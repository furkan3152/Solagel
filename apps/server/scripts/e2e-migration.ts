/**
 * End-to-end check of the arena v1 -> v2 migration (docs/OPERATIONS.md, "Moving the testnet to the
 * fee-on-entry arena (v2)", and the legacy card in /admin -> Game -> the arena contract), against a real
 * EVM (a fresh `hardhat node`) and a real game server (real chain, never DEV_FAKE_CHAIN):
 *
 *  0. the testnet as it is today: the LEGACY v1 arena (fee on profit; its creation code is kept in
 *     scripts/fixtures/elymum-arena-v1.bytecode, runtime code hash pinned in @elymum/contracts legacy.ts),
 *     the TestToken and the NFT, registered through /api/admin/contracts, set up with /admin -> Setup's
 *     own step list (token, the four arenas, the server key as minter, holder perks 3 %, holders-only #4);
 *     staked testnet bots play (31337 counts as a test chain);
 *  1. two players play arena 1 on v1 and a third buys a ticket and never plays. While they are live the
 *     admin deploys the new arena from the legacy card (`deployArenaParams(arenaDeployArgs(...))`) and the
 *     server REFUSES the registry switch (409: the journal owes money on the old arena); DELETE too;
 *  2. Start / stop: every arena of the old contract is disabled; the bell settles the players (fee on
 *     profit), the unplayed ticket is settled at its entry fee by the sweeper, the bots' tickets settle;
 *     the open-ticket counts reach 0 and no loot is left on the floors;
 *  3. Advanced -> sweep: each disabled arena's vault of the old contract goes to the fee wallet;
 *  4. the new arena registers (201), the server switches without a restart and reads the v2 rule;
 *  5. Setup on the new arena (same step list): same token, four arenas, holder perks 3 %, holders-only
 *     #4, and a fee wallet that is not the deployer;
 *  6. a ticket on v2 plays `entry - fee` and settles at the bell; staked bots buy on the new arena;
 *  7. owed payouts on the old address stay collectable: a v1 arena whose player transfer fails (the
 *     test BlockingToken) finalizes the session with `owed`, the arena is disabled and swept, and the
 *     player still collects with `refund` afterwards.
 *
 *   pnpm -F @elymum/server e2e:migration
 *   RPC_URL=http://127.0.0.1:8545 pnpm -F @elymum/server e2e:migration   # a node you started
 *
 * Needs the compiled contracts for step 7 (`pnpm -F @elymum/contracts compile`, offline once the solc
 * 0.8.28 compiler is cached); the script runs it when the artifact is missing.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HOLDER_FEE_BPS,
  ELYMUM_ARENA_V1_RUNTIME_CODE_HASH,
  elymumArenaAbi,
  approveCall,
  computeEntryFee,
  createElymumPublicClient,
  createElymumWalletClient,
  deployArenaParams,
  deployNft,
  deployTestToken,
  deployedAddress,
  describeError,
  elysiumChain,
  faucetCall,
  getArena,
  getArenaConfig,
  getArenaVersion,
  getSession,
  getTokenBalance,
  joinCall,
  listArenas,
  planJoin,
  refundCall,
  sendCall,
  setFeeWalletCall,
  setTokenCall,
  settleCall,
  sweepArenaCall,
  updateArenaFrom,
  createArenaCall,
  type ContractCall,
} from '@elymum/sdk';
import { fetchStatus, type StatusSnapshot } from '@elymum/sdk/ops';
import { PROTOCOL_VERSION, type ChainStatus, type ServerMessage } from '@elymum/shared';
import { keccak256, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import WebSocket from 'ws';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SERVER_DIR = resolve(ROOT, 'apps/server');
const CONTRACTS_DIR = resolve(ROOT, 'packages/contracts');
const V1_BYTECODE = readFileSync(resolve(SERVER_DIR, 'scripts/fixtures/elymum-arena-v1.bytecode'), 'utf8').trim() as Hex;
const port = Number(process.env.PORT ?? 8788);
const nodePort = Number(process.env.NODE_PORT ?? 8546);
const rpcUrl = process.env.RPC_URL ?? `http://127.0.0.1:${nodePort}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
/** Hardhat dev account #0: the owner / admin (funded with 10,000 HYPE on the node). */
const ADMIN_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ARENA_ID = 1;
const ROUND_ENV = { ROUND_SECONDS: '20', ROUND_JOIN_CLOSE_SECONDS: '3', ARENA_BOT_TARGET: '2', ARENA_BOT_MIN: '0', ARENA_BOT_MAX: '2', BOT_TICKETS_PER_MIN: '30' };

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const step = (msg: string) => console.log(`${elapsed()}  > ${msg}`);
const ok = (msg: string) => console.log(`${elapsed()}  OK ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Fail extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}

async function waitUntil<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, everyMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe().catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) throw new Fail(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(everyMs);
  }
}

async function getJson<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${httpUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return (await res.json()) as T;
}

/* ── processes ───────────────────────────────────────────────────────────── */

const children: ChildProcess[] = [];
let dataDir: string | null = null;
const serverLog: string[] = [];

async function rpcUp(): Promise<boolean> {
  try {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
    return r.ok && /"result"/.test(await r.text());
  } catch {
    return false;
  }
}

async function startNode(): Promise<void> {
  if (process.env.RPC_URL) {
    assert(await rpcUp(), `no EVM node answers at ${rpcUrl}`);
    return;
  }
  assert(!(await rpcUp()), `something already answers at ${rpcUrl}: stop it or set RPC_URL`);
  const child = spawn('pnpm', ['-F', '@elymum/contracts', 'exec', 'hardhat', 'node', '--port', String(nodePort)], { cwd: ROOT, detached: true, stdio: 'ignore' });
  children.push(child);
  await waitUntil('the hardhat node', 90_000, rpcUp, 300);
}

async function startServer(serverKey: string): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), 'elymum-migration-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...ROUND_ENV,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    PUBLIC_URL: httpUrl,
    DATA_DIR: dataDir,
    EVM_RPC_URL: rpcUrl,
    SERVER_PRIVATE_KEY: serverKey,
    ADMIN_WALLETS: admin.address,
    GAME_ACCESS: 'public',
    STALE_SESSION_AFTER_S: '8',
  };
  for (const k of ['DEV_FAKE_CHAIN', 'ARENA_ADDRESS', 'NFT_ADDRESS', 'TOKEN_ADDRESS']) delete env[k];
  const child = spawn(resolve(SERVER_DIR, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(child);
  const show = (buf: Buffer) =>
    buf
      .toString()
      .split('\n')
      .filter((l) => l.trim())
      .forEach((l) => {
        serverLog.push(l);
        if (/chain:|contracts:|bots:|!!!|rror/.test(l) && !/bought a ticket|settled 1:|settled \d+:/.test(l)) console.log(`        server │ ${l.replace(/^\[[^\]]+\] /, '')}`);
      });
  child.stdout?.on('data', show);
  child.stderr?.on('data', show);
  await waitUntil('the game server', 30_000, async () => (await fetch(`${httpUrl}/api/health`)).ok);
}

function stopAll(): void {
  for (const c of children) {
    if (c.exitCode !== null || c.pid === undefined) continue;
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {
      c.kill('SIGTERM');
    }
  }
  try {
    // the server may still be writing its state while it exits
    if (dataDir && !process.env.KEEP_DATA) rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* left in the temp dir */
  }
}

/* ── chain helpers ───────────────────────────────────────────────────────── */

const chain = elysiumChain(31337, { rpcUrl });
const client: PublicClient = createElymumPublicClient(rpcUrl, chain, { pollingInterval: 100 });
const wallets = new Map<Address, WalletClient>();
const admin = privateKeyToAccount(ADMIN_KEY);

function account(): PrivateKeyAccount {
  const a = privateKeyToAccount(generatePrivateKey());
  wallets.set(a.address, createElymumWalletClient(rpcUrl, { account: a, chain, pollingInterval: 100 }));
  return a;
}
wallets.set(admin.address, createElymumWalletClient(rpcUrl, { account: admin, chain, pollingInterval: 100 }));

async function fund(to: Address, hype = 10n ** 18n): Promise<void> {
  const hash = await wallets.get(admin.address)!.sendTransaction({ account: admin, chain, to, value: hype });
  await client.waitForTransactionReceipt({ hash });
}

async function send(from: PrivateKeyAccount, call: ContractCall, what: string): Promise<void> {
  try {
    const hash = await sendCall(wallets.get(from.address)!, call);
    const r = await client.waitForTransactionReceipt({ hash });
    assert(r.status === 'success', `${what} reverted (${hash})`);
  } catch (err) {
    if (err instanceof Fail) throw err;
    throw new Fail(`${what}: ${describeError(err).message}`);
  }
}

async function deployRaw(from: PrivateKeyAccount, abi: Abi, bytecode: Hex, args: readonly unknown[]): Promise<Address> {
  const hash = await wallets.get(from.address)!.deployContract({ abi, bytecode, args, account: from, chain } as never);
  return deployedAddress(client, hash);
}

async function codeHash(address: Address): Promise<string> {
  const code = await client.getCode({ address });
  return code ? keccak256(code) : '0x';
}

/** /admin -> Setup: runs every step the panel would list for this arena, in order (signed by the owner). */
async function runSetup(arena: Address, nft: Address, token: Address, serverKey: Address): Promise<string[]> {
  // the exact step list of /admin -> Setup (pure, no React; loaded at run time so the server's typecheck
  // does not follow the web app's Vite-typed modules)
  const { setupSteps } = (await import(resolve(ROOT, 'apps/web/src/admin/setup.ts'))) as {
    setupSteps: (ctx: { status: StatusSnapshot | null; net: { serverKey: string | null } }, opts: { openMint: boolean }) => { id: string; label: string; call: ContractCall }[];
  };
  const status = await fetchStatus(client, { arena, nft, testToken: token, account: admin.address });
  const steps = setupSteps({ status, net: { serverKey } }, { openMint: false });
  for (const s of steps) await send(admin, s.call, `setup: ${s.label}`);
  return steps.map((s) => s.id);
}

/* ── game client ─────────────────────────────────────────────────────────── */

class Player {
  msgs: ServerMessage[] = [];
  private constructor(
    readonly name: string,
    readonly account: PrivateKeyAccount,
    readonly ws: WebSocket,
  ) {
    ws.on('message', (data, isBinary) => {
      if (!isBinary) this.msgs.push(JSON.parse(data.toString()) as ServerMessage);
    });
  }

  static async connect(name: string, acct: PrivateKeyAccount): Promise<Player> {
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
    const p = new Player(name, acct, ws);
    p.send({ t: 'hello', v: PROTOCOL_VERSION });
    await p.wait('welcome');
    return p;
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  wait<T extends ServerMessage['t']>(t: T, timeoutMs = 10_000, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { t: T }>> {
    return waitUntil(`${this.name}: ${t}`, timeoutMs, async () => this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>)) as Extract<ServerMessage, { t: T }> | undefined, 50);
  }

  async signIn(): Promise<void> {
    const n = await getJson<{ message: string }>(`/api/auth/nonce?address=${this.account.address}`);
    this.send({ t: 'auth', address: this.account.address, message: n.message, signature: await this.account.signMessage({ message: n.message }) });
    await this.wait('authed');
  }

  /** Joins the arena room, waiting out a closed join window. */
  async joinArena(arenaId: number): Promise<Extract<ServerMessage, { t: 'joined' }>> {
    for (;;) {
      this.msgs = this.msgs.filter((m) => m.t !== 'error' && m.t !== 'joined');
      this.send({ t: 'join', room: `arena:${arenaId}`, name: this.name, skin: 1 });
      const r = await waitUntil(`${this.name} join`, 15_000, async () => this.msgs.find((m) => m.t === 'joined' || m.t === 'error'));
      if (r.t === 'joined') return r;
      assert(r.t === 'error' && r.code === 'round_closed', `${this.name}: ${JSON.stringify(r)}`);
      await sleep(Math.max(200, (r.opensAt ?? Date.now()) - Date.now() + 200));
    }
  }

  close(): void {
    this.ws.close();
  }
}

async function httpLogin(acct: PrivateKeyAccount): Promise<string> {
  const n = await getJson<{ message: string }>(`/api/auth/nonce?address=${acct.address}`);
  const res = await fetch(`${httpUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: acct.address, message: n.message, signature: await acct.signMessage({ message: n.message }) }),
  });
  const body = (await res.json()) as { token?: string; admin?: boolean };
  assert(res.ok && body.token && body.admin, `admin login failed: ${JSON.stringify(body)}`);
  return body.token;
}

async function register(adminToken: string, kind: 'arena' | 'nft' | 'token', address: Address): Promise<{ status: number; body: { error?: string; code?: string; message?: string } }> {
  const res = await fetch(`${httpUrl}/api/admin/contracts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ kind, address }),
  });
  return { status: res.status, body: (await res.json()) as { error?: string; message?: string } };
}

const status = async () => (await getJson<{ chain: ChainStatus }>('/api/config')).chain;

/* ── the run ─────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  step(`EVM node at ${rpcUrl}`);
  await startNode();
  const serverKey = generatePrivateKey();
  const server = privateKeyToAccount(serverKey);
  const feeWallet = account();
  const newFeeWallet = account();
  const [hunter, prey, idle, v2player] = [account(), account(), account(), account()];
  for (const a of [server, feeWallet, newFeeWallet, hunter, prey, idle, v2player]) await fund(a.address, a === server ? 10n ** 19n : 10n ** 18n);

  step('0. the testnet today: TestToken, NFT and the LEGACY v1 arena, registered and set up');
  const token = await deployedAddress(client, await deployTestToken(wallets.get(admin.address)!, { owner: admin.address }));
  const nft = await deployedAddress(
    client,
    await deployNft(wallets.get(admin.address)!, { owner: admin.address, maxSupply: 5000, mintPrice: 0n, wlLimit: 2, publicLimit: 5, baseURI: `${httpUrl}/api/nft/`, treasury: admin.address }),
  );
  const oldArena = await deployRaw(admin, elymumArenaAbi as Abi, V1_BYTECODE, [admin.address, server.address, feeWallet.address]);
  assert((await codeHash(oldArena)) === ELYMUM_ARENA_V1_RUNTIME_CODE_HASH, 'the v1 fixture is not the build live on the testnet (runtime code hash differs)');
  assert((await getArenaVersion(client, oldArena)) === 1, 'the SDK does not read the v1 arena as version 1');
  ok(`token ${token} · nft ${nft} · v1 arena ${oldArena} (runtime code hash = the testnet's)`);

  await startServer(serverKey);
  const adminToken = await httpLogin(admin);
  for (const [kind, address] of [
    ['token', token],
    ['nft', nft],
    ['arena', oldArena],
  ] as const) {
    const r = await register(adminToken, kind, address);
    assert(r.status === 201, `register ${kind}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
  const v1setup = await runSetup(oldArena, nft, token, server.address);
  ok(`v1 Setup ran: ${v1setup.join(', ')}`);
  let st = await waitUntil('arenas on (v1)', 60_000, async () => {
    const s = await status();
    return s.arenaAddress === oldArena && s.tokenReady && s.arenasEnabled ? s : null;
  });
  assert(st.feeModel === 'profit', `v1 arena: feeModel ${st.feeModel}`);
  ok('the server runs the v1 arena: feeModel "profit"');

  step('1. tickets on v1: two players play arena 1, a third buys a ticket and never plays; bots stake');
  for (const [who, acct] of [
    ['hunter', hunter],
    ['prey', prey],
    ['idle', idle],
  ] as const) {
    await send(acct, faucetCall(token), `${who} faucet`);
    for (const call of (await planJoin(client, { arena: oldArena, arenaId: ARENA_ID, player: acct.address, token })).calls) await send(acct, call, `${who} ${call.functionName}`);
  }
  const h = await Player.connect('Hunter', hunter);
  const p = await Player.connect('Prey', prey);
  await h.signIn();
  await p.signIn();
  const [jh, jp] = [await h.joinArena(ARENA_ID), await p.joinArena(ARENA_ID)];
  const entry = (await getArena(client, oldArena, ARENA_ID)).entryFee;
  ok(`joined on v1: ${jh.session} / ${jp.session} play value ${jh.value} (v1: the whole entry fee)`);
  step('1b. the admin deploys the new arena from the legacy card while players are live: the switch is refused');
  // the legacy card's deploy (`arenaDeployArgs`): owner = the connected wallet, settler = the server's published key, fee wallet = the owner
  assert(st.serverKey === server.address, `the server publishes the key ${st.serverKey}`);
  const params = deployArenaParams({ admin: admin.address, serverAuthority: st.serverKey, feeWallet: admin.address });
  const newArena = await deployRaw(admin, params.abi as Abi, params.bytecode, params.args);
  assert((await getArenaVersion(client, newArena)) === 2, 'the bundled arena is not v2');
  const refused = await register(adminToken, 'arena', newArena);
  assert(refused.status === 409, `expected 409 while the journal owes money on the old arena, got ${refused.status} ${JSON.stringify(refused.body)}`);
  const del = await fetch(`${httpUrl}/api/admin/contracts?kind=arena`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });
  assert(del.status === 409, `DELETE arena while owed: HTTP ${del.status}`);
  assert((await status()).arenaAddress === oldArena, 'the registry moved although refused');
  ok(`refused: ${refused.body.message}`);

  await waitUntil('a staked bot ticket on the v1 arena', 60_000, async () => serverLog.some((l) => /bots: .* bought a ticket in arena #/.test(l)), 1_000);
  ok('staked bots bought tickets on the v1 arena');

  step('2. Start / stop: close every arena of the old contract, wait for the bell, the sweeper and the bots');
  for (const a of await listArenas(client, oldArena)) if (a.enabled) await send(admin, updateArenaFrom(oldArena, a, { enabled: false }), `disable arena #${a.id}`);
  const [sh, sp] = await Promise.all([h.wait('settled', 60_000, (m) => m.session === jh.session), p.wait('settled', 60_000, (m) => m.session === jp.session)]);
  ok(`the bell settled both on v1: hunter ${sh.payout} (fee ${sh.fee ?? 0}), prey ${sp.payout} (fee ${sp.fee ?? 0})`);
  await waitUntil('every open ticket of the old contract settled or refunded', 180_000, async () => {
    const list = await listArenas(client, oldArena);
    return list.every((a) => a.openSessions === 0);
  }, 2_000);
  assert((await getSession(client, oldArena, ARENA_ID, idle.address)).id === 0n, 'the unplayed ticket is still open');
  ok('open tickets: 0 on all four arenas (the unplayed one was settled at its entry fee by the sweeper)');
  await waitUntil('no loot left on the old arena floors', 90_000, async () => {
    const r = await getJson<{ rooms: { arenaId?: number; loot?: number }[] }>('/api/rooms');
    return r.rooms.every((x) => !x.loot);
  }, 1_000);
  // a loot sweep queued at the bell is sent within seconds: give it time before the vault goes
  await sleep(8_000);

  step('3. Advanced -> sweep: each disabled arena vault of the OLD contract to the fee wallet');
  const feeBefore = await getTokenBalance(client, token, feeWallet.address);
  for (const a of await listArenas(client, oldArena)) await send(admin, sweepArenaCall(oldArena, a.id), `sweepArena #${a.id}`);
  const swept = (await getTokenBalance(client, token, feeWallet.address)) - feeBefore;
  assert((await listArenas(client, oldArena)).every((a) => a.vault === 0n), 'a vault of the old arena is not empty after the sweep');
  ok(`swept ${swept} base units of dust to the fee wallet`);

  step('4. the new arena registers; the server switches without a restart and reads the v2 rule');
  const reg = await waitUntil('the registry switch (journal idle)', 60_000, async () => {
    const r = await register(adminToken, 'arena', newArena);
    if (r.status !== 201) console.log(`        (register: ${r.status} ${r.body.message ?? ''})`);
    return r.status === 201 ? r : null;
  }, 3_000);
  assert(reg.status === 201, 'registered');
  st = await waitUntil('the server on the new arena', 30_000, async () => {
    const s = await status();
    return s.arenaAddress === newArena ? s : null;
  });
  assert(!st.tokenReady && !st.arenasEnabled, 'the new arena has no token yet: arenas must be off');
  assert(serverLog.some((l) => l.includes(`arena contract changed ${oldArena} → ${newArena}`)), 'no "arena contract changed" log line');
  ok('switched: the server runs the new arena (token not set yet: practice only)');

  step('5. Setup on the new arena: same token, four arenas, holder perks 3 %, holders-only #4, fee wallet');
  const v2setup = await runSetup(newArena, nft, token, server.address);
  assert(v2setup.includes('token') && v2setup.includes('perks') && v2setup.includes('holders-4') && v2setup.filter((s) => s.startsWith('arena-')).length === 4, `setup steps: ${v2setup.join(', ')}`);
  await send(admin, setFeeWalletCall(newArena, newFeeWallet.address), 'setFeeWallet');
  const cfg = await getArenaConfig(client, newArena);
  assert(cfg.token?.toLowerCase() === token.toLowerCase(), 'the new arena has another token');
  assert(cfg.holderFeeBps === DEFAULT_HOLDER_FEE_BPS && cfg.holderNft?.toLowerCase() === nft.toLowerCase(), `holder perks: ${cfg.holderFeeBps} / ${cfg.holderNft}`);
  assert(cfg.feeWallet.toLowerCase() === newFeeWallet.address.toLowerCase(), 'fee wallet');
  const arenas = await listArenas(client, newArena);
  assert(arenas.length === 4 && arenas.every((a) => a.enabled) && arenas.find((a) => a.id === 4)?.holdersOnly && !arenas.find((a) => a.id === 1)?.holdersOnly, 'arenas');
  ok(`v2 Setup ran: ${v2setup.join(', ')} + fee wallet ${newFeeWallet.address}`);
  st = await waitUntil('arenas on (v2)', 60_000, async () => {
    const s = await status();
    return s.tokenReady && s.arenasEnabled ? s : null;
  });
  assert(st.feeModel === 'entry', `v2 arena: feeModel ${st.feeModel}`);
  ok('the server pushed the v2 arena on: feeModel "entry"');

  step('6. a ticket on v2 plays entry - fee and settles at the bell; staked bots buy on the new arena');
  await send(v2player, faucetCall(token), 'v2player faucet');
  for (const call of (await planJoin(client, { arena: newArena, arenaId: ARENA_ID, player: v2player.address, token })).calls) await send(v2player, call, `v2player ${call.functionName}`);
  const s2 = await getSession(client, newArena, ARENA_ID, v2player.address);
  const fee = computeEntryFee(s2.entryFee, s2.feeBps);
  const v = await Player.connect('Newbie', v2player);
  await v.signIn();
  const jv = await v.joinArena(ARENA_ID);
  const decimalsShift = 10n ** 12n; // 18-decimal token, 6-decimal ledger
  assert(BigInt(jv.value ?? -1) === (s2.entryFee - fee) / decimalsShift, `v2 ticket value ${jv.value}, expected ${(s2.entryFee - fee) / decimalsShift}`);
  ok(`joined on v2: value ${jv.value} = entry ${s2.entryFee / decimalsShift} - fee ${fee / decimalsShift} (${s2.feeBps} bps)`);
  const sv = await v.wait('settled', 60_000, (m) => m.session === jv.session);
  ok(`settled on v2 at the bell: ${sv.payout} · ${sv.txHash}`);
  const botBuysBefore = serverLog.filter((l) => l.includes(`bought a ticket`)).length;
  await waitUntil('a staked bot ticket on the new arena', 120_000, async () => {
    const list = await listArenas(client, newArena);
    return serverLog.filter((l) => l.includes('bought a ticket')).length > botBuysBefore && list.some((a) => a.openSessions > 0 || a.totalDeposited > s2.entryFee);
  }, 2_000);
  ok('staked bots buy their tickets on the new arena by themselves');
  assert(!serverLog.some((l) => /!!!/.test(l) && !/KEPT DISABLED/.test(l)), `alarms in the server log:\n${serverLog.filter((l) => /!!!/.test(l)).join('\n')}`);

  step('7. owed payouts on the old address stay collectable after close + sweep (v1, a failing player transfer)');
  const artifact = resolve(CONTRACTS_DIR, 'artifacts/contracts/test/MockTokens.sol/BlockingToken.json');
  if (!existsSync(artifact)) spawnSync('pnpm', ['-F', '@elymum/contracts', 'compile'], { cwd: ROOT, stdio: 'inherit' });
  const blk = JSON.parse(readFileSync(artifact, 'utf8')) as { abi: Abi; bytecode: Hex };
  const blkToken = await deployRaw(admin, blk.abi, blk.bytecode, []);
  // the admin acts as the server authority of this side arena (the game server is not involved)
  const side = await deployRaw(admin, elymumArenaAbi as Abi, V1_BYTECODE, [admin.address, admin.address, feeWallet.address]);
  await send(admin, setTokenCall(side, blkToken), 'side setToken');
  await send(admin, createArenaCall(side, { id: 1, entryFee: entry, maxSessions: 10 }), 'side createArena');
  const mint = (to: Address, amount: bigint): ContractCall => ({ address: blkToken, abi: blk.abi, functionName: 'mint', args: [to, amount] }) as ContractCall;
  const block = (who: Address, b: boolean): ContractCall => ({ address: blkToken, abi: blk.abi, functionName: 'setBlocked', args: [who, b] }) as ContractCall;
  await send(admin, mint(hunter.address, entry), 'mint');
  await send(hunter, approveCall(blkToken, side, entry), 'approve');
  await send(hunter, joinCall(side, 1), 'join side');
  const sess = await getSession(client, side, 1, hunter.address);
  await send(admin, block(hunter.address, true), 'block player');
  await send(admin, settleCall(side, [{ arenaId: 1, player: hunter.address, sessionId: sess.id, payout: entry }]), 'settle (transfer fails)');
  const fin = await getSession(client, side, 1, hunter.address);
  assert(fin.finalized && fin.owed === entry, `expected a finalized session owing ${entry}, got ${JSON.stringify({ finalized: fin.finalized, owed: String(fin.owed) })}`);
  const sa = await getArena(client, side, 1);
  await send(admin, updateArenaFrom(side, sa, { enabled: false }), 'side disable');
  await send(admin, sweepArenaCall(side, 1), 'side sweep (owed stays reserved)');
  await send(admin, block(hunter.address, false), 'unblock player');
  const before = await getTokenBalance(client, blkToken, hunter.address);
  await send(hunter, refundCall(side, 1), 'collect');
  const got = (await getTokenBalance(client, blkToken, hunter.address)) - before;
  assert(got === entry, `collected ${got}, expected ${entry}`);
  ok(`the owed payout (${entry}) was collected from the old address after the arena was closed and swept`);

  h.close();
  p.close();
  v.close();
  console.log(`\n${elapsed()}  MIGRATION E2E PASSED`);
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

main()
  .then(() => {
    stopAll();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n${elapsed()}  MIGRATION E2E FAILED: ${err instanceof Fail ? err.message : ((err as Error).stack ?? err)}`);
    if (dataDir) console.error(`server data: ${dataDir}`);
    stopAll();
    process.exit(1);
  });

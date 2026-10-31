/**
 * End-to-end check of Elymum against a real EVM (a fresh `hardhat node`) and a real game server (real
 * chain, never DEV_FAKE_CHAIN). It follows the launch order of /admin → Deploy:
 *
 *  1. a hardhat node starts (or `RPC_URL` points at one you run); the admin deploys the TestToken and the
 *     arena (server authority = the game server's key) WITHOUT setting the token;
 *  2. the game server starts with `EVM_RPC_URL` + `SERVER_PRIVATE_KEY` and no `ARENA_ADDRESS`: it waits for
 *     contracts (practice only); the admin signs in with SIWE and registers the arena through
 *     `POST /api/admin/contracts` (code hash, owner and server authority checked), picked up at once;
 *  3. arena joins answer `token_not_set`; the admin calls `setToken` and creates the four arenas; the
 *     running server picks the token up (config watcher, ≤ 30 s) and pushes `chain` with `tokenReady: true`;
 *  4. two players sign in over the WebSocket with SIWE, take test tokens from the faucet and buy a ticket
 *     for the same arena (`approve` + `join`); a third buys a ticket and never plays;
 *  5. at the bell both live stakers are paid their value in ONE settle batch (`settled` with the same
 *     `txHash`), the fee wallet receives the fee on any profit, and the unplayed ticket is settled at its
 *     entry fee by the stale-session sweeper; the arena vault ends where it started (conservation).
 *
 *   pnpm -F @elymum/server e2e                 # starts hardhat node + the game server itself
 *   RPC_URL=http://127.0.0.1:8545 pnpm -F @elymum/server e2e   # use a node you started
 *
 * Env: RPC_URL (default: spawn `hardhat node` on NODE_PORT, default 8545), PORT (game server, default 8787).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultArenaCalls,
  createElymumPublicClient,
  createElymumWalletClient,
  deployArena,
  deployTestToken,
  deployedAddress,
  describeError,
  elysiumChain,
  faucetCall,
  formatTokenAmount,
  getArena,
  getSession,
  getTokenBalance,
  planJoin,
  sendCall,
  setTokenCall,
  type ContractCall,
} from '@elymum/sdk';
import { PROTOCOL_VERSION, type ChainStatus, type ServerMessage } from '@elymum/shared';
import type { Address, PublicClient, WalletClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import WebSocket from 'ws';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SERVER_DIR = resolve(ROOT, 'apps/server');
const port = Number(process.env.PORT ?? 8787);
const nodePort = Number(process.env.NODE_PORT ?? 8545);
const rpcUrl = process.env.RPC_URL ?? `http://127.0.0.1:${nodePort}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
/** Hardhat's well-known dev accounts (funded with 10,000 HYPE each on the node). */
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
] as const;
const [admin, hunter, prey, idle, feeWallet] = KEYS.map((k) => privateKeyToAccount(k));
const ARENA_ID = 1;
const ROUND_ENV = { ROUND_SECONDS: '20', ROUND_JOIN_CLOSE_SECONDS: '3', ARENA_BOT_TARGET: '0', ARENA_BOT_MIN: '0', ARENA_BOT_MAX: '0' };

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const step = (msg: string) => console.log(`${elapsed()}  > ${msg}`);
const ok = (msg: string) => console.log(`${elapsed()}  OK ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tok = (raw: bigint) => `${formatTokenAmount(raw, 18)} tELYMUM`;

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
  const child = spawn('pnpm', ['-F', '@elymum/contracts', 'exec', 'hardhat', 'node', '--port', String(nodePort)], { cwd: ROOT, detached: true, stdio: 'ignore' });
  children.push(child);
  await waitUntil('the hardhat node', 60_000, rpcUp, 300);
}

/** Starts the game server (real chain, no arena address: it waits for the registry); resolves once it answers. */
async function startServer(serverKey: string): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), 'elymum-e2e-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...ROUND_ENV,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    EVM_RPC_URL: rpcUrl,
    SERVER_PRIVATE_KEY: serverKey,
    ADMIN_WALLETS: admin.address,
    // the run plays as ordinary wallets: open the game to everyone
    GAME_ACCESS: 'public',
    STALE_SESSION_AFTER_S: '8',
  };
  for (const k of ['DEV_FAKE_CHAIN', 'ARENA_ADDRESS', 'NFT_ADDRESS']) delete env[k];
  const child = spawn(resolve(SERVER_DIR, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const show = (buf: Buffer) =>
    buf
      .toString()
      .split('\n')
      .filter((l) => /chain:|contracts:|arena|!!!|error|Error/.test(l))
      .forEach((l) => console.log(`        server │ ${l.replace(/^\[[^\]]+\] /, '')}`));
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
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

/* ── chain helpers ───────────────────────────────────────────────────────── */

let client: PublicClient;
const wallets = new Map<Address, WalletClient>();

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

  static async connect(name: string, account: PrivateKeyAccount): Promise<Player> {
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
    const p = new Player(name, account, ws);
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

  /** SIWE over the WebSocket: nonce from `/api/auth/nonce`, `personal_sign`, `auth`. */
  async signIn(): Promise<string> {
    const n = await getJson<{ message: string }>(`/api/auth/nonce?address=${this.account.address}`);
    this.send({ t: 'auth', address: this.account.address, message: n.message, signature: await this.account.signMessage({ message: n.message }) });
    const authed = await this.wait('authed');
    assert(authed.address === this.account.address, `${this.name}: signed in as ${authed.address}`);
    return authed.token;
  }

  close(): void {
    this.ws.close();
  }
}

/** HTTP SIWE sign-in (the site's `/api/auth/login`); returns the session token. */
async function httpLogin(account: PrivateKeyAccount): Promise<string> {
  const n = await getJson<{ message: string }>(`/api/auth/nonce?address=${account.address}`);
  const res = await fetch(`${httpUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: account.address, message: n.message, signature: await account.signMessage({ message: n.message }) }),
  });
  const body = (await res.json()) as { token?: string; admin?: boolean; error?: string };
  assert(res.ok && body.token && body.admin, `admin login failed: ${JSON.stringify(body)}`);
  return body.token;
}

/* ── the run ─────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  step(`EVM node at ${rpcUrl}`);
  await startNode();
  const chain = elysiumChain(31337, { rpcUrl });
  client = createElymumPublicClient(rpcUrl, chain, { pollingInterval: 100 });
  for (const a of [admin, hunter, prey, idle, feeWallet]) wallets.set(a.address, createElymumWalletClient(rpcUrl, { account: a, chain, pollingInterval: 100 }));
  const serverKey = generatePrivateKey();
  const server = privateKeyToAccount(serverKey);
  // the server key pays gas in HYPE
  const fund = await wallets.get(admin.address)!.sendTransaction({ account: admin, chain, to: server.address, value: 10n ** 18n });
  await client.waitForTransactionReceipt({ hash: fund });

  step('1. deploy the TestToken and the arena (no token set yet)');
  const token = await deployedAddress(client, await deployTestToken(wallets.get(admin.address)!, { owner: admin.address }));
  const arenaTx = await deployArena(wallets.get(admin.address)!, { admin: admin.address, serverAuthority: server.address, feeWallet: feeWallet.address });
  const arena = await deployedAddress(client, arenaTx);
  ok(`token ${token} · arena ${arena} · server key ${server.address}`);

  step('2. the game server waits for contracts; the admin registers the arena (SIWE + /api/admin/contracts)');
  await startServer(serverKey);
  let status = (await getJson<{ chain: ChainStatus }>('/api/config')).chain;
  assert(status.enabled && status.arenaAddress === null && !status.tokenReady, `expected "waiting for contracts", got ${JSON.stringify(status)}`);
  const adminToken = await httpLogin(admin);
  const reg = await fetch(`${httpUrl}/api/admin/contracts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ kind: 'arena', address: arena, txHash: arenaTx }),
  });
  assert(reg.status === 201, `register arena: HTTP ${reg.status} ${await reg.text()}`);
  status = await waitUntil('the registered arena', 10_000, async () => {
    const s = (await getJson<{ chain: ChainStatus }>('/api/config')).chain;
    return s.arenaAddress === arena ? s : null;
  });
  assert(!status.tokenReady, 'the token is not set yet');
  ok('arena registered and picked up without a restart; tokenReady false');

  step('3. arena joins answer token_not_set; then setToken + the four arenas');
  const h = await Player.connect('hunter', hunter);
  await h.signIn();
  h.send({ t: 'join', room: `arena:${ARENA_ID}`, name: 'Hunter', skin: 1 });
  await h.wait('error', 10_000, (m) => m.code === 'token_not_set');
  await send(admin, setTokenCall(arena, token), 'setToken');
  for (const call of createDefaultArenaCalls(arena, 18)) await send(admin, call, 'createArena');
  const pushed = await h.wait('chain', 45_000, (m) => m.chain.tokenReady && m.chain.arenasEnabled);
  ok(`the server pushed tokenReady (token ${pushed.chain.token?.address}, ${pushed.chain.token?.decimals} decimals)`);

  step('4. tickets: two players join arena 1, a third buys a ticket and never plays');
  const vaultBefore = (await getArena(client, arena, ARENA_ID)).vault;
  for (const [who, acct] of [
    ['hunter', hunter],
    ['prey', prey],
    ['idle', idle],
  ] as const) {
    await send(acct, faucetCall(token), `${who} faucet`);
    for (const call of (await planJoin(client, { arena, arenaId: ARENA_ID, player: acct.address, token })).calls) await send(acct, call, `${who} ${call.functionName}`);
  }
  const p = await Player.connect('prey', prey);
  await p.signIn();
  const joinWhenOpen = async (pl: Player, name: string) => {
    for (;;) {
      pl.msgs = pl.msgs.filter((m) => m.t !== 'error' && m.t !== 'joined');
      pl.send({ t: 'join', room: `arena:${ARENA_ID}`, name, skin: 1 });
      const r = await waitUntil(`${name} join`, 10_000, async () => pl.msgs.find((m) => m.t === 'joined' || m.t === 'error'));
      if (r.t === 'joined') return r;
      assert(r.t === 'error' && r.code === 'round_closed', `${name}: ${JSON.stringify(r)}`);
      await sleep(Math.max(200, (r.opensAt ?? Date.now()) - Date.now() + 200));
    }
  };
  const jh = await joinWhenOpen(h, 'Hunter');
  const jp = await joinWhenOpen(p, 'Prey');
  assert(jh.session && jp.session, 'joined without a session key');
  ok(`joined: ${jh.session} and ${jp.session} (value ${jh.value} ledger units each)`);

  step('5. the bell: one settle batch pays both; the stale ticket is settled at its entry fee');
  const [sh, sp] = await Promise.all([
    h.wait('settled', 60_000, (m) => m.session === jh.session),
    p.wait('settled', 60_000, (m) => m.session === jp.session),
  ]);
  assert(/^0x[0-9a-f]{64}$/.test(sh.txHash) && sh.txHash === sp.txHash, `expected one batch, got ${sh.txHash} and ${sp.txHash}`);
  ok(`settled in one batch ${sh.txHash}: hunter ${sh.payout} (fee ${sh.fee ?? 0}), prey ${sp.payout} (fee ${sp.fee ?? 0})`);
  await waitUntil('the stale ticket to be settled', 60_000, async () => (await getSession(client, arena, ARENA_ID, idle.address)).id === 0n, 1_000);
  ok('the unplayed ticket was settled at its entry fee by the sweeper');
  const vaultAfter = (await getArena(client, arena, ARENA_ID)).vault;
  const fees = await getTokenBalance(client, token, feeWallet.address);
  assert(vaultAfter === vaultBefore, `conservation: vault ${tok(vaultBefore)} before, ${tok(vaultAfter)} after`);
  ok(`conservation: the arena vault is back at ${tok(vaultAfter)}; fees collected ${tok(fees)}`);
  h.close();
  p.close();
  console.log(`\n${elapsed()}  E2E PASSED`);
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
    console.error(`\n${elapsed()}  E2E FAILED: ${err instanceof Fail ? err.message : ((err as Error).stack ?? err)}`);
    stopAll();
    process.exit(1);
  });

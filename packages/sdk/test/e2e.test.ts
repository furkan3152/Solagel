/**
 * End to end against a real EVM: spawns `hardhat node` (from @elymum/contracts) on a free port,
 * deploys the TestToken, the arena and the NFT with the SDK's helpers, and runs the money paths:
 * set the token, create the default arenas, join (approve-if-needed), settle a batch (fee checked
 * against math.ts and the contract's computeFee), burn loot, then the allowlist mint with a proof
 * built in TypeScript (excess refunded) and the treasury withdrawal.
 *
 * Skips itself when the node cannot start within 40 s (no Hardhat, or no network for the compiler
 * download). The child process group is killed when the suite ends or the process exits.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address, Hash, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BURN_ADDRESS,
  DEFAULT_FEE_BPS,
  MintPhase,
  buildMerkleTree,
  computeFee,
  computeFeeOnChain,
  createDefaultArenaCalls,
  createElymumPublicClient,
  createElymumWalletClient,
  deployArena,
  deployNft,
  deployTestToken,
  deployedAddress,
  describeError,
  elysiumChain,
  faucetCall,
  fromLedger,
  getArena,
  getArenaConfig,
  getMintState,
  getMintedBy,
  getNftBalance,
  getSession,
  getTokenBalance,
  listArenas,
  mintAllowlistCall,
  mintValue,
  planJoin,
  sendCall,
  setMerkleRootCall,
  setPausedCall,
  setPhaseCall,
  setTokenCall,
  settleCalls,
  simulateCall,
  splitPayout,
  sweepLootCall,
  toLedger,
  usdCentsToWei,
  verifyMerkleProof,
  withdrawCall,
  type ContractCall,
} from '../src/index';
import { checkDeployedCode, fetchStatus } from '../src/ops';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // admin
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // server
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // player 1
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // player 2
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // fee wallet
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // outsider
] as const;
const [admin, server, p1, p2, feeWallet, outsider] = KEYS.map((k) => privateKeyToAccount(k));
const T = 10n ** 18n;

let child: ChildProcess | null = null;
let up = false;
let client: PublicClient;
const wallets = new Map<Address, WalletClient>();

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.unref();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (typeof a === 'object' && a ? ok(a.port) : fail(new Error('no port'))));
    });
  });
}

function killChild(): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM'); // the whole group: pnpm and the node it started
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
}
process.on('exit', killChild);

async function rpcUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
    return r.ok && /"result"/.test(await r.text());
  } catch {
    return false;
  }
}

async function send(from: Address, call: ContractCall): Promise<Hash> {
  const hash = await sendCall(wallets.get(from)!, call);
  const r = await client.waitForTransactionReceipt({ hash });
  expect(r.status).toBe('success');
  return hash;
}

beforeAll(async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  child = spawn('pnpm', ['-F', '@elymum/contracts', 'exec', 'hardhat', 'node', '--port', String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.on('error', () => undefined);
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await rpcUp(url)) {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) {
    killChild();
    console.warn('e2e: hardhat node did not start within 40 s; skipping');
    return;
  }
  const chain = elysiumChain(31337, { rpcUrl: url });
  client = createElymumPublicClient(url, chain, { pollingInterval: 50 });
  for (const a of [admin, server, p1, p2, feeWallet, outsider]) wallets.set(a.address, createElymumWalletClient(url, { account: a, chain, pollingInterval: 50 }));
}, 60_000);

afterAll(() => killChild());

describe('e2e on a hardhat node', () => {
  let token: Address;
  let arena: Address;
  let nft: Address;

  it('deploys the TestToken and the arena with the bundled bytecode', async (ctx) => {
    if (!up) return ctx.skip();
    token = await deployedAddress(client, await deployTestToken(wallets.get(admin.address)!, { owner: admin.address }));
    arena = await deployedAddress(
      client,
      await deployArena(wallets.get(admin.address)!, { admin: admin.address, serverAuthority: server.address, feeWallet: feeWallet.address }),
    );
    expect(await checkDeployedCode(client, token, 'token')).toBe('ok');
    expect(await checkDeployedCode(client, arena, 'arena')).toBe('ok');
    expect(await checkDeployedCode(client, token, 'arena')).toBe('mismatch');
    const c = await getArenaConfig(client, arena);
    expect(c).toMatchObject({ admin: admin.address, serverAuthority: server.address, feeWallet: feeWallet.address, token: null, feeBps: DEFAULT_FEE_BPS, paused: false });
  }, 30_000);

  it('sets the token and creates the default arenas', async (ctx) => {
    if (!up) return ctx.skip();
    await send(admin.address, setTokenCall(arena, token));
    const c = await getArenaConfig(client, arena);
    expect(c.token).toBe(token);
    expect(c.decimals).toBe(18);
    // set-token is final
    const again = await simulateCall(client, setTokenCall(arena, token), admin).catch((e) => e);
    expect(describeError(again).name).toBe('TokenAlreadySet');

    for (const call of createDefaultArenaCalls(arena, c.decimals)) await send(admin.address, call);
    const arenas = await listArenas(client, arena);
    expect(arenas.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    expect(arenas[0]).toMatchObject({ entryFee: 1000n * T, maxSessions: 300, enabled: true, exists: true, openSessions: 0 });
    expect(createDefaultArenaCalls(arena, 18, arenas.map((a) => a.id))).toEqual([]);
  }, 30_000);

  it('joins with approve-if-needed and settles a batch with the right fee', async (ctx) => {
    if (!up) return ctx.skip();
    for (const p of [p1, p2]) await send(p.address, faucetCall(token));
    expect(await getTokenBalance(client, token, p1.address)).toBe(1_000_000n * T);

    const plan = await planJoin(client, { arena, arenaId: 1, player: p1.address });
    expect(plan.calls.map((c) => c.functionName)).toEqual(['approve', 'join']);
    for (const call of plan.calls) await send(p1.address, call);
    for (const call of (await planJoin(client, { arena, arenaId: 1, player: p2.address, token })).calls) await send(p2.address, call);

    const s1 = await getSession(client, arena, 1, p1.address);
    const s2 = await getSession(client, arena, 1, p2.address);
    expect(s1).toMatchObject({ id: 1n, entryFee: 1000n * T, feeBps: 500, finalized: false });
    expect(s2.id).toBe(2n);
    expect((await getArena(client, arena, 1)).vault).toBe(2000n * T);

    // the joining player cannot join twice
    const twice = await simulateCall(client, (await planJoin(client, { arena, arenaId: 1, player: p1.address, token })).join, p1).catch((e) => e);
    expect(describeError(twice).name).toBe('SessionExists');

    // the server's ledger works in ledger units (6 decimals) and converts at the chain boundary
    const entryLedger = toLedger(s1.entryFee, 18);
    expect(entryLedger).toBe(1_000_000_000);
    const payout1 = fromLedger(1_512_345_678, 18); // 1512.345678 tokens
    const payout2 = 2000n * T - payout1;
    const before1 = await getTokenBalance(client, token, p1.address);
    const before2 = await getTokenBalance(client, token, p2.address);
    const calls = settleCalls(arena, [
      { arenaId: 1, player: p1.address, sessionId: s1.id, payout: payout1 },
      { arenaId: 1, player: p2.address, sessionId: s2.id, payout: payout2 },
    ]);
    expect(calls).toHaveLength(1);
    await send(server.address, calls[0]);

    const fee1 = computeFee(payout1, s1.entryFee, s1.feeBps);
    expect(fee1).toBe(await computeFeeOnChain(client, arena, payout1, s1.entryFee, s1.feeBps));
    expect(fee1).toBe(25_617_283_900_000_000_000n); // 5 % of 512.345678
    expect(computeFee(payout2, s2.entryFee, s2.feeBps)).toBe(0n);
    expect((await getTokenBalance(client, token, p1.address)) - before1).toBe(splitPayout(payout1, s1.entryFee, 500).player);
    expect((await getTokenBalance(client, token, p2.address)) - before2).toBe(payout2);
    expect(await getTokenBalance(client, token, feeWallet.address)).toBe(fee1);
    expect((await getSession(client, arena, 1, p1.address)).id).toBe(0n);
    const a1 = await getArena(client, arena, 1);
    expect(a1).toMatchObject({ vault: 0n, openSessions: 0 });
    const c = await getArenaConfig(client, arena);
    expect(c.totals).toMatchObject({ games: 2n, fees: fee1, staked: 2000n * T });

    // a replayed settlement is skipped, not paid twice
    await send(server.address, settleCalls(arena, [{ arenaId: 1, player: p1.address, sessionId: s1.id, payout: payout1 }])[0]);
    expect(await getTokenBalance(client, token, feeWallet.address)).toBe(fee1);

    // only the server may settle
    const notServer = await simulateCall(client, calls[0], p1).catch((e) => e);
    expect(describeError(notServer).name).toBe('NotServer');
  }, 60_000);

  it('burns floor loot with a monotonic sweep id', async (ctx) => {
    if (!up) return ctx.skip();
    for (const call of (await planJoin(client, { arena, arenaId: 1, player: p1.address, token })).calls) await send(p1.address, call);
    const s = await getSession(client, arena, 1, p1.address);
    await send(server.address, settleCalls(arena, [{ arenaId: 1, player: p1.address, sessionId: s.id, payout: 400n * T }])[0]);
    await send(server.address, sweepLootCall(arena, 1, 1n, 600n * T));
    expect(await getTokenBalance(client, token, BURN_ADDRESS)).toBe(600n * T);
    expect(await getArena(client, arena, 1)).toMatchObject({ vault: 0n, totalBurned: 600n * T, lastSweepId: 1n });
    const replay = await simulateCall(client, sweepLootCall(arena, 1, 1n, 0n), server).catch((e) => e);
    expect(describeError(replay).name).toBe('SweepIdNotIncreasing');

    // pause blocks joins only
    await send(admin.address, setPausedCall(arena, true));
    const paused = await simulateCall(client, (await planJoin(client, { arena, arenaId: 2, player: p2.address, token })).join, p2).catch((e) => e);
    expect(describeError(paused)).toMatchObject({ kind: 'contract', name: 'Paused' });
    await send(admin.address, setPausedCall(arena, false));
  }, 60_000);

  it('mints on the allowlist with a TypeScript-built Merkle proof and refunds the excess', async (ctx) => {
    if (!up) return ctx.skip();
    const price = usdCentsToWei(100, '40'); // $1 at 40 USD/HYPE = 0.025 HYPE
    nft = await deployedAddress(
      client,
      await deployNft(wallets.get(admin.address)!, {
        owner: admin.address,
        maxSupply: 100,
        mintPrice: price,
        wlLimit: 2,
        publicLimit: 2,
        baseURI: 'https://elymum.test/api/nft/',
        treasury: feeWallet.address,
      }),
    );
    expect(await checkDeployedCode(client, nft, 'nft')).toBe('ok');

    const extra = Array.from({ length: 6 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    const tree = buildMerkleTree([p2.address.toLowerCase(), ...extra, p1.address]);
    expect(tree.count).toBe(8);
    await send(admin.address, setMerkleRootCall(nft, tree.root));
    await send(admin.address, setPhaseCall(nft, 'allowlist'));
    const state = await getMintState(client, nft);
    expect(state).toMatchObject({ phase: MintPhase.Allowlist, root: tree.root, price, totalSupply: 0, maxSupply: 100 });

    const proof = tree.proof(p1.address)!;
    expect(verifyMerkleProof(tree.root, p1.address, proof)).toBe(true);
    const call = mintAllowlistCall(nft, { qty: 2, proof, price: state.price });
    expect(call.value).toBe(mintValue(price, 2)); // 1 % over
    expect(call.value! > price * 2n).toBe(true);

    const before = await client.getBalance({ address: p1.address });
    const hash = await send(p1.address, call);
    const r = await client.getTransactionReceipt({ hash });
    const after = await client.getBalance({ address: p1.address });
    expect(before - after).toBe(price * 2n + r.gasUsed * r.effectiveGasPrice); // the 1 % buffer came back
    expect(await client.getBalance({ address: nft })).toBe(price * 2n);
    expect(await getNftBalance(client, nft, p1.address)).toBe(2n);
    expect(await getMintedBy(client, nft, p1.address)).toEqual({ wl: 2, pub: 0 });

    // every listed wallet verifies on chain; an outsider cannot reuse a proof
    const p2proof = tree.proof(p2.address)!;
    await send(p2.address, mintAllowlistCall(nft, { qty: 1, proof: p2proof, price }));
    const stolen = await simulateCall(client, mintAllowlistCall(nft, { qty: 1, proof, price }), outsider).catch((e) => e);
    expect(describeError(stolen).name).toBe('NotAllowlisted');
    const over = await simulateCall(client, mintAllowlistCall(nft, { qty: 1, proof, price }), p1).catch((e) => e);
    expect(describeError(over).name).toBe('WlLimitExceeded');

    // withdraw to the treasury
    const t0 = await client.getBalance({ address: feeWallet.address });
    await send(admin.address, withdrawCall(nft));
    expect((await client.getBalance({ address: feeWallet.address })) - t0).toBe(price * 3n);

    const status = await fetchStatus(client, { arena, nft, account: admin.address });
    expect(status.chain.id).toBe(31337);
    expect(status.arena?.code).toBe('ok');
    expect(status.arena?.arenas).toHaveLength(4);
    expect(status.nft?.state?.totalSupply).toBe(3);
  }, 60_000);
});

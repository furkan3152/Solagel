import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromLedger, type SessionInfo } from '@elymum/sdk';
import { generatePrivateKey } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createChain } from '../src/chain';
import { EvmChain, LOW_BALANCE_WEI, RECHECK_MS, type ContractsView } from '../src/chain/evm';
import { NullChain, parseSessionKey, sessionKey, type SettledEvent } from '../src/chain/types';
import { loadConfig, type ServerConfig } from '../src/config';
import { Journal, sweepKey, type SettlementItem, type SweepItem } from '../src/stake/journal';
import { ARENA, E18, FakeEvm, NFT, SERVER, TOKEN, revert } from './fake-evm';
import { testSigner } from './signers';

const T0 = 1_760_000_000_000;
const wallet = () => testSigner().address;
/** 1,000 tokens of an 18-decimal token in ledger units (6 decimals). */
const K = 1_000 * 1e6;

function config(env: Record<string, string> = {}): ServerConfig {
  return loadConfig({ EVM_RPC_URL: 'http://127.0.0.1:1', SERVER_PRIVATE_KEY: generatePrivateKey(), ...env } as unknown as NodeJS.ProcessEnv);
}

interface Harness {
  chain: EvmChain;
  evm: FakeEvm;
  journal: Journal;
  logs: string[];
  settled: SettledEvent[];
  live: Set<string>;
  clock: { now: number };
  view: ContractsView;
  statusChanges: number;
}

async function harness(
  opts: { env?: Record<string, string>; setup?: (evm: FakeEvm) => void; journal?: Journal; view?: ContractsView; start?: boolean } = {},
): Promise<Harness> {
  const evm = new FakeEvm();
  evm.addArena(1, 1_000n);
  evm.addArena(2, 10_000n);
  opts.setup?.(evm);
  const journal = opts.journal ?? new Journal(null);
  const h: Harness = {
    chain: null as unknown as EvmChain,
    evm,
    journal,
    logs: [],
    settled: [],
    live: new Set(),
    clock: { now: T0 },
    view: opts.view ?? { arena: ARENA, nft: null },
    statusChanges: 0,
  };
  h.chain = new EvmChain(config(opts.env), journal, (m) => h.logs.push(m), {
    client: evm,
    contracts: () => h.view,
    loops: false,
    now: () => h.clock.now,
    receiptTimeoutMs: 10,
  });
  h.chain.setLiveSessionProvider(() => h.live);
  h.chain.onSettled((e) => h.settled.push(e));
  h.chain.onStatusChange(() => h.statusChanges++);
  if (opts.start !== false) await h.chain.start();
  return h;
}

function settleItem(s: SessionInfo, payout: number, overrides: Partial<SettlementItem> = {}): SettlementItem {
  const key = sessionKey(s.arenaId, s.player, s.id);
  return {
    kind: 'settle',
    key,
    player: s.player,
    arenaId: s.arenaId,
    session: key,
    sessionId: Number(s.id),
    payout,
    score: 420,
    kills: 2,
    xp: 50,
    reason: 'round',
    attempts: 0,
    nextAttemptAt: T0,
    createdAt: T0,
    ...overrides,
  };
}

const sweepItem = (overrides: Partial<SweepItem> = {}): SweepItem => ({
  kind: 'sweep',
  key: sweepKey('arena-1-1', 7),
  arenaId: 1,
  roomId: 'arena-1-1',
  round: 7,
  amount: 3_141_592,
  attempts: 0,
  nextAttemptAt: T0,
  createdAt: T0,
  ...overrides,
});

const settleCalls = (evm: FakeEvm) => evm.sent.filter((c) => c.functionName === 'settle');
const settleArgs = (evm: FakeEvm, i = 0) => settleCalls(evm)[i].args[0] as { arenaId: number; player: string; sessionId: bigint; payout: bigint }[];

describe('session keys', () => {
  it('are `<arenaId>:<player lowercase>:<sessionId>` and parse back', () => {
    const w = wallet();
    const k = sessionKey(3, w, 42n);
    expect(k).toBe(`3:${w.toLowerCase()}:42`);
    expect(parseSessionKey(k)).toEqual({ arenaId: 3, player: w.toLowerCase(), sessionId: 42 });
    expect(parseSessionKey('Sess1111')).toBeNull();
  });
});

describe('createChain', () => {
  it('stays off (practice only) without EVM_RPC_URL or a server key', async () => {
    const logs: string[] = [];
    expect(await createChain(loadConfig({} as NodeJS.ProcessEnv), new Journal(null), (m) => logs.push(m))).toBeInstanceOf(NullChain);
    expect(await createChain(loadConfig({ EVM_RPC_URL: 'http://127.0.0.1:1' } as unknown as NodeJS.ProcessEnv), new Journal(null), () => {})).toBeInstanceOf(NullChain);
    expect(logs.join()).toMatch(/EVM_RPC_URL and SERVER_PRIVATE_KEY/);
    const off = new NullChain().status();
    expect(off).toMatchObject({ enabled: false, chainId: null, arenaAddress: null, nftAddress: null, tokenReady: false, token: null, serverKey: null });
  });

  it('picks the EVM gateway when both are set; an unusable key keeps it disabled instead of crashing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-chain-'));
    writeFileSync(join(dir, 'bad.key'), 'not a key');
    const logs: string[] = [];
    const chain = await createChain(config({ SERVER_PRIVATE_KEY: join(dir, 'bad.key') }), new Journal(null), (m) => logs.push(m));
    expect(chain).toBeInstanceOf(EvmChain);
    await chain.start();
    expect(chain.enabled).toBe(false);
    expect(chain.status().enabled).toBe(false);
    expect(logs.join()).toMatch(/disabled — SERVER_PRIVATE_KEY: .* does not hold a private key/);
    await chain.stop();
  });

  it('an unreachable RPC: disabled, re-probed on refresh, then enabled without a restart', async () => {
    const h = await harness({ setup: (e) => (e.rpcDown = true) });
    expect(h.chain.enabled).toBe(false);
    expect(h.chain.status()).toMatchObject({ enabled: false, serverKey: SERVER });
    expect(h.logs.join()).toMatch(/unreachable/);
    h.evm.rpcDown = false;
    await h.chain.refresh();
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.tokenReady).toBe(true);
    expect(h.statusChanges).toBe(1);
  });
});

describe('status and reads', () => {
  it('publishes the EVM ChainStatus with the public RPC and the server key', async () => {
    const h = await harness({ env: { PUBLIC_RPC_URL: 'https://rpc.public.example', TOKEN_SYMBOL: '$TEST' }, view: { arena: ARENA, nft: NFT.toLowerCase() } });
    expect(h.chain.status()).toEqual({
      enabled: true,
      chainId: 31337,
      chainName: 'Localnet',
      rpcUrl: 'https://rpc.public.example',
      explorerUrl: null,
      arenaAddress: ARENA,
      nftAddress: NFT,
      arenasEnabled: true,
      tokenReady: true,
      token: { address: TOKEN, symbol: '$TEST', decimals: 18 },
      feeBps: 500,
      serverKey: SERVER,
    });
  });

  it('names an unknown chain id by CHAIN_NAME and EXPLORER_URL', async () => {
    const h = await harness({ env: { CHAIN_NAME: 'Elysium', EXPLORER_URL: 'https://scan.example/' }, setup: (e) => (e.chainId = 4242) });
    expect(h.chain.status()).toMatchObject({ chainId: 4242, chainName: 'Elysium', explorerUrl: 'https://scan.example', rpcUrl: null });
    const t = await harness({ env: { CHAIN_NAME: 'Not used' }, setup: (e) => (e.chainId = 99801) });
    expect(t.chain.status()).toMatchObject({ chainName: 'Elysium Testnet', explorerUrl: 'https://explorer-elysium-testnet.t.conduit.xyz' });
  });

  it('converts 18-decimal amounts to ledger units at the boundary (vaults rounded down)', async () => {
    const h = await harness();
    const w = wallet();
    const s = h.evm.join(1, w);
    h.evm.arenaMap.get(1)!.vault += 7n; // dust below a ledger unit
    const arenas = await h.chain.listArenas(true);
    expect(arenas[0]).toEqual({ id: 1, entryFee: K, maxSessions: 300, openSessions: 1, enabled: true, pot: K });
    expect(arenas[1].entryFee).toBe(10 * K);
    expect(Number.isSafeInteger(arenas[1].entryFee)).toBe(true);
    const got = await h.chain.getSession(1, w.toLowerCase());
    expect(got).toEqual({ key: `1:${w.toLowerCase()}:${s.id}`, id: Number(s.id), player: w, arenaId: 1, entryFee: K, openedAt: s.openedAt, finalized: false, owed: 0 });
    expect(await h.chain.getSession(2, w)).toBeNull();
    expect(await h.chain.getSession(1, 'nope')).toBeNull();
    expect(await h.chain.getSession(0, w)).toBeNull();
    // a 6-decimal token is 1:1
    const six = await harness({ setup: (e) => (e.config.decimals = 6) });
    six.evm.arenaMap.clear();
    six.evm.addArena(1, 1_000n);
    expect((await six.chain.listArenas(true))[0].entryFee).toBe(1_000 * 1e6);
  });

  it('caches the arena list for 60 s', async () => {
    const h = await harness();
    expect((await h.chain.listArenas()).length).toBe(2);
    h.evm.addArena(3, 50_000n);
    expect((await h.chain.listArenas()).length).toBe(2);
    h.clock.now += 61_000;
    expect((await h.chain.listArenas()).length).toBe(3);
    // RPC errors keep the cached value
    h.evm.rpcDown = true;
    expect((await h.chain.listArenas(true)).length).toBe(3);
  });

  it('server key info and the low-balance warning', async () => {
    const h = await harness({ setup: (e) => (e.balanceWei = LOW_BALANCE_WEI - 1n) });
    await h.chain.checkBalance();
    expect(h.chain.serverInfo()).toEqual({ address: SERVER, balanceWei: (LOW_BALANCE_WEI - 1n).toString(), low: true });
    expect(h.logs.join()).toMatch(/WARNING the server key .* holds only/);
    h.evm.balanceWei = E18;
    await h.chain.checkBalance();
    expect(h.chain.serverInfo().low).toBe(false);
  });

  it('verifies smart-wallet signatures through the chain', async () => {
    const h = await harness();
    expect(await h.chain.verifyMessage(wallet(), 'hi', '0x1271')).toBe(true);
    expect(await h.chain.verifyMessage(wallet(), 'hi', '0x00')).toBe(false);
    expect(await h.chain.verifyMessage('nope', 'hi', '0x1271')).toBe(false);
  });
});

describe('contracts and the token watcher', () => {
  it('waits for contracts (practice only) and picks a newly registered arena up without a restart', async () => {
    const h = await harness({ view: { arena: null, nft: null } });
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.tokenReady).toBe(false);
    expect(h.chain.status()).toMatchObject({ enabled: true, chainId: 31337, arenaAddress: null, tokenReady: false, arenasEnabled: false });
    expect(await h.chain.listArenas()).toEqual([]);
    expect(h.logs.join()).toMatch(/waiting for contracts/);
    h.view = { arena: ARENA, nft: null };
    await h.chain.refresh();
    expect(h.chain.status()).toMatchObject({ arenaAddress: ARENA, tokenReady: true, arenasEnabled: true });
    expect(h.statusChanges).toBe(1);
    await h.chain.refresh();
    expect(h.statusChanges).toBe(1);
  });

  it('runs practice only while the token is unset, and announces the flip once', async () => {
    const h = await harness({ setup: (e) => (e.config.token = null) });
    expect(h.chain.status()).toMatchObject({ tokenReady: false, arenasEnabled: false, token: null });
    expect(await h.chain.listArenas()).toEqual([]);
    expect(await h.chain.getSession(1, wallet())).toBeNull();
    const w = wallet();
    const s = h.evm.join(1, w);
    h.journal.enqueue(settleItem(s, K));
    await h.chain.processPending();
    expect(settleCalls(h.evm)).toHaveLength(0);
    expect(h.journal.pending[0].lastError).toBe('game token not set');
    h.evm.config.token = TOKEN;
    await h.chain.refresh();
    expect(h.chain.status()).toMatchObject({ tokenReady: true, arenasEnabled: true, token: { address: TOKEN, decimals: 18 } });
    expect(h.statusChanges).toBe(1);
    expect(h.logs.join()).toMatch(/game token set/);
    await h.chain.refresh();
    expect(h.statusChanges).toBe(1);
  });

  it('a server booting with the token already set does not announce a flip', async () => {
    const h = await harness();
    await h.chain.refresh();
    expect(h.statusChanges).toBe(0);
  });

  it('refuses an arena whose code is not the bundled artifact', async () => {
    const h = await harness({ setup: (e) => e.code.set(ARENA.toLowerCase(), 'mismatch') });
    expect(h.chain.tokenReady).toBe(false);
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.logs.join()).toMatch(/is not the bundled ElymumArena/);
  });

  it('keeps settlements queued while the server key is not the server authority; resumes once fixed', async () => {
    const h = await harness({ setup: (e) => (e.config.serverAuthority = '0x0000000000000000000000000000000000000bad') });
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.logs.join()).toMatch(/is NOT the arena's server authority/);
    const s = h.evm.join(1, wallet());
    h.journal.enqueue(settleItem(s, K));
    await h.chain.processPending();
    expect(settleCalls(h.evm)).toHaveLength(0);
    expect(h.journal.pending[0].lastError).toMatch(/server authority/);
    h.evm.config.serverAuthority = SERVER;
    await h.chain.refresh();
    expect(h.chain.stakeEnabled).toBe(true);
    h.clock.now += 600_000;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(1);
  });

  it('never sends a journal that still owes money on another arena contract', async () => {
    const journal = new Journal(null);
    journal.bindContract('0x00000000000000000000000000000000000000Aa');
    journal.enqueue(sweepItem());
    const h = await harness({ journal });
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.logs.join()).toMatch(/journal still owes money on arena 0x00000000000000000000000000000000000000aa/);
    await h.chain.processPending();
    expect(h.evm.sent).toHaveLength(0);
    expect(journal.pending[0].lastError).toMatch(/journal belongs to arena/);
    // an idle journal follows the new contract
    const idle = new Journal(null);
    idle.bindContract('0x00000000000000000000000000000000000000Aa');
    const ok = await harness({ journal: idle });
    expect(ok.chain.stakeEnabled).toBe(true);
    expect(idle.contract).toBe(ARENA.toLowerCase());
  });
});

describe('settlement worker (batched settle)', () => {
  it('settles every due item of an arena in one batch, reconciled from the Settled events', async () => {
    const h = await harness();
    const [a, b, c] = [wallet(), wallet(), wallet()];
    const sa = h.evm.join(1, a);
    const sb = h.evm.join(1, b);
    const sc = h.evm.join(1, c);
    h.journal.commit({ enqueue: [settleItem(sa, 2 * K), settleItem(sb, 0, { reason: 'death', createdAt: T0 + 1 }), settleItem(sc, K, { createdAt: T0 + 2 })] });
    await h.chain.processPending();
    expect(settleCalls(h.evm)).toHaveLength(1);
    const args = settleArgs(h.evm);
    expect(args.map((x) => [x.player, x.sessionId, x.payout])).toEqual([
      [a, sa.id, 2_000n * E18],
      [b, sb.id, 0n],
      [c, sc.id, 1_000n * E18],
    ]);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(3);
    const ea = h.settled.find((e) => e.player === a)!;
    // fee 5 % of the profit (1,000 tokens) = 50 tokens, in ledger units
    expect(ea).toMatchObject({ key: sessionKey(1, a, sa.id), arenaId: 1, payout: 2 * K, fee: 50 * 1e6 });
    expect(ea.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(ea.collect).toBeUndefined();
    expect(h.settled.find((e) => e.player === b)).toMatchObject({ payout: 0, fee: 0 });
    expect(h.logs.join()).toMatch(/settle batch 0x[0-9a-f]+ · arena #1 · 3\/3 settled/);
  });

  it('chunks a bell of 45 tickets into 40 + 5, one batch per arena', async () => {
    const h = await harness();
    const items: SettlementItem[] = [];
    for (let i = 0; i < 45; i++) items.push(settleItem(h.evm.join(1, wallet()), K, { createdAt: T0 + i }));
    items.push(settleItem(h.evm.join(2, wallet()), 10 * K, { createdAt: T0 + 100 }));
    h.journal.commit({ enqueue: items });
    await h.chain.processPending();
    expect(settleCalls(h.evm).map((c) => (c.args[0] as unknown[]).length)).toEqual([40, 5, 1]);
    expect(settleArgs(h.evm, 2)[0].arenaId).toBe(2);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(46);
  });

  it('a failing transfer to the player finalizes the session: the player collects', async () => {
    const h = await harness();
    const w = wallet();
    const s = h.evm.join(1, w);
    for (let i = 0; i < 3; i++) h.evm.join(1, wallet()); // the vault covers the payout
    h.evm.refusing.add(w.toLowerCase());
    h.journal.enqueue(settleItem(s, 3 * K));
    await h.chain.processPending();
    expect(h.settled[0]).toMatchObject({ collect: true, payout: 3 * K, fee: 100 * 1e6 });
    expect(h.evm.sessions.get(`1:${w.toLowerCase()}`)).toMatchObject({ finalized: true, owed: 2_900n * E18 });
    expect(await h.chain.getSession(1, w)).toMatchObject({ finalized: true, owed: 2_900 * 1e6 });
    expect(h.logs.join()).toMatch(/finalized .* \(to collect\)/);
    // a zero payout is never "to collect"
    const z = wallet();
    const sz = h.evm.join(1, z);
    h.evm.refusing.add(z.toLowerCase());
    h.journal.enqueue(settleItem(sz, 0));
    await h.chain.processPending();
    expect(h.settled[1].collect).toBeUndefined();
  });

  it('drops items whose session is gone or belongs to a newer join, without sending', async () => {
    const h = await harness();
    const gone = wallet();
    const sg = h.evm.join(1, gone);
    h.evm.close(1, gone);
    const rejoined = wallet();
    const old = h.evm.join(1, rejoined);
    h.evm.close(1, rejoined);
    h.evm.join(1, rejoined);
    const fin = wallet();
    const sf = h.evm.join(1, fin);
    h.evm.sessions.set(`1:${fin.toLowerCase()}`, { ...sf, finalized: true, owed: 5n });
    h.journal.commit({ enqueue: [settleItem(sg, K), settleItem(old, K, { createdAt: T0 + 1 }), settleItem(sf, K, { createdAt: T0 + 2 })] });
    await h.chain.processPending();
    expect(settleCalls(h.evm)).toHaveLength(0);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
    const log = h.logs.join('\n');
    expect(log).toMatch(/session already closed/);
    expect(log).toMatch(/on-chain session is #\d+, item is for #\d+/);
    expect(log).toMatch(/already finalized/);
  });

  it('an item settled elsewhere between the check and the batch is reconciled as settled elsewhere', async () => {
    const h = await harness();
    const a = wallet();
    const b = wallet();
    const sa = h.evm.join(1, a);
    const sb = h.evm.join(1, b);
    h.evm.beforeSettle = () => h.evm.close(1, b); // b refunded meanwhile
    h.journal.commit({ enqueue: [settleItem(sa, K), settleItem(sb, K, { createdAt: T0 + 1 })] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled.map((e) => e.player)).toEqual([a]);
    expect(h.logs.join()).toMatch(/settled elsewhere/);
  });

  it('a skipped item (vault short) is retried with backoff; the rest of the batch settles', async () => {
    const h = await harness();
    const a = wallet();
    const b = wallet();
    const sa = h.evm.join(1, a);
    const sb = h.evm.join(1, b);
    h.journal.commit({ enqueue: [settleItem(sa, K), settleItem(sb, 5 * K, { createdAt: T0 + 1 })] });
    await h.chain.processPending();
    expect(h.settled.map((e) => e.player)).toEqual([a]);
    const left = h.journal.pending[0] as SettlementItem;
    expect(left.key).toBe(sessionKey(1, b, sb.id));
    expect(left.attempts).toBe(1);
    expect(left.lastError).toMatch(/skipped: the payout is larger than the arena vault/);
    expect(left.nextAttemptAt).toBeGreaterThan(T0);
    expect(h.logs.join()).toMatch(/vault cannot cover/);
    // not due yet: nothing is sent
    await h.chain.processPending();
    expect(settleCalls(h.evm)).toHaveLength(1);
    // more tickets fill the vault: the next attempt settles it
    for (let i = 0; i < 5; i++) h.evm.join(1, wallet());
    h.clock.now = left.nextAttemptAt;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled.map((e) => e.player)).toEqual([a, b]);
  });

  it('retries transient send errors with backoff', async () => {
    const h = await harness();
    const s = h.evm.join(1, wallet());
    h.journal.enqueue(settleItem(s, K));
    h.evm.failures.push(new TypeError('fetch failed'), new TypeError('fetch failed'));
    await h.chain.processPending();
    const first = h.journal.pending[0];
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt).toBe(T0 + 4_000);
    h.clock.now = first.nextAttemptAt;
    await h.chain.processPending();
    expect(h.journal.pending[0].attempts).toBe(2);
    expect(h.journal.pending[0].nextAttemptAt).toBe(h.clock.now + 8_000);
    h.clock.now = h.journal.pending[0].nextAttemptAt;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(1);
  });

  it('an unconfirmed batch is re-checked; a late confirmation is still reported', async () => {
    const h = await harness();
    const w = wallet();
    const s = h.evm.join(1, w);
    h.evm.join(1, wallet());
    h.journal.enqueue(settleItem(s, 2 * K));
    h.evm.holdReceipts = true;
    await h.chain.processPending();
    expect(h.journal.pending[0].lastError).toMatch(/not confirmed yet/);
    expect(h.journal.pending[0].nextAttemptAt).toBe(T0 + RECHECK_MS);
    expect(h.settled).toHaveLength(0);
    // the transaction was mined meanwhile: the next pass sees the session closed and reports our tx
    h.evm.holdReceipts = false;
    h.clock.now += RECHECK_MS;
    await h.chain.processPending();
    expect(settleCalls(h.evm)).toHaveLength(1);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ player: w, payout: 2 * K, fee: 50 * 1e6 });
    expect(h.logs.join()).toMatch(/confirmation arrived late/);
  });

  it('a NotServer revert re-reads the config; a rotated key keeps the items', async () => {
    const h = await harness();
    const s = h.evm.join(1, wallet());
    h.journal.enqueue(settleItem(s, K));
    h.evm.config.serverAuthority = '0x0000000000000000000000000000000000000bad';
    h.clock.now += 31_000; // past the config cache
    h.evm.configReads = 0;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(1);
    expect(h.chain.stakeEnabled).toBe(false);
    // the cached config hid the rotation: the revert itself triggers a re-read
    const h2 = await harness();
    const s2 = h2.evm.join(1, wallet());
    h2.journal.enqueue(settleItem(s2, K));
    h2.evm.failures.push(revert('NotServer'));
    const reads = h2.evm.configReads;
    await h2.chain.processPending();
    expect(h2.evm.configReads).toBeGreaterThan(reads);
    expect(h2.journal.pending[0].lastError).toMatch(/NotServer/);
  });

  it('fee-wallet guard: a batch reverting on the fee transfer holds every item (never blamed on the players)', async () => {
    const h = await harness();
    const s = h.evm.join(1, wallet());
    h.evm.join(1, wallet());
    h.journal.enqueue(settleItem(s, 2 * K));
    h.evm.feeWalletBroken = true;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(1);
    expect(h.journal.pending[0].lastError).toMatch(/SafeERC20FailedOperation/);
    expect(h.logs.join()).toMatch(/fee wallet .* cannot receive the game token. ALL settlements are held/);
    h.evm.feeWalletBroken = false;
    h.clock.now = h.journal.pending[0].nextAttemptAt;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.join()).toMatch(/settlements resume/);
  });

  it('cancels a stale settlement whose session became live', async () => {
    const h = await harness();
    const s = h.evm.join(1, wallet());
    const item = settleItem(s, K, { reason: 'stale' });
    h.journal.enqueue(item);
    h.live.add(item.key);
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(settleCalls(h.evm)).toHaveLength(0);
    expect(h.logs.join()).toMatch(/stale settlement .* cancelled/);
  });

  it('drops malformed items loudly and never sends them', async () => {
    const h = await harness();
    h.journal.commit({
      enqueue: [
        { ...settleItem(h.evm.join(1, wallet()), K), key: 'a', player: 'not-an-evm-address' },
        { ...settleItem(h.evm.join(1, wallet()), K), key: 'b', sessionId: undefined },
        { ...settleItem(h.evm.join(1, wallet()), K), key: 'c', payout: -1 },
      ],
    });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.evm.sent).toHaveLength(0);
    expect(h.logs.filter((l) => /dropping malformed settlement/.test(l))).toHaveLength(3);
  });

  it('never sends a held settlement; a release pays it as it was, a settle at 0 pays nothing', async () => {
    const h = await harness();
    const a = wallet();
    const b = wallet();
    const sa = h.evm.join(1, a);
    const sb = h.evm.join(1, b);
    const hold = { at: T0, score: 90, why: 'test', flags: [] };
    const ia = settleItem(sa, 2 * K, { held: hold });
    const ib = settleItem(sb, 2 * K, { held: hold, createdAt: T0 + 1 });
    h.journal.commit({ enqueue: [ia, ib] });
    await h.chain.processPending();
    expect(h.evm.sent).toHaveLength(0);
    h.journal.release(ia.key, h.clock.now);
    h.journal.settleZero(ib.key, 'collusion', 'admin', h.clock.now);
    await h.chain.processPending();
    expect(settleArgs(h.evm).map((x) => [x.player, x.payout])).toEqual([
      [a, 2_000n * E18],
      [b, 0n],
    ]);
    expect(h.journal.pending).toHaveLength(0);
  });
});

describe('loot sweeps (sweepLoot burns, monotonic sweep ids)', () => {
  it('burns exactly the journaled amount with the next sweep id, persisted before the send', async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) h.evm.join(1, wallet());
    h.evm.arenaMap.get(1)!.lastSweepId = 4n;
    h.journal.enqueue(sweepItem());
    await h.chain.processPending();
    const call = h.evm.sent.find((c) => c.functionName === 'sweepLoot')!;
    expect(call.args).toEqual([1, 5n, fromLedger(3_141_592, 18)]);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.journal.lastSweepId(1)).toBe(5);
    expect(h.evm.arenaMap.get(1)!.totalBurned).toBe(3_141_592n * 10n ** 12n);
    expect(h.logs.join()).toMatch(/burned 3.141592 \$ELYMUM loot of arena-1-1 \(round 7\) · sweep #5/);
  });

  it('a sweep item survives a journal reload with its id; a landed sweep is never sent again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-sweep-'));
    const path = join(dir, 'journal.json');
    const before = new Journal(path);
    before.enqueue(sweepItem());
    const h = await harness({ journal: before });
    h.evm.join(1, wallet());
    h.evm.holdReceipts = true; // sent, not confirmed
    await h.chain.processPending();
    expect(h.evm.sent).toHaveLength(1);
    const reloaded = new Journal(path);
    expect((reloaded.pending[0] as SweepItem).sweepId).toBe(1);
    expect((reloaded.pending[0] as SweepItem).sentTx).toMatch(/^0x/);
    expect(reloaded.lastSweepId(1)).toBe(1);
    // a restarted worker reads lastSweepId: the sweep landed, nothing is resent
    const again = await harness({ journal: reloaded, setup: (e) => e.addArena(1, 1_000n, { lastSweepId: 1n, vault: 10n * E18 }) });
    again.clock.now += RECHECK_MS;
    await again.chain.processPending();
    expect(again.evm.sent).toHaveLength(0);
    expect(reloaded.pending).toHaveLength(0);
    expect(again.logs.join()).toMatch(/sweep #1 \(confirmed\)/);
  });

  it('a sweep that did not land is resent with the same id (the contract refuses a second burn)', async () => {
    const h = await harness();
    h.evm.join(1, wallet());
    h.journal.enqueue(sweepItem());
    h.evm.failures.push(new TypeError('fetch failed'));
    await h.chain.processPending();
    expect((h.journal.pending[0] as SweepItem).sweepId).toBe(1);
    h.clock.now = h.journal.pending[0].nextAttemptAt;
    await h.chain.processPending();
    expect(h.evm.sent.map((c) => c.args[1])).toEqual([1n]);
    expect(h.journal.pending).toHaveLength(0);
    // SweepIdNotIncreasing: an earlier send of the id landed; confirmed on the next pass
    const k = await harness();
    k.evm.join(1, wallet());
    k.journal.enqueue(sweepItem());
    k.evm.failures.push(revert('SweepIdNotIncreasing'));
    await k.chain.processPending();
    expect(k.journal.pending[0].lastError).toMatch(/SweepIdNotIncreasing/);
    k.evm.arenaMap.get(1)!.lastSweepId = 1n;
    k.clock.now += RECHECK_MS;
    await k.chain.processPending();
    expect(k.journal.pending).toHaveLength(0);
    expect(k.evm.sent).toHaveLength(0);
  });

  it('one sweep per arena at a time, oldest first; a short vault waits', async () => {
    const h = await harness();
    h.evm.join(1, wallet());
    h.journal.commit({
      enqueue: [
        sweepItem({ key: sweepKey('arena-1-1', 8), round: 8, createdAt: T0 + 5, amount: 100 }),
        sweepItem({ key: sweepKey('arena-1-1', 7), round: 7, createdAt: T0, amount: 5 * K }),
      ],
    });
    await h.chain.processPending();
    // round 7 is older and too big for the vault: it waits, and round 8 is not started before it
    expect(h.evm.sent).toHaveLength(0);
    expect(h.journal.pending.find((p) => p.key === sweepKey('arena-1-1', 7))!.lastError).toMatch(/vault cannot cover/);
    expect((h.journal.pending.find((p) => p.key === sweepKey('arena-1-1', 8)) as SweepItem).sweepId).toBeUndefined();
    for (let i = 0; i < 5; i++) h.evm.join(1, wallet());
    h.clock.now += 600_000;
    await h.chain.processPending();
    await h.chain.processPending();
    expect(h.evm.sent.map((c) => [c.args[1], c.args[2]])).toEqual([
      [1n, fromLedger(5 * K, 18)],
      [2n, fromLedger(100, 18)],
    ]);
    expect(h.journal.pending).toHaveLength(0);
  });

  it('drops a malformed sweep loudly', async () => {
    const h = await harness();
    h.journal.enqueue(sweepItem({ amount: 0 }));
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.join()).toMatch(/dropping malformed loot sweep/);
  });
});

describe('stale sessions (settled at the entry fee)', () => {
  it('queues unplayed sessions from the Joined logs; live, queued, fresh and finalized ones are skipped', async () => {
    const h = await harness({ env: { LOG_CHUNK_BLOCKS: '100' } });
    const old = Math.floor(T0 / 1000) - 3600;
    const stale = wallet();
    const ss = h.evm.join(1, stale, { openedAt: old });
    const live = wallet();
    const sl = h.evm.join(1, live, { openedAt: old });
    h.live.add(sessionKey(1, live, sl.id));
    const fresh = wallet();
    h.evm.join(2, fresh, { openedAt: Math.floor(T0 / 1000) - 10 });
    const fin = wallet();
    const sf = h.evm.join(1, fin, { openedAt: old });
    h.evm.sessions.set(`1:${fin.toLowerCase()}`, { ...sf, finalized: true, owed: 1n });
    const closed = wallet();
    h.evm.join(1, closed, { openedAt: old });
    h.evm.close(1, closed);
    h.evm.block += 450n; // several log chunks to scan
    expect(await h.chain.sweepStale()).toBe(1);
    expect(h.journal.pending).toEqual([
      expect.objectContaining({ kind: 'settle', key: sessionKey(1, stale, ss.id), player: stale, sessionId: Number(ss.id), payout: K, reason: 'stale' }),
    ]);
    expect(h.evm.logRequests.length).toBeGreaterThan(3);
    expect(h.evm.logRequests[0][0]).toBe(10n); // from the deploy block
    expect(h.logs.join()).toMatch(/unplayed session\(s\) older than 15 min → settlement at the entry fee queued/);
    // queued: not queued twice; the scan resumes where it stopped
    const requests = h.evm.logRequests.length;
    expect(await h.chain.sweepStale()).toBe(0);
    expect(h.evm.logRequests.length).toBe(requests);
    h.evm.block += 10n;
    expect(await h.chain.sweepStale()).toBe(0);
    expect(h.evm.logRequests.length).toBe(requests + 1);
    // the settlement pays the entry fee back (no profit, no fee)
    await h.chain.processPending();
    expect(h.settled[0]).toMatchObject({ player: stale, payout: K, fee: 0 });
  });

  it('skips a session seated during its awaits (re-reads the live sessions right before the commit)', async () => {
    const h = await harness();
    const old = Math.floor(T0 / 1000) - 3600;
    const p = wallet();
    const sp = h.evm.join(1, p, { openedAt: old });
    const key = sessionKey(1, p, sp.id);
    const read = h.evm.session.bind(h.evm);
    // the player is seated while the sweeper reads the session
    h.evm.session = async (...args: Parameters<typeof read>) => {
      const s = await read(...args);
      h.live.add(key);
      return s;
    };
    expect(await h.chain.sweepStale()).toBe(0);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.join()).toMatch(/1 stale settlement\(s\) skipped/);
  });

  it('a stale refund replaced by the real result is never sent with its old payout', async () => {
    const h = await harness();
    const old = Math.floor(T0 / 1000) - 3600;
    const p = wallet();
    const sp = h.evm.join(1, p, { openedAt: old });
    expect(await h.chain.sweepStale()).toBe(1);
    const key = sessionKey(1, p, sp.id);
    const read = h.evm.session.bind(h.evm);
    // the room's real result (eaten: payout 0) arrives while the worker checks the stale item
    h.evm.session = async (...args: Parameters<typeof read>) => {
      const s = await read(...args);
      if (h.journal.pending.some((x) => x.key === key && x.kind === 'settle' && x.reason === 'stale')) {
        h.journal.commit({ enqueue: [{ kind: 'settle', key, player: p, arenaId: 1, session: key, sessionId: Number(sp.id), payout: 0, score: 0, kills: 0, xp: 0, reason: 'death', attempts: 0, nextAttemptAt: 0, createdAt: h.clock.now }] });
      }
      return s;
    };
    await h.chain.processPending();
    await h.chain.processPending();
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ player: p, payout: 0 });
    expect(h.journal.pending).toHaveLength(0);
  });

  it('respects STALE_SESSION_AFTER_S and STAKE_ARENA_IDS', async () => {
    const h = await harness({ env: { STALE_SESSION_AFTER_S: '5', STAKE_ARENA_IDS: '2' } });
    const t = Math.floor(T0 / 1000) - 6;
    h.evm.join(1, wallet(), { openedAt: t });
    const w = wallet();
    h.evm.join(2, w, { openedAt: t });
    expect(await h.chain.sweepStale()).toBe(1);
    expect(h.journal.pending[0]).toMatchObject({ player: w, arenaId: 2, payout: 10 * K });
  });

  it('stays off after a journal quarantine until STALE_SWEEP_ACK=1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-quarantine-'));
    const path = join(dir, 'journal.json');
    writeFileSync(path, '{broken');
    const journal = new Journal(path);
    expect(journal.quarantinedFiles()).toHaveLength(1);
    const h = await harness({ journal });
    h.evm.join(1, wallet(), { openedAt: Math.floor(T0 / 1000) - 3600 });
    expect(await h.chain.sweepStale()).toBe(0);
    expect(h.logs.join()).toMatch(/stale-session sweeper is OFF/);
    const acked = await harness({ journal, env: { STALE_SWEEP_ACK: '1' } });
    acked.evm.join(1, wallet(), { openedAt: Math.floor(T0 / 1000) - 3600 });
    expect(await acked.chain.sweepStale()).toBe(1);
  });
});

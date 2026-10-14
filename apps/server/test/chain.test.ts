import type { ConfigView, ProfileView, SeasonView as SdkSeasonView, SessionView } from '@slana/sdk';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { createChain } from '../src/chain';
import { SolanaChain, STALE_SESSION_AFTER_S, type ChainClient, type SettledEvent } from '../src/chain/solana';
import { loadConfig, type ServerConfig } from '../src/config';
import { Journal, type SettlementItem } from '../src/stake/journal';

const PROGRAM = new PublicKey('5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472');
const T0 = 1_760_000_000_000;
const wallet = () => Keypair.generate().publicKey.toBase58();

function chainConfig(overrides: Partial<ServerConfig['chain']> = {}): ServerConfig {
  const cfg = loadConfig({} as NodeJS.ProcessEnv);
  cfg.chain = {
    ...cfg.chain,
    cluster: 'localnet',
    rpcUrl: 'http://127.0.0.1:1',
    programId: PROGRAM.toBase58(),
    serverKeypair: '[]',
    stakeEnabled: true,
    ...overrides,
  };
  return cfg;
}

function configView(server: Keypair, overrides: Partial<ConfigView> = {}): ConfigView {
  return {
    admin: wallet(),
    serverAuthority: server.publicKey.toBase58(),
    treasury: wallet(),
    feeBps: 500,
    seasonShareBps: 5000,
    skinPrice: 50_000_000,
    currentSeason: 3,
    paused: false,
    totalPlayers: 0,
    totalGames: 0,
    totalSessions: 0,
    totalStaked: 0,
    totalPaidOut: 0,
    ...overrides,
  };
}

function profileView(owner: string): ProfileView {
  return {
    address: wallet(),
    owner,
    name: 'gm_gummy',
    skin: 4,
    premiumSkins: 0,
    xp: 800,
    level: 5,
    gamesPlayed: 1,
    kills: 0,
    bestScore: 10,
    totalScore: 10,
    season: 3,
    seasonPoints: 10,
    stakeGames: 0,
    totalStaked: 0,
    totalWon: 0,
    createdAt: 1,
    lastPlayed: 1,
  };
}

/** Fake instruction; its data names the session it settles so a successful send can close it. */
const dummyIx = (tag = '') => new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.from(tag) });

class FakeClient implements ChainClient {
  readonly programId = PROGRAM;
  deployed = true;
  config: ConfigView | null;
  sessions = new Map<string, SessionView>();
  profiles = new Map<string, ProfileView>();
  seasons = new Map<number, SdkSeasonView>();
  settles: Record<string, unknown>[] = [];
  records: Record<string, unknown>[] = [];
  profileFetches = 0;
  profileError: Error | null = null;
  rpcDown = false;

  constructor(server: Keypair) {
    this.config = configView(server);
  }
  private check() {
    if (this.rpcDown) throw new TypeError('fetch failed');
  }
  async isDeployed() {
    this.check();
    return this.deployed;
  }
  async fetchConfig() {
    this.check();
    return this.config;
  }
  async fetchProfile(owner: string) {
    this.profileFetches++;
    if (this.profileError) throw this.profileError;
    return this.profiles.get(owner) ?? null;
  }
  async fetchArenas() {
    return [];
  }
  async fetchSession(arenaId: number, player: string) {
    this.check();
    return this.sessions.get(`${arenaId}:${player}`) ?? null;
  }
  async fetchSessions() {
    return [...this.sessions.values()];
  }
  async fetchSeason(id: number) {
    return this.seasons.get(id) ?? null;
  }
  addSession(player: string, opts: Partial<SessionView> = {}): SessionView {
    const s: SessionView = {
      address: wallet(),
      player,
      arena: wallet(),
      arenaId: 1,
      buyIn: 10_000_000,
      openedAt: Math.floor(T0 / 1000) - 60,
      id: 7,
      ...opts,
    };
    this.sessions.set(`${s.arenaId}:${player}`, s);
    return s;
  }
  readonly ix = {
    settleSession: async (_server: unknown, p: Record<string, unknown>) => {
      this.settles.push(p);
      return dummyIx(`${p.arenaId}:${p.player}`);
    },
    recordGame: async (_server: unknown, p: Record<string, unknown>) => {
      this.records.push(p);
      return dummyIx();
    },
  } as unknown as ChainClient['ix'];
}

interface Harness {
  chain: SolanaChain;
  client: FakeClient;
  journal: Journal;
  logs: string[];
  settled: SettledEvent[];
  sent: number;
  /** Next send outcomes (an Error is thrown); empty → success. */
  failures: unknown[];
  live: Set<string>;
  landed: Set<string>;
  clock: { now: number };
}

async function harness(opts: { cfg?: Partial<ServerConfig['chain']>; setup?: (c: FakeClient, server: Keypair) => void } = {}): Promise<Harness> {
  const server = Keypair.generate();
  const client = new FakeClient(server);
  opts.setup?.(client, server);
  const journal = new Journal(null);
  const h: Harness = {
    chain: null as unknown as SolanaChain,
    client,
    journal,
    logs: [],
    settled: [],
    sent: 0,
    failures: [],
    live: new Set(),
    landed: new Set(),
    clock: { now: T0 },
  };
  h.chain = new SolanaChain(chainConfig(opts.cfg), journal, (m) => h.logs.push(m), {
    client,
    keypair: server,
    loops: false,
    now: () => h.clock.now,
    balance: async () => 1_000_000_000,
    signatureLanded: async (sig) => h.landed.has(sig),
    send: async (ixs, onSignature) => {
      h.sent++;
      const signature = `sig${h.sent}`;
      onSignature(signature);
      const failure = h.failures.shift();
      if (failure !== undefined) throw failure;
      client.sessions.delete(ixs[0].data.toString()); // settle_session closes the session
      return signature;
    },
  });
  h.chain.setLiveSessionProvider(() => h.live);
  h.chain.onSettled((e) => h.settled.push(e));
  await h.chain.start();
  return h;
}

function settleItem(session: SessionView, overrides: Partial<SettlementItem> = {}): SettlementItem {
  return {
    kind: 'settle',
    key: session.address,
    player: session.player,
    arenaId: session.arenaId,
    session: session.address,
    sessionId: session.id,
    payout: 12_345_678,
    score: 420,
    kills: 2,
    xp: 50,
    reason: 'cashout',
    attempts: 0,
    nextAttemptAt: T0,
    createdAt: T0,
    ...overrides,
  };
}

describe('createChain', () => {
  it('returns a disabled gateway when the chain env is missing', async () => {
    const logs: string[] = [];
    const chain = await createChain(loadConfig({} as NodeJS.ProcessEnv), new Journal(null), (m) => logs.push(m));
    expect(chain.enabled).toBe(false);
    expect(chain.stakeEnabled).toBe(false);
    expect(chain.status()).toMatchObject({ enabled: false, programId: null, arenasEnabled: false, token: null, pass: null });
    expect(await chain.getProfile(wallet())).toBeNull();
    expect(await chain.season()).toBeNull();
    expect(logs.join('\n')).toMatch(/disabled/);
  });

  it('a configured gateway with an unusable keypair stays disabled instead of crashing', async () => {
    const logs: string[] = [];
    const cfg = chainConfig({ serverKeypair: '/nonexistent/server.json' });
    const chain = await createChain(cfg, new Journal(null), (m) => logs.push(m));
    expect(chain).toBeInstanceOf(SolanaChain);
    await chain.start();
    expect(chain.enabled).toBe(false);
    expect(chain.status().enabled).toBe(false);
    expect(logs.join('\n')).toMatch(/cannot read/);
    await chain.stop();
  });

  it('behaves like NullChain when the program is not deployed or not initialized', async () => {
    const notDeployed = await harness({ setup: (c) => (c.deployed = false) });
    expect(notDeployed.chain.enabled).toBe(false);
    expect(notDeployed.chain.stakeEnabled).toBe(false);
    expect(notDeployed.logs.join('\n')).toMatch(/not deployed/);
    const notInit = await harness({ setup: (c) => (c.config = null) });
    expect(notInit.chain.enabled).toBe(false);
    expect(notInit.logs.join('\n')).toMatch(/not initialized/);
    const down = await harness({ setup: (c) => (c.rpcDown = true) });
    expect(down.chain.enabled).toBe(false);
    expect(down.logs.join('\n')).toMatch(/unreachable/);
  });
});

describe('SolanaChain status & reads', () => {
  it('reports the chain status with the public RPC', async () => {
    const h = await harness({ cfg: { publicRpcUrl: null } });
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.stakeEnabled).toBe(true);
    expect(h.chain.status()).toEqual({
      enabled: true,
      cluster: 'localnet',
      programId: PROGRAM.toBase58(),
      rpcUrl: 'http://127.0.0.1:8899',
      arenasEnabled: true,
      currentSeason: 3,
      token: null,
      pass: null,
    });
    const h2 = await harness({ cfg: { publicRpcUrl: 'https://rpc.example', stakeEnabled: false } });
    expect(h2.chain.status()).toMatchObject({ rpcUrl: 'https://rpc.example', arenasEnabled: false });
  });

  it('caches profiles for 60 s, refreshes on demand and never throws', async () => {
    const owner = wallet();
    const h = await harness({ setup: (c) => c.profiles.set(owner, profileView(owner)) });
    expect(await h.chain.getProfile(owner)).toEqual({
      owner,
      name: 'gm_gummy',
      skin: 4,
      xp: 800,
      level: 5,
      premiumSkins: 0,
      gamesPlayed: 1,
      bestScore: 10,
    });
    await h.chain.getProfile(owner);
    expect(h.client.profileFetches).toBe(1);
    await h.chain.getProfile(owner, true);
    expect(h.client.profileFetches).toBe(2);
    h.clock.now += 61_000;
    h.client.profileError = new Error('429 Too Many Requests');
    expect((await h.chain.getProfile(owner))?.name).toBe('gm_gummy'); // last known value on RPC errors
    expect(await h.chain.getProfile(wallet())).toBeNull();
    expect(await h.chain.getProfile('not-a-key')).toBeNull();
  });

  it('season() returns the live pool and the previous finalized season', async () => {
    const p = wallet();
    const h = await harness({
      setup: (c) => {
        c.seasons.set(3, {
          address: 's3',
          id: 3,
          startedAt: 100,
          endedAt: 0,
          finalized: false,
          prizePool: 0,
          claimedMask: 0,
          pool: 777,
          entries: [{ player: p, name: 'alice', points: 50, bestScore: 40, skin: 2 }],
        });
        c.seasons.set(2, {
          address: 's2',
          id: 2,
          startedAt: 1,
          endedAt: 99,
          finalized: true,
          prizePool: 5_000,
          claimedMask: 0b1,
          pool: 3_500,
          entries: [{ player: p, name: 'alice', points: 9, bestScore: 9, skin: 1 }],
        });
      },
    });
    expect(await h.chain.season()).toEqual({
      id: 3,
      startedAt: 100,
      finalized: false,
      prizePool: 777,
      entries: [{ player: p, name: 'alice', skin: 2, points: 50, bestScore: 40 }],
      previous: { id: 2, prizePool: 5_000, endedAt: 99, entries: [{ player: p, name: 'alice', skin: 1, points: 9, bestScore: 9 }], claimedMask: 1 },
    });
  });
});

describe('settlement worker', () => {
  it('settles, removes the item and emits onSettled', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.sent).toBe(1);
    expect(h.client.settles[0]).toMatchObject({
      player: s.player,
      arenaId: 1,
      sessionId: 7,
      payout: 12_345_678,
      score: 420,
      kills: 2,
      xp: 50,
      currentSeason: 3,
      treasury: h.client.config!.treasury,
    });
    expect(h.settled).toEqual([{ key: s.address, player: s.player, signature: 'sig1', kind: 'settle', payout: 12_345_678 }]);
  });

  it('drops items whose session is gone or belongs to a newer join', async () => {
    const h = await harness();
    const gone = settleItem({ address: wallet(), player: wallet(), arena: wallet(), arenaId: 1, buyIn: 1, openedAt: 1, id: 3 });
    const s = h.client.addSession(wallet(), { id: 9 });
    const old = settleItem(s, { sessionId: 8 });
    h.journal.commit({ enqueue: [gone, old] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.sent).toBe(0);
    expect(h.settled).toHaveLength(0);
    expect(h.logs.filter((l) => /dropping settlement/.test(l))).toHaveLength(2);
  });

  it('retries transient errors with backoff', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    h.failures.push(new TypeError('fetch failed'));
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(1);
    const item = h.journal.pending[0];
    expect(item.attempts).toBe(1);
    expect(item.lastError).toMatch(/fetch failed/);
    expect(item.nextAttemptAt).toBe(T0 + 4_000);

    await h.chain.processPending(); // not due yet
    expect(h.sent).toBe(1);

    h.clock.now += 4_000;
    h.failures.push(new Error('Transaction simulation failed: Blockhash not found'));
    await h.chain.processPending();
    expect(h.sent).toBe(2);
    expect(h.journal.pending[0].attempts).toBe(2);
    expect(h.journal.pending[0].nextAttemptAt).toBe(h.clock.now + 8_000);

    h.clock.now += 8_000;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled.map((e) => e.signature)).toEqual(['sig3']);
  });

  it('maps permanent program errors to removal', async () => {
    const h = await harness();
    const a = h.client.addSession(wallet());
    const b = h.client.addSession(wallet(), { arenaId: 2 });
    h.journal.commit({ enqueue: [settleItem(a), settleItem(b, { createdAt: T0 + 1 })] });
    h.failures.push(
      { logs: ['Program log: AnchorError occurred. Error Code: SessionMismatch. Error Number: 6023. Error Message: x.'] },
      new Error('failed ({"err":{"InstructionError":[1,{"Custom":3012}]}})'),
    );
    await h.chain.processPending();
    expect(h.sent).toBe(2);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
  });

  it('keeps settlements but drops records when the server key is not the authority', async () => {
    const owner = wallet();
    const h = await harness({
      setup: (c) => {
        c.config = configView(Keypair.generate());
        c.profiles.set(owner, profileView(owner));
      },
    });
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.logs.join('\n')).toMatch(/NOT the program's server authority/);
    const s = h.client.addSession(wallet());
    h.journal.commit({
      enqueue: [
        settleItem(s),
        { kind: 'record', key: `${owner}:1`, player: owner, score: 100, kills: 1, xp: 20, attempts: 0, nextAttemptAt: T0, createdAt: T0 },
      ],
    });
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending.map((p) => p.kind)).toEqual(['settle']);
    expect(h.journal.pending[0].attempts).toBe(1);
    expect(await h.chain.sweepStale()).toBe(0);
  });

  it('a rejected settlement re-reads the config: changed treasury → retry, rotated key → keep', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    h.client.config = { ...h.client.config!, treasury: wallet() };
    h.failures.push({ logs: ['Program log: AnchorError caused by account: treasury. Error Code: Unauthorized. Error Number: 6000. Error Message: x.'] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(1);
    expect(h.journal.pending[0].lastError).toMatch(/treasury changed/);

    h.clock.now += 4_000;
    h.client.config = { ...h.client.config!, serverAuthority: wallet() };
    h.failures.push({ logs: ['Program log: AnchorError occurred. Error Code: Unauthorized. Error Number: 6000. Error Message: x.'] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(1); // money stays queued
    expect(h.chain.stakeEnabled).toBe(false);
  });

  it('reports a settlement whose confirmation was lost once the session is gone', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    h.failures.push(new Error('send timed out after 120 s'));
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(1);
    // it did land: the session is closed and the signature is confirmed
    h.client.sessions.clear();
    h.landed.add('sig1');
    h.clock.now += 4_000;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toEqual([{ key: s.address, player: s.player, signature: 'sig1', kind: 'settle', payout: 12_345_678 }]);
  });

  it('drops stale refunds whose session became live', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s, { reason: 'stale', payout: s.buyIn, score: 0, kills: 0, xp: 0 }));
    h.live.add(s.address);
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.join('\n')).toMatch(/stale refund .* cancelled/);
  });

  it('records free games for players with a profile and drops the rest', async () => {
    const withProfile = wallet();
    const without = wallet();
    const h = await harness({ setup: (c) => c.profiles.set(withProfile, profileView(withProfile)) });
    const record = (player: string, n: number): SettlementItem => ({
      kind: 'record',
      key: `${player}:${n}`,
      player,
      score: 1234,
      kills: 3,
      xp: 99,
      attempts: 0,
      nextAttemptAt: T0,
      createdAt: T0 + n,
    });
    h.journal.commit({ enqueue: [record(withProfile, 1), record(without, 2)] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.records).toEqual([{ player: withProfile, currentSeason: 3, score: 1234, kills: 3, xp: 99 }]);
    expect(h.settled).toEqual([{ key: `${withProfile}:1`, player: withProfile, signature: 'sig1', kind: 'record' }]);
  });

  it('keeps at most 4 sends in flight, oldest first', async () => {
    const h = await harness();
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    (h.chain as unknown as { deps: { send: unknown } }).deps.send = async (_ixs: unknown, onSig: (s: string) => void) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      onSig('x');
      return `sig-${++h.sent}`;
    };
    const items = Array.from({ length: 9 }, (_, i) => {
      const s = h.client.addSession(wallet(), { id: i });
      return settleItem(s, { createdAt: T0 - i });
    });
    h.journal.commit({ enqueue: items });
    for (let i = 0; i < 5 && h.journal.pending.length > 0; i++) {
      await h.chain.processPending();
      await new Promise((r) => setImmediate(r));
    }
    expect(h.journal.pending).toHaveLength(0);
    expect(peak).toBe(4);
    for (const s of h.client.settles) order.push(s.sessionId as number);
    expect(order.slice(0, 4)).toEqual([8, 7, 6, 5]);
  });
});

describe('stale-session sweeper', () => {
  it('queues a buy-in refund for unplayed sessions older than 15 minutes', async () => {
    const h = await harness();
    const nowS = Math.floor(T0 / 1000);
    const stale = h.client.addSession(wallet(), { openedAt: nowS - STALE_SESSION_AFTER_S - 1, buyIn: 50_000_000, id: 11, arenaId: 2 });
    h.client.addSession(wallet(), { openedAt: nowS - 60 }); // too young
    const live = h.client.addSession(wallet(), { openedAt: nowS - 3_600 });
    h.live.add(live.address);
    const queued = h.client.addSession(wallet(), { openedAt: nowS - 3_600, arenaId: 3 });
    h.journal.enqueue(settleItem(queued, { nextAttemptAt: T0 + 60_000 }));

    expect(await h.chain.sweepStale()).toBe(1);
    const item = h.journal.pending.find((p) => p.key === stale.address)!;
    expect(item).toMatchObject({ kind: 'settle', reason: 'stale', payout: 50_000_000, sessionId: 11, arenaId: 2, score: 0, kills: 0, xp: 0 });
    expect(await h.chain.sweepStale()).toBe(0); // already pending

    await h.chain.processPending();
    expect(h.settled.map((e) => [e.key, e.payout])).toEqual([[stale.address, 50_000_000]]);
  });

  it('only sweeps the configured arenas', async () => {
    const h = await harness({ cfg: { arenaIds: [1] } });
    const nowS = Math.floor(T0 / 1000);
    h.client.addSession(wallet(), { openedAt: nowS - 3_600, arenaId: 2 });
    expect(await h.chain.sweepStale()).toBe(0);
  });
});

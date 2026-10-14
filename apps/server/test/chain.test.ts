import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SlanaClient,
  ata,
  pdas,
  type ArenaView,
  type ConfigView,
  type CoreAsset,
  type OwnedPass,
  type ProfileView,
  type SeasonView as SdkSeasonView,
  type SessionView,
} from '@slana/sdk';
import { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { createChain } from '../src/chain';
import { SolanaChain, STALE_SESSION_AFTER_S, type ChainClient } from '../src/chain/solana';
import type { SettledEvent } from '../src/chain/types';
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
    tokenMint: wallet(),
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    tokenDecimals: 6,
    feeBps: 500,
    passFeeBps: 200,
    treasuryBps: 5000,
    seasonBps: 3000,
    burnBps: 2000,
    settleFeeLamports: 20_000,
    currentSeason: 3,
    paused: false,
    passCollection: null,
    passBaseUri: '',
    passSupply: 3333,
    passMinted: 0,
    passPerWallet: 1,
    passMinTokens: 0n,
    passMintOpen: false,
    passMintStartTs: 0,
    passSeedHash: null,
    passSeed: null,
    passRevealed: false,
    totals: { players: 0, games: 0, sessions: 0, staked: 0n, paidOut: 0n },
    ...overrides,
  };
}

function profileView(owner: string): ProfileView {
  return {
    address: wallet(),
    owner,
    name: 'gm_gummy',
    skin: 4,
    xp: 800,
    level: 5,
    gamesPlayed: 1,
    kills: 0,
    bestScore: 10,
    totalScore: 10,
    season: 3,
    seasonPoints: 10,
    stakeGames: 0,
    totalStaked: 0n,
    totalWon: 0n,
    createdAt: 1,
    lastPlayed: 1,
  };
}

/** Fake instruction; its data names the session it settles so a successful send can close it. */
const dummyIx = (tag = '') => new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.from(tag) });
/** Real v2 instruction builders (no RPC is touched while building). */
const realIx = new SlanaClient(new Connection('http://127.0.0.1:1'), PROGRAM).ix;
const COLLECTION = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin').toBase58();

class FakeClient implements ChainClient {
  readonly programId = PROGRAM;
  deployed = true;
  config: ConfigView | null;
  sessions = new Map<string, SessionView>();
  profiles = new Map<string, ProfileView>();
  seasons = new Map<number, SdkSeasonView>();
  settles: Record<string, unknown>[] = [];
  /** Real `settle_session` instructions built from the same params. */
  built: TransactionInstruction[] = [];
  /** Addresses `accountExists` reports as missing (e.g. a player's ATA). */
  missing = new Set<string>();
  /** Raw mint supply. */
  mintSupply = 1_000_000_000_000_000n;
  assets = new Map<string, CoreAsset>();
  owned = new Map<string, OwnedPass[]>();
  assetFetches = 0;
  ownedFetches = 0;
  arenas: ArenaView[] = [];
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
    return this.arenas;
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
  async fetchMintSupply() {
    this.check();
    return this.mintSupply;
  }
  async accountExists(address: string) {
    return !this.missing.has(address);
  }
  async fetchCoreAsset(asset: string) {
    this.assetFetches++;
    return this.assets.get(asset) ?? null;
  }
  async listOwnedPasses(owner: string, collection: string) {
    this.ownedFetches++;
    expect(collection).toBe(COLLECTION);
    return this.owned.get(owner) ?? [];
  }
  addSession(player: string, opts: Partial<SessionView> = {}): SessionView {
    const s: SessionView = {
      address: wallet(),
      player,
      arena: wallet(),
      arenaId: 1,
      entryFee: 10_000_000n,
      openedAt: Math.floor(T0 / 1000) - 60,
      id: 7,
      hasPass: false,
      passAsset: null,
      settleFee: 20_000,
      ...opts,
    };
    this.sessions.set(`${s.arenaId}:${player}`, s);
    return s;
  }
  readonly ix = {
    settleSession: async (server: PublicKey, p: Parameters<ChainClient['ix']['settleSession']>[1]) => {
      this.settles.push(p as unknown as Record<string, unknown>);
      this.built.push(await realIx.settleSession(server, p));
      return dummyIx(`${p.arenaId}:${p.player}`);
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
  /** Instructions of every send. */
  sentIxs: TransactionInstruction[][];
  server: Keypair;
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
    sentIxs: [],
    server,
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
      h.sentIxs.push(ixs);
      const signature = `sig${h.sent}`;
      onSignature(signature);
      const failure = h.failures.shift();
      if (failure !== undefined) throw failure;
      client.sessions.delete(ixs[ixs.length - 1].data.toString()); // settle_session closes the session
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
      token: { mint: h.client.config!.tokenMint, symbol: '$SLANA', decimals: 6 },
      pass: null,
    });
    // the collection is set: the Pass status is published
    h.client.config = {
      ...h.client.config!,
      passCollection: COLLECTION,
      passMinted: 12,
      passMintOpen: true,
      passMintStartTs: 1_700_000_000,
      passSeed: null,
    };
    await (h.chain as unknown as { freshConfig(): Promise<unknown> }).freshConfig();
    expect(h.chain.passStatus()).toEqual({
      collection: COLLECTION,
      supply: 3333,
      minted: 12,
      perWallet: 1,
      mintOpen: true,
      mintStartTs: 1_700_000_000,
      revealed: false,
      seed: null,
    });
    expect(h.chain.status().pass).toEqual(h.chain.passStatus());
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
          prizePool: 0n,
          claimedMask: 0,
          pool: 777n,
          entries: [{ player: p, name: 'alice', points: 50, bestScore: 40, skin: 2 }],
        });
        c.seasons.set(2, {
          address: 's2',
          id: 2,
          startedAt: 1,
          endedAt: 99,
          finalized: true,
          prizePool: 5_000n,
          claimedMask: 0b1,
          pool: 3_500n,
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
      tokenMint: h.client.config!.tokenMint,
      tokenProgram: h.client.config!.tokenProgram,
      hasPass: false,
      passAsset: null,
    });
    // fee on profit only: (12 345 678 − 10 000 000) × 5 %
    expect(h.settled).toEqual([{ key: s.address, player: s.player, signature: 'sig1', payout: 12_345_678, fee: 117_283 }]);
  });

  it('settle builds v2 accounts with pass lock only for pass sessions', async () => {
    const h = await harness();
    const asset = wallet();
    const plain = h.client.addSession(wallet(), { id: 1 });
    const withPass = h.client.addSession(wallet(), { id: 2, arenaId: 2, hasPass: true, passAsset: asset });
    h.journal.commit({ enqueue: [settleItem(plain), settleItem(withPass, { createdAt: T0 + 1 })] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.settles.map((p) => [p.hasPass, p.passAsset])).toEqual([
      [false, null],
      [true, asset],
    ]);
    const lock = pdas.passLock(asset, PROGRAM);
    const keys = h.client.built.map((ix) => ix.keys.map((k) => k.pubkey.toBase58()));
    expect(keys[0]).not.toContain(lock.toBase58());
    expect(keys[1]).toContain(lock.toBase58());
    // both carry the v2 token accounts: vault, player ATA, treasury and season vaults
    const mint = h.client.config!.tokenMint;
    const tp = h.client.config!.tokenProgram;
    expect(keys[0]).toContain(ata(plain.player, mint, tp).toBase58());
    expect(keys[1]).toContain(ata(withPass.player, mint, tp).toBase58());
    for (const k of keys) {
      expect(k).toContain(pdas.treasuryVault(PROGRAM).toBase58());
      expect(k).toContain(pdas.seasonVault(PROGRAM).toBase58());
    }
    // the Pass session pays the lower fee: (12 345 678 − 10 000 000) × 2 %
    expect(h.settled.map((e) => e.fee)).toEqual([117_283, 46_913]);
  });

  it('creates player ATA when missing', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    const mint = h.client.config!.tokenMint;
    const tp = h.client.config!.tokenProgram;
    const playerAta = ata(s.player, mint, tp);
    h.client.missing.add(playerAta.toBase58());
    const other = h.client.addSession(wallet(), { arenaId: 2 });
    h.journal.commit({ enqueue: [settleItem(s), settleItem(other, { createdAt: T0 + 1 })] });
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.sentIxs.map((ixs) => ixs.length)).toEqual([2, 1]);
    const create = h.sentIxs[0][0];
    expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(create.keys[0].pubkey.equals(h.server.publicKey)).toBe(true); // the server pays the rent
    expect(create.keys[1].pubkey.equals(playerAta)).toBe(true);
    expect(create.keys[2].pubkey.toBase58()).toBe(s.player);
  });

  it('drops items whose session is gone or belongs to a newer join', async () => {
    const h = await harness();
    const gone = settleItem({ address: wallet(), player: wallet(), arena: wallet(), arenaId: 1, entryFee: 1n, openedAt: 1, id: 3, hasPass: false, passAsset: null, settleFee: 0 });
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
      { logs: ['Program log: AnchorError occurred. Error Code: SessionMismatch. Error Number: 6019. Error Message: x.'] },
      new Error('failed ({"err":{"InstructionError":[1,{"Custom":3012}]}})'),
    );
    await h.chain.processPending();
    expect(h.sent).toBe(2);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
  });

  it('keeps settlements when the server key is not the authority', async () => {
    const h = await harness({ setup: (c) => (c.config = configView(Keypair.generate())) });
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.logs.join('\n')).toMatch(/NOT the program's server authority/);
    const s = h.client.addSession(wallet());
    h.journal.commit({ enqueue: [settleItem(s)] });
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending.map((p) => p.kind)).toEqual(['settle']);
    expect(h.journal.pending[0].attempts).toBe(1);
    expect(await h.chain.sweepStale()).toBe(0);
  });

  // v2: the treasury is a program vault, so only the rotated-key case remains.
  it('a rejected settlement re-reads the config: rotated key → keep', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
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
    expect(h.settled).toEqual([{ key: s.address, player: s.player, signature: 'sig1', payout: 12_345_678 }]);
  });

  it('drops stale refunds whose session became live', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s, { reason: 'stale', payout: Number(s.entryFee), score: 0, kills: 0, xp: 0 }));
    h.live.add(s.address);
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.join('\n')).toMatch(/stale refund .* cancelled/);
  });

  it('drops legacy record items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-journal-'));
    const path = join(dir, 'journal.json');
    const owner = wallet();
    const s = { address: wallet(), player: wallet(), arenaId: 1, id: 4 };
    const legacy = (n: number) => ({ kind: 'record', key: `${owner}:${n}`, player: owner, score: 99, kills: 1, xp: 5, attempts: 0, nextAttemptAt: T0, createdAt: T0 });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        pending: [
          legacy(1),
          { kind: 'settle', key: s.address, player: s.player, arenaId: 1, session: s.address, sessionId: 4, payout: 5, score: 1, kills: 0, xp: 0, attempts: 0, nextAttemptAt: T0, createdAt: T0 },
          legacy(2),
        ],
        live: [],
        updatedAt: T0,
      }),
    );
    const logs: string[] = [];
    const journal = new Journal(path, (m) => logs.push(m));
    expect(journal.pending.map((p) => [p.kind, p.key])).toEqual([['settle', s.address]]);
    expect(logs.join('\n')).toMatch(/dropped 2 legacy free-play record item\(s\)/);
    // the cleaned journal is written back
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { version: number; pending: { kind: string }[] };
    expect(onDisk.version).toBe(2);
    expect(onDisk.pending.map((p) => p.kind)).toEqual(['settle']);
  });

  it('refuses arenas when supply unsafe', async () => {
    const h = await harness({ setup: (c) => (c.mintSupply = BigInt(Number.MAX_SAFE_INTEGER) + 1n) });
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.chain.status().arenasEnabled).toBe(false);
    expect(h.logs.join('\n')).toMatch(/MAX_SAFE_INTEGER/);
    // settlements still run: the money is owed either way
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    // a safe supply turns the arenas back on at the next refresh
    h.client.mintSupply = 10n ** 15n;
    await (h.chain as unknown as { refresh(): Promise<void> }).refresh();
    expect(h.chain.stakeEnabled).toBe(true);
    expect(h.chain.status().arenasEnabled).toBe(true);
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
    const stale = h.client.addSession(wallet(), { openedAt: nowS - STALE_SESSION_AFTER_S - 1, entryFee: 50_000_000n, id: 11, arenaId: 2 });
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

describe('Pass reads', () => {
  const passConfig = (c: FakeClient) => (c.config = { ...c.config!, passCollection: COLLECTION });

  it('getPass verifies the collection and the name, cached 60 s', async () => {
    const h = await harness({ setup: passConfig });
    const owner = wallet();
    const good = wallet();
    const foreign = wallet();
    const badName = wallet();
    h.client.assets.set(good, { owner, collection: COLLECTION, name: 'Slana Pass #42', uri: 'x' });
    h.client.assets.set(foreign, { owner, collection: wallet(), name: 'Slana Pass #42', uri: 'x' });
    h.client.assets.set(badName, { owner, collection: COLLECTION, name: 'Slana Pass', uri: 'x' });
    expect(await h.chain.getPass(good)).toEqual({ owner, number: 42 });
    expect(await h.chain.getPass(foreign)).toBeNull();
    expect(await h.chain.getPass(badName)).toBeNull();
    expect(await h.chain.getPass('nope')).toBeNull();
    const fetches = h.client.assetFetches;
    await h.chain.getPass(good);
    expect(h.client.assetFetches).toBe(fetches);
    h.clock.now += 61_000;
    await h.chain.getPass(good);
    expect(h.client.assetFetches).toBe(fetches + 1);
  });

  it('ownedPasses lists via the SDK, cached 30 s', async () => {
    const h = await harness({ setup: passConfig });
    const owner = wallet();
    h.client.owned.set(owner, [{ asset: wallet(), number: 7 }]);
    expect(await h.chain.ownedPasses(owner)).toEqual(h.client.owned.get(owner));
    await h.chain.ownedPasses(owner);
    expect(h.client.ownedFetches).toBe(1);
    h.clock.now += 31_000;
    await h.chain.ownedPasses(owner);
    expect(h.client.ownedFetches).toBe(2);
    expect(await h.chain.ownedPasses('nope')).toEqual([]);
  });

  it('getSession and listArenas return the v2 shapes', async () => {
    const h = await harness();
    const asset = wallet();
    const s = h.client.addSession(wallet(), { hasPass: true, passAsset: asset });
    expect(await h.chain.getSession(1, s.player)).toEqual({
      address: s.address,
      id: 7,
      player: s.player,
      arenaId: 1,
      entryFee: 10_000_000,
      openedAt: s.openedAt,
      hasPass: true,
      passAsset: asset,
    });
    h.client.arenas = [
      { id: 2, address: 'A2', entryFee: 5_000n, requiresPass: true, maxSessions: 64, openSessions: 3, enabled: true, vault: 'V2', pot: 15_000n },
    ];
    expect(await h.chain.listArenas()).toEqual([
      { id: 2, address: 'A2', entryFee: 5_000, requiresPass: true, maxSessions: 64, openSessions: 3, enabled: true, pot: 15_000 },
    ]);
  });
});

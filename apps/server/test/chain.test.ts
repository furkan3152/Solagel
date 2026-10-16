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
  type ProfileView,
  type SessionView,
} from '@slana/sdk';
import { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { createChain } from '../src/chain';
import { SolanaChain, STALE_SESSION_AFTER_S, TOKEN_FAILURES_BEFORE_FINALIZE, feeAccountProblem, type ChainClient } from '../src/chain/solana';
import type { SettledEvent } from '../src/chain/types';
import { loadConfig, type ServerConfig } from '../src/config';
import { Journal, sweepKey, type SettlementItem, type SweepItem } from '../src/stake/journal';

const PROGRAM = new PublicKey('5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472');
const T0 = 1_760_000_000_000;
const wallet = () => Keypair.generate().publicKey.toBase58();
const MINT = wallet();
/** The fee wallet (defaults to the admin in `pnpm admin init`). */
const FEE_WALLET = wallet();

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
    feeWallet: FEE_WALLET,
    tokenMint: MINT,
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    tokenDecimals: 6,
    feeBps: 500,
    settleFeeLamports: 20_000,
    paused: false,
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
    stakeGames: 0,
    totalStaked: 0n,
    totalWon: 0n,
    createdAt: 1,
    lastPlayed: 1,
  };
}

/** A 165-byte SPL token account: mint, owner, state (1 initialized, 2 frozen). */
function tokenAccountData(mint: string, owner: string, state: number): Uint8Array {
  const data = new Uint8Array(165);
  data.set(new PublicKey(mint).toBytes(), 0);
  data.set(new PublicKey(owner).toBytes(), 32);
  data[108] = state;
  return data;
}

/** Fake instruction; its data names the session it settles so a successful send can close it. */
const dummyIx = (tag = '') => new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.from(tag) });
/** Real v2 instruction builders (no RPC is touched while building). */
const realIx = new SlanaClient(new Connection('http://127.0.0.1:1'), PROGRAM).ix;

class FakeClient implements ChainClient {
  readonly programId = PROGRAM;
  deployed = true;
  config: ConfigView | null;
  sessions = new Map<string, SessionView>();
  profiles = new Map<string, ProfileView>();
  settles: Record<string, unknown>[] = [];
  /** Real `settle_session` instructions built from the same params. */
  built: TransactionInstruction[] = [];
  /** `sweep_loot` params, and the real instructions built from them. */
  sweeps: Record<string, unknown>[] = [];
  sweepBuilt: TransactionInstruction[] = [];
  /** Addresses `accountExists` reports as missing (e.g. a player's ATA). */
  missing = new Set<string>();
  /** Raw mint supply. */
  mintSupply = 1_000_000_000_000_000n;
  supplyFetches = 0;
  configFetches = 0;
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
    this.configFetches++;
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
  async fetchMintSupply() {
    this.check();
    this.supplyFetches++;
    return this.mintSupply;
  }
  async accountExists(address: string) {
    return !this.missing.has(address);
  }
  /** Per-address overrides of `fetchAccount` (e.g. a frozen or foreign fee wallet account). */
  accounts = new Map<string, { owner: string; data: Uint8Array }>();
  feeAccountFetches = 0;
  /** Every other existing address reads as a healthy token account of the fee wallet (the only account fetched). */
  async fetchAccount(address: string) {
    this.feeAccountFetches++;
    this.check();
    if (this.missing.has(address)) return null;
    const set = this.accounts.get(address);
    if (set) return set;
    const c = this.config!;
    return { owner: c.tokenProgram!, data: tokenAccountData(c.tokenMint!, c.feeWallet, 1) };
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
      settleFee: 20_000,
      // the fee fixed at join
      feeBps: 500,
      finalized: false,
      owed: 0n,
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
    sweepLoot: async (server: PublicKey, p: Parameters<ChainClient['ix']['sweepLoot']>[1]) => {
      this.sweeps.push(p as unknown as Record<string, unknown>);
      const ix = await realIx.sweepLoot(server, p);
      this.sweepBuilt.push(ix);
      return ix;
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
  /** Block height ('confirmed'); a send's blockhash stays valid for 150 blocks. */
  chainHeight: { now: number };
  /** RPC failures of the sweep checks: status lookup / block height. */
  rpc: { statusDown: boolean; heightDown: boolean };
}

async function harness(
  opts: { cfg?: Partial<ServerConfig['chain']>; setup?: (c: FakeClient, server: Keypair) => void; journal?: Journal } = {},
): Promise<Harness> {
  const server = Keypair.generate();
  const client = new FakeClient(server);
  opts.setup?.(client, server);
  const journal = opts.journal ?? new Journal(null);
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
    chainHeight: { now: 1_000 },
    rpc: { statusDown: false, heightDown: false },
  };
  h.chain = new SolanaChain(chainConfig(opts.cfg), journal, (m) => h.logs.push(m), {
    client,
    keypair: server,
    loops: false,
    now: () => h.clock.now,
    balance: async () => 1_000_000_000,
    signatureLanded: async (sig) => {
      if (h.rpc.statusDown) throw new TypeError('fetch failed');
      return h.landed.has(sig);
    },
    blockHeight: async () => {
      if (h.rpc.heightDown) throw new TypeError('fetch failed');
      return h.chainHeight.now;
    },
    send: async (ixs, onSignature) => {
      h.sent++;
      h.sentIxs.push(ixs);
      const signature = `sig${h.sent}`;
      onSignature(signature, h.chainHeight.now + 150);
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
    expect(chain.status()).toEqual({ enabled: false, cluster: 'localnet', programId: null, rpcUrl: null, arenasEnabled: false, tokenReady: false, token: null, feeBps: null });
    expect(chain.tokenReady).toBe(false);
    expect(await chain.getProfile(wallet())).toBeNull();
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
      tokenReady: true,
      token: { mint: MINT, symbol: '$SLANA', decimals: 6 },
      feeBps: 500,
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
      tokenMint: MINT,
      tokenProgram: h.client.config!.tokenProgram,
      feeWalletToken: ata(FEE_WALLET, MINT, h.client.config!.tokenProgram!).toBase58(),
    });
    expect(h.client.settles[0].playerToken).toBeUndefined();
    // fee on profit only: (12 345 678 − 10 000 000) × 5 %
    expect(h.settled).toEqual([{ key: s.address, player: s.player, arenaId: 1, signature: 'sig1', payout: 12_345_678, fee: 117_283 }]);
  });

  it('settle pays the fee to the fee wallet token account and the rest to the player ATA', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    const tp = h.client.config!.tokenProgram!;
    // account order: server, config, arena, vault, session, player, player_token, profile, fee_wallet_token, mint, token program
    const keys = h.client.built[0].keys.map((k) => k.pubkey.toBase58());
    expect(keys[6]).toBe(ata(s.player, MINT, tp).toBase58());
    expect(keys[8]).toBe(ata(FEE_WALLET, MINT, tp).toBase58());
    expect(h.client.built[0].keys[8].isWritable).toBe(true);
    expect(keys[9]).toBe(MINT);
  });

  it('the fee wallet plays: settles without its player token account (2040) and collects through refund', async () => {
    const h = await harness();
    // the fee wallet bought a ticket: its ATA is both the player account and the fee account
    const s = h.client.addSession(FEE_WALLET);
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(0);
    const tp = h.client.config!.tokenProgram!;
    const feeAta = ata(FEE_WALLET, MINT, tp).toBase58();
    expect(h.client.settles[0]).toMatchObject({ player: FEE_WALLET, playerToken: null, feeWalletToken: feeAta });
    // the account appears once (fee_wallet_token); the optional player_token slot is the program id
    const keys = h.client.built[0].keys.map((k) => k.pubkey.toBase58());
    expect(keys[6]).toBe(PROGRAM.toBase58());
    expect(keys.filter((k) => k === feeAta)).toHaveLength(1);
    // finalized with `owed`: the player collects with refund_session
    expect(h.settled).toMatchObject([{ key: s.address, player: FEE_WALLET, payout: 12_345_678, fee: 117_283, collect: true }]);
    expect(h.logs.some((l) => /the player is the fee wallet/.test(l))).toBe(true);
    // a player who is not the fee wallet is still paid directly
    const other = h.client.addSession(wallet(), { id: 8 });
    h.journal.enqueue(settleItem(other));
    await h.chain.processPending();
    expect(h.client.settles[1].playerToken).toBeUndefined();
  });

  it('the settled fee is the one fixed at join, not the current config', async () => {
    const h = await harness();
    // joined at 5 % (and one at 2 %); the admin has since raised the fee to 10 %
    h.client.config = { ...h.client.config!, feeBps: 1_000 };
    const plain = h.client.addSession(wallet(), { id: 1 });
    const cheap = h.client.addSession(wallet(), { id: 2, arenaId: 2, feeBps: 200 });
    h.journal.commit({ enqueue: [settleItem(plain), settleItem(cheap, { createdAt: T0 + 1 })] });
    await h.chain.processPending();
    expect(h.settled.map((e) => e.fee)).toEqual([117_283, 46_913]);
  });

  it('R24: a missing player ATA settles at once without the token account (finalize, no server-paid rent)', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    const playerAta = ata(s.player, MINT, h.client.config!.tokenProgram!);
    h.client.missing.add(playerAta.toBase58());
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.settles[0].playerToken).toBeNull();
    // the real instruction carries the program id in the optional player_token slot
    const keys = h.client.built[0].keys.map((k) => k.pubkey.toBase58());
    expect(keys[6]).toBe(PROGRAM.toBase58());
    expect(keys).not.toContain(playerAta.toBase58());
    expect(h.sentIxs.flat().some((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))).toBe(false);
    expect(h.settled).toMatchObject([{ key: s.address, collect: true }]);
    expect(h.logs.some((l) => /finalized .* \(to collect\)/.test(l))).toBe(true);
  });

  it('a zero payout without an ATA is not flagged as a payout to collect', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.client.missing.add(ata(s.player, MINT, h.client.config!.tokenProgram!).toBase58());
    h.journal.enqueue(settleItem(s, { payout: 0, reason: 'death' }));
    await h.chain.processPending();
    expect(h.client.settles[0].playerToken).toBeNull();
    expect(h.settled[0].collect).toBeUndefined();
  });

  it(`R24: after ${TOKEN_FAILURES_BEFORE_FINALIZE} token-account failures (e.g. MemoTransfer) the worker settles without it`, async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    const memo = () => ({
      logs: [
        'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]',
        'Program log: Error: No memo in previous instruction; required for recipient to receive a transfer',
        'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x24',
      ],
    });
    for (let i = 0; i < TOKEN_FAILURES_BEFORE_FINALIZE; i++) h.failures.push(memo());
    for (let i = 0; i < TOKEN_FAILURES_BEFORE_FINALIZE; i++) {
      await h.chain.processPending();
      expect(h.journal.settlements()[0].tokenFailures).toBe(i + 1);
      h.clock.now = h.journal.pending[0].nextAttemptAt;
    }
    expect(h.client.settles.every((p) => p.playerToken === undefined)).toBe(true);
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.settles.at(-1)!.playerToken).toBeNull();
    expect(h.settled).toMatchObject([{ key: s.address, collect: true }]);
    // an owner-changed account (ConstraintTokenOwner) counts too
    const t = await harness();
    const s2 = t.client.addSession(wallet());
    t.journal.enqueue(settleItem(s2));
    t.failures.push({ logs: ['Program log: AnchorError caused by account: player_token. Error Code: ConstraintTokenOwner. Error Number: 2015. Error Message: x.'] });
    await t.chain.processPending();
    expect(t.journal.settlements()[0].tokenFailures).toBe(1);
  });

  it('I2: AccountNotInitialized with the session still open retries; dropped only once the session is gone', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    // the player closed the ATA between the existence check and the send
    h.failures.push(new Error('failed ({"err":{"InstructionError":[1,{"Custom":3012}]}})'));
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(1);
    expect(h.journal.pending[0].lastError).toMatch(/session still open/);
    // next attempt: the ATA is gone → finalize without it
    h.client.missing.add(ata(s.player, MINT, h.client.config!.tokenProgram!).toBase58());
    h.clock.now = h.journal.pending[0].nextAttemptAt;
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.settles.at(-1)!.playerToken).toBeNull();

    // the session really closed (someone else settled/refunded it): dropped
    const g = await harness();
    const s2 = g.client.addSession(wallet());
    g.journal.enqueue(settleItem(s2));
    g.failures.push(new Error('failed ({"err":{"InstructionError":[1,{"Custom":3012}]}})'));
    const fetch = g.client.fetchSession.bind(g.client);
    let calls = 0;
    g.client.fetchSession = async (a, p) => (++calls > 1 ? null : fetch(a, p));
    await g.chain.processPending();
    expect(g.journal.pending).toHaveLength(0);
    expect(g.logs.some((l) => /dropping settlement/.test(l))).toBe(true);
    // a re-opened session (newer id) is dropped too
    const r = await harness();
    const s3 = r.client.addSession(wallet(), { id: 5 });
    r.journal.enqueue(settleItem(s3));
    r.failures.push(new Error('failed ({"err":{"InstructionError":[1,{"Custom":3007}]}})'));
    let n = 0;
    r.client.fetchSession = async () => (++n > 1 ? { ...s3, id: 6 } : s3);
    await r.chain.processPending();
    expect(r.journal.pending).toHaveLength(0);
  });

  it('a finalized session is never settled again', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet(), { finalized: true, owed: 5n });
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.some((l) => /finalized/.test(l))).toBe(true);
  });

  it('drops items whose session is gone or belongs to a newer join', async () => {
    const h = await harness();
    const gone = settleItem({ address: wallet(), player: wallet(), arena: wallet(), arenaId: 1, entryFee: 1n, openedAt: 1, id: 3, settleFee: 0, feeBps: 500, finalized: false, owed: 0n });
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
      { logs: ['Program log: AnchorError occurred. Error Code: SessionMismatch. Error Number: 6011. Error Message: x.'] },
      { logs: ['Program log: AnchorError occurred. Error Code: SessionFinalized. Error Number: 6020. Error Message: x.'] },
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
    expect(h.settled).toEqual([{ key: s.address, player: s.player, arenaId: 1, signature: 'sig1', payout: 12_345_678 }]);
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
          { kind: 'mystery', key: 'm1', player: owner, score: 0, kills: 0, xp: 0, attempts: 0, nextAttemptAt: T0, createdAt: T0 },
        ],
        live: [],
        updatedAt: T0,
      }),
    );
    const logs: string[] = [];
    const journal = new Journal(path, (m) => logs.push(m));
    // only records are dropped: an unknown kind still reaches the worker's loud path
    expect(journal.pending.map((p) => [p.kind, p.key])).toEqual([
      ['settle', s.address],
      ['mystery', 'm1'],
    ]);
    expect(logs.join('\n')).toMatch(/dropped 2 legacy free-play record item\(s\)/);
    // the cleaned journal is written back
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { version: number; pending: { kind: string }[] };
    expect(onDisk.version).toBe(2);
    expect(onDisk.pending.map((p) => p.kind)).toEqual(['settle', 'mystery']);
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

  it('STALE_SESSION_AFTER_S shortens the age (localnet e2e)', async () => {
    const h = await harness({ cfg: { staleSessionAfterS: 5 } });
    const nowS = Math.floor(T0 / 1000);
    const old = h.client.addSession(wallet(), { openedAt: nowS - 6, entryFee: 7n, id: 21 });
    h.client.addSession(wallet(), { openedAt: nowS - 2 }); // younger than 5 s
    expect(await h.chain.sweepStale()).toBe(1);
    expect(h.journal.pending.map((p) => p.key)).toEqual([old.address]);
    expect(h.logs.some((l) => /older than 5 s/.test(l))).toBe(true);
  });

  it('skips finalized sessions (their payout is the player\'s to collect)', async () => {
    const h = await harness();
    const nowS = Math.floor(T0 / 1000);
    h.client.addSession(wallet(), { openedAt: nowS - 3_600, finalized: true, owed: 9n });
    expect(await h.chain.sweepStale()).toBe(0);
  });

  it('M9: stays off after a journal quarantine until STALE_SWEEP_ACK=1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-quarantine-'));
    const path = join(dir, 'journal.json');
    writeFileSync(path, '{ not json');
    const nowS = Math.floor(T0 / 1000);
    for (const ack of [false, true]) {
      const h = await harness({ cfg: { staleSweepAck: ack } });
      const journal = new Journal(path);
      expect(journal.quarantinedFiles()).toHaveLength(1);
      const chain = new SolanaChain(chainConfig({ staleSweepAck: ack }), journal, (m) => h.logs.push(m), {
        client: h.client,
        keypair: h.server,
        loops: false,
        now: () => h.clock.now,
        balance: async () => 1_000_000_000,
      });
      await chain.start();
      h.client.addSession(wallet(), { openedAt: nowS - 3_600 });
      expect(await chain.sweepStale()).toBe(ack ? 1 : 0);
      if (!ack) expect(h.logs.some((l) => /sweeper is OFF .*STALE_SWEEP_ACK=1/.test(l))).toBe(true);
    }
  });

  it('only sweeps the configured arenas', async () => {
    const h = await harness({ cfg: { arenaIds: [1] } });
    const nowS = Math.floor(T0 / 1000);
    h.client.addSession(wallet(), { openedAt: nowS - 3_600, arenaId: 2 });
    expect(await h.chain.sweepStale()).toBe(0);
  });
});

describe('reads', () => {
  it('getSession and listArenas return the v2 shapes', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    expect(await h.chain.getSession(1, s.player)).toEqual({
      address: s.address,
      id: 7,
      player: s.player,
      arenaId: 1,
      entryFee: 10_000_000,
      openedAt: s.openedAt,
      finalized: false,
      owed: 0,
    });
    h.client.arenas = [
      { id: 2, address: 'A2', entryFee: 5_000n, maxSessions: 64, openSessions: 3, enabled: true, vault: 'V2', pot: 15_000n },
    ];
    expect(await h.chain.listArenas()).toEqual([
      { id: 2, address: 'A2', entryFee: 5_000, maxSessions: 64, openSessions: 3, enabled: true, pot: 15_000 },
    ]);
  });
});

function sweepItem(overrides: Partial<SweepItem> = {}): SweepItem {
  return {
    kind: 'sweep',
    key: sweepKey('arena-1-1', 5_970_000),
    arenaId: 1,
    roomId: 'arena-1-1',
    round: 5_970_000,
    amount: 3_141_592,
    attempts: 0,
    nextAttemptAt: T0,
    createdAt: T0,
    ...overrides,
  };
}

describe('loot sweeps (round end)', () => {
  it('sends sweep_loot (a burn) for exactly the journaled amount, signed by the server, once', async () => {
    const h = await harness();
    h.journal.enqueue(sweepItem());
    await h.chain.processPending();
    expect(h.client.sweeps).toEqual([{ id: 1, amount: 3_141_592, tokenMint: MINT, tokenProgram: h.client.config!.tokenProgram }]);
    const ix = h.client.sweepBuilt[0];
    expect(ix.keys[0]).toMatchObject({ isSigner: true });
    expect(ix.keys[0].pubkey.equals(h.server.publicKey)).toBe(true);
    // the burn lowers the supply: the mint is writable; the vault is the arena's
    const mintKey = ix.keys.find((k) => k.pubkey.toBase58() === MINT)!;
    expect(mintKey.isWritable).toBe(true);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toContain(pdas.vault(pdas.arena(1, PROGRAM), PROGRAM).toBase58());
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.logs.some((l) => /burned .* loot of arena-1-1/.test(l))).toBe(true);
    await h.chain.processPending();
    expect(h.sent).toBe(1);
  });

  it('a sweep item survives a journal reload and is executed once', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'slana-sweep-')), 'journal.json');
    const before = new Journal(path);
    // the round-end write: the floor loot leaves the loot records in the same commit that queues the sweep
    before.commit({ roomId: 'arena-1-1', live: [], loot: { roomId: 'arena-1-1', arenaId: 1, items: [{ x: 1, y: 2, value: 3_141_592 }] } });
    expect(before.owedByArena(1)).toBe(3_141_592);
    before.commit({ enqueue: [sweepItem()], roomId: 'arena-1-1', live: [], loot: { roomId: 'arena-1-1', arenaId: 1, items: [] } });
    expect(before.owedByArena(1)).toBe(3_141_592);

    const reloaded = new Journal(path);
    expect(reloaded.pending).toEqual([sweepItem()]);
    expect(reloaded.recoverLoot(1)).toEqual([]);
    expect(reloaded.recoverLive()).toBe(0);
    expect(reloaded.pending).toHaveLength(1);
    const h = await harness({ journal: reloaded });
    await h.chain.processPending();
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(new Journal(path).pending).toEqual([]);
  });

  /** A sweep whose send timed out (outcome unknown): its signature and blockhash expiry are on disk. */
  async function lostSweep() {
    const path = join(mkdtempSync(join(tmpdir(), 'slana-sweep-')), 'journal.json');
    const h = await harness({ journal: new Journal(path) });
    h.journal.enqueue(sweepItem());
    h.failures.push(new Error('confirmation timeout'));
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(new Journal(path).pending[0]).toMatchObject({ kind: 'sweep', sentSignature: 'sig1', sentAt: T0, sentLastValidBlockHeight: 1_150 });
    const again = async () => {
      h.clock.now = h.journal.pending[0]?.nextAttemptAt ?? h.clock.now;
      await h.chain.processPending();
    };
    return { h, path, again };
  }

  it('landed before expiry: marked done, never sent again', async () => {
    const { h, path, again } = await lostSweep();
    h.landed.add('sig1');
    await again();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(0);
    expect(new Journal(path).pending).toEqual([]);
    expect(h.client.sweeps).toHaveLength(1);
  });

  it('not landed but the blockhash is still valid: waits, no resend', async () => {
    const { h, again } = await lostSweep();
    for (const height of [1_000, 1_100, 1_150]) {
      h.chainHeight.now = height; // at lastValidBlockHeight the transaction may still land
      await again();
      expect(h.sent).toBe(1);
      expect(h.journal.pending).toHaveLength(1);
    }
    // landed even after a long wall-clock delay: still never resent
    h.clock.now += 10 * 60_000;
    h.landed.add('sig1');
    await again();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(0);
  });

  it('expired and not found: sent again (with a new expiry), exactly once', async () => {
    const { h, again } = await lostSweep();
    h.chainHeight.now = 1_151;
    await again();
    expect(h.sent).toBe(2);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.sweeps).toHaveLength(2);
    await again();
    expect(h.sent).toBe(2);
  });

  it('an RPC error while checking: waits and retries later, never resends', async () => {
    const { h, again } = await lostSweep();
    h.chainHeight.now = 5_000; // expired, but the checks cannot be read
    h.rpc.statusDown = true;
    await again();
    expect(h.sent).toBe(1);
    expect(h.journal.pending[0].lastError).toMatch(/status unknown/);
    h.rpc.statusDown = false;
    h.rpc.heightDown = true;
    await again();
    expect(h.sent).toBe(1);
    expect(h.journal.pending[0].lastError).toMatch(/block height unavailable/);
    // the RPC is back: expired and not landed → resend
    h.rpc.heightDown = false;
    await again();
    expect(h.sent).toBe(2);
    expect(h.journal.pending).toHaveLength(0);
  });

  it('a sweep sent without a recorded expiry is never resent', async () => {
    const h = await harness();
    h.journal.enqueue(sweepItem({ sentSignature: 'old', sentAt: T0 - 3_600_000 }));
    h.chainHeight.now = 99_999;
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending).toHaveLength(1);
    expect(h.logs.some((l) => /without a recorded blockhash expiry/.test(l))).toBe(true);
  });

  it('a program error is final (nothing moved): retried at once', async () => {
    const t = await harness();
    t.journal.enqueue(sweepItem());
    t.failures.push({ logs: ['Program log: AnchorError occurred. Error Code: InsufficientPot. Error Number: 6007. Error Message: x.'] });
    await t.chain.processPending();
    const left = t.journal.pending[0] as SweepItem;
    expect(left.sentSignature).toBeUndefined();
    expect(left.sentLastValidBlockHeight).toBeUndefined();
    expect(left.attempts).toBe(1);
    t.clock.now = left.nextAttemptAt;
    await t.chain.processPending();
    expect(t.sent).toBe(2);
    expect(t.journal.pending).toHaveLength(0);
  });
});

describe('token watcher (initialized without a mint, set_token_mint later)', () => {
  const unset = (c: FakeClient) => (c.config = { ...c.config!, tokenMint: null, tokenProgram: null, tokenDecimals: 0 });

  it('runs practice only while the mint is unset: no arenas, no supply read, settlements wait', async () => {
    const h = await harness({ setup: unset });
    expect(h.chain.enabled).toBe(true);
    expect(h.chain.tokenReady).toBe(false);
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.chain.status()).toMatchObject({ enabled: true, arenasEnabled: false, tokenReady: false, token: null, feeBps: 500 });
    expect(h.logs.join('\n')).toMatch(/token not set/);
    expect(h.client.supplyFetches).toBe(0);
    h.client.arenas = [{ id: 1, address: 'A1', entryFee: 5_000n, maxSessions: 64, openSessions: 0, enabled: true, vault: 'V1', pot: 0n }];
    expect(await h.chain.listArenas(true)).toEqual([]);
    expect(await h.chain.sweepStale()).toBe(0);
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending[0].lastError).toBe('game token not set');
  });

  it('picks the mint up on the 30 s refresh without a restart and tells the listeners once', async () => {
    const h = await harness({ setup: unset });
    let changes = 0;
    h.chain.onStatusChange(() => changes++);
    // a settlement queued while the token is unset is held…
    const held = h.client.addSession(wallet(), { id: 3, arenaId: 2 });
    h.journal.enqueue(settleItem(held));
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending[0].lastError).toBe('game token not set');
    await h.chain.refresh();
    expect(changes).toBe(0);
    expect(h.chain.tokenReady).toBe(false);

    // `pnpm admin set-token --mint <CA>` lands
    h.client.config = configView(h.server);
    h.client.arenas = [{ id: 1, address: 'A1', entryFee: 5_000n, maxSessions: 64, openSessions: 0, enabled: true, vault: 'V1', pot: 0n }];
    await h.chain.refresh();
    expect(changes).toBe(1);
    expect(h.chain.tokenReady).toBe(true);
    expect(h.chain.stakeEnabled).toBe(true);
    expect(h.client.supplyFetches).toBe(1);
    expect(h.chain.status()).toMatchObject({ arenasEnabled: true, tokenReady: true, token: { mint: MINT, decimals: 6 } });
    expect((await h.chain.listArenas()).map((a) => a.id)).toEqual([1]);
    expect(h.logs.some((l) => /game token set — mint /.test(l))).toBe(true);
    // later refreshes keep it (the mint is set once) and do not announce again
    await h.chain.refresh();
    expect(changes).toBe(1);
    // …and the same held item goes out after the flip, paid to the player directly
    h.clock.now = h.journal.pending[0].nextAttemptAt;
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(0);
    expect(h.client.settles[0]).toMatchObject({ player: held.player, sessionId: 3 });
    expect(h.client.settles[0].playerToken).toBeUndefined();
    expect(h.settled.map((e) => e.key)).toEqual([held.address]);
  });

  it('a server booting with the token already set does not announce a flip', async () => {
    const h = await harness();
    expect(h.chain.tokenReady).toBe(true);
    expect(h.logs.some((l) => /game token set — mint /.test(l))).toBe(false);
    let changes = 0;
    h.chain.onStatusChange(() => changes++);
    await h.chain.refresh();
    expect(changes).toBe(0);
  });

  it('pushes arenasEnabled changes too (supply unsafe and back), not only the token flip', async () => {
    const h = await harness();
    const seen: boolean[] = [];
    h.chain.onStatusChange(() => seen.push(h.chain.status().arenasEnabled));
    h.client.mintSupply = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await h.chain.refresh();
    expect(seen).toEqual([false]);
    await h.chain.refresh();
    expect(seen).toEqual([false]);
    h.client.mintSupply = 10n ** 15n;
    await h.chain.refresh();
    expect(seen).toEqual([false, true]);
    // a rotated server key turns the arenas off as well
    h.client.config = { ...h.client.config!, serverAuthority: wallet() };
    await h.chain.refresh();
    expect(seen).toEqual([false, true, false]);
  });

  it('an unsafe supply keeps arenas off after the mint is set (still announced as tokenReady)', async () => {
    const h = await harness({ setup: unset });
    h.client.mintSupply = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    h.client.config = configView(h.server);
    await h.chain.refresh();
    expect(h.chain.tokenReady).toBe(true);
    expect(h.chain.stakeEnabled).toBe(false);
    expect(h.chain.status()).toMatchObject({ tokenReady: true, arenasEnabled: false });
  });
});

describe('fee wallet token account', () => {
  const feeAta = () => ata(FEE_WALLET, MINT, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBase58();

  it('feeAccountProblem accepts only an initialized, unfrozen account of the game mint owned by the fee wallet', () => {
    const tp = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const expect_ = { tokenProgram: tp, tokenMint: MINT, feeWallet: FEE_WALLET };
    expect(feeAccountProblem({ owner: tp, data: tokenAccountData(MINT, FEE_WALLET, 1) }, expect_)).toBeNull();
    expect(feeAccountProblem(null, expect_)).toBe('missing');
    expect(feeAccountProblem({ owner: tp, data: tokenAccountData(MINT, FEE_WALLET, 2) }, expect_)).toBe('frozen');
    expect(feeAccountProblem({ owner: tp, data: tokenAccountData(MINT, FEE_WALLET, 0) }, expect_)).toBe('not initialized');
    expect(feeAccountProblem({ owner: tp, data: tokenAccountData(wallet(), FEE_WALLET, 1) }, expect_)).toMatch(/not the game token/);
    expect(feeAccountProblem({ owner: tp, data: tokenAccountData(MINT, wallet(), 1) }, expect_)).toMatch(/not the fee wallet/);
    expect(feeAccountProblem({ owner: wallet(), data: tokenAccountData(MINT, FEE_WALLET, 1) }, expect_)).toMatch(/not the token program/);
    expect(feeAccountProblem({ owner: tp, data: new Uint8Array(10) }, expect_)).toBe('not a token account');
  });

  it('missing: every settlement (and finalize) is held, never counted against the player; recreated: they flow', async () => {
    const h = await harness();
    h.client.missing.add(feeAta());
    const plain = h.client.addSession(wallet(), { id: 1 });
    const noAta = h.client.addSession(wallet(), { id: 2, arenaId: 2 });
    h.client.missing.add(ata(noAta.player, MINT, h.client.config!.tokenProgram!).toBase58()); // would finalize
    h.journal.commit({ enqueue: [settleItem(plain), settleItem(noAta, { createdAt: T0 + 1 })] });
    for (let i = 0; i < TOKEN_FAILURES_BEFORE_FINALIZE + 1; i++) {
      await h.chain.processPending();
      h.clock.now = Math.max(...h.journal.pending.map((p) => p.nextAttemptAt));
    }
    expect(h.sent).toBe(0);
    expect(h.journal.settlements()).toHaveLength(2);
    for (const p of h.journal.settlements()) {
      expect(p.tokenFailures).toBeUndefined();
      expect(p.lastError).toBe('fee wallet token account missing');
    }
    const loud = h.logs.filter((l) => /^!!! chain: fee wallet token account .* is missing: ALL settlements are held/.test(l));
    expect(loud).toHaveLength(1); // about once a minute, not per item
    expect(h.logs.some((l) => /player's token account refused|settling without it/.test(l))).toBe(false);

    // the admin recreates it (idempotent ATA creation): both settle, the plain player is paid directly
    h.client.missing.delete(feeAta());
    h.clock.now = Math.max(...h.journal.pending.map((p) => p.nextAttemptAt));
    await h.chain.processPending();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.sent).toBe(2);
    expect(h.client.settles.find((p) => p.player === plain.player)!.playerToken).toBeUndefined();
    expect(h.client.settles.find((p) => p.player === noAta.player)!.playerToken).toBeNull();
    expect(h.logs.some((l) => /is usable again — settlements resume/.test(l))).toBe(true);
  });

  it('frozen: held as well', async () => {
    const h = await harness();
    h.client.accounts.set(feeAta(), { owner: h.client.config!.tokenProgram!, data: tokenAccountData(MINT, FEE_WALLET, 2) });
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    await h.chain.processPending();
    expect(h.sent).toBe(0);
    expect(h.journal.pending[0].lastError).toBe('fee wallet token account frozen');
  });

  it('closed between the check and the send: the account error is not blamed on the player', async () => {
    const h = await harness();
    const s = h.client.addSession(wallet());
    h.journal.enqueue(settleItem(s));
    // the check passed (cached for 30 s), then the fee wallet closed its account before the send
    const fetchAccount = h.client.fetchAccount.bind(h.client);
    let n = 0;
    h.client.fetchAccount = async (a) => (++n > 1 ? null : fetchAccount(a));
    h.failures.push(new Error('failed ({"err":{"InstructionError":[0,{"Custom":3012}]}})'));
    await h.chain.processPending();
    expect(h.sent).toBe(1);
    expect(h.journal.pending).toHaveLength(1);
    expect(h.journal.settlements()[0].tokenFailures).toBeUndefined();
    expect(h.journal.pending[0].lastError).toMatch(/fee wallet token account missing/);
    // a ConstraintTokenOwner on it is not counted either
    const t = await harness();
    const s2 = t.client.addSession(wallet());
    t.journal.enqueue(settleItem(s2));
    t.client.accounts.set(feeAta(), { owner: t.client.config!.tokenProgram!, data: tokenAccountData(MINT, FEE_WALLET, 1) });
    let m = 0;
    const fetch2 = t.client.fetchAccount.bind(t.client);
    t.client.fetchAccount = async (a) => (++m > 1 ? { owner: t.client.config!.tokenProgram!, data: tokenAccountData(MINT, wallet(), 1) } : fetch2(a));
    t.failures.push({ logs: ['Program log: AnchorError caused by account: fee_wallet_token. Error Code: ConstraintTokenOwner. Error Number: 2015. Error Message: x.'] });
    await t.chain.processPending();
    expect(t.journal.settlements()[0].tokenFailures).toBeUndefined();
    expect(t.journal.pending[0].lastError).toMatch(/not the fee wallet/);
  });
});

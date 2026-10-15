import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_ARENAS, TOKEN_SYMBOL_DEFAULT, type ChainStatus, type PassStatus } from '@slana/shared';
import bs58 from 'bs58';
import type { Journal } from '../stake/journal';
import type { ChainArena, ChainGateway, ChainPass, ChainProfile, ChainSession, OwnedPassInfo, SeasonView, SettledEvent } from './types';

/** Token decimals of the fake mint (pump.fun style). */
const DECIMALS = 6;
/** Fee on profit, basis points (program defaults: 5 %, 2 % with a Pass). */
const FEE_BPS = 500;
const PASS_FEE_BPS = 200;
const PASS_SUPPLY = 3333;
/** Revealed trait seed of the fake collection (32 bytes hex). */
const PASS_SEED = createHash('sha256').update('slana-dev-fake-chain').digest('hex');

/** Made-up season players. */
const DEV_SEASON_NAMES = ['pennyhunter', 'Nakamoto', 'Daphne', 'whale_bay', 'inkwell', 'riso', 'night market', 'Alice', 'tokyo_drift', 'mustard', 'Matt', 'papercut'] as const;
/** A stable, address-shaped id for a made-up player. */
const fakeAddress = (label: string) => bs58.encode(createHash('sha256').update(label).digest());

/** Deterministic Pass number for a wallet (1..supply). */
const passNumberOf = (wallet: string) => (createHash('sha256').update(wallet).digest().readUInt32LE(0) % PASS_SUPPLY) + 1;
/** Passes "minted" before this server started (the collection is not empty). */
const PRE_MINTED = 412;

/**
 * The fake collection: `mint` starts open and unrevealed with no Pass in any wallet
 * (mint → envelope → sealed passport, then a dev-only reveal publishes the seed);
 * `revealed` gives every wallet one revealed Pass.
 */
export type DevFakePassMode = 'mint' | 'revealed';

/** Dev-only actions the HTTP server exposes under `/api/dev/` when the fake chain runs. */
export interface DevFakePassActions {
  devMintPass(wallet: string): { ok: true; pass: OwnedPassInfo } | { ok: false; error: string };
  devRevealPasses(): PassStatus;
}

/**
 * DEV ONLY (`DEV_FAKE_CHAIN=1` with `NODE_ENV=development`, see `assertDevFakeChainAllowed`). An in-memory chain so
 * the arena flow (ticket → play → death / round-end payout → settlement) can be driven
 * locally without a validator:
 *  - every signed-in wallet has an open ticket in every default arena; tickets of
 *    Pass arenas are bought "with" the wallet's fake Pass;
 *  - Pass collection (`DevFakePassMode`): by default the mint is open and unrevealed
 *    and a wallet owns only what it minted here (`devMintPass`) until `devRevealPasses`
 *    publishes the seed; `revealed` mode gives every wallet one revealed Pass
 *    (number derived from the wallet);
 *  - settlements are simulated `settleMs` after the journal item appears: the
 *    item is removed, the ticket closes and a `settled` event with the fee fires.
 *    Only items for tickets this instance issued are ever touched; it also runs
 *    on its own journal file (`journal.dev-fake.json`).
 */
export class DevFakeChain implements ChainGateway, DevFakePassActions {
  readonly enabled = true;
  readonly stakeEnabled = true;
  private readonly sessions = new Map<string, ChainSession>();
  private readonly byAddress = new Map<string, ChainSession>();
  private readonly listeners: ((e: SettledEvent) => void)[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly scheduled = new Set<string>();
  private nextId = 1;
  private stopped = false;
  /** Mint mode: Pass numbers minted here, per wallet. */
  private readonly mints = new Map<string, number[]>();
  private minted = PRE_MINTED;
  private revealed: boolean;
  /** Raw token units of floor loot swept into the running season's pool (round ends). */
  private swept = 0;

  constructor(
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly settleMs = 2600,
    readonly passMode: DevFakePassMode = 'mint',
  ) {
    this.revealed = passMode === 'revealed';
  }

  /** The wallet's Pass numbers (mint mode: minted here; revealed mode: one per wallet). */
  private passNumbers(wallet: string): number[] {
    return this.passMode === 'revealed' ? [passNumberOf(wallet)] : (this.mints.get(wallet) ?? []);
  }

  status(): ChainStatus {
    return {
      enabled: true,
      cluster: 'devnet',
      programId: 'DevFakeChain1111111111111111111111111111111',
      rpcUrl: null,
      arenasEnabled: true,
      currentSeason: 2,
      token: { mint: 'DevFakeMint11111111111111111111111111111111', symbol: TOKEN_SYMBOL_DEFAULT, decimals: DECIMALS },
      pass: this.passStatus(),
    };
  }

  async getProfile(_owner: string): Promise<ChainProfile | null> {
    return null;
  }

  async getSession(arenaId: number, player: string): Promise<ChainSession | null> {
    const arena = (await this.listArenas()).find((a) => a.id === arenaId);
    if (!arena) return null;
    const key = `${arenaId}:${player}`;
    let s = this.sessions.get(key);
    if (!s) {
      const owned = this.passNumbers(player);
      // a Pass arena sells tickets only to a wallet with a Pass
      if (arena.requiresPass && owned.length === 0) return null;
      const id = this.nextId++;
      const hasPass = arena.requiresPass;
      s = {
        address: `DevSession${id}x${player.slice(0, 8)}`,
        id,
        player,
        arenaId,
        entryFee: arena.entryFee,
        openedAt: Math.floor(Date.now() / 1000),
        hasPass,
        passAsset: hasPass ? `DevPass${owned[0]}x${player}` : null,
        finalized: false,
        owed: 0,
      };
      this.sessions.set(key, s);
      this.byAddress.set(s.address, s);
    }
    return s;
  }

  async listArenas(): Promise<ChainArena[]> {
    return DEFAULT_ARENAS.map((a) => ({
      id: a.id,
      address: `DevArena${a.id}`,
      entryFee: a.entryTokens * 10 ** DECIMALS,
      requiresPass: a.requiresPass,
      maxSessions: a.maxSessions,
      openSessions: 0,
      enabled: true,
      // no real vault: the server's vault-vs-journal guard does not apply
      pot: null,
    }));
  }

  /** A running season 2 and a finalized season 1 with standings (names are made up). */
  async season(): Promise<SeasonView | null> {
    const day = 86_400;
    const now = Math.floor(Date.now() / 1000);
    const token = 10 ** DECIMALS;
    const entries = (names: readonly string[], top: number) =>
      names.map((name, i) => ({
        player: fakeAddress(`season:${name}`),
        name,
        skin: i % 8,
        points: Math.round(top * Math.pow(0.86, i)),
        bestScore: Math.round(top * 2.1 * Math.pow(0.9, i)),
      }));
    return {
      id: 2,
      startedAt: now - 11 * day - 3_600,
      finalized: false,
      prizePool: 84_200 * token + this.swept,
      entries: entries(DEV_SEASON_NAMES, 4_210),
      previous: {
        id: 1,
        prizePool: 61_500 * token,
        endedAt: now - 11 * day - 3_600,
        entries: entries(DEV_SEASON_NAMES.slice(3).concat(DEV_SEASON_NAMES.slice(0, 3)), 5_120),
        claimedMask: 0b101,
      },
    };
  }

  async getPass(asset: string): Promise<ChainPass | null> {
    const m = /^DevPass(\d+)x(.+)$/.exec(asset);
    if (!m || !this.passNumbers(m[2]).includes(Number(m[1]))) return null;
    return { number: Number(m[1]), owner: m[2] };
  }

  async ownedPasses(wallet: string): Promise<OwnedPassInfo[]> {
    return this.passNumbers(wallet).map((number) => ({ asset: `DevPass${number}x${wallet}`, number }));
  }

  passStatus(): PassStatus {
    return {
      collection: 'DevFakeCollection11111111111111111111111111',
      supply: PASS_SUPPLY,
      minted: this.passMode === 'revealed' ? PRE_MINTED : this.minted,
      perWallet: 1,
      // revealed mode keeps the earlier answer (mint open and revealed); mint mode closes the mint at the reveal
      mintOpen: this.passMode === 'revealed' || !this.revealed,
      mintStartTs: 0,
      revealed: this.revealed,
      seed: this.revealed ? PASS_SEED : null,
    };
  }

  /** DEV ONLY: "mints" the next Pass into `wallet` (sealed until `devRevealPasses`). */
  devMintPass(wallet: string): { ok: true; pass: OwnedPassInfo } | { ok: false; error: string } {
    if (this.passMode === 'revealed') return { ok: false, error: 'DEV_FAKE_PASS=revealed: every wallet already has a Pass' };
    if (this.revealed) return { ok: false, error: 'MintClosed' };
    if (this.minted >= PASS_SUPPLY) return { ok: false, error: 'MintClosed' };
    const mine = this.mints.get(wallet) ?? [];
    if (mine.length >= 1) return { ok: false, error: 'MintLimit' };
    const number = ++this.minted;
    this.mints.set(wallet, [...mine, number]);
    this.log(`chain(dev-fake): minted Pass #${number} to ${wallet}`);
    return { ok: true, pass: { asset: `DevPass${number}x${wallet}`, number } };
  }

  /** DEV ONLY: closes the mint and publishes the trait seed (the reveal). */
  devRevealPasses(): PassStatus {
    if (!this.revealed) this.log('chain(dev-fake): Pass collection revealed');
    this.revealed = true;
    return this.passStatus();
  }

  kick(): void {
    if (this.stopped) return;
    for (const item of this.journal.pending) {
      // only tickets this fake chain issued (and loot sweeps of its own journal file): anything else is real money, never touched
      if (item.kind === 'settle' && !this.byAddress.has(item.key)) continue;
      if (item.kind !== 'settle' && item.kind !== 'sweep') continue;
      if (this.scheduled.has(item.key)) continue;
      this.scheduled.add(item.key);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.scheduled.delete(item.key);
        this.settle(item.key);
      }, this.settleMs);
      this.timers.add(timer);
    }
  }

  /** Season pool of the running season, raw units (tests). */
  get seasonPool(): number {
    return 84_200 * 10 ** DECIMALS + this.swept;
  }

  private settle(key: string): void {
    const item = this.journal.pending.find((p) => p.key === key);
    if (!item || this.stopped) return;
    if (item.kind === 'sweep') {
      // sweep_loot: the floor loot of a finished round moves to the season pool
      this.journal.remove(key);
      this.swept += item.amount;
      this.log(`chain(dev-fake): swept ${item.amount} loot of ${item.roomId} round ${item.round} into the season pool`);
      return;
    }
    const session = this.byAddress.get(key);
    if (!session) return;
    const payout = item.payout ?? 0;
    const profit = Math.max(0, payout - session.entryFee);
    const fee = Math.floor((profit * (session.hasPass ? PASS_FEE_BPS : FEE_BPS)) / 10_000);
    this.journal.remove(key);
    this.sessions.delete(`${session.arenaId}:${session.player}`);
    this.byAddress.delete(key);
    const signature = bs58.encode(randomBytes(64));
    this.log(`chain(dev-fake): settled ${key} payout=${payout} fee=${fee}`);
    for (const fn of this.listeners) fn({ key, player: item.player, arenaId: session.arenaId, signature, payout, fee });
  }

  setLiveSessionProvider(): void {}

  onSettled(fn: (e: SettledEvent) => void): void {
    this.listeners.push(fn);
  }

  async start(): Promise<void> {
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

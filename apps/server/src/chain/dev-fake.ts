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
const DEV_SEASON_NAMES = ['kuruşavcısı', 'Nakamoto', 'Defne', 'balina_koyu', 'mürekkep', 'riso', 'gece pazarı', 'Ayşe', 'tokyo_drift', 'hardal', 'Mert', 'kâğıtkesik'] as const;
/** A stable, address-shaped id for a made-up player. */
const fakeAddress = (label: string) => bs58.encode(createHash('sha256').update(label).digest());

/** Deterministic Pass number for a wallet (1..supply). */
const passNumberOf = (wallet: string) => (createHash('sha256').update(wallet).digest().readUInt32LE(0) % PASS_SUPPLY) + 1;

/**
 * DEV ONLY (`DEV_FAKE_CHAIN=1` with `NODE_ENV=development`, see `assertDevFakeChainAllowed`). An in-memory chain so
 * the arena flow (ticket → play → death / cash-out → settlement) can be driven
 * locally without a validator:
 *  - every signed-in wallet has an open ticket in every default arena; tickets of
 *    Pass arenas are bought "with" the wallet's fake Pass;
 *  - every wallet owns one revealed Pass (number derived from the wallet);
 *  - settlements are simulated `settleMs` after the journal item appears: the
 *    item is removed, the ticket closes and a `settled` event with the fee fires.
 *    Only items for tickets this instance issued are ever touched; it also runs
 *    on its own journal file (`journal.dev-fake.json`).
 */
export class DevFakeChain implements ChainGateway {
  readonly enabled = true;
  readonly stakeEnabled = true;
  private readonly sessions = new Map<string, ChainSession>();
  private readonly byAddress = new Map<string, ChainSession>();
  private readonly listeners: ((e: SettledEvent) => void)[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly scheduled = new Set<string>();
  private nextId = 1;
  private stopped = false;

  constructor(
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly settleMs = 2600,
  ) {}

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
        passAsset: hasPass ? `DevPass${passNumberOf(player)}x${player}` : null,
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
      prizePool: 84_200 * token,
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
    return m ? { number: Number(m[1]), owner: m[2] } : null;
  }

  async ownedPasses(wallet: string): Promise<OwnedPassInfo[]> {
    const number = passNumberOf(wallet);
    return [{ asset: `DevPass${number}x${wallet}`, number }];
  }

  passStatus(): PassStatus {
    return {
      collection: 'DevFakeCollection11111111111111111111111111',
      supply: PASS_SUPPLY,
      minted: 412,
      perWallet: 1,
      mintOpen: true,
      mintStartTs: 0,
      revealed: true,
      seed: PASS_SEED,
    };
  }

  kick(): void {
    if (this.stopped) return;
    for (const item of this.journal.pending) {
      // only tickets this fake chain issued: anything else in the journal is real money, never touched
      if (!this.byAddress.has(item.key) || this.scheduled.has(item.key)) continue;
      this.scheduled.add(item.key);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.scheduled.delete(item.key);
        this.settle(item.key);
      }, this.settleMs);
      this.timers.add(timer);
    }
  }

  private settle(key: string): void {
    const session = this.byAddress.get(key);
    const item = this.journal.pending.find((p) => p.key === key);
    if (!session || !item || this.stopped) return;
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

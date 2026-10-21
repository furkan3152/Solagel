import { randomBytes } from 'node:crypto';
import { DEFAULT_ARENAS, TOKEN_SYMBOL_DEFAULT, type ChainStatus } from '@slana/shared';
import bs58 from 'bs58';
import type { Journal } from '../stake/journal';
import type { ChainArena, ChainGateway, ChainProfile, ChainSession, SettledEvent } from './types';

/** Token decimals of the fake mint (pump.fun style). */
const DECIMALS = 6;
/** Fee on profit, basis points (the program default: 5 %). */
const FEE_BPS = 500;
const FAKE_MINT = 'DevFakeMint11111111111111111111111111111111';

/** Dev-only actions the HTTP server exposes under `/api/dev/` when the fake chain runs. */
export interface DevFakeChainActions {
  /** Sets the fake game token (like `pnpm admin set-token`); false when it was already set. */
  devSetToken(): boolean;
}

/**
 * DEV ONLY (`DEV_FAKE_CHAIN=1` with `NODE_ENV=development`, see `assertDevFakeChainAllowed`). An in-memory chain so
 * the arena flow (ticket → play → death / round-end payout → settlement) can be driven
 * locally without a validator:
 *  - the game token starts unset (practice only, arenas "opening soon") unless `tokenSet`
 *    (`DEV_FAKE_TOKEN=1`); `devSetToken` (the dev route `POST /api/dev/token`) sets it, which
 *    shows the default arenas and fires `onStatusChange`, like `set-token` on a real chain;
 *  - once set, every signed-in wallet has an open ticket in every default arena;
 *  - settlements are simulated `settleMs` after the journal item appears: the
 *    item is removed, the ticket closes and a `settled` event with the fee fires.
 *    Loot sweeps are "burned" (counted in `burned`).
 *    Only items for tickets this instance issued are ever touched; it also runs
 *    on its own journal file (`journal.dev-fake.json`).
 */
export class DevFakeChain implements ChainGateway, DevFakeChainActions {
  readonly enabled = true;
  private readonly sessions = new Map<string, ChainSession>();
  private readonly byAddress = new Map<string, ChainSession>();
  private readonly listeners: ((e: SettledEvent) => void)[] = [];
  private readonly statusListeners: (() => void)[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly scheduled = new Set<string>();
  private nextId = 1;
  private stopped = false;
  private tokenSet: boolean;
  /** Raw token units of floor loot burned at round ends. */
  burned = 0;

  constructor(
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly settleMs = 2600,
    opts: { tokenSet?: boolean } = {},
  ) {
    this.tokenSet = opts.tokenSet ?? false;
  }

  get tokenReady(): boolean {
    return this.tokenSet;
  }

  get stakeEnabled(): boolean {
    return this.tokenSet;
  }

  status(): ChainStatus {
    return {
      enabled: true,
      cluster: 'devnet',
      programId: 'DevFakeChain1111111111111111111111111111111',
      rpcUrl: null,
      arenasEnabled: this.tokenSet,
      tokenReady: this.tokenSet,
      token: this.tokenSet ? { mint: FAKE_MINT, symbol: TOKEN_SYMBOL_DEFAULT, decimals: DECIMALS } : null,
      feeBps: FEE_BPS,
    };
  }

  /** DEV ONLY: sets the fake game token; arenas appear and status listeners fire. */
  devSetToken(): boolean {
    if (this.tokenSet) return false;
    this.tokenSet = true;
    this.log(`chain(dev-fake): game token set (${FAKE_MINT}) — arenas open`);
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch (err) {
        this.log(`chain(dev-fake): status listener failed: ${(err as Error).stack ?? err}`);
      }
    }
    return true;
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
      s = {
        address: `DevSession${id}x${player.slice(0, 8)}`,
        id,
        player,
        arenaId,
        entryFee: arena.entryFee,
        openedAt: Math.floor(Date.now() / 1000),
        finalized: false,
        owed: 0,
      };
      this.sessions.set(key, s);
      this.byAddress.set(s.address, s);
    }
    return s;
  }

  /** The default arenas once the token is set (none before: `create_arena` needs the mint). */
  async listArenas(): Promise<ChainArena[]> {
    if (!this.tokenSet) return [];
    return DEFAULT_ARENAS.map((a) => ({
      id: a.id,
      address: `DevArena${a.id}`,
      entryFee: a.entryTokens * 10 ** DECIMALS,
      maxSessions: a.maxSessions,
      openSessions: 0,
      enabled: true,
      // no real vault: the server's vault-vs-journal guard does not apply
      pot: null,
    }));
  }

  kick(): void {
    if (this.stopped) return;
    for (const item of this.journal.pending) {
      // only tickets this fake chain issued (and loot sweeps of its own journal file): anything else is real money, never touched
      if (item.kind === 'settle' && !this.byAddress.has(item.key)) continue;
      if (item.kind !== 'settle' && item.kind !== 'sweep') continue;
      // integrity holds wait for an admin decision
      if (item.kind === 'settle' && item.held) continue;
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

  private settle(key: string): void {
    const item = this.journal.pending.find((p) => p.key === key);
    if (!item || this.stopped || (item.kind === 'settle' && item.held)) return;
    if (item.kind === 'sweep') {
      // sweep_loot: the floor loot of a finished round is burned from the arena vault
      this.journal.remove(key);
      this.burned += item.amount;
      this.log(`chain(dev-fake): burned ${item.amount} loot of ${item.roomId} round ${item.round}`);
      return;
    }
    const session = this.byAddress.get(key);
    if (!session) return;
    const payout = item.payout ?? 0;
    const profit = Math.max(0, payout - session.entryFee);
    const fee = Math.floor((profit * FEE_BPS) / 10_000);
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

  onStatusChange(fn: () => void): void {
    this.statusListeners.push(fn);
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

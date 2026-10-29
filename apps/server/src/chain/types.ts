import type { ChainStatus } from '@elymum/shared';

export interface ChainProfile {
  owner: string;
  name: string;
  skin: number;
  xp: number;
  level: number;
  premiumSkins: number;
  gamesPlayed: number;
  bestScore: number;
}

export interface ChainSession {
  address: string;
  /** On-chain `Session::id` (must be echoed in settle_session). */
  id: number;
  player: string;
  arenaId: number;
  /** Ticket price, raw token units. */
  entryFee: number;
  /** Unix seconds. */
  openedAt: number;
  /**
   * R24: already settled without the player's token account; the result is final and
   * `owed` waits for the player to collect it. Never playable, never refunded as stale.
   */
  finalized: boolean;
  /** Raw token units the player can collect (finalized sessions; 0 otherwise). */
  owed: number;
}

export interface ChainArena {
  id: number;
  address: string;
  /** Ticket price, raw token units. */
  entryFee: number;
  /** On-chain cap on open sessions. */
  maxSessions: number;
  openSessions: number;
  enabled: boolean;
  /**
   * Raw token units held by the arena vault; null when the gateway has no real vault
   * (dev-fake), which skips the vault-vs-journal guard.
   */
  pot: number | null;
}

export interface SettledEvent {
  /** Journal key (session PDA). */
  key: string;
  player: string;
  /** Arena of the settled session (absent on journal items written before it existed). */
  arenaId?: number;
  signature: string;
  /** Raw token units paid out of the vault (before the fee). */
  payout: number;
  /** Fee on profit, raw token units (absent when unknown, e.g. a late confirmation). */
  fee?: number;
  /** R24: settled without a usable token account; the player collects the net payout. */
  collect?: boolean;
}

/** Everything the rooms need from Solana. `NullChain` is used when disabled. */
export interface ChainGateway {
  readonly enabled: boolean;
  /**
   * The game token is set on chain (`isTokenSet(config)`). False while the program is
   * initialized without a mint: practice only, arena joins answer `token_not_set`.
   */
  readonly tokenReady: boolean;
  /** Arena tickets can be played (chain on, token set and usable, server authorized). */
  readonly stakeEnabled: boolean;
  status(): ChainStatus;
  getProfile(owner: string, fresh?: boolean): Promise<ChainProfile | null>;
  getSession(arenaId: number, player: string): Promise<ChainSession | null>;
  /** On-chain arenas; cached briefly unless `fresh` (a re-read that bypasses the cache). */
  listArenas(fresh?: boolean): Promise<ChainArena[]>;
  /** Wake the settlement worker (new journal items). */
  kick(): void;
  /** Ids of sessions currently owned by a room (live); never refunded as stale. */
  setLiveSessionProvider(fn: () => Set<string>): void;
  onSettled(fn: (e: SettledEvent) => void): void;
  /**
   * `status()` changed in a way clients must see without reconnecting (the token was set, so
   * `tokenReady` turned true and arenas can attach). Listeners re-read `status()`.
   */
  onStatusChange(fn: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class NullChain implements ChainGateway {
  readonly enabled = false;
  readonly tokenReady = false;
  readonly stakeEnabled = false;
  constructor(private readonly cluster = 'disabled') {}
  status(): ChainStatus {
    return {
      enabled: false,
      cluster: this.cluster,
      programId: null,
      rpcUrl: null,
      arenasEnabled: false,
      tokenReady: false,
      token: null,
      feeBps: null,
    };
  }
  async getProfile(): Promise<ChainProfile | null> {
    return null;
  }
  async getSession(): Promise<ChainSession | null> {
    return null;
  }
  async listArenas(): Promise<ChainArena[]> {
    return [];
  }
  kick(): void {}
  setLiveSessionProvider(): void {}
  onSettled(): void {}
  onStatusChange(): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

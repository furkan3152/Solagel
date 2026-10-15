import type { ChainStatus, PassStatus } from '@slana/shared';

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
  /** The ticket was bought with a Slana Pass (Pass power, lower fee). */
  hasPass: boolean;
  /** The Pass asset locked by this session, null without a Pass. */
  passAsset: string | null;
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
  /** A Slana Pass is needed to buy a ticket. */
  requiresPass: boolean;
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

/** A verified Slana Pass (Core asset of our collection). */
export interface ChainPass {
  owner: string;
  number: number;
}

/** A Slana Pass owned by a wallet. */
export interface OwnedPassInfo {
  asset: string;
  number: number;
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

export interface SeasonEntry {
  player: string;
  name: string;
  skin: number;
  points: number;
  bestScore: number;
}

export interface SeasonView {
  id: number;
  startedAt: number;
  finalized: boolean;
  prizePool: number;
  entries: SeasonEntry[];
  /** Previous finalized season (for claims), if any. */
  previous: { id: number; prizePool: number; endedAt: number; entries: SeasonEntry[]; claimedMask: number } | null;
}

/** Everything the rooms need from Solana. `NullChain` is used when disabled. */
export interface ChainGateway {
  readonly enabled: boolean;
  readonly stakeEnabled: boolean;
  status(): ChainStatus;
  getProfile(owner: string, fresh?: boolean): Promise<ChainProfile | null>;
  getSession(arenaId: number, player: string): Promise<ChainSession | null>;
  /** On-chain arenas; cached briefly unless `fresh` (a re-read that bypasses the cache). */
  listArenas(fresh?: boolean): Promise<ChainArena[]>;
  season(): Promise<SeasonView | null>;
  /** Core asset `asset` when it is a Pass of our collection (cached 60 s); null otherwise. */
  getPass(asset: string): Promise<ChainPass | null>;
  /** Passes of our collection owned by `wallet` (cached 30 s). */
  ownedPasses(wallet: string): Promise<OwnedPassInfo[]>;
  /** Collection / mint / reveal state, null while the collection is not set. */
  passStatus(): PassStatus | null;
  /** Wake the settlement worker (new journal items). */
  kick(): void;
  /** Ids of sessions currently owned by a room (live); never refunded as stale. */
  setLiveSessionProvider(fn: () => Set<string>): void;
  onSettled(fn: (e: SettledEvent) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class NullChain implements ChainGateway {
  readonly enabled = false;
  readonly stakeEnabled = false;
  constructor(private readonly cluster = 'disabled') {}
  status(): ChainStatus {
    return {
      enabled: false,
      cluster: this.cluster,
      programId: null,
      rpcUrl: null,
      arenasEnabled: false,
      currentSeason: null,
      token: null,
      pass: null,
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
  async season(): Promise<SeasonView | null> {
    return null;
  }
  async getPass(_asset: string): Promise<ChainPass | null> {
    return null;
  }
  async ownedPasses(_wallet: string): Promise<OwnedPassInfo[]> {
    return [];
  }
  passStatus(): PassStatus | null {
    return null;
  }
  kick(): void {}
  setLiveSessionProvider(): void {}
  onSettled(): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

import type { ChainStatus } from '@solagel/shared';

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
  player: string;
  arenaId: number;
  buyIn: number;
  /** Unix seconds. */
  openedAt: number;
}

export interface ChainArena {
  id: number;
  address: string;
  buyIn: number;
  maxPlayers: number;
  enabled: boolean;
  openSessions: number;
  /** Lamports above rent held by the arena vault. */
  pot: number;
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
  listArenas(): Promise<ChainArena[]>;
  season(): Promise<SeasonView | null>;
  /** Wake the settlement worker (new journal items). */
  kick(): void;
  /** Ids of sessions currently owned by a room (live); never refunded as stale. */
  setLiveSessionProvider(fn: () => Set<string>): void;
  onSettled(fn: (e: { key: string; player: string; signature: string; kind: 'settle' | 'record'; payout?: number }) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class NullChain implements ChainGateway {
  readonly enabled = false;
  readonly stakeEnabled = false;
  constructor(private readonly cluster = 'disabled') {}
  status(): ChainStatus {
    return { enabled: false, cluster: this.cluster, programId: null, rpcUrl: null, stakeEnabled: false, currentSeason: null };
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
  kick(): void {}
  setLiveSessionProvider(): void {}
  onSettled(): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

import type { ChainStatus, RoomInfo } from './protocol';

export type NftChain = 'unconfigured' | 'solana' | 'ethereum' | 'base' | 'polygon';
export type NftStandard = 'unconfigured' | 'metaplex' | 'erc721' | 'erc1155';
export interface TokenSettings {
  status: 'planned' | 'configured' | 'launched';
  mintAddress: string | null;
  symbol: string;
  decimals: number | null;
  launchUrl: string | null;
}
export interface NftSettings {
  status: 'planned' | 'configured';
  chain: NftChain;
  standard: NftStandard;
  collectionAddress: string | null;
  openSeaUrl: string | null;
  skinMappings: { skinId: number; assetId: string }[];
}
export interface AdminSettings {
  admissionsPaused: boolean;
  bots: { target: number; min: number; max: number; privateTarget: number };
  token: TokenSettings;
  nft: NftSettings;
}
export interface AdminAuditEntry {
  at: number;
  wallet: string;
  action: string;
  revision: number;
  summary: string;
}
export interface AdminSnapshot {
  revision: number;
  updatedAt: number;
  settings: AdminSettings;
  audit: AdminAuditEntry[];
}
export interface TokenMintInspection {
  mintAddress: string;
  cluster: string;
  tokenProgram: 'spl-token' | 'token-2022';
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: number[];
  warnings: string[];
  gameplaySupported: false;
}
export interface AdminStatus extends AdminSnapshot {
  authority: { wallet: string; offchainAdmin: boolean; onChainAdmin: boolean };
  online: number;
  rooms: RoomInfo[];
  chain: ChainStatus;
  config: { admin: string; serverAuthority: string; treasury: string; feeBps: number; seasonShareBps: number; currentSeason: number; paused: boolean } | null;
  journal: {
    healthy: boolean;
    live: { roomId: string; session: string; sessionId: number; player: string; arenaId: number; value: number }[];
    pending: { key: string; kind: 'settle' | 'record'; player: string; arenaId?: number; sessionId?: number; payout?: number; attempts: number; lastError?: string; nextAttemptAt: number }[];
    receipts: { player: string; arenaId: number; sessionId: number; signature: string; payout: number; settledAt: number }[];
  };
  capabilities: { tokenGameplay: false; nftOwnership: false };
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  admissionsPaused: false,
  bots: { target: 18, min: 3, max: 18, privateTarget: 8 },
  token: { status: 'planned', mintAddress: null, symbol: '', decimals: null, launchUrl: null },
  nft: { status: 'planned', chain: 'unconfigured', standard: 'unconfigured', collectionAddress: null, openSeaUrl: null, skinMappings: [] },
};

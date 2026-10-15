import type { IdlAccounts } from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import type { Slana } from './idl/slana';
import { levelFromXp, toBigInt, toNumber } from './math';
import { toBase58, type Address } from './program';

/** Raw decoded accounts as returned by the Anchor coder (BN for u64/i64, number[] for byte arrays). */
export type RawConfig = IdlAccounts<Slana>['config'];
export type RawProfile = IdlAccounts<Slana>['playerProfile'];
export type RawArena = IdlAccounts<Slana>['arena'];
export type RawSession = IdlAccounts<Slana>['session'];
export type RawSeason = IdlAccounts<Slana>['season'];
export type RawPassLock = IdlAccounts<Slana>['passLock'];
export type RawMintCounter = IdlAccounts<Slana>['mintCounter'];
export type RawLeaderEntry = RawSeason['entries'][number];

/** Account names in the (camelCased) IDL, as used by `program.coder.accounts`. */
export const ACCOUNT_NAMES = {
  config: 'config',
  profile: 'playerProfile',
  arena: 'arena',
  session: 'session',
  season: 'season',
  passLock: 'passLock',
  mintCounter: 'mintCounter',
} as const;

/** Raw token amounts are `bigint` base units; lamports and counters are numbers. */
export interface ConfigView {
  admin: string;
  serverAuthority: string;
  tokenMint: string;
  tokenProgram: string;
  tokenDecimals: number;
  feeBps: number;
  /** Fee on profit of a Pass session (≤ `feeBps`). */
  passFeeBps: number;
  /** Fee split (sums to 10 000). */
  treasuryBps: number;
  seasonBps: number;
  burnBps: number;
  /** Lamports a player deposits per session for the server's settle transaction. */
  settleFeeLamports: number;
  currentSeason: number;
  paused: boolean;
  /** Core collection of the Pass, null until `set_pass_collection`. */
  passCollection: string | null;
  passBaseUri: string;
  passSupply: number;
  passMinted: number;
  passPerWallet: number;
  /** Minimum token balance to mint (0 = none). */
  passMinTokens: bigint;
  passMintOpen: boolean;
  /** Unix seconds. */
  passMintStartTs: number;
  /** The mint has been opened at least once: `passSupply` is frozen. */
  passMintOpened: boolean;
  /** The mint ended for good (closed or sold out) and `passEntropy` is captured; it never reopens. */
  passMintEnded: boolean;
  /** Hex sha256 of the seed, null while unset. */
  passSeedHash: string | null;
  /** The admin's committed seed (hex), null until revealed. Traits do NOT derive from it: use `passFinalSeed`. */
  passSeed: string | null;
  passRevealed: boolean;
  /** Hex SlotHashes entry captured when the mint ended, null before. */
  passEntropy: string | null;
  /** Slot of `passEntropy` (0 before the mint ended). */
  passEntropySlot: number;
  /**
   * The revealed seed every Pass trait derives from: `sha256(passSeed || passEntropy)` (hex),
   * null until revealed. `passTraits(passFinalSeed, n, passSupply)`.
   */
  passFinalSeed: string | null;
  totals: { players: number; games: number; sessions: number; staked: bigint; paidOut: bigint };
}

export interface ProfileView {
  /** Profile PDA. */
  address: string;
  owner: string;
  name: string;
  skin: number;
  xp: number;
  level: number;
  gamesPlayed: number;
  kills: number;
  bestScore: number;
  totalScore: number;
  /** Season that `seasonPoints` belongs to. */
  season: number;
  seasonPoints: number;
  stakeGames: number;
  /** Token base units. */
  totalStaked: bigint;
  /** Token base units. */
  totalWon: bigint;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds (0 = never played). */
  lastPlayed: number;
}

export interface ArenaView {
  id: number;
  /** Arena PDA. */
  address: string;
  /** Token base units. */
  entryFee: bigint;
  requiresPass: boolean;
  maxSessions: number;
  openSessions: number;
  enabled: boolean;
  /** Token vault `["vault", arena]`. */
  vault: string;
  /** Tokens held by the vault (base units). */
  pot: bigint;
}

export interface SessionView {
  /** Session PDA. */
  address: string;
  /** Unique, increasing session id (`settle_session` must echo it). */
  id: number;
  player: string;
  /** Arena PDA. */
  arena: string;
  arenaId: number;
  /** Token base units. */
  entryFee: bigint;
  /** Unix seconds. */
  openedAt: number;
  hasPass: boolean;
  /** Locked Pass asset, null without a Pass. */
  passAsset: string | null;
  /** Settle deposit in lamports. */
  settleFee: number;
  /** Fee on profit in basis points, fixed at join (settlement uses it, not the config). */
  feeBps: number;
}

export interface LeaderEntryView {
  player: string;
  name: string;
  points: number;
  bestScore: number;
  skin: number;
}

export interface SeasonView {
  /** Season PDA. */
  address: string;
  id: number;
  /** Unix seconds. */
  startedAt: number;
  /** Unix seconds (0 while running). */
  endedAt: number;
  finalized: boolean;
  /** This season's tokens in the season vault, not paid out yet (base units). */
  pool: bigint;
  /** Prize pool frozen by `end_season` (0 while running). */
  prizePool: bigint;
  /** Bit `rank` set ⇔ that rank's prize was claimed. */
  claimedMask: number;
  /** Leaderboard, sorted by points (only the used `count` entries). */
  entries: LeaderEntryView[];
}

const utf8 = new TextDecoder('utf-8');

/** Decodes a fixed-size UTF-8 name buffer, keeping only `name[..len]`. */
export function decodeName(bytes: ArrayLike<number>, len: number): string {
  const n = Math.max(0, Math.min(len, bytes.length));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bytes[i];
  return utf8.decode(out);
}

const pk = (k: PublicKey): string => k.toBase58();
const pkOrNull = (k: PublicKey): string | null => (k.equals(PublicKey.default) ? null : k.toBase58());

/** Lowercase hex of a byte array, null when all zero. */
export function hexOrNull(bytes: ArrayLike<number>): string | null {
  let hex = '';
  let any = false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) any = true;
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return any ? hex : null;
}

export function toConfigView(raw: RawConfig): ConfigView {
  return {
    admin: pk(raw.admin),
    serverAuthority: pk(raw.serverAuthority),
    tokenMint: pk(raw.tokenMint),
    tokenProgram: pk(raw.tokenProgram),
    tokenDecimals: raw.tokenDecimals,
    feeBps: raw.feeBps,
    passFeeBps: raw.passFeeBps,
    treasuryBps: raw.treasuryBps,
    seasonBps: raw.seasonBps,
    burnBps: raw.burnBps,
    settleFeeLamports: toNumber(raw.settleFeeLamports),
    currentSeason: raw.currentSeason,
    paused: raw.paused,
    passCollection: pkOrNull(raw.passCollection),
    passBaseUri: decodeName(raw.passBaseUri, raw.passBaseUriLen),
    passSupply: raw.passSupply,
    passMinted: raw.passMinted,
    passPerWallet: raw.passPerWallet,
    passMinTokens: toBigInt(raw.passMinTokens),
    passMintOpen: raw.passMintOpen,
    passMintStartTs: toNumber(raw.passMintStartTs),
    passMintOpened: raw.passMintOpened,
    passMintEnded: raw.passMintEnded,
    passSeedHash: hexOrNull(raw.passSeedHash),
    passSeed: raw.passRevealed ? (hexOrNull(raw.passSeed) ?? '00'.repeat(32)) : null,
    passRevealed: raw.passRevealed,
    passEntropy: raw.passMintEnded ? (hexOrNull(raw.passEntropy) ?? '00'.repeat(32)) : null,
    passEntropySlot: toNumber(raw.passEntropySlot),
    passFinalSeed: raw.passRevealed ? (hexOrNull(raw.passFinalSeed) ?? '00'.repeat(32)) : null,
    totals: {
      players: toNumber(raw.totalPlayers),
      games: toNumber(raw.totalGames),
      sessions: toNumber(raw.totalSessions),
      staked: toBigInt(raw.totalStaked),
      paidOut: toBigInt(raw.totalPaidOut),
    },
  };
}

export function toProfileView(address: Address, raw: RawProfile): ProfileView {
  const xp = toNumber(raw.xp);
  return {
    address: toBase58(address),
    owner: pk(raw.owner),
    name: decodeName(raw.name, raw.nameLen),
    skin: raw.skin,
    xp,
    level: levelFromXp(raw.xp),
    gamesPlayed: raw.gamesPlayed,
    kills: raw.kills,
    bestScore: raw.bestScore,
    totalScore: toNumber(raw.totalScore),
    season: raw.season,
    seasonPoints: toNumber(raw.seasonPoints),
    stakeGames: raw.stakeGames,
    totalStaked: toBigInt(raw.totalStaked),
    totalWon: toBigInt(raw.totalWon),
    createdAt: toNumber(raw.createdAt),
    lastPlayed: toNumber(raw.lastPlayed),
  };
}

/** `vaultAmount` is the token balance of the arena's vault (read separately). */
export function toArenaView(address: Address, raw: RawArena, vaultAmount: bigint): ArenaView {
  return {
    id: raw.id,
    address: toBase58(address),
    entryFee: toBigInt(raw.entryFee),
    requiresPass: raw.requiresPass,
    maxSessions: raw.maxSessions,
    openSessions: raw.openSessions,
    enabled: raw.enabled,
    vault: pk(raw.vault),
    pot: vaultAmount,
  };
}

export function toSessionView(address: Address, raw: RawSession): SessionView {
  return {
    address: toBase58(address),
    id: toNumber(raw.id),
    player: pk(raw.player),
    arena: pk(raw.arena),
    arenaId: raw.arenaId,
    entryFee: toBigInt(raw.entryFee),
    openedAt: toNumber(raw.openedAt),
    hasPass: raw.hasPass,
    passAsset: raw.hasPass ? pkOrNull(raw.passAsset) : null,
    settleFee: toNumber(raw.settleFee),
    feeBps: raw.feeBps,
  };
}

export function toLeaderEntryView(raw: RawLeaderEntry): LeaderEntryView {
  return {
    player: pk(raw.player),
    name: decodeName(raw.name, raw.nameLen),
    points: toNumber(raw.points),
    bestScore: raw.bestScore,
    skin: raw.skin,
  };
}

export function toSeasonView(address: Address, raw: RawSeason): SeasonView {
  const count = Math.max(0, Math.min(raw.count, raw.entries.length));
  return {
    address: toBase58(address),
    id: raw.id,
    startedAt: toNumber(raw.startedAt),
    endedAt: toNumber(raw.endedAt),
    finalized: raw.finalized,
    pool: toBigInt(raw.pool),
    prizePool: toBigInt(raw.prizePool),
    claimedMask: raw.claimedMask,
    entries: raw.entries.slice(0, count).map(toLeaderEntryView),
  };
}

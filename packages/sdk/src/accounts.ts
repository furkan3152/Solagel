import type { IdlAccounts } from '@anchor-lang/core';
import type { PublicKey } from '@solana/web3.js';
import type { Solagel } from './idl/solagel';
import { levelFromXp, toNumber } from './math';
import { toBase58, type Address } from './program';

/** Raw decoded accounts as returned by the Anchor coder (BN for u64/i64, number[] for byte arrays). */
export type RawConfig = IdlAccounts<Solagel>['config'];
export type RawProfile = IdlAccounts<Solagel>['playerProfile'];
export type RawArena = IdlAccounts<Solagel>['arena'];
export type RawSession = IdlAccounts<Solagel>['session'];
export type RawSeason = IdlAccounts<Solagel>['season'];
export type RawLeaderEntry = RawSeason['entries'][number];

/** Account names in the (camelCased) IDL, as used by `program.coder.accounts`. */
export const ACCOUNT_NAMES = {
  config: 'config',
  profile: 'playerProfile',
  arena: 'arena',
  session: 'session',
  season: 'season',
} as const;

export interface ConfigView {
  admin: string;
  serverAuthority: string;
  treasury: string;
  feeBps: number;
  seasonShareBps: number;
  /** Lamports. */
  skinPrice: number;
  currentSeason: number;
  paused: boolean;
  totalPlayers: number;
  totalGames: number;
  totalSessions: number;
  /** Lamports. */
  totalStaked: number;
  /** Lamports. */
  totalPaidOut: number;
}

export interface ProfileView {
  /** Profile PDA. */
  address: string;
  owner: string;
  name: string;
  skin: number;
  /** Bit `i` set ⇔ premium skin `16 + i` owned. */
  premiumSkins: number;
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
  /** Lamports. */
  totalStaked: number;
  /** Lamports. */
  totalWon: number;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds (0 = never played). */
  lastPlayed: number;
}

export interface ArenaView {
  /** Arena PDA (also the vault). */
  address: string;
  id: number;
  /** Lamports. */
  buyIn: number;
  maxPlayers: number;
  enabled: boolean;
  openSessions: number;
  /** Lamports. */
  totalDeposited: number;
  /** Lamports. */
  totalPaidOut: number;
  /** Lamports held above the rent-exempt minimum. */
  pot: number;
}

export interface SessionView {
  /** Session PDA. */
  address: string;
  player: string;
  /** Arena PDA. */
  arena: string;
  arenaId: number;
  /** Lamports. */
  buyIn: number;
  /** Unix seconds. */
  openedAt: number;
  /** Unique, increasing session id (`settle_session` must echo it). */
  id: number;
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
  /** Prize pool frozen by `end_season` (0 while running). Lamports. */
  prizePool: number;
  /** Bit `rank` set ⇔ that rank's prize was claimed. */
  claimedMask: number;
  /** Lamports currently held above rent (the live pool while running; unclaimed prizes after). */
  pool: number;
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

export function toConfigView(raw: RawConfig): ConfigView {
  return {
    admin: pk(raw.admin),
    serverAuthority: pk(raw.serverAuthority),
    treasury: pk(raw.treasury),
    feeBps: raw.feeBps,
    seasonShareBps: raw.seasonShareBps,
    skinPrice: toNumber(raw.skinPrice),
    currentSeason: raw.currentSeason,
    paused: raw.paused,
    totalPlayers: toNumber(raw.totalPlayers),
    totalGames: toNumber(raw.totalGames),
    totalSessions: toNumber(raw.totalSessions),
    totalStaked: toNumber(raw.totalStaked),
    totalPaidOut: toNumber(raw.totalPaidOut),
  };
}

export function toProfileView(address: Address, raw: RawProfile): ProfileView {
  const xp = toNumber(raw.xp);
  return {
    address: toBase58(address),
    owner: pk(raw.owner),
    name: decodeName(raw.name, raw.nameLen),
    skin: raw.skin,
    premiumSkins: raw.premiumSkins,
    xp,
    level: levelFromXp(raw.xp),
    gamesPlayed: raw.gamesPlayed,
    kills: raw.kills,
    bestScore: raw.bestScore,
    totalScore: toNumber(raw.totalScore),
    season: raw.season,
    seasonPoints: toNumber(raw.seasonPoints),
    stakeGames: raw.stakeGames,
    totalStaked: toNumber(raw.totalStaked),
    totalWon: toNumber(raw.totalWon),
    createdAt: toNumber(raw.createdAt),
    lastPlayed: toNumber(raw.lastPlayed),
  };
}

/** `lamports`/`rentExemptMinimum` come from the account info (the pot is everything above rent). */
export function toArenaView(address: Address, raw: RawArena, lamports: number, rentExemptMinimum: number): ArenaView {
  return {
    address: toBase58(address),
    id: raw.id,
    buyIn: toNumber(raw.buyIn),
    maxPlayers: raw.maxPlayers,
    enabled: raw.enabled,
    openSessions: raw.openSessions,
    totalDeposited: toNumber(raw.totalDeposited),
    totalPaidOut: toNumber(raw.totalPaidOut),
    pot: Math.max(0, lamports - rentExemptMinimum),
  };
}

export function toSessionView(address: Address, raw: RawSession): SessionView {
  return {
    address: toBase58(address),
    player: pk(raw.player),
    arena: pk(raw.arena),
    arenaId: raw.arenaId,
    buyIn: toNumber(raw.buyIn),
    openedAt: toNumber(raw.openedAt),
    id: toNumber(raw.id),
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

export function toSeasonView(address: Address, raw: RawSeason, lamports: number, rentExemptMinimum: number): SeasonView {
  const count = Math.max(0, Math.min(raw.count, raw.entries.length));
  return {
    address: toBase58(address),
    id: raw.id,
    startedAt: toNumber(raw.startedAt),
    endedAt: toNumber(raw.endedAt),
    finalized: raw.finalized,
    prizePool: toNumber(raw.prizePool),
    claimedMask: raw.claimedMask,
    pool: Math.max(0, lamports - rentExemptMinimum),
    entries: raw.entries.slice(0, count).map(toLeaderEntryView),
  };
}

/** Whether premium skin `skin` (16..23) is owned according to `premiumSkins`. */
export const ownsPremiumSkin = (premiumSkins: number, skin: number): boolean =>
  skin >= 16 && skin < 24 && ((premiumSkins >>> (skin - 16)) & 1) === 1;

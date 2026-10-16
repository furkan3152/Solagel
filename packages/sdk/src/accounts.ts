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

/** Account names in the (camelCased) IDL, as used by `program.coder.accounts`. */
export const ACCOUNT_NAMES = {
  config: 'config',
  profile: 'playerProfile',
  arena: 'arena',
  session: 'session',
} as const;

/** Raw token amounts are `bigint` base units; lamports and counters are numbers. */
export interface ConfigView {
  admin: string;
  serverAuthority: string;
  /** Wallet that receives the whole fee on profit (and swept arena vaults) in its token account. */
  feeWallet: string;
  /** Game token mint; null until the admin runs `set_token_mint` (once). */
  tokenMint: string | null;
  /** SPL Token or Token-2022 program of the mint; null while the mint is unset. */
  tokenProgram: string | null;
  /** Mint decimals (0 while the mint is unset). */
  tokenDecimals: number;
  /** Fee on profit in basis points for new sessions (each session keeps the rate it joined with). */
  feeBps: number;
  /** Lamports a player deposits per session for the server's settle transaction. */
  settleFeeLamports: number;
  paused: boolean;
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
  /** Settle deposit in lamports. */
  settleFee: number;
  /** Fee on profit in basis points, fixed at join (settlement uses it, not the config). */
  feeBps: number;
  /**
   * Settled without a player token account (ruling R24): the game result is final; `owed`
   * waits in the arena vault until the player collects it with `refund_session` (no waiting time).
   */
  finalized: boolean;
  /** Token base units the player can collect from a finalized session (0 otherwise). */
  owed: bigint;
}

/** The game token as stored in the config, once set. */
export interface GameToken {
  tokenMint: string;
  tokenProgram: string;
  tokenDecimals: number;
}

/** Thrown by `requireToken` while `Config.tokenMint` is unset. */
export class TokenNotSetError extends Error {
  constructor() {
    super('the game token mint is not set yet (run `pnpm admin set-token --mint <CA>`)');
    this.name = 'TokenNotSetError';
  }
}

/** True once `set_token_mint` stored the game mint (arenas can exist and be joined). */
export function isTokenSet(config: Pick<ConfigView, 'tokenMint' | 'tokenProgram'>): boolean {
  return config.tokenMint !== null && config.tokenProgram !== null;
}

/** The game token of a config; throws `TokenNotSetError` while the mint is unset. */
export function requireToken(config: Pick<ConfigView, 'tokenMint' | 'tokenProgram' | 'tokenDecimals'>): GameToken {
  if (config.tokenMint === null || config.tokenProgram === null) throw new TokenNotSetError();
  return { tokenMint: config.tokenMint, tokenProgram: config.tokenProgram, tokenDecimals: config.tokenDecimals };
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

export function toConfigView(raw: RawConfig): ConfigView {
  const tokenMint = pkOrNull(raw.tokenMint);
  return {
    admin: pk(raw.admin),
    serverAuthority: pk(raw.serverAuthority),
    feeWallet: pk(raw.feeWallet),
    tokenMint,
    // the program sets mint and program together; treat a half-set pair as unset
    tokenProgram: tokenMint === null ? null : pkOrNull(raw.tokenProgram),
    tokenDecimals: raw.tokenDecimals,
    feeBps: raw.feeBps,
    settleFeeLamports: toNumber(raw.settleFeeLamports),
    paused: raw.paused,
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
  return {
    address: toBase58(address),
    owner: pk(raw.owner),
    name: decodeName(raw.name, raw.nameLen),
    skin: raw.skin,
    xp: toNumber(raw.xp),
    level: levelFromXp(raw.xp),
    gamesPlayed: raw.gamesPlayed,
    kills: raw.kills,
    bestScore: raw.bestScore,
    totalScore: toNumber(raw.totalScore),
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
    settleFee: toNumber(raw.settleFee),
    feeBps: raw.feeBps,
    finalized: raw.finalized,
    owed: toBigInt(raw.owed),
  };
}

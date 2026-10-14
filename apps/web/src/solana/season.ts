import { PRIZE_SHARES_BPS } from '@slana/shared';
import type { SlanaInstructions } from '@slana/sdk';
import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { buildAtaTx } from './ticket';

/**
 * Season prizes (spec §3.4): the top 10 of a finalized season share its
 * frozen prize pool (`PRIZE_SHARES_BPS`) and each winner claims their share
 * within 30 days (`CLAIM_WINDOW_SECS`, enforced by the program).
 */

/** Program constant `CLAIM_WINDOW_SECS`. */
export const CLAIM_WINDOW_S = 2_592_000;
/** Prize ranks paid (`PRIZE_SHARES_BPS.length`). */
export const PRIZE_RANKS = PRIZE_SHARES_BPS.length;

/** The program's `mul_bps`: floor(amount × bps / 10 000). */
export const prizeAmount = (pool: bigint, rank: number): bigint =>
  rank >= 0 && rank < PRIZE_RANKS ? (pool * BigInt(PRIZE_SHARES_BPS[rank])) / 10_000n : 0n;

export interface FinalizedSeason {
  id: number;
  /** Frozen prize pool, raw token units. */
  prizePool: number | bigint;
  /** Unix seconds. */
  endedAt: number;
  /** Ranked entries (sorted by points). */
  entries: { player: string }[];
  /** Bit `rank` set ⇔ claimed. */
  claimedMask: number;
}

export type ClaimState =
  | { kind: 'none' }
  | { kind: 'claimable'; seasonId: number; rank: number; amount: bigint; closesAt: number }
  | { kind: 'claimed'; seasonId: number; rank: number; amount: bigint }
  | { kind: 'expired'; seasonId: number; rank: number; amount: bigint };

/** Is there a prize for `me` in this finalized season, and can it still be claimed? (The program's `prize_rank` order.) */
export function claimState(season: FinalizedSeason | null, me: string | null, nowS: number): ClaimState {
  if (!season || !me) return { kind: 'none' };
  const rank = season.entries.slice(0, PRIZE_RANKS).findIndex((e) => e.player === me);
  if (rank < 0) return { kind: 'none' };
  const pool = typeof season.prizePool === 'bigint' ? season.prizePool : BigInt(Math.trunc(season.prizePool));
  const amount = prizeAmount(pool, rank);
  if (amount <= 0n) return { kind: 'none' };
  const base = { seasonId: season.id, rank, amount };
  if ((season.claimedMask & (1 << rank)) !== 0) return { kind: 'claimed', ...base };
  const closesAt = season.endedAt + CLAIM_WINDOW_S;
  if (nowS > closesAt) return { kind: 'expired', ...base };
  return { kind: 'claimable', ...base, closesAt };
}

/**
 * `[createAta?] + claimSeasonReward`: the prize lands in the claimer's
 * game-token account, created (idempotently) in the same transaction when the
 * wallet has none yet.
 */
export async function buildClaimTx(
  ix: SlanaInstructions,
  p: { claimer: string | PublicKey; seasonId: number; token: { tokenMint: string; tokenProgram: string }; ataExists: boolean | null },
): Promise<TransactionInstruction[]> {
  const out: TransactionInstruction[] = [];
  if (p.ataExists !== true) out.push(...buildAtaTx(p.claimer, p.token));
  out.push(await ix.claimSeasonReward(p.claimer, { seasonId: p.seasonId, tokenMint: p.token.tokenMint, tokenProgram: p.token.tokenProgram }));
  return out;
}

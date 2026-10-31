/**
 * Constants mirrored from `packages/contracts/contracts/*.sol` (a unit test checks the ones the
 * contracts expose as `public constant` against the bundled ABIs, and the e2e test reads them from
 * a deployed contract).
 */

/** Basis-point denominator (100 %). */
export const BPS = 10_000;
/** Upper bound of the arena's `feeBps` (10 %). */
export const MAX_FEE_BPS = 1_000;
/** Fee on profit a freshly deployed arena starts with (5 %). */
export const DEFAULT_FEE_BPS = 500;
/** Bounds of `maxSessions` (open tickets per arena). */
export const MIN_ARENA_SESSIONS = 2;
export const MAX_ARENA_SESSIONS = 2_000;
/** Arena ids are uint16 and never 0. */
export const MIN_ARENA_ID = 1;
export const MAX_ARENA_ID = 65_535;
/** A ticket the server never settled can be refunded by its player this many seconds after joining (24 h). */
export const REFUND_DELAY_SECS = 86_400;
/** Floor loot is burned by sending it here (`sweepLoot`). */
export const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;
/** Largest uint128 (entry fees and payouts). */
export const MAX_UINT128 = (1n << 128n) - 1n;
/** Largest uint64 (session ids, sweep ids). */
export const MAX_UINT64 = (1n << 64n) - 1n;

/** `SettleSkipped.reason` codes. */
export const SettleSkipReason = {
  UnknownArena: 1,
  SessionMismatch: 2,
  Finalized: 3,
  InsufficientVault: 4,
} as const;
export type SettleSkipReason = (typeof SettleSkipReason)[keyof typeof SettleSkipReason];

/** Human text for a `SettleSkipped.reason`. */
export function settleSkipReasonText(reason: number): string {
  switch (reason) {
    case SettleSkipReason.UnknownArena:
      return 'the arena does not exist';
    case SettleSkipReason.SessionMismatch:
      return 'no open session with this id (never opened, already settled or refunded)';
    case SettleSkipReason.Finalized:
      return 'already settled; waits for the player to collect';
    case SettleSkipReason.InsufficientVault:
      return 'the payout is larger than the arena vault';
    default:
      return `unknown reason ${reason}`;
  }
}

/** Items per `settle` transaction (the server chunks a bell's batch at this size). */
export const SETTLE_CHUNK = 40;

/** NFT mint phases (`ElymumNFT.Phase`). */
export const MintPhase = {
  Closed: 0,
  Allowlist: 1,
  Public: 2,
} as const;
export type MintPhase = (typeof MintPhase)[keyof typeof MintPhase];
export const MINT_PHASE_NAMES = ['closed', 'allowlist', 'public'] as const;
export type MintPhaseName = (typeof MINT_PHASE_NAMES)[number];

/** NFT royalty upper bound (10 %). */
export const MAX_ROYALTY_BPS = 1_000;
/** Default overpayment on a mint (1 %): the contract refunds the excess, so a price change in between cannot fail the mint. */
export const DEFAULT_MINT_BUFFER_BPS = 100;
/** Mint target in US cents ($1). */
export const DEFAULT_MINT_USD_CENTS = 100;
/** Hyperliquid's public info API (POST `{"type":"allMids"}`). */
export const HYPE_PRICE_URL_DEFAULT = 'https://api.hyperliquid.xyz/info';

/** TestToken faucet defaults (owner-settable with `setFaucet`): 1,000,000 tokens (18 decimals) per call, once per hour. */
export const TEST_TOKEN_FAUCET_AMOUNT = 1_000_000n * 10n ** 18n;
/** TestToken faucet default for holders of the holder NFT: 2,000,000 tokens. */
export const TEST_TOKEN_HOLDER_FAUCET_AMOUNT = 2_000_000n * 10n ** 18n;
export const TEST_TOKEN_FAUCET_COOLDOWN_SECS = 3_600;

/** Holder fee the admin panel suggests for `setHolderPerks` (3 %; the contract starts with the perks off). */
export const DEFAULT_HOLDER_FEE_BPS = 300;
/** Arenas the admin panel suggests marking holders-only (#4, the Isles of the Blessed). */
export const DEFAULT_HOLDERS_ONLY_ARENA_IDS: readonly number[] = [4];

import { elymumArenaArtifact } from './artifacts';

/**
 * Earlier ElymumArena builds that may still be deployed (hand-written, not generated).
 *
 * Version 1 took the platform fee on PROFIT at `settle` (`computeFee(payout, entryFee, feeBps)`), put the whole
 * entry fee into the vault, settled unplayed tickets back at their entry fee and has no `version()` view. It is
 * live on the Elysium testnet (0x9bdC7dCbB3Ea173E3111093A64cBe547E2f82A68). Its `join`, `refund`, `settle`,
 * `sweepLoot`, `getSession`, `getArena`, `config` and events have exactly the ABI of the current build, so the
 * current ABI talks to it; only the fee rule (and `cancel` / `arenaFees` / `version`, which it lacks) differ.
 *
 * Version 2 (the bundled artifact) takes the fee from the ENTRY FEE of every played ticket.
 */
export const ELYMUM_ARENA_V1_RUNTIME_CODE_HASH = '0xed5fc567574f38b0cb9fa20b273fcc5f76d5048e4678e181b06da6feaba356f8' as const;

/** The arena version of the bundled artifact (`ElymumArena.version()`). */
export const ELYMUM_ARENA_VERSION = 2;

/** 1: fee on profit (legacy). 2: fee on the entry fee of every played ticket. */
export type ArenaVersion = 1 | 2;

/** The arena version of a runtime code hash: 2 for the bundled build, 1 for the legacy one, null for anything else. */
export function arenaVersionOfCodeHash(hash: string | null | undefined): ArenaVersion | null {
  const h = hash?.toLowerCase();
  if (!h) return null;
  if (h === elymumArenaArtifact.runtimeCodeHash.toLowerCase()) return 2;
  if (h === ELYMUM_ARENA_V1_RUNTIME_CODE_HASH) return 1;
  return null;
}

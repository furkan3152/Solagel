import type { ChainStatus } from '@elymum/shared';

/**
 * Arena address the game server advertises in its `DEV_FAKE_CHAIN=1` mode (`ChainStatus.arenaAddress`).
 * Compared case-insensitively.
 */
export const DEV_FAKE_ARENA_ADDRESS = '0x000000000000000000000000000000000000fA4E';

/** The fake-chain stand-in is only ever active in a dev build talking to a DEV_FAKE_CHAIN server. */
export function isDevFake(chain: Pick<ChainStatus, 'arenaAddress'> | null | undefined): boolean {
  return import.meta.env.DEV && !!chain?.arenaAddress && chain.arenaAddress.toLowerCase() === DEV_FAKE_ARENA_ADDRESS.toLowerCase();
}

/**
 * Loads the dev-only fake chain (./devFake.ts). In production builds `import.meta.env.DEV` is
 * the literal `false`, so the dynamic import is removed and the module never reaches the bundle.
 */
export function loadDevFake(): Promise<typeof import('./devFake') | null> {
  if (import.meta.env.DEV) return import('./devFake');
  return Promise.resolve(null);
}

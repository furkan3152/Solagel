import type { ChainStatus } from '@elymum/shared';

/** Program id the game server advertises in its DEV_FAKE_CHAIN mode. */
export const DEV_FAKE_PROGRAM_ID = 'DevFakeChain1111111111111111111111111111111';

/** The fake-chain stand-in is only ever active in a dev build talking to a DEV_FAKE_CHAIN server. */
export function isDevFake(chain: ChainStatus | null): boolean {
  return import.meta.env.DEV && chain?.programId === DEV_FAKE_PROGRAM_ID;
}

/**
 * Loads the dev-only fake chain (./devFake.ts). In production builds
 * `import.meta.env.DEV` is the literal `false`, so the dynamic import is
 * removed and the module never reaches the bundle.
 */
export function loadDevFake(): Promise<typeof import('./devFake') | null> {
  if (import.meta.env.DEV) return import('./devFake');
  return Promise.resolve(null);
}

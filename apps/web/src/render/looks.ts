import { SEALED_LOOK, lookForBasicSkin, lookForPass, passTraits, type CoinLook } from '@slana/art';
import type { PassStatus } from '@slana/shared';

/**
 * Coin looks by player: a revealed Slana Pass (traits from the seeded
 * collection), the sealed look before the reveal, or the basic skin. Cached;
 * the cache resets when the collection seed changes.
 */
export class LookCache {
  private readonly looks = new Map<string, CoinLook>();
  private seed: string | null = null;

  lookFor(skin: number, pass: number, status: PassStatus | null): CoinLook {
    const seed = status?.revealed && status.seed ? `${status.seed}:${status.supply}` : null;
    if (seed !== this.seed) {
      this.looks.clear();
      this.seed = seed;
    }
    const key = pass > 0 ? `p${pass}` : `s${skin}`;
    let look = this.looks.get(key);
    if (!look) {
      if (pass > 0) {
        try {
          look = status?.revealed && status.seed ? lookForPass(passTraits(status.seed, pass, status.supply)) : SEALED_LOOK;
        } catch {
          look = SEALED_LOOK;
        }
      } else look = lookForBasicSkin(skin);
      this.looks.set(key, look);
    }
    return look;
  }
}

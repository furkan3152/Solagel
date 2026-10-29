import { lookForBasicSkin, type CoinLook } from '@elymum/art';

/** Coin looks by basic skin id, cached (one riso look per skin). */
export class LookCache {
  private readonly looks = new Map<number, CoinLook>();

  lookFor(skin: number): CoinLook {
    let look = this.looks.get(skin);
    if (!look) {
      look = lookForBasicSkin(skin);
      this.looks.set(skin, look);
    }
    return look;
  }
}

import { ELYSIUM, lookForBasicSkin, shadeOf, type CoinLook } from '@elymum/art';
import { EMBLEM_SKIN_ID } from '@elymum/shared';

/**
 * The emblem skin (`EMBLEM_SKIN_ID`, unlocked for Elymum NFT holders): the emblem's gold coin with
 * its crown face and a laurel, drawn with the shared Storybook coin art.
 */
export const EMBLEM_LOOK: CoinLook = {
  body: ELYSIUM.sun,
  overprint: ELYSIUM.teal,
  offset: { dx: 0, dy: 0 },
  symbol: 'crown',
  eyes: 'round',
  mouth: 'grin',
  accessory: 'laurel',
  shade: shadeOf(ELYSIUM.sun),
};

/** The look of any skin id: the emblem skin, else a basic skin (ids wrap). */
export function lookForSkin(id: number): CoinLook {
  if (id === EMBLEM_SKIN_ID) return { ...EMBLEM_LOOK, offset: { ...EMBLEM_LOOK.offset } };
  return lookForBasicSkin(id);
}

/** Coin looks by skin id, cached (one Storybook look per skin). */
export class LookCache {
  private readonly looks = new Map<number, CoinLook>();

  lookFor(skin: number): CoinLook {
    let look = this.looks.get(skin);
    if (!look) {
      look = lookForSkin(skin);
      this.looks.set(skin, look);
    }
    return look;
  }
}

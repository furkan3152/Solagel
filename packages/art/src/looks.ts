import { ELYSIUM, shadeOf } from './palette';

/** Symbols a coin can carry on its face. */
export type SymbolKind = 'coin' | 'heart' | 'star' | 'bolt' | 'moon' | 'flower' | 'clover' | 'dollar' | 'crown' | 'diamond';
/** Eye shapes (the resting look; expressions override them). */
export type EyesKind = 'round' | 'sleepy' | 'wink' | 'determined' | 'star' | 'heart' | 'sunglasses' | 'dizzy';
/** Mouth shapes. */
export type MouthKind = 'smile' | 'grin' | 'cat' | 'o' | 'tongue' | 'fang';
/** Hats and other accessories. */
export type AccessoryKind =
  | 'none'
  | 'cap'
  | 'beanie'
  | 'flower'
  | 'headphones'
  | 'partyHat'
  | 'propeller'
  | 'cowboy'
  | 'halo'
  | 'horns'
  | 'laurel'
  | 'crown';

/** Everything `drawRisoCoin` needs to know about a character's appearance. */
export interface CoinLook {
  /** Body paint (hex): the flat cel fill. */
  body: string;
  /** Accent paint (hex): hats, sparks, crumbs. (Was the riso overprint ink.) */
  overprint: string;
  /** @deprecated riso misregistration; ignored by the Storybook drawing (kept so old looks still type-check). */
  offset: { dx: number; dy: number };
  symbol: SymbolKind;
  eyes: EyesKind;
  mouth: MouthKind;
  accessory: AccessoryKind;
  /** The body's one hard shadow tone; default `shadeOf(body)`. */
  shade?: string;
}

const P = ELYSIUM;
const look = (body: string, overprint: string, symbol: SymbolKind, eyes: EyesKind, mouth: MouthKind, accessory: AccessoryKind): CoinLook => ({
  body,
  overprint,
  offset: { dx: 0, dy: 0 },
  symbol,
  eyes,
  mouth,
  accessory,
  shade: shadeOf(body),
});

/** The eight free skins in the Storybook coin paints (`COIN_PAINTS`). */
const BASIC: readonly CoinLook[] = [
  // 0 Solly
  look(P.cyan, P.sun, 'coin', 'round', 'smile', 'none'),
  // 1 Goldie
  look(P.sun, P.coral, 'star', 'round', 'grin', 'none'),
  // 2 Penny
  look(P.coral, P.sun, 'coin', 'round', 'smile', 'none'),
  // 3 Minty
  look(P.up, P.sun, 'dollar', 'round', 'grin', 'none'),
  // 4 Bubbles
  look(P.cream, P.coral, 'heart', 'round', 'cat', 'flower'),
  // 5 Skye
  look(P.spray, P.teal, 'moon', 'sleepy', 'o', 'none'),
  // 6 Zesty
  look(P.teal, P.sun, 'bolt', 'wink', 'tongue', 'none'),
  // 7 Grape
  look(P.foam, P.teal, 'diamond', 'round', 'cat', 'none'),
];

/** Looks of the eight free basic skins (ids 0..7; other ids wrap). */
export function lookForBasicSkin(id: number): CoinLook {
  const i = ((Math.trunc(id) % BASIC.length) + BASIC.length) % BASIC.length;
  const l = BASIC[i];
  return { ...l, offset: { ...l.offset } };
}

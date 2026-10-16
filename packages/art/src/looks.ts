import { RISO } from './palette';

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
  /** Body ink colour (hex). */
  body: string;
  /** Overprint (second ink) colour (hex). */
  overprint: string;
  /** Overprint misregistration in units of r/40. */
  offset: { dx: number; dy: number };
  symbol: SymbolKind;
  eyes: EyesKind;
  mouth: MouthKind;
  accessory: AccessoryKind;
}

const BASIC: readonly CoinLook[] = [
  // 0 Solly
  { body: RISO.purple, overprint: RISO.mint, offset: { dx: 3, dy: 3 }, symbol: 'coin', eyes: 'round', mouth: 'smile', accessory: 'none' },
  // 1 Goldie
  { body: RISO.mustard, overprint: RISO.orange, offset: { dx: 3, dy: 2 }, symbol: 'star', eyes: 'round', mouth: 'grin', accessory: 'none' },
  // 2 Penny
  { body: RISO.orange, overprint: RISO.red, offset: { dx: -3, dy: 3 }, symbol: 'coin', eyes: 'round', mouth: 'smile', accessory: 'none' },
  // 3 Minty
  { body: RISO.mint, overprint: RISO.teal, offset: { dx: 3, dy: 3 }, symbol: 'dollar', eyes: 'round', mouth: 'grin', accessory: 'none' },
  // 4 Bubbles
  { body: RISO.fluoPink, overprint: RISO.teal, offset: { dx: 3, dy: 3 }, symbol: 'heart', eyes: 'round', mouth: 'cat', accessory: 'flower' },
  // 5 Skye
  { body: RISO.aqua, overprint: RISO.blue, offset: { dx: 2, dy: 3 }, symbol: 'moon', eyes: 'sleepy', mouth: 'o', accessory: 'none' },
  // 6 Zesty
  { body: RISO.mustard, overprint: RISO.green, offset: { dx: -3, dy: 3 }, symbol: 'bolt', eyes: 'wink', mouth: 'tongue', accessory: 'none' },
  // 7 Grape
  { body: RISO.lilac, overprint: RISO.purple, offset: { dx: 3, dy: 3 }, symbol: 'diamond', eyes: 'round', mouth: 'cat', accessory: 'none' },
];

/** Looks of the eight free basic skins (ids 0..7; other ids wrap). */
export function lookForBasicSkin(id: number): CoinLook {
  const i = ((Math.trunc(id) % BASIC.length) + BASIC.length) % BASIC.length;
  const l = BASIC[i];
  return { ...l, offset: { ...l.offset } };
}

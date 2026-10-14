import { RISO } from './palette';
import type { AccessoryKind, EyesKind, MouthKind, PassTraits, Special, SymbolKind } from './traits';

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
  special: Special;
}

const BASIC: readonly CoinLook[] = [
  // 0 Solly
  { body: RISO.purple, overprint: RISO.mint, offset: { dx: 3, dy: 3 }, symbol: 'coin', eyes: 'round', mouth: 'smile', accessory: 'none', special: null },
  // 1 Goldie
  { body: RISO.mustard, overprint: RISO.orange, offset: { dx: 3, dy: 2 }, symbol: 'star', eyes: 'round', mouth: 'grin', accessory: 'none', special: null },
  // 2 Penny
  { body: RISO.orange, overprint: RISO.red, offset: { dx: -3, dy: 3 }, symbol: 'coin', eyes: 'round', mouth: 'smile', accessory: 'none', special: null },
  // 3 Minty
  { body: RISO.mint, overprint: RISO.teal, offset: { dx: 3, dy: 3 }, symbol: 'dollar', eyes: 'round', mouth: 'grin', accessory: 'none', special: null },
  // 4 Bubbles
  { body: RISO.fluoPink, overprint: RISO.teal, offset: { dx: 3, dy: 3 }, symbol: 'heart', eyes: 'round', mouth: 'cat', accessory: 'flower', special: null },
  // 5 Skye
  { body: RISO.aqua, overprint: RISO.blue, offset: { dx: 2, dy: 3 }, symbol: 'moon', eyes: 'sleepy', mouth: 'o', accessory: 'none', special: null },
  // 6 Zesty
  { body: RISO.mustard, overprint: RISO.green, offset: { dx: -3, dy: 3 }, symbol: 'bolt', eyes: 'wink', mouth: 'tongue', accessory: 'none', special: null },
  // 7 Grape
  { body: RISO.lilac, overprint: RISO.purple, offset: { dx: 3, dy: 3 }, symbol: 'diamond', eyes: 'round', mouth: 'cat', accessory: 'none', special: null },
];

/** Looks of the eight free basic skins (ids 0..7; other ids wrap). */
export function lookForBasicSkin(id: number): CoinLook {
  const i = ((Math.trunc(id) % BASIC.length) + BASIC.length) % BASIC.length;
  const l = BASIC[i];
  return { ...l, offset: { ...l.offset } };
}

/** Look of a revealed Slana Pass. */
export function lookForPass(t: PassTraits): CoinLook {
  return {
    body: RISO[t.ink],
    overprint: RISO[t.overprint],
    offset: { ...t.offset },
    symbol: t.symbol,
    eyes: t.eyes,
    mouth: t.mouth,
    accessory: t.accessory,
    special: t.special,
  };
}

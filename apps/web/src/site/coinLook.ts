import { RISO, type AccessoryKind, type CoinLook, type EyesKind, type MouthKind, type SymbolKind } from '@elymum/art';

/** FNV-1a, 32 bit: a stable hash of a string (the same handle always gives the same coin). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small deterministic generator seeded from a hash. */
export function seeded(seed: number): () => number {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Body ink and its second ink: pairs that print well together. */
const INKS: readonly [string, string][] = [
  [RISO.fluoPink, RISO.teal],
  [RISO.mustard, RISO.orange],
  [RISO.teal, RISO.blue],
  [RISO.aqua, RISO.purple],
  [RISO.mint, RISO.teal],
  [RISO.orange, RISO.red],
  [RISO.lilac, RISO.purple],
  [RISO.purple, RISO.mint],
  [RISO.mustard, RISO.green],
  [RISO.fluoPink, RISO.mustard],
  [RISO.green, RISO.mustard],
  [RISO.blue, RISO.aqua],
];
const SYMBOLS: readonly SymbolKind[] = ['coin', 'heart', 'star', 'bolt', 'moon', 'flower', 'clover', 'dollar', 'crown', 'diamond'];
const EYES: readonly EyesKind[] = ['round', 'round', 'round', 'sleepy', 'wink', 'determined', 'star', 'heart', 'sunglasses'];
const MOUTHS: readonly MouthKind[] = ['smile', 'grin', 'cat', 'o', 'tongue', 'fang'];
const HATS: readonly AccessoryKind[] = ['none', 'none', 'none', 'cap', 'beanie', 'flower', 'headphones', 'partyHat', 'propeller', 'cowboy', 'halo', 'horns', 'laurel', 'crown'];

const pick = <T,>(list: readonly T[], r: () => number): T => list[Math.floor(r() * list.length) % list.length];

/** The coin of an X handle: ink, symbol, face and hat all come from the handle. */
export function lookForHandle(handle: string): CoinLook {
  const r = seeded(hash32(`slana:${handle.toLowerCase()}`));
  const [body, overprint] = pick(INKS, r);
  const dx = r() < 0.5 ? -3 : 3;
  return { body, overprint, offset: { dx, dy: 3 }, symbol: pick(SYMBOLS, r), eyes: pick(EYES, r), mouth: pick(MOUTHS, r), accessory: pick(HATS, r) };
}

/** The ticket number printed on a handle's card (0001-9999). */
export function ticketNumber(handle: string): number {
  return (hash32(`ticket:${handle.toLowerCase()}`) % 9999) + 1;
}

export const ticketNo = (handle: string): string => String(ticketNumber(handle)).padStart(4, '0');

import type { PassTraits } from '@slana/art';
import type { TKey } from '../../i18n';

type Names = Record<string, string>;

/** Riso inks, as a printer would name them. */
const INKS: Names = {
  fluoPink: 'Fluo pink',
  teal: 'Teal',
  mustard: 'Mustard',
  blue: 'Riso blue',
  green: 'Riso green',
  orange: 'Orange',
  purple: 'Purple',
  red: 'Red',
  aqua: 'Aqua',
  lilac: 'Lilac',
  mint: 'Mint',
  brown: 'Brown',
};

const SYMBOLS: Names = {
  coin: 'Coin',
  heart: 'Heart',
  star: 'Star',
  bolt: 'Bolt',
  moon: 'Moon',
  flower: 'Flower',
  clover: 'Clover',
  dollar: 'Dollar',
  crown: 'Crown',
  diamond: 'Diamond',
};

const EYES: Names = {
  round: 'Round',
  sleepy: 'Sleepy',
  wink: 'Wink',
  determined: 'Determined',
  star: 'Starry',
  heart: 'Smitten',
  sunglasses: 'Sunglasses',
  dizzy: 'Dizzy',
};

const MOUTHS: Names = {
  smile: 'Smile',
  grin: 'Grin',
  cat: 'Cat',
  o: 'Oh',
  tongue: 'Tongue',
  fang: 'Fang',
};

const ACCESSORIES: Names = {
  none: 'None',
  cap: 'Cap',
  beanie: 'Beanie',
  flower: 'Flower',
  headphones: 'Headphones',
  partyHat: 'Party hat',
  propeller: 'Propeller',
  cowboy: 'Cowboy hat',
  halo: 'Halo',
  horns: 'Horns',
  laurel: 'Laurel',
  crown: 'Crown',
};

const PAPER_NAMES: Names = {
  cream: 'Cream',
  pink: 'Pink',
  mint: 'Mint',
  sky: 'Sky',
  butter: 'Butter',
  lilac: 'Lilac',
};

const name = (table: Names, v: string) => table[v] ?? v;

export interface TraitRow {
  label: TKey;
  value: string;
}

/** The passport fields of a revealed Pass, in reading order. */
export function traitRows(t: PassTraits, tx: (k: TKey, vars?: Record<string, string | number>) => string): TraitRow[] {
  const rows: TraitRow[] = [
    { label: 'pp.f.ink', value: name(INKS, t.ink) },
    { label: 'pp.f.overprint', value: name(INKS, t.overprint) },
    { label: 'pp.f.symbol', value: name(SYMBOLS, t.symbol) },
    { label: 'pp.f.eyes', value: name(EYES, t.eyes) },
    { label: 'pp.f.mouth', value: name(MOUTHS, t.mouth) },
    { label: 'pp.f.accessory', value: name(ACCESSORIES, t.accessory) },
    { label: 'pp.f.paper', value: name(PAPER_NAMES, t.paper) },
  ];
  if (t.special) rows.push({ label: 'pp.f.special', value: specialName(t.special, tx) });
  return rows;
}

export function specialName(s: NonNullable<PassTraits['special']>, tx: (k: TKey, vars?: Record<string, string | number>) => string): string {
  if (s === 'gold') return tx('pp.s.gold');
  if (s === 'holo') return tx('pp.s.holo');
  return tx('pp.s.one', { n: s.slice('oneOfOne:'.length) });
}

export const rarityKey = (r: PassTraits['rarity']): TKey => (r === 'legendary' ? 'pp.r.legendary' : r === 'rare' ? 'pp.r.rare' : 'pp.r.common');

/** Short look line for the rolling preview, e.g. "Mustard · Crown · Starry". */
export function lookLine(t: PassTraits): string {
  return [name(INKS, t.ink), name(SYMBOLS, t.symbol), name(EYES, t.eyes), name(ACCESSORIES, t.accessory)].join(' · ');
}

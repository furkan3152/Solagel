import type { PassTraits } from '@slana/art';
import type { TKey } from '../../i18n';
import type { Lang } from '../../store';

type Names = Record<string, { en: string; tr: string }>;

/** Riso inks, as a printer would name them. */
const INKS: Names = {
  fluoPink: { en: 'Fluo pink', tr: 'Fluo pembe' },
  teal: { en: 'Teal', tr: 'Deniz' },
  mustard: { en: 'Mustard', tr: 'Hardal' },
  blue: { en: 'Riso blue', tr: 'Riso mavi' },
  green: { en: 'Riso green', tr: 'Riso yeşil' },
  orange: { en: 'Orange', tr: 'Turuncu' },
  purple: { en: 'Purple', tr: 'Mor' },
  red: { en: 'Red', tr: 'Kırmızı' },
  aqua: { en: 'Aqua', tr: 'Su mavisi' },
  lilac: { en: 'Lilac', tr: 'Leylak' },
  mint: { en: 'Mint', tr: 'Nane' },
  brown: { en: 'Brown', tr: 'Kahve' },
};

const SYMBOLS: Names = {
  coin: { en: 'Coin', tr: 'Sikke' },
  heart: { en: 'Heart', tr: 'Kalp' },
  star: { en: 'Star', tr: 'Yıldız' },
  bolt: { en: 'Bolt', tr: 'Şimşek' },
  moon: { en: 'Moon', tr: 'Ay' },
  flower: { en: 'Flower', tr: 'Çiçek' },
  clover: { en: 'Clover', tr: 'Yonca' },
  dollar: { en: 'Dollar', tr: 'Dolar' },
  crown: { en: 'Crown', tr: 'Taç' },
  diamond: { en: 'Diamond', tr: 'Elmas' },
};

const EYES: Names = {
  round: { en: 'Round', tr: 'Yuvarlak' },
  sleepy: { en: 'Sleepy', tr: 'Uykulu' },
  wink: { en: 'Wink', tr: 'Göz kırpan' },
  determined: { en: 'Determined', tr: 'Kararlı' },
  star: { en: 'Starry', tr: 'Yıldızlı' },
  heart: { en: 'Smitten', tr: 'Aşık' },
  sunglasses: { en: 'Sunglasses', tr: 'Güneş gözlüğü' },
  dizzy: { en: 'Dizzy', tr: 'Başı dönmüş' },
};

const MOUTHS: Names = {
  smile: { en: 'Smile', tr: 'Gülümseme' },
  grin: { en: 'Grin', tr: 'Sırıtma' },
  cat: { en: 'Cat', tr: 'Kedi' },
  o: { en: 'Oh', tr: 'Şaşkın' },
  tongue: { en: 'Tongue', tr: 'Dil' },
  fang: { en: 'Fang', tr: 'Diş' },
};

const ACCESSORIES: Names = {
  none: { en: 'None', tr: 'Yok' },
  cap: { en: 'Cap', tr: 'Kasket' },
  beanie: { en: 'Beanie', tr: 'Bere' },
  flower: { en: 'Flower', tr: 'Çiçek' },
  headphones: { en: 'Headphones', tr: 'Kulaklık' },
  partyHat: { en: 'Party hat', tr: 'Parti şapkası' },
  propeller: { en: 'Propeller', tr: 'Pervane' },
  cowboy: { en: 'Cowboy hat', tr: 'Kovboy şapkası' },
  halo: { en: 'Halo', tr: 'Hale' },
  horns: { en: 'Horns', tr: 'Boynuz' },
  laurel: { en: 'Laurel', tr: 'Defne' },
  crown: { en: 'Crown', tr: 'Taç' },
};

const PAPER_NAMES: Names = {
  cream: { en: 'Cream', tr: 'Krem' },
  pink: { en: 'Pink', tr: 'Pembe' },
  mint: { en: 'Mint', tr: 'Nane' },
  sky: { en: 'Sky', tr: 'Gök' },
  butter: { en: 'Butter', tr: 'Tereyağı' },
  lilac: { en: 'Lilac', tr: 'Leylak' },
};

const name = (table: Names, v: string, lang: Lang) => table[v]?.[lang] ?? v;

export interface TraitRow {
  label: TKey;
  value: string;
}

/** The passport fields of a revealed Pass, in reading order. */
export function traitRows(t: PassTraits, lang: Lang, tr: (k: TKey, vars?: Record<string, string | number>) => string): TraitRow[] {
  const rows: TraitRow[] = [
    { label: 'pp.f.ink', value: name(INKS, t.ink, lang) },
    { label: 'pp.f.overprint', value: name(INKS, t.overprint, lang) },
    { label: 'pp.f.symbol', value: name(SYMBOLS, t.symbol, lang) },
    { label: 'pp.f.eyes', value: name(EYES, t.eyes, lang) },
    { label: 'pp.f.mouth', value: name(MOUTHS, t.mouth, lang) },
    { label: 'pp.f.accessory', value: name(ACCESSORIES, t.accessory, lang) },
    { label: 'pp.f.paper', value: name(PAPER_NAMES, t.paper, lang) },
  ];
  if (t.special) rows.push({ label: 'pp.f.special', value: specialName(t.special, tr) });
  return rows;
}

export function specialName(s: NonNullable<PassTraits['special']>, tr: (k: TKey, vars?: Record<string, string | number>) => string): string {
  if (s === 'gold') return tr('pp.s.gold');
  if (s === 'holo') return tr('pp.s.holo');
  return tr('pp.s.one', { n: s.slice('oneOfOne:'.length) });
}

export const rarityKey = (r: PassTraits['rarity']): TKey => (r === 'legendary' ? 'pp.r.legendary' : r === 'rare' ? 'pp.r.rare' : 'pp.r.common');

/** Short look line for the rolling preview, e.g. "Mustard · Crown · Starry". */
export function lookLine(t: PassTraits, lang: Lang): string {
  return [name(INKS, t.ink, lang), name(SYMBOLS, t.symbol, lang), name(EYES, t.eyes, lang), name(ACCESSORIES, t.accessory, lang)].join(' · ');
}

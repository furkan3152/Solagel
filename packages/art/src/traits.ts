import type { CoinLook } from './looks';
import { RISO, type PaperKind, type RisoInk } from './palette';
import { seededRandom } from './rng';

/**
 * Slana Pass traits (spec §4.3). Every list is `[value, weight]`; the weight
 * product of a pass decides its rarity tier.
 */
type Weighted<T extends string> = readonly (readonly [T, number])[];

export const INK_WEIGHTS = [
  ['fluoPink', 12],
  ['teal', 12],
  ['mustard', 11],
  ['blue', 10],
  ['green', 9],
  ['orange', 9],
  ['purple', 8],
  ['red', 8],
  ['aqua', 7],
  ['lilac', 6],
  ['mint', 5],
  ['brown', 3],
] as const satisfies Weighted<RisoInk>;

export const OVERPRINT_WEIGHTS = [
  ['teal', 24],
  ['fluoPink', 22],
  ['mustard', 20],
  ['blue', 14],
  ['aqua', 12],
  ['lilac', 8],
] as const satisfies Weighted<RisoInk>;

export const SYMBOL_WEIGHTS = [
  ['coin', 18],
  ['heart', 15],
  ['star', 15],
  ['bolt', 12],
  ['moon', 10],
  ['flower', 9],
  ['clover', 7],
  ['dollar', 6],
  ['crown', 5],
  ['diamond', 3],
] as const;

export const EYES_WEIGHTS = [
  ['round', 26],
  ['sleepy', 16],
  ['wink', 14],
  ['determined', 12],
  ['star', 10],
  ['heart', 9],
  ['sunglasses', 8],
  ['dizzy', 5],
] as const;

export const MOUTH_WEIGHTS = [
  ['smile', 30],
  ['grin', 22],
  ['cat', 16],
  ['o', 14],
  ['tongue', 11],
  ['fang', 7],
] as const;

export const ACCESSORY_WEIGHTS = [
  ['none', 22],
  ['cap', 11],
  ['beanie', 11],
  ['flower', 10],
  ['headphones', 9],
  ['partyHat', 9],
  ['propeller', 7],
  ['cowboy', 6],
  ['halo', 5],
  ['horns', 4],
  ['laurel', 3],
  ['crown', 3],
] as const;

export const PAPER_WEIGHTS = [
  ['cream', 30],
  ['butter', 18],
  ['pink', 16],
  ['mint', 14],
  ['sky', 14],
  ['lilac', 8],
] as const satisfies Weighted<PaperKind>;

type Of<W extends Weighted<string>> = W[number][0];
export type OverprintInk = Of<typeof OVERPRINT_WEIGHTS>;
export type SymbolKind = Of<typeof SYMBOL_WEIGHTS>;
export type EyesKind = Of<typeof EYES_WEIGHTS>;
export type MouthKind = Of<typeof MOUTH_WEIGHTS>;
export type AccessoryKind = Of<typeof ACCESSORY_WEIGHTS>;
export type Special = 'gold' | 'holo' | `oneOfOne:${number}` | null;
export type Rarity = 'common' | 'rare' | 'legendary';

export interface PassTraits {
  ink: RisoInk;
  overprint: OverprintInk;
  /** Misregistration of the overprint, in units of r/40. */
  offset: { dx: number; dy: number };
  symbol: SymbolKind;
  eyes: EyesKind;
  mouth: MouthKind;
  accessory: AccessoryKind;
  paper: PaperKind;
  special: Special;
  rarity: Rarity;
  /** −log10 of the trait weight product: higher is rarer. */
  score: number;
}

export const SYMBOLS = SYMBOL_WEIGHTS.map(([k]) => k);
export const EYES = EYES_WEIGHTS.map(([k]) => k);
export const MOUTHS = MOUTH_WEIGHTS.map(([k]) => k);
export const ACCESSORIES = ACCESSORY_WEIGHTS.map(([k]) => k);

export const ONE_OF_ONE_COUNT = 10;
/** Share of the supply in the legendary tier (1/1s included). */
export const LEGENDARY_SHARE = 0.02;
/** Share of the supply in the rare tier (directly below legendary). */
export const RARE_SHARE = 0.18;

type Base = Omit<PassTraits, 'special' | 'rarity' | 'score'>;

/** The ten hand-picked 1/1 designs (hand-made). */
export const ONE_OF_ONES: readonly Base[] = [
  { ink: 'mustard', overprint: 'fluoPink', offset: { dx: 3, dy: 3 }, symbol: 'crown', eyes: 'star', mouth: 'grin', accessory: 'crown', paper: 'butter' },
  { ink: 'purple', overprint: 'aqua', offset: { dx: -3, dy: 3 }, symbol: 'moon', eyes: 'sleepy', mouth: 'o', accessory: 'halo', paper: 'lilac' },
  { ink: 'red', overprint: 'mustard', offset: { dx: 4, dy: 0 }, symbol: 'bolt', eyes: 'determined', mouth: 'fang', accessory: 'horns', paper: 'cream' },
  { ink: 'teal', overprint: 'fluoPink', offset: { dx: 3, dy: -3 }, symbol: 'clover', eyes: 'wink', mouth: 'tongue', accessory: 'propeller', paper: 'mint' },
  { ink: 'fluoPink', overprint: 'teal', offset: { dx: 4, dy: 4 }, symbol: 'heart', eyes: 'heart', mouth: 'cat', accessory: 'flower', paper: 'pink' },
  { ink: 'blue', overprint: 'mustard', offset: { dx: -4, dy: 2 }, symbol: 'star', eyes: 'sunglasses', mouth: 'grin', accessory: 'cap', paper: 'sky' },
  { ink: 'brown', overprint: 'mustard', offset: { dx: 3, dy: 2 }, symbol: 'dollar', eyes: 'round', mouth: 'smile', accessory: 'cowboy', paper: 'butter' },
  { ink: 'mint', overprint: 'lilac', offset: { dx: 2, dy: 3 }, symbol: 'flower', eyes: 'round', mouth: 'smile', accessory: 'laurel', paper: 'mint' },
  { ink: 'aqua', overprint: 'blue', offset: { dx: 0, dy: 4 }, symbol: 'diamond', eyes: 'dizzy', mouth: 'o', accessory: 'headphones', paper: 'sky' },
  { ink: 'green', overprint: 'mustard', offset: { dx: -3, dy: -3 }, symbol: 'coin', eyes: 'determined', mouth: 'grin', accessory: 'partyHat', paper: 'cream' },
];

/** Combination key used for uniqueness (the offset is not part of identity). */
export function traitKey(t: Pick<PassTraits, 'ink' | 'overprint' | 'symbol' | 'eyes' | 'mouth' | 'accessory' | 'paper'>): string {
  return `${t.ink}|${t.overprint}|${t.symbol}|${t.eyes}|${t.mouth}|${t.accessory}|${t.paper}`;
}

const total = (w: Weighted<string>): number => w.reduce((s, [, x]) => s + x, 0);

function pick<T extends string>(w: Weighted<T>, rnd: () => number, exclude?: string): T {
  const list = exclude ? w.filter(([k]) => k !== exclude) : w;
  let x = rnd() * total(list);
  for (const [k, wt] of list) {
    x -= wt;
    if (x < 0) return k;
  }
  return list[list.length - 1][0];
}

const prob = (w: Weighted<string>, k: string): number => (w.find(([v]) => v === k)?.[1] ?? 0) / total(w);

/** −log10 of the weight product of a pass's categorical traits. */
export function traitScore(t: Base): number {
  const p =
    prob(INK_WEIGHTS, t.ink) *
    prob(OVERPRINT_WEIGHTS, t.overprint) *
    prob(SYMBOL_WEIGHTS, t.symbol) *
    prob(EYES_WEIGHTS, t.eyes) *
    prob(MOUTH_WEIGHTS, t.mouth) *
    prob(ACCESSORY_WEIGHTS, t.accessory) *
    prob(PAPER_WEIGHTS, t.paper);
  return Math.round(-Math.log10(p) * 10000) / 10000;
}

const OFFSET_STEPS = [2, 3, 4];

function rollOffset(rnd: () => number): { dx: number; dy: number } {
  const a = Math.floor(rnd() * 8) * (Math.PI / 4);
  const m = OFFSET_STEPS[Math.floor(rnd() * OFFSET_STEPS.length)];
  return { dx: Math.round(Math.cos(a) * m) || 0, dy: Math.round(Math.sin(a) * m) || 0 };
}

function rollBase(rnd: () => number): Base {
  const ink = pick(INK_WEIGHTS, rnd);
  return {
    ink,
    overprint: pick(OVERPRINT_WEIGHTS, rnd, ink),
    offset: rollOffset(rnd),
    symbol: pick(SYMBOL_WEIGHTS, rnd),
    eyes: pick(EYES_WEIGHTS, rnd),
    mouth: pick(MOUTH_WEIGHTS, rnd),
    accessory: pick(ACCESSORY_WEIGHTS, rnd),
    paper: pick(PAPER_WEIGHTS, rnd),
  };
}

function checkArgs(seedHex: string, supply: number): void {
  if (!/^[0-9a-fA-F]+$/.test(seedHex)) throw new Error('seedHex must be a non-empty hex string');
  if (!Number.isInteger(supply) || supply < 1) throw new Error('supply must be a positive integer');
}

/**
 * The whole collection for a reveal seed: deterministic, unique by
 * `traitKey`. Ten 1/1 slots are placed by the seeded RNG; the remaining
 * passes are ranked by `score`, the top 2 % of the supply (1/1s included)
 * is legendary (gold or holo special) and the next 18 % is rare.
 */
export function passCollection(seedHex: string, supply: number): PassTraits[] {
  checkArgs(seedHex, supply);

  // 1/1 slots (partial Fisher–Yates over the indices)
  const slotRnd = seededRandom(seedHex, 'slana-pass:one-of-one');
  const idx = Array.from({ length: supply }, (_, i) => i);
  const ones = Math.min(ONE_OF_ONE_COUNT, supply);
  const slotOf = new Map<number, number>();
  for (let k = 0; k < ones; k++) {
    const j = k + Math.floor(slotRnd() * (supply - k));
    [idx[k], idx[j]] = [idx[j], idx[k]];
    slotOf.set(idx[k], k);
  }

  const seen = new Set(ONE_OF_ONES.slice(0, ones).map(traitKey));
  const rnd = seededRandom(seedHex, 'slana-pass:traits');
  const bases: Base[] = [];
  for (let i = 0; i < supply; i++) {
    const k = slotOf.get(i);
    if (k !== undefined) {
      bases.push(ONE_OF_ONES[k]);
      continue;
    }
    let b = rollBase(rnd);
    let tries = 0;
    while (seen.has(traitKey(b))) {
      if (++tries > 10_000) throw new Error('trait space exhausted');
      b = rollBase(rnd);
    }
    seen.add(traitKey(b));
    bases.push(b);
  }

  const scores = bases.map(traitScore);
  const legendTotal = Math.max(ones, Math.round(supply * LEGENDARY_SHARE));
  const rareTotal = Math.round(supply * RARE_SHARE);
  const ranked = bases
    .map((_, i) => i)
    .filter((i) => !slotOf.has(i))
    .sort((a, b) => scores[b] - scores[a] || a - b);
  const rarity: Rarity[] = bases.map(() => 'common');
  for (const i of slotOf.keys()) rarity[i] = 'legendary';
  ranked.forEach((i, rank) => {
    if (rank < legendTotal - ones) rarity[i] = 'legendary';
    else if (rank < legendTotal - ones + rareTotal) rarity[i] = 'rare';
  });

  const specialRnd = seededRandom(seedHex, 'slana-pass:special');
  return bases.map((b, i) => {
    const k = slotOf.get(i);
    let special: Special = null;
    if (k !== undefined) special = `oneOfOne:${k + 1}`;
    else if (rarity[i] === 'legendary') special = specialRnd() < 0.5 ? 'gold' : 'holo';
    return { ...b, offset: { ...b.offset }, special, rarity: rarity[i], score: scores[i] };
  });
}

const memo = new Map<string, PassTraits[]>();

/** Traits of pass number `n` (1-based); the collection is memoised per seed + supply. */
export function passTraits(seedHex: string, n: number, supply = 3333): PassTraits {
  const key = `${seedHex.toLowerCase()}:${supply}`;
  let col = memo.get(key);
  if (!col) {
    col = passCollection(seedHex, supply);
    if (memo.size >= 4) memo.delete(memo.keys().next().value!);
    memo.set(key, col);
  }
  if (!Number.isInteger(n) || n < 1 || n > supply) throw new Error(`pass number out of range: ${n}`);
  const t = col[n - 1];
  return { ...t, offset: { ...t.offset } };
}

/** How an unrevealed ("sealed") pass looks: a sleepy red wax-seal coin. */
export const SEALED_LOOK: CoinLook = {
  body: RISO.red,
  overprint: RISO.mustard,
  offset: { dx: 3, dy: 3 },
  symbol: 'coin',
  eyes: 'sleepy',
  mouth: 'smile',
  accessory: 'none',
  special: null,
};

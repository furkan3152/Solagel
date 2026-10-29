/**
 * The Elymum NFT emblem: a deterministic Storybook-style SVG drawn from the token id (the drawing style of
 * docs/design/storybook-reference.html): a cartoon coin character with a face and a mood picked from the id,
 * flat cel colour, 3 px ink outlines, on a seigaiha back ring, labelled "No. <id>". Same id, same picture.
 */

export const INK = '#04181C';
const NIGHT = '#0F2A30';
const CREAM = '#F6EEDA';
const BLUSH = '#F39B86';

/** Paints (fill, hard shade) from the Elysium palette. */
export const EMBLEM_PAINTS = {
  teal: ['#2D7388', '#1F5566'],
  cyan: ['#34B7DD', '#2490B0'],
  foam: ['#93D9EE', '#69B4CC'],
  sun: ['#F2C14E', '#D49A2B'],
  up: ['#3C9A87', '#2B7465'],
} as const;
export type EmblemPaint = keyof typeof EMBLEM_PAINTS;
const PAINTS = Object.keys(EMBLEM_PAINTS) as EmblemPaint[];

export const EMBLEM_MOODS = ['smile', 'happy', 'smug', 'scared', 'chomp', 'sleepy', 'open'] as const;
export type EmblemMood = (typeof EMBLEM_MOODS)[number];

export interface EmblemTraits {
  coin: EmblemPaint;
  /** The back ring's paint (never the coin's). */
  ring: EmblemPaint;
  mood: EmblemMood;
  /** Pupil offset. */
  look: [number, number];
  sweat: boolean;
  feet: boolean;
}

/** A 32-bit integer hash of the id (splitmix-like), then a small PRNG: deterministic, well spread. */
function rng(id: number): () => number {
  let s = (Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ (id >>> 13)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

/** The traits of a token id (the metadata's attributes come from these). */
export function emblemTraits(id: number): EmblemTraits {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError(`token id must be a positive integer, got ${id}`);
  const r = rng(id);
  const coin = pick(r, PAINTS);
  const ring = pick(
    r,
    PAINTS.filter((p) => p !== coin),
  );
  const mood = pick(r, EMBLEM_MOODS);
  const look: [number, number] = [Math.round(r() * 8 - 4), Math.round(r() * 4 - 2)];
  return { coin, ring, mood, look, sweat: mood === 'scared' || r() < 0.08, feet: r() < 0.5 };
}

const NS = 'vector-effect="non-scaling-stroke"';
const W = 3;

/** The coin character (viewBox units −56..56), adapted from the reference generator without animation. */
function coin(t: EmblemTraits, clipId: string): string {
  const [c, s] = EMBLEM_PAINTS[t.coin];
  const [lx, ly] = t.look;
  const stroke = `stroke="${INK}" stroke-width="${W}" ${NS}`;
  const eye = (x: number): string => {
    if (t.mood === 'happy') return `<path d="M${x - 8} -4 Q${x} -15 ${x + 8} -4" fill="none" ${stroke} stroke-linecap="round"/>`;
    if (t.mood === 'sleepy') return `<path d="M${x - 9} -6 Q${x} 2 ${x + 9} -6" fill="none" ${stroke} stroke-linecap="round"/>`;
    return [
      `<ellipse cx="${x}" cy="-6" rx="10" ry="12.5" fill="#fff" ${stroke}/>`,
      `<circle cx="${x + lx}" cy="${-5 + ly}" r="${t.mood === 'scared' ? 3.6 : 6}" fill="${INK}"/>`,
      `<circle cx="${x + lx - 2.2}" cy="${-8 + ly}" r="2.1" fill="#fff"/>`,
      t.mood === 'smug' ? `<path d="M${x - 11.5} -6 L${x + 11.5} -6 A11 13 0 0 0 ${x - 11.5} -6Z" fill="${c}" ${stroke} stroke-linejoin="round"/>` : '',
    ].join('');
  };
  let brows = '';
  if (t.mood === 'scared') brows = `<path d="M-24 -24 L-9 -21 M24 -24 L9 -21" ${stroke} stroke-linecap="round"/>`;
  if (t.mood === 'smug') brows = `<path d="M-25 -21 Q-16 -25 -7 -21 M7 -22 Q16 -27 25 -23" fill="none" ${stroke} stroke-linecap="round"/>`;
  const smile = `<path d="M-9 13 Q0 22 9 13" fill="none" ${stroke} stroke-linecap="round"/>`;
  const open = `<path d="M-11 11 Q0 13 11 11 Q10 27 0 27 Q-10 27 -11 11Z" fill="${INK}" ${stroke} stroke-linejoin="round"/><path d="M-6 23 Q0 18 6 23 Q3 26 0 26 Q-3 26 -6 23Z" fill="${BLUSH}"/>`;
  const chomp = `<path d="M-20 8 Q0 4 20 8 Q20 38 0 38 Q-20 38 -20 8Z" fill="${INK}" ${stroke} stroke-linejoin="round"/><path d="M-14 9 l4 6 l4 -6 M6 9 l4 6 l4 -6" fill="#fff"/><path d="M-10 32 Q0 25 10 32 Q5 36 0 36 Q-5 36 -10 32Z" fill="${BLUSH}"/>`;
  const mouth: Record<EmblemMood, string> = {
    smile,
    smug: `<path d="M-6 15 Q4 19 12 11" fill="none" ${stroke} stroke-linecap="round"/>`,
    happy: open,
    open,
    scared: `<path d="M-8 18 q4 -5 8 0 t8 0" fill="none" ${stroke} stroke-linecap="round"/>`,
    chomp,
    sleepy: `<ellipse cx="0" cy="17" rx="4" ry="5" fill="${INK}" ${stroke}/><path d="M30 -38 h8 l-8 9 h8" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  const cheeks = `<ellipse cx="-27" cy="9" rx="6" ry="3.6" fill="${BLUSH}" opacity=".75"/><ellipse cx="27" cy="9" rx="6" ry="3.6" fill="${BLUSH}" opacity=".75"/>`;
  const feet = t.feet
    ? `<g fill="${s}" ${stroke} stroke-linejoin="round"><path d="M-30 52 Q-30 42 -18 42 Q-6 42 -6 52 Z"/><path d="M6 52 Q6 42 18 42 Q30 42 30 52 Z"/></g>`
    : '';
  const sweat = t.sweat ? `<path d="M38 -30 q6 9 0 13 q-6 -4 0 -13Z" fill="#DBF2F9" ${stroke}/>` : '';
  return [
    `<ellipse cx="0" cy="53" rx="34" ry="5" fill="${INK}" opacity=".22"/>`,
    feet,
    `<circle r="46" fill="${s}"/>`,
    `<clipPath id="${clipId}"><circle r="46"/></clipPath>`,
    `<g clip-path="url(#${clipId})"><circle cx="-6" cy="-8" r="46" fill="${c}"/></g>`,
    `<circle r="37.5" fill="none" stroke="${s}" stroke-width="2.5" ${NS} opacity=".9"/>`,
    `<path d="M-36 -10 A37 37 0 0 1 -18 -32" stroke="#fff" stroke-width="5" ${NS} fill="none" stroke-linecap="round" opacity=".85"/>`,
    `<circle r="46" fill="none" ${stroke}/>`,
    cheeks,
    brows,
    eye(-15),
    eye(15),
    mouth[t.mood],
    sweat,
  ].join('');
}

/** A ring of seigaiha scales (stacked half circles facing outward) around (cx, cy). */
function seigaihaRing(cx: number, cy: number, radius: number, paint: EmblemPaint): string {
  const [fill, shade] = EMBLEM_PAINTS[paint];
  const n = 28;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (360 / n) * i;
    const f = i % 2 === 0 ? fill : shade;
    out.push(
      `<g transform="rotate(${angle} ${cx} ${cy}) translate(${cx} ${cy - radius})">` +
        `<path d="M-24 0 A24 24 0 0 1 24 0Z" fill="${f}" stroke="${INK}" stroke-width="${W}" stroke-linejoin="round"/>` +
        `<path d="M-16 0 A16 16 0 0 1 16 0" fill="none" stroke="${CREAM}" stroke-width="2.5" opacity=".9"/>` +
        `<path d="M-8 0 A8 8 0 0 1 8 0" fill="none" stroke="${CREAM}" stroke-width="2.5" opacity=".9"/>` +
        `</g>`,
    );
  }
  return out.join('');
}

/** The emblem of token `id` (512 × 512 SVG). */
export function emblemSvg(id: number): string {
  const t = emblemTraits(id);
  const label = `No. ${id}`;
  const labelW = 40 + label.length * 15;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Elymum ${label}">`,
    `<rect width="512" height="512" fill="${NIGHT}"/>`,
    // a faint star field and the ring's horizon arc
    `<g fill="${CREAM}" opacity=".35"><circle cx="58" cy="64" r="2"/><circle cx="452" cy="88" r="2.5"/><circle cx="420" cy="440" r="1.8"/><circle cx="84" cy="420" r="2.2"/><circle cx="470" cy="270" r="1.6"/></g>`,
    `<path d="M-40 520 A420 420 0 0 1 552 520" fill="none" stroke="${EMBLEM_PAINTS.cyan[0]}" stroke-width="2" opacity=".35"/>`,
    seigaihaRing(256, 236, 188, t.ring),
    `<circle cx="256" cy="236" r="164" fill="${NIGHT}" stroke="${INK}" stroke-width="${W}"/>`,
    `<circle cx="256" cy="236" r="152" fill="none" stroke="${EMBLEM_PAINTS[t.ring][0]}" stroke-width="2" stroke-dasharray="2 9" stroke-linecap="round"/>`,
    `<g transform="translate(256 232) scale(2.45)">${coin(t, `clip-${id}`)}</g>`,
    `<g transform="translate(${256 - labelW / 2} 446)">`,
    `<rect x="3" y="4" width="${labelW}" height="44" rx="12" fill="${INK}"/>`,
    `<rect width="${labelW}" height="44" rx="12" fill="${CREAM}" stroke="${INK}" stroke-width="${W}"/>`,
    `<text x="${labelW / 2}" y="29" text-anchor="middle" font-family="'Geist Mono', ui-monospace, Menlo, monospace" font-size="20" font-weight="600" letter-spacing="1.6" fill="${INK}">${label}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

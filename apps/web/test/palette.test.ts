import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARENA_META, CARD_PAPER, ELYSIUM, INK, INK_2, NIGHT, PAPER, RISO, SHADE, TEXT_INKS } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { WORLD_THEMES } from '../src/render/renderer';

// ── colour maths (WCAG 2.x relative luminance, OKLCH chroma) ──

const rgb = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** OKLCH chroma of an sRGB colour. */
const chroma = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(A, B);
};

// ── tokens.css: day, night, and the night copies ──

const strip = (f: string) => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip('../src/design/tokens.css');
const storybook = strip('../src/design/storybook.css');

/** Custom properties declared in the first rule whose selector list starts with `selector`. */
function block(selector: string, src = css, from = 0): Record<string, string> {
  const at = src.indexOf(selector, from);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = src.indexOf('{', at);
  const body = src.slice(open + 1, src.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

const DAY = block(':root,\n.kb');
const NIGHT_RULE = block(":root[data-theme='dark']");
const NIGHT_PRINT = { ...DAY, ...NIGHT_RULE };
const SYSTEM_DARK = block(':root:not([data-theme])', css, css.indexOf('prefers-color-scheme: dark'));
/** A cream sticker (day island) on either page: the island rule overrides the text tokens. */
const ISLAND = block('.kb-island,', storybook);
const DAY_ISLAND = { ...DAY, ...ISLAND };
const NIGHT_ISLAND = { ...NIGHT_PRINT, ...ISLAND };

/** Resolves `var(--x)` chains to a hex colour. */
function token(print: Record<string, string>, name: string): string {
  let v = print[name];
  for (let i = 0; i < 8 && v?.startsWith('var('); i++) v = print[/var\((--[\w-]+)\)/.exec(v)![1]];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a hex colour: ${v}`);
  return v.toUpperCase();
}

/** Text tokens that must read at >= 4.5:1 on the page, the card and the surface (both themes). */
const TEXT = [
  '--ink',
  '--ink-2',
  '--ink-3',
  '--teal-ink',
  '--up-ink',
  '--down-ink',
  '--sun-ink',
  '--cyan-ink',
  // legacy names screens still use
  '--pink-text',
  '--pink-ink',
  '--teal-text',
  '--mustard-text',
  '--mustard-ink',
  '--blue-ink',
  '--green-ink',
  '--red-ink',
];
/** Text on a cream sticker / white field / mint step, in both themes (islands keep day text). */
const ISLAND_TEXT = ['--ink', '--ink-2', '--ink-3', '--teal-ink', '--up-ink', '--down-ink', '--sun-ink', '--cyan-ink', '--pink-text'];
const ISLAND_BG = ['--sticker', '--white', '--linen'];
/** [text, background] pairs on fills (fixed, same in both themes unless the token is themed). */
const ON_FILL: [string, string][] = [
  ['--on-ink', '--ink'],
  ['--on-ink-2', '--ink'],
  // buttons: primary sun, teal, up, danger, secondary cream, disabled sand
  ['--ink-fixed', '--sun'],
  ['--pink-sub', '--sun'],
  ['--cream', '--teal'],
  ['--ink-fixed', '--up'],
  ['--ink-fixed', '--down'],
  ['--ink-fixed', '--sticker'],
  ['--on-sticker-2', '--sticker'],
  ['--stone', '--sand'],
  ['--foam', '--reef'],
  // tags, pills, chips, tape text
  ['--ink-fixed', '--mist'],
  ['--ink-fixed', '--cyan'],
  ['--ink-fixed', '--white'],
  ['--ink-fixed', '--paper-fixed'],
  ['--on-cover', '--danger'],
  // night sections: the sun word in a headline, foam kickers, cream copy
  ['--sun', '--trench'],
  ['--foam', '--trench'],
  ['--cream', '--trench'],
  ['--sun', '--abyss'],
  ['--cream', '--abyss'],
];
const AA = 4.5;

describe.each([
  ['day', DAY],
  ['night', NIGHT_PRINT],
] as const)('%s contrast (WCAG AA, >= 4.5:1)', (_name, print) => {
  it.each(TEXT.flatMap((t) => [[t, '--paper'] as const, [t, '--card'] as const, [t, '--surface'] as const]))('%s on %s', (fg, bg) => {
    expect(contrast(token(print, fg), token(print, bg))).toBeGreaterThanOrEqual(AA);
  });
  it.each(ON_FILL)('%s on %s', (fg, bg) => {
    expect(contrast(token(print, fg), token(print, bg))).toBeGreaterThanOrEqual(AA);
  });
});

describe.each([
  ['day', DAY_ISLAND],
  ['night', NIGHT_ISLAND],
] as const)('cream stickers on the %s page keep day text', (_name, print) => {
  it.each(ISLAND_TEXT.flatMap((t) => ISLAND_BG.map((b) => [t, b] as const)))('%s on %s', (fg, bg) => {
    expect(contrast(token(print, fg), token(print, bg))).toBeGreaterThanOrEqual(AA);
  });
});

describe('tokens.css matches the shared palette', () => {
  it('every paint and its shade', () => {
    const want: Record<string, string> = {
      '--abyss': ELYSIUM.abyss,
      '--deep': ELYSIUM.deep,
      '--trench': ELYSIUM.trench,
      '--reef': ELYSIUM.reef,
      '--current': ELYSIUM.current,
      '--teal': ELYSIUM.teal,
      '--teal-s': SHADE.teal,
      '--cyan': ELYSIUM.cyan,
      '--cyan-s': SHADE.cyan,
      '--spray': ELYSIUM.spray,
      '--foam': ELYSIUM.foam,
      '--foam-s': SHADE.foam,
      '--mist': ELYSIUM.mist,
      '--plain': ELYSIUM.plain,
      '--linen': ELYSIUM.linen,
      '--sand': ELYSIUM.sand,
      '--sand-2': ELYSIUM.sand2,
      '--stone': ELYSIUM.stone,
      '--cream': ELYSIUM.cream,
      '--cream-s': SHADE.cream,
      '--sun': ELYSIUM.sun,
      '--sun-s': SHADE.sun,
      '--up': ELYSIUM.up,
      '--up-s': SHADE.up,
      '--down': ELYSIUM.down,
      '--down-s': SHADE.down,
      '--meadow': ELYSIUM.meadow,
      '--clover': ELYSIUM.clover,
      '--verdant': ELYSIUM.verdant,
      '--forest': ELYSIUM.forest,
      '--pine': ELYSIUM.pine,
      '--blush': ELYSIUM.blush,
      '--coral': ELYSIUM.coral,
      '--outline': INK,
      '--ink-fixed': INK,
      '--paper': PAPER,
      '--card': CARD_PAPER,
      '--sticker': CARD_PAPER,
      '--ink': INK,
    };
    for (const [k, v] of Object.entries(want)) expect([k, token(DAY, k)]).toEqual([k, v]);
  });
  it('legacy riso names alias the nearest paint', () => {
    expect(token(DAY, '--pink')).toBe(ELYSIUM.sun);
    expect(token(DAY, '--mustard')).toBe(RISO.mustard);
    expect(token(DAY, '--teal')).toBe(RISO.teal);
    expect(token(DAY, '--blue')).toBe(RISO.blue);
    expect(token(DAY, '--green')).toBe(RISO.green);
    expect(token(DAY, '--red')).toBe(RISO.red);
    expect(token(DAY, '--aqua')).toBe(RISO.aqua);
    expect(token(DAY, '--orange')).toBe(RISO.orange);
  });
  it('text-safe inks', () => {
    for (const [k, v] of Object.entries(TEXT_INKS.day)) expect([k, token(DAY, `--${k}-ink`)]).toEqual([k, v]);
    for (const [k, v] of Object.entries(TEXT_INKS.night)) expect([k, token(NIGHT_PRINT, `--${k}-ink`)]).toEqual([k, v]);
  });
  it('night', () => {
    const want: Record<string, string> = { '--paper': NIGHT.paper, '--card': NIGHT.card, '--ink': NIGHT.ink, '--ink-2': NIGHT.ink2 };
    for (const [k, v] of Object.entries(want)) expect([k, token(NIGHT_PRINT, k)]).toEqual([k, v]);
    expect(INK_2).toBe(ELYSIUM.stone);
  });
  it('the system-dark copy repeats the night rule exactly', () => {
    expect(SYSTEM_DARK).toEqual(NIGHT_RULE);
  });
});

describe('canvas world labels', () => {
  it.each(['light', 'dark'] as const)('%s: name and mass labels read on the world paper and their halo', (theme) => {
    const w = WORLD_THEMES[theme];
    for (const bg of [w.paper, w.labelHalo]) {
      expect(contrast(w.label, bg)).toBeGreaterThanOrEqual(AA);
      expect(contrast(w.labelSub, bg)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('the paint box', () => {
  it('every paint has exactly one shade, darker than the paint', () => {
    for (const k of Object.keys(ELYSIUM) as (keyof typeof ELYSIUM)[]) {
      expect([k, luminance(SHADE[k]) < luminance(ELYSIUM[k])]).toEqual([k, true]);
    }
  });
  it('the coin and signal paints are saturated (OKLCH chroma >= 0.06; Kinetiq teal is muted on purpose)', () => {
    for (const k of ['teal', 'cyan', 'spray', 'sun', 'up', 'down', 'verdant', 'blush', 'coral'] as const) {
      expect([k, chroma(ELYSIUM[k]) >= 0.06]).toEqual([k, true]);
    }
  });
  it('the four arenas wear Elysian inks (spec §6.3)', () => {
    expect(Object.values(ARENA_META).map((a) => a.ink)).toEqual([ELYSIUM.spray, ELYSIUM.foam, ELYSIUM.sun, ELYSIUM.up]);
  });
});

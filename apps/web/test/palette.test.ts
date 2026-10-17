import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARENA_META, CARD_PAPER, INK, INK_2, NIGHT, PAPER, RISO } from '@slana/shared';
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

// ── tokens.css, both prints ──

const css = readFileSync(join(__dirname, '../src/design/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom properties declared in the first rule whose selector list contains `selector`. */
function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', at);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

const PAPER_PRINT = block(':root,\n.kb');
const NIGHT_PRINT = { ...PAPER_PRINT, ...block(":root[data-theme='dark']") };

/** Resolves `var(--x)` chains to a hex colour. */
function token(print: Record<string, string>, name: string): string {
  let v = print[name];
  for (let i = 0; i < 8 && v?.startsWith('var('); i++) v = print[/var\((--[\w-]+)\)/.exec(v)![1]];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a hex colour: ${v}`);
  return v.toUpperCase();
}

/** Text tokens that must read at >= 4.5:1 on both --paper and --card. */
const TEXT = ['--ink', '--ink-2', '--pink-text', '--pink-ink', '--teal-ink', '--mustard-text', '--mustard-ink', '--blue-ink', '--green-ink', '--red-ink'];
/** [text, background] pairs on fills. */
const ON_FILL: [string, string][] = [
  ['--on-ink', '--ink'],
  ['--on-ink-2', '--ink'],
  ['--ink-fixed', '--pink'],
  ['--ink-fixed', '--teal'],
  ['--ink-fixed', '--mustard'],
  ['--ink-fixed', '--green'],
  ['--pink-sub', '--pink'],
  ['--on-cover', '--danger'],
  ['--ink-fixed', '--paper-fixed'],
  // slana.io landing: the gold kicker on the ink band (NFT teaser)
  ['--mustard', '--ink-fixed'],
];
const AA = 4.5;

describe.each([
  ['paper', PAPER_PRINT],
  ['night', NIGHT_PRINT],
] as const)('%s print contrast (WCAG AA, >= 4.5:1)', (_name, print) => {
  it.each(TEXT.flatMap((t) => [[t, '--paper'] as const, [t, '--card'] as const]))('%s on %s', (fg, bg) => {
    expect(contrast(token(print, fg), token(print, bg))).toBeGreaterThanOrEqual(AA);
  });
  it.each(ON_FILL)('%s on %s', (fg, bg) => {
    expect(contrast(token(print, fg), token(print, bg))).toBeGreaterThanOrEqual(AA);
  });
});

describe('tokens.css matches the shared palette', () => {
  it('paper print', () => {
    const want: Record<string, string> = {
      '--paper': PAPER,
      '--paper-fixed': PAPER,
      '--card': CARD_PAPER,
      '--on-cover': CARD_PAPER,
      '--ink': INK,
      '--ink-fixed': INK,
      '--ink-2': INK_2,
      '--pink': RISO.fluoPink,
      '--teal': RISO.teal,
      '--mustard': RISO.mustard,
      '--blue': RISO.blue,
      '--green': RISO.green,
      '--red': RISO.red,
      '--orange': RISO.orange,
      '--purple': RISO.purple,
      '--aqua': RISO.aqua,
    };
    for (const [k, v] of Object.entries(want)) expect([k, token(PAPER_PRINT, k)]).toEqual([k, v]);
  });
  it('night print', () => {
    const want: Record<string, string> = { '--paper': NIGHT.paper, '--card': NIGHT.card, '--ink': NIGHT.ink, '--ink-2': NIGHT.ink2, '--on-ink': NIGHT.paper };
    for (const [k, v] of Object.entries(want)) expect([k, token(NIGHT_PRINT, k)]).toEqual([k, v]);
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

describe('vivid riso inks', () => {
  it('every riso ink is a saturated print colour (OKLCH chroma >= 0.11)', () => {
    for (const [name, hex] of Object.entries(RISO)) expect([name, chroma(hex) >= 0.11]).toEqual([name, true]);
  });
  it('the arena tickets print in four distinct riso inks', () => {
    expect(Object.values(ARENA_META).map((a) => a.ink)).toEqual([RISO.red, RISO.teal, RISO.mustard, RISO.blue]);
  });
});

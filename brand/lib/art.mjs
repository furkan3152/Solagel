// Drawing kit for the Elymum brand renders, in the "Ring Storybook" language of
// docs/design/storybook-reference.html and docs/specs/2026-10-29-elymum-on-elysium.md (section 6):
// ink outlines (#04181C), flat cel fills with one shade tone, hard offset shadows (no blur), cream
// die-cut stickers, Fraunces (display, SOFT 100), DM Sans (reading), Geist Mono (numbers, kickers).
// Everything is inline: fonts come from the web app's @fontsource-variable packages as data URIs
// (Google Fonts as a fallback when they are not installed).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The palette (mirrors packages/shared/src/palette.ts and the spec's token table). */
export const C = {
  ink: '#04181C',
  deep: '#071317',
  trench: '#0F2A30',
  reef: '#163B44',
  current: '#1E4D5A',
  teal: '#2D7388',
  tealS: '#1F5566',
  cyan: '#34B7DD',
  cyanS: '#2490B0',
  spray: '#6FCDE8',
  foam: '#93D9EE',
  foamS: '#69B4CC',
  mist: '#DBF2F9',
  plain: '#F8F7F4',
  linen: '#F1EFE8',
  sand: '#EBE6DD',
  sand2: '#DDD6C7',
  cream: '#F6EEDA',
  creamS: '#DCCDA8',
  stone: '#6B655A',
  sun: '#F2C14E',
  sunS: '#D49A2B',
  up: '#3C9A87',
  upS: '#2B7465',
  down: '#FF5252',
  blush: '#F39B86',
  coral: '#D9714F',
  meadow: '#B9D98F',
  verdant: '#5FA36A',
  forest: '#3E8A5C',
  pine: '#2F6E4F',
};

/** Coin paints: [fill, shade]. */
export const PAINTS = {
  teal: [C.teal, C.tealS],
  cyan: [C.cyan, C.cyanS],
  foam: [C.foam, C.foamS],
  sun: [C.sun, C.sunS],
  up: [C.up, C.upS],
  cream: [C.cream, C.creamS],
};

/* ------------------------------------------------------------------ fonts */

const FONT_DIR = join(ROOT, 'apps/web/node_modules/@fontsource-variable');
const FONT_SOURCES = [
  // [our family, fontsource css file, style]
  ['Fraunces', 'fraunces/full.css'],
  ['Fraunces', 'fraunces/full-italic.css'],
  ['DM Sans', 'dm-sans/opsz.css'],
  ['DM Sans', 'dm-sans/opsz-italic.css'],
  ['Geist Mono', 'geist-mono/wght.css'],
];

let fontCache = null;
/** @font-face rules (latin subsets, inlined as data URIs). */
export function fontFaces() {
  if (fontCache !== null) return fontCache;
  if (!existsSync(FONT_DIR)) {
    fontCache =
      '@import url("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,100..900,0..100,0..1;1,9..144,100..900,0..100,0..1&family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Geist+Mono:wght@400..600&display=block");';
    return fontCache;
  }
  const rules = [];
  for (const [family, file] of FONT_SOURCES) {
    const path = join(FONT_DIR, file);
    if (!existsSync(path)) continue;
    const css = readFileSync(path, 'utf8');
    for (const m of css.matchAll(/\/\* ([^*]+) \*\/\s*@font-face\s*{([^}]*)}/g)) {
      const [, name, body] = m;
      if (!/-latin-(?!ext)/.test(name)) continue;
      const url = /url\(\.\/files\/([^)]+)\)/.exec(body)?.[1];
      if (!url) continue;
      const data = readFileSync(join(dirname(path), 'files', url)).toString('base64');
      rules.push(
        `@font-face{font-family:'${family}';${body
          .replace(/font-family:[^;]+;/, '')
          .replace(/font-display:[^;]+;/, 'font-display:block;')
          .replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${data}) format('woff2');`)
          .replace(/\s+/g, ' ')}}`,
      );
    }
  }
  fontCache = rules.join('\n');
  return fontCache;
}

/* ------------------------------------------------------------------ base css */

export function baseCss() {
  return `${fontFaces()}
:root{--ink:${C.ink};--cream:${C.cream};--sun:${C.sun};--stone:${C.stone};--trench:${C.trench};
  --display:"Fraunces",Georgia,serif;--body:"DM Sans",system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
body{font-family:var(--body);color:var(--ink);-webkit-font-smoothing:antialiased;font-optical-sizing:auto}
.frame{position:relative;overflow:hidden}
.abs{position:absolute}
.disp{font-family:var(--display);font-variation-settings:"SOFT" 100,"WONK" 0,"opsz" 144;font-weight:800;letter-spacing:-.02em;line-height:.98}
.wonk{font-variation-settings:"SOFT" 100,"WONK" 1,"opsz" 144}
.quote{font-family:var(--display);font-style:italic;font-variation-settings:"SOFT" 100,"WONK" 1;font-weight:500}
.mono,.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.kick{font-family:var(--mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.sticker{background:var(--cream);border:3px solid var(--ink);border-radius:18px;box-shadow:4px 4px 0 var(--ink)}
.btn{display:inline-flex;align-items:center;gap:10px;font-family:var(--body);font-weight:700;font-size:18px;color:var(--ink);
  padding:13px 22px;border:3px solid var(--ink);border-radius:14px;box-shadow:4px 4px 0 var(--ink);background:var(--cream);white-space:nowrap}
.btn.sun{background:var(--sun)} .btn.teal{background:${C.teal};color:var(--cream)}
.tag{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;
  padding:5px 11px;border:2.5px solid var(--ink);border-radius:999px;background:var(--cream);color:var(--ink);white-space:nowrap}
.tag.sun{background:var(--sun)} .tag.ghost{background:transparent;color:${C.foam};border-color:${C.foam}}
.tape{position:absolute;width:104px;height:30px;background:rgba(219,242,249,.88);border:2px solid rgba(4,24,28,.22)}
`;
}

/** A full HTML page of `w` x `h` with `body` inside a `.frame`. */
export function page({ w, h, body, css = '', bg = 'transparent' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${baseCss()}
.frame{width:${w}px;height:${h}px;background:${bg}}
${css}</style></head><body><div class="frame">${body}</div></body></html>`;
}

/* ------------------------------------------------------------------ coin character */

let uid = 0;
/**
 * The coin with a face (port of the reference's `coin()`), as an SVG sized to its box.
 * moods: smile, happy, smug, scared, chomp, sleepy, open. `size` is the rendered width in px:
 * the outline is scaled inversely so it stays ~3px on screen.
 */
export function coin(paint = 'sun', o = {}) {
  const [c, s] = PAINTS[paint] ?? PAINTS.sun;
  const id = `coin${uid++}`;
  const mood = o.mood ?? 'smile';
  const [lx, ly] = o.look ?? [0, 0];
  const feet = o.feet !== false;
  const ink = C.ink;
  const sz = o.size ?? 112;
  const W = Math.min((3 * 112) / sz, 6.2);
  const Wf = Math.min((2.6 * 112) / sz, 5);
  const eye = (x) => {
    if (mood === 'happy') return `<path d="M${x - 8} -4 Q${x} -15 ${x + 8} -4" fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round"/>`;
    if (mood === 'sleepy')
      return `<path d="M${x - 9} -5 Q${x} 3 ${x + 9} -5" fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round"/>`;
    return `<g>
      <ellipse cx="${x}" cy="-6" rx="10" ry="12.5" fill="#fff" stroke="${ink}" stroke-width="${Wf}"/>
      <circle cx="${x + lx}" cy="${-5 + ly}" r="${mood === 'scared' ? 3.6 : 6}" fill="${ink}"/>
      <circle cx="${x + lx - 2.2}" cy="${-8 + ly}" r="2.1" fill="#fff"/>
      ${mood === 'smug' ? `<path d="M${x - 11.5} -6 L${x + 11.5} -6 A11 13 0 0 0 ${x - 11.5} -6Z" fill="${c}" stroke="${ink}" stroke-width="${W}" stroke-linejoin="round"/>` : ''}
    </g>`;
  };
  let brows = '';
  if (mood === 'scared') brows = `<path d="M-24 -24 L-9 -21 M24 -24 L9 -21" stroke="${ink}" stroke-width="${W}" stroke-linecap="round"/>`;
  if (mood === 'smug') brows = `<path d="M-25 -21 Q-16 -25 -7 -21 M7 -22 Q16 -27 25 -23" stroke="${ink}" stroke-width="${W}" fill="none" stroke-linecap="round"/>`;
  const smile = `<path d="M-9 13 Q0 22 9 13" fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round"/>`;
  const open = `<path d="M-11 11 Q0 13 11 11 Q10 27 0 27 Q-10 27 -11 11Z" fill="${ink}" stroke="${ink}" stroke-width="${W}" stroke-linejoin="round"/><path d="M-6 23 Q0 18 6 23 Q3 26 0 26 Q-3 26 -6 23Z" fill="${C.blush}"/>`;
  const chomp = `<path d="M-20 8 Q0 4 20 8 Q20 38 0 38 Q-20 38 -20 8Z" fill="${ink}" stroke="${ink}" stroke-width="${W}" stroke-linejoin="round"/><path d="M-14 9 l4 6 l4 -6 M6 9 l4 6 l4 -6" fill="#fff"/><path d="M-10 32 Q0 25 10 32 Q5 36 0 36 Q-5 36 -10 32Z" fill="${C.blush}"/>`;
  const mouths = {
    smile,
    smug: `<path d="M-6 15 Q4 19 12 11" fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round"/>`,
    happy: open,
    open,
    scared: `<path d="M-8 18 q4 -5 8 0 t8 0" fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round"/>`,
    chomp,
    sleepy: `<ellipse cx="0" cy="16" rx="4" ry="3" fill="${ink}"/>`,
  };
  const cheeks = `<ellipse cx="-27" cy="9" rx="6" ry="3.6" fill="${C.blush}" opacity=".75"/><ellipse cx="27" cy="9" rx="6" ry="3.6" fill="${C.blush}" opacity=".75"/>`;
  const feetSvg = feet
    ? `<g stroke="${ink}" stroke-width="${W}" fill="${s}" stroke-linejoin="round"><path d="M-30 52 Q-30 42 -18 42 Q-6 42 -6 52 Z"/><path d="M6 52 Q6 42 18 42 Q30 42 30 52 Z"/></g>`
    : '';
  const sweat = o.sweat ? `<path d="M38 -30 q6 9 0 13 q-6 -4 0 -13Z" fill="${C.mist}" stroke="${ink}" stroke-width="2.5"/>` : '';
  const zzz =
    mood === 'sleepy' && o.zzz !== false
      ? `<g font-family="Geist Mono, monospace" font-weight="700" fill="${C.ink}"><text x="20" y="-26" font-size="13">z</text><text x="29" y="-35" font-size="10">z</text></g>`
      : '';
  const shadow = o.ground ? `<ellipse cx="0" cy="53" rx="34" ry="5" fill="${ink}" opacity=".18"/>` : '';
  // die-cut sticker: a cream border hugging the coin, an ink edge and a hard shadow down-right
  const R = 46 + (o.diecut ?? 0);
  const diecut = o.diecut ? `<circle cx="3.2" cy="3.2" r="${R}" fill="${ink}"/><circle r="${R}" fill="${C.cream}" stroke="${ink}" stroke-width="${W}"/>` : '';
  const vb = o.diecut ? `${-R - W} ${-R - W} ${2 * (R + W) + 3.2} ${2 * (R + W) + 3.2}` : '-56 -56 112 112';
  return `<svg viewBox="${vb}" width="${sz}" height="${sz}" style="overflow:visible;display:block">
    <defs><clipPath id="${id}"><circle r="46"/></clipPath></defs>
    ${diecut}${shadow}${feetSvg}
    <circle r="46" fill="${s}"/>
    <g clip-path="url(#${id})"><circle cx="-6" cy="-8" r="46" fill="${c}"/></g>
    <circle r="37.5" fill="none" stroke="${s}" stroke-width="2.5" opacity=".9"/>
    <path d="M-36 -10 A37 37 0 0 1 -18 -32" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>
    <circle r="46" fill="none" stroke="${ink}" stroke-width="${W}"/>
    ${cheeks}${brows}${eye(-15)}${eye(15)}${mouths[mood] ?? smile}${sweat}${zzz}
  </svg>`;
}

/* ------------------------------------------------------------------ marks */

/**
 * The ELYMUM wordmark: chunky cyan Fraunces 900 letters, a fat ink edge, a hard offset shadow and a mist
 * shine, each letter a hair off the baseline. `diecut` adds a cream sticker border (for night pages).
 */
export function wordmark({ width = 470, diecut = false, fill = C.cyan } = {}) {
  const letters = 'ELYMUM'.split('');
  // hand-set advance (Fraunces 900 at 96px, tracking -3), with a little bounce on the baseline
  const xs = [10, 74, 134, 198, 290, 360];
  const dy = [0, -2, 1, -1, 2, -1];
  const rot = [-2, 1.5, -1, 0.8, -1.5, 2];
  const t = (stroke, extra) =>
    letters
      .map(
        (l, i) =>
          `<text x="${xs[i]}" y="${92 + dy[i]}" transform="rotate(${rot[i]} ${xs[i] + 30} 60)" ${extra} stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke">${l}</text>`,
      )
      .join('');
  const font = `font-family="Fraunces" font-weight="900" font-size="96" style="font-variation-settings:'SOFT' 100,'WONK' 1,'opsz' 144"`;
  return `<svg viewBox="-8 -4 486 124" width="${width}" style="display:block;overflow:visible" role="img" aria-label="Elymum">
    <g ${font}>
      ${diecut ? `<g transform="translate(6,6)" fill="${C.ink}" stroke="${C.ink}">${t(28, '')}</g><g fill="${C.ink}" stroke="${C.ink}">${t(28, '')}</g><g fill="${C.cream}" stroke="${C.cream}">${t(22, '')}</g>` : ''}
      <g transform="translate(5,5)" fill="${C.ink}" stroke="${C.ink}">${t(6, '')}</g>
      <g fill="${fill}" stroke="${C.ink}">${t(6, '')}</g>
    </g>
    <path d="M24 36 q8 -12 26 -11" stroke="${C.mist}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M300 32 q6 -8 16 -8" stroke="${C.mist}" stroke-width="5" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/** CoinMark: a cyan coin with a fat cream E (the compact mark and the favicon). `px` = rendered size. */
export function coinMark(px = 256, { shadow = true } = {}) {
  const ink = C.ink;
  // stroke stays ~3 px at large sizes and thick enough to read at 32 px
  const W = px >= 128 ? 4 : Math.min(9, (3 * 112) / px + 3.2);
  const E = 'M-16 -27 H16 Q20 -27 20 -23 V-17 Q20 -13 16 -13 H-2 V-7 H13 Q17 -7 17 -3 V3 Q17 7 13 7 H-2 V13 H16 Q20 13 20 17 V23 Q20 27 16 27 H-16 Q-20 27 -20 23 V-23 Q-20 -27 -16 -27Z';
  const vb = shadow ? '-54 -54 112 112' : '-52 -52 104 104';
  return `<svg viewBox="${vb}" width="${px}" height="${px}" style="display:block">
    <defs><clipPath id="cm-clip"><circle r="48"/></clipPath></defs>
    ${shadow ? `<circle cx="4" cy="4" r="48" fill="${ink}"/>` : ''}
    <circle r="48" fill="${C.cyanS}"/>
    <g clip-path="url(#cm-clip)"><circle cx="-6" cy="-8" r="48" fill="${C.cyan}"/></g>
    <path d="M-38 -12 A39 39 0 0 1 -20 -34" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".85"/>
    <circle r="48" fill="none" stroke="${ink}" stroke-width="${W}"/>
    <path d="${E}" transform="translate(3,3)" fill="${ink}" stroke="${ink}" stroke-width="${W}" stroke-linejoin="round"/>
    <path d="${E}" fill="${C.cream}" stroke="${ink}" stroke-width="${W}" stroke-linejoin="round"/>
  </svg>`;
}

/* ------------------------------------------------------------------ motifs */

/** Seigaiha wave scales (rows of nested half circles, drawn back to front), as SVG paths in a w x h box. */
export function seigaiha({ w, h, r = 38, stroke = C.reef, fill = 'none', width = 3, rows = null, y0 = null } = {}) {
  const step = r * 2 + 4;
  const rowH = r * 0.9;
  const n = rows ?? Math.ceil(h / rowH) + 1;
  const start = y0 ?? h - (n - 1) * rowH;
  let s = '';
  for (let row = 0; row < n; row++) {
    const y = start + row * rowH;
    const off = (row % 2) * (step / 2);
    for (let x = -step + off; x < w + step; x += step) {
      s += `<path d="M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y}Z" fill="${fill}" stroke="none"/>`;
      for (const k of [1, 0.68, 0.36]) s += `<path d="M${x - r * k} ${y} A${r * k} ${r * k} 0 0 1 ${x + r * k} ${y}"/>`;
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block"><g fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round">${s}</g></svg>`;
}

/** A chubby outlined cloud (ink silhouette, white puff, mist belly, one highlight), 186 x 80 at scale 1. */
export function cloud(scale = 1, { night = false } = {}) {
  const puff = night ? C.current : '#FFFFFF';
  const belly = night ? C.reef : C.mist;
  const shapes = '<circle cx="40" cy="40" r="28"/><circle cx="80" cy="26" r="36"/><circle cx="124" cy="38" r="30"/><circle cx="154" cy="52" r="20"/><rect x="18" y="44" width="150" height="26" rx="13"/>';
  return `<svg viewBox="-6 -14 192 92" width="${192 * scale}" height="${92 * scale}" style="display:block;overflow:visible">
    <g stroke="${C.ink}" stroke-width="6" fill="${C.ink}">${shapes}</g>
    <g fill="${puff}">${shapes}</g>
    <path d="M18 58 H168 V57 a13 13 0 0 1 -13 13 H31 a13 13 0 0 1 -13 -13z" fill="${belly}"/>
    <path d="M58 22 q10 -14 26 -10" stroke="${C.ink}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".35"/>
  </svg>`;
}

/** A four-point sparkle star. */
export const star = (x, y, s = 1, fill = C.cream) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -7 Q1 -1 7 0 Q1 1 0 7 Q-1 1 -7 0 Q-1 -1 0 -7Z" fill="${fill}"/>`;

/** Scattered stars and dots for a night sky, deterministic. */
export function starfield(w, h, n = 24, seed = 7) {
  let x = seed;
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  let s = '';
  for (let i = 0; i < n; i++) {
    const px = rnd() * w;
    const py = rnd() * h;
    s += i % 4 === 0 ? star(px, py, 0.8 + rnd() * 0.6) : `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(1.4 + rnd()).toFixed(1)}" fill="${C.cream}" opacity=".8"/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block">${s}</svg>`;
}

/** Food bits of the arena floor: pear drop, grape cluster, seed. */
export function food(kind, x, y, color) {
  const ink = C.ink;
  if (kind === 0) return `<path transform="translate(${x} ${y})" d="M0 -9 Q7 2 6 6 Q4 11 0 11 Q-4 11 -6 6 Q-7 2 0 -9Z" fill="${color}" stroke="${ink}" stroke-width="2"/>`;
  if (kind === 1)
    return `<g transform="translate(${x} ${y})" fill="${color}" stroke="${ink}" stroke-width="1.8"><circle cx="-4" cy="-3" r="4"/><circle cx="4" cy="-3" r="4"/><circle cx="0" cy="4" r="4"/></g>`;
  return `<g transform="translate(${x} ${y})"><circle r="9" fill="${color}" opacity=".22"/><circle r="4.2" fill="${color}" stroke="${ink}" stroke-width="2"/></g>`;
}

/** Little props from the ring scene: house, round tree, pine (drawn up from the base point). */
export const props = {
  house: (x, y, s = 1) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12 0 V-16 L0 -27 L12 -16 V0 Z" fill="${C.cream}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/><path d="M-15 -14 L0 -29 L15 -14 L12 -16 L0 -27 L-12 -16Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/><rect x="-4" y="-11" width="8" height="8" rx="1.5" fill="${C.sun}" stroke="${C.ink}" stroke-width="2"/></g>`,
  tree: (x, y, s = 1) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 V-14" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="-24" r="12" fill="${C.forest}" stroke="${C.ink}" stroke-width="2.5"/><path d="M-5 -30 a8 8 0 0 1 8 -3" stroke="#8CC47A" stroke-width="3" fill="none" stroke-linecap="round"/></g>`,
  pine: (x, y, s = 1) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 V-8" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><path d="M0 -40 L11 -8 H-11 Z" fill="${C.pine}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/></g>`,
};

/**
 * Terraces climbing out of the bottom edge of a w x h box (a day footer): three green steps that
 * curve up at both sides like the ring's floor, then the sandy shore. `rise` = how far the sides lift.
 */
export function terraces({ w, h, rise = 70, props: extra = '' }) {
  const layer = (top, fill, line) => {
    const mid = top + rise;
    return `<path d="M-20 ${top} Q ${w / 2} ${mid + rise} ${w + 20} ${top} V ${h + 20} H -20 Z" fill="${fill}" stroke="${C.ink}" stroke-width="3"/>
      <path d="M-20 ${top + 14} Q ${w / 2} ${mid + rise + 14} ${w + 20} ${top + 14}" fill="none" stroke="${line}" stroke-width="8"/>
      <path d="M-20 ${top + 30} Q ${w / 2} ${mid + rise + 30} ${w + 20} ${top + 30}" fill="none" stroke="${line}" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60"/>`;
  };
  const step = (h - 40) / 4;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block;overflow:visible">
    ${layer(0, C.meadow, '#9CC77A')}${layer(step, '#8CC47A', '#74B064')}${layer(step * 2, C.verdant, '#4C8F58')}
    <path d="M-20 ${step * 3} Q ${w / 2} ${step * 3 + rise * 2} ${w + 20} ${step * 3} V ${h + 20} H -20 Z" fill="${C.sand}" stroke="${C.ink}" stroke-width="3"/>
    ${extra}</svg>`;
}

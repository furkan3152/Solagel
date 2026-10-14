/**
 * Tiny vector stroke font for pass numbers: `0-9`, `#`, `N`, `o`, `.` and
 * space. Uses the current `strokeStyle`; no text rendering involved.
 */

type Glyph = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const TAU = Math.PI * 2;

/** Each glyph traces into the current path inside a w×h box at the origin (y down). */
const GLYPHS: Record<string, { adv: number; draw: Glyph }> = {
  '0': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w, h / 2);
      c.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, TAU);
    },
  },
  '1': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.18, h * 0.24);
      c.lineTo(w * 0.56, 0);
      c.lineTo(w * 0.56, h);
      c.moveTo(w * 0.16, h);
      c.lineTo(w * 0.94, h);
    },
  },
  '2': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.02, h * 0.24);
      c.bezierCurveTo(w * 0.1, -h * 0.06, w * 0.98, -h * 0.06, w * 0.96, h * 0.28);
      c.bezierCurveTo(w * 0.94, h * 0.55, w * 0.25, h * 0.7, 0, h);
      c.lineTo(w, h);
    },
  },
  '3': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.04, h * 0.14);
      c.bezierCurveTo(w * 0.2, -h * 0.05, w * 0.95, -h * 0.04, w * 0.9, h * 0.25);
      c.bezierCurveTo(w * 0.86, h * 0.44, w * 0.55, h * 0.47, w * 0.36, h * 0.47);
      c.bezierCurveTo(w * 0.75, h * 0.47, w * 1.02, h * 0.56, w, h * 0.74);
      c.bezierCurveTo(w * 0.98, h * 1.06, w * 0.15, h * 1.06, 0, h * 0.84);
    },
  },
  '4': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.72, h);
      c.lineTo(w * 0.72, 0);
      c.lineTo(0, h * 0.7);
      c.lineTo(w, h * 0.7);
    },
  },
  '5': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.92, 0);
      c.lineTo(w * 0.14, 0);
      c.lineTo(w * 0.06, h * 0.45);
      c.bezierCurveTo(w * 0.5, h * 0.3, w * 1.02, h * 0.42, w, h * 0.7);
      c.bezierCurveTo(w * 0.98, h * 1.06, w * 0.15, h * 1.06, 0, h * 0.86);
    },
  },
  '6': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.86, h * 0.08);
      c.bezierCurveTo(w * 0.5, -h * 0.1, 0, h * 0.1, 0, h * 0.68);
      c.moveTo(w, h * 0.68);
      c.ellipse(w / 2, h * 0.68, w / 2, h * 0.32, 0, 0, TAU);
    },
  },
  '7': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(0, 0);
      c.lineTo(w, 0);
      c.bezierCurveTo(w * 0.6, h * 0.35, w * 0.35, h * 0.65, w * 0.32, h);
    },
  },
  '8': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.9, h * 0.24);
      c.ellipse(w / 2, h * 0.24, w * 0.4, h * 0.24, 0, 0, TAU);
      c.moveTo(w, h * 0.74);
      c.ellipse(w / 2, h * 0.74, w / 2, h * 0.26, 0, 0, TAU);
    },
  },
  '9': {
    adv: 1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.14, h * 0.92);
      c.bezierCurveTo(w * 0.5, h * 1.1, w, h * 0.9, w, h * 0.32);
      c.moveTo(w, h * 0.32);
      c.ellipse(w / 2, h * 0.32, w / 2, h * 0.32, 0, 0, TAU);
    },
  },
  '#': {
    adv: 1.1,
    draw: (c, w, h) => {
      c.moveTo(w * 0.38, 0);
      c.lineTo(w * 0.22, h);
      c.moveTo(w * 0.86, 0);
      c.lineTo(w * 0.7, h);
      c.moveTo(0, h * 0.32);
      c.lineTo(w * 1.08, h * 0.32);
      c.moveTo(-w * 0.06, h * 0.68);
      c.lineTo(w, h * 0.68);
    },
  },
  N: {
    adv: 1.05,
    draw: (c, w, h) => {
      c.moveTo(0, h);
      c.lineTo(0, 0);
      c.lineTo(w, h);
      c.lineTo(w, 0);
    },
  },
  o: {
    adv: 0.9,
    draw: (c, w, h) => {
      c.moveTo(w * 0.9, h * 0.7);
      c.ellipse(w * 0.45, h * 0.7, w * 0.45, h * 0.3, 0, 0, TAU);
    },
  },
  '.': {
    adv: 0.35,
    draw: (c, w, h) => {
      c.moveTo(w * 0.08, h * 0.98);
      c.lineTo(w * 0.1, h * 0.98);
    },
  },
  ' ': { adv: 0.45, draw: () => {} },
};

const ASPECT = 0.56;
const GAP = 0.32;

/** Width of `text` drawn at height h. */
export function measureDigits(text: string, h: number): number {
  const w = h * ASPECT;
  let x = 0;
  for (const ch of text) x += (GLYPHS[ch]?.adv ?? 0.45) * w + w * GAP;
  return Math.max(0, x - w * GAP);
}

/**
 * Draws `text` with its top-left at (x, y) and cap height h, using the
 * current strokeStyle. Returns the drawn width.
 */
export function drawDigits(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number): number {
  const w = h * ASPECT;
  ctx.save();
  ctx.lineWidth = h * 0.15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    const gw = g.adv * w;
    ctx.save();
    ctx.translate(cx, y);
    ctx.beginPath();
    g.draw(ctx, ch === '.' ? w : gw, h);
    ctx.stroke();
    ctx.restore();
    cx += gw + w * GAP;
  }
  ctx.restore();
  return cx - x - w * GAP;
}

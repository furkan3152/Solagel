import { ELYSIUM, INK } from './palette';
import { heartPath, starPath } from './symbols';
import type { EyesKind, MouthKind } from './looks';

const TAU = Math.PI * 2;
const WHITE = ELYSIUM.white;

/**
 * Moods. `happy` is the resting look (the skin's own eyes and mouth); `proud`
 * is joy (^ ^ and an open laugh: growing); `smug` the heavy-lidded smirk of a
 * big coin; `chomp` a hunter's snapping jaw (animated with `time`); `hungry`
 * an open "ooh" at a snack; `scared` small pupils, worried brows and a sweat drop.
 */
export type Expression = 'happy' | 'hungry' | 'scared' | 'sleep' | 'dead' | 'love' | 'proud' | 'smug' | 'chomp';

export interface FaceOpts {
  expression: Expression;
  eyes: EyesKind;
  mouth: MouthKind;
  /** Eye direction, each in -1..1. */
  lookX: number;
  lookY: number;
  time: number;
  seed: number;
  /** Radius on screen in px (level of detail). */
  detail: number;
  /** Cheek colour. */
  blush: string;
  /** Body paint (eyelids are cut from it). Default: cream. */
  body?: string;
  /** Ink line width in local units (≈ 3 screen px). Default: r × 0.065. */
  lineW?: number;
}

/*
 * Geometry follows the Storybook reference coin (docs/design/storybook-reference.html):
 * a 46-unit radius, eyes at (±15, −6) 10 × 12.5, mouth around y 13…27, cheeks
 * at (±27, 9). Everything below is in those units (`u` = r / 46).
 */

const isBlinking = (time: number, seed: number): boolean => time > 0 && (time + seed * 977) % 4600 < 140;

function pen(ctx: CanvasRenderingContext2D, w: number, color: string = INK): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

interface Ctx {
  ctx: CanvasRenderingContext2D;
  u: number;
  /** Ink line width (local units). */
  w: number;
  /** Thinner line for eye whites. */
  wf: number;
  o: FaceOpts;
  /** Pupil offset. */
  lx: number;
  ly: number;
  /** Small on screen: no sparkles, no fine detail. */
  coarse: boolean;
}

/* ───────────────────────────── eyes ───────────────────────────── */

function white(c: Ctx, x: number, y = -6, ry = 12.5): void {
  const { ctx, u } = c;
  ctx.beginPath();
  ctx.ellipse(x * u, y * u, 10 * u, ry * u, 0, 0, TAU);
  ctx.fillStyle = WHITE;
  ctx.fill();
  pen(ctx, c.wf);
  ctx.stroke();
}

function pupil(c: Ctx, x: number, pr = 6, sparkle = true): void {
  const { ctx, u } = c;
  const px = (x + c.lx) * u;
  const py = (-5 + c.ly) * u;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(px, py, pr * u, 0, TAU);
  ctx.fill();
  if (sparkle && !c.coarse) {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(px - 2.2 * u * (pr / 6), py - 3 * u * (pr / 6), Math.max(2.1 * u * (pr / 6), 0), 0, TAU);
    ctx.fill();
  }
}

function roundEye(c: Ctx, x: number, pr = 6): void {
  white(c, x);
  pupil(c, x, pr);
}

/** ^ : a closed happy eye. */
function happyArc(c: Ctx, x: number): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo((x - 8) * u, -4 * u);
  ctx.quadraticCurveTo(x * u, -15 * u, (x + 8) * u, -4 * u);
  ctx.stroke();
}

/** ∪ : a closed eye (blink, sleep). */
function closedArc(c: Ctx, x: number, lash = false): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo((x - 9) * u, -7 * u);
  ctx.quadraticCurveTo(x * u, 2 * u, (x + 9) * u, -7 * u);
  if (lash) {
    const s = Math.sign(x) || 1;
    ctx.moveTo((x + s * 8.5) * u, -6.5 * u);
    ctx.lineTo((x + s * 12) * u, -9.5 * u);
  }
  ctx.stroke();
}

/** A round eye under a heavy lid cut from the body paint (smug, sleepy); `lid` is the lid line's y. */
function liddedEye(c: Ctx, x: number, lid: number): void {
  // the pupil sinks under the lid (the look still slides sideways)
  const ly = c.ly;
  c.ly = Math.max(ly, lid + 8.5);
  roundEye(c, x);
  c.ly = ly;
  const { ctx, u } = c;
  const rx = 11.2;
  const ry = 13.2;
  const t = Math.asin(Math.max(-1, Math.min(1, (lid + 6) / ry)));
  ctx.beginPath();
  ctx.ellipse(x * u, -6 * u, rx * u, ry * u, 0, Math.PI - t, TAU + t, false);
  ctx.closePath();
  ctx.fillStyle = c.o.body ?? ELYSIUM.cream;
  ctx.fill();
  pen(ctx, c.w);
  ctx.stroke();
}

function brows(c: Ctx, kind: 'smug' | 'worried' | 'angry'): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  if (kind === 'smug') {
    ctx.moveTo(-25 * u, -21 * u);
    ctx.quadraticCurveTo(-16 * u, -25 * u, -7 * u, -21 * u);
    ctx.moveTo(7 * u, -22 * u);
    ctx.quadraticCurveTo(16 * u, -27 * u, 25 * u, -23 * u);
  } else if (kind === 'worried') {
    ctx.moveTo(-24 * u, -20 * u);
    ctx.lineTo(-10 * u, -25 * u);
    ctx.moveTo(24 * u, -20 * u);
    ctx.lineTo(10 * u, -25 * u);
  } else {
    ctx.moveTo(-24 * u, -25 * u);
    ctx.lineTo(-9 * u, -20 * u);
    ctx.moveTo(24 * u, -25 * u);
    ctx.lineTo(9 * u, -20 * u);
  }
  ctx.stroke();
}

function starEye(c: Ctx, x: number): void {
  white(c, x);
  const { ctx, u } = c;
  ctx.save();
  ctx.translate((x + c.lx * 0.6) * u, (-5 + c.ly * 0.6) * u);
  starPath(ctx, 8 * u, 3.8 * u, 5, -Math.PI / 2 + Math.sin(c.o.time / 500 + c.o.seed) * 0.12);
  ctx.fillStyle = ELYSIUM.sun;
  ctx.fill();
  pen(ctx, c.wf * 0.85);
  ctx.stroke();
  ctx.restore();
}

function heartEye(c: Ctx, x: number, big: boolean): void {
  const { ctx, u } = c;
  if (!big) white(c, x);
  ctx.save();
  ctx.translate((x + (big ? 0 : c.lx * 0.5)) * u, (big ? -6 : -5 + c.ly * 0.5) * u);
  const pulse = big && c.o.time > 0 ? 1 + Math.sin(c.o.time / 140) * 0.06 : 1;
  heartPath(ctx, (big ? 11 : 7.5) * u * pulse);
  ctx.fillStyle = ELYSIUM.down;
  ctx.fill();
  pen(ctx, c.wf);
  ctx.stroke();
  if (!c.coarse) {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(-3 * u, -2.5 * u, (big ? 2.2 : 1.6) * u, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function dizzyEye(c: Ctx, x: number): void {
  white(c, x);
  const { ctx, u } = c;
  pen(ctx, c.wf);
  const rot = c.o.time / 260;
  const s = Math.sign(x) || 1;
  ctx.beginPath();
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const a = rot * s + t * TAU * 2;
    const rr = 8 * u * t;
    const px = x * u + Math.cos(a) * rr * s;
    const py = -6 * u + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function deadEye(c: Ctx, x: number): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  const d = 6.5 * u;
  ctx.beginPath();
  ctx.moveTo(x * u - d, -6 * u - d);
  ctx.lineTo(x * u + d, -6 * u + d);
  ctx.moveTo(x * u + d, -6 * u - d);
  ctx.lineTo(x * u - d, -6 * u + d);
  ctx.stroke();
}

function sunglasses(c: Ctx): void {
  const { ctx, u } = c;
  const lx = c.lx * 0.4 * u;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const x0 = s * 4 * u + lx;
    const x1 = s * 27 * u + lx;
    ctx.moveTo(x0, -16 * u);
    ctx.lineTo(x1, -16 * u);
    ctx.quadraticCurveTo(x1, 2 * u, s * 15 * u + lx, 2 * u);
    ctx.quadraticCurveTo(x0, 2 * u, x0, -16 * u);
    ctx.closePath();
  }
  ctx.fillStyle = INK;
  ctx.fill();
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo(-5 * u + lx, -14 * u);
  ctx.lineTo(5 * u + lx, -14 * u);
  ctx.stroke();
  if (!c.coarse) {
    pen(ctx, c.wf * 0.9, ELYSIUM.mist);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(s * 15 * u + lx - 6 * u, -8 * u);
      ctx.lineTo(s * 15 * u + lx - 2 * u, -12 * u);
    }
    ctx.stroke();
  }
}

function drawEyes(c: Ctx): void {
  const { o } = c;
  const e = o.expression;
  if (e === 'dead') return (deadEye(c, -15), deadEye(c, 15));
  if (e === 'sleep') return (closedArc(c, -15, true), closedArc(c, 15, true));
  if (e === 'love') return (heartEye(c, -15, true), heartEye(c, 15, true));
  if (e === 'proud') return (happyArc(c, -15), happyArc(c, 15));
  if (e === 'scared') {
    roundEye(c, -15, 3.6);
    roundEye(c, 15, 3.6);
    return brows(c, 'worried');
  }
  if (o.eyes === 'sunglasses') return sunglasses(c);
  const blink = isBlinking(o.time, o.seed);
  if (e === 'smug') {
    if (blink) return (closedArc(c, -15), closedArc(c, 15), brows(c, 'smug'));
    liddedEye(c, -15, -6);
    liddedEye(c, 15, -6);
    return brows(c, 'smug');
  }
  if (blink && o.eyes !== 'star' && o.eyes !== 'heart' && o.eyes !== 'dizzy') {
    closedArc(c, -15);
    if (o.eyes === 'wink') happyArc(c, 15);
    else closedArc(c, 15);
    if (o.eyes === 'determined' || e === 'chomp') brows(c, 'angry');
    return;
  }
  switch (o.eyes) {
    case 'round':
      roundEye(c, -15);
      roundEye(c, 15);
      break;
    case 'sleepy':
      liddedEye(c, -15, -4);
      liddedEye(c, 15, -4);
      break;
    case 'wink':
      roundEye(c, -15);
      happyArc(c, 15);
      break;
    case 'determined':
      roundEye(c, -15);
      roundEye(c, 15);
      brows(c, 'angry');
      break;
    case 'star':
      starEye(c, -15);
      starEye(c, 15);
      break;
    case 'heart':
      heartEye(c, -15, false);
      heartEye(c, 15, false);
      break;
    case 'dizzy':
      dizzyEye(c, -15);
      dizzyEye(c, 15);
      break;
  }
  if (e === 'chomp' && o.eyes !== 'determined') brows(c, 'angry');
}

/* ───────────────────────────── mouths ───────────────────────────── */

function smile(c: Ctx, wide = 1): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo(-9 * wide * u, 13 * u);
  ctx.quadraticCurveTo(0, (13 + 9 * wide) * u, 9 * wide * u, 13 * u);
  ctx.stroke();
}

/** The open laugh: an ink D with a blush tongue. */
function openMouth(c: Ctx, k = 1): void {
  const { ctx, u } = c;
  const w = 11 * k;
  const b = 11 + 16 * k;
  ctx.beginPath();
  ctx.moveTo(-w * u, 11 * u);
  ctx.quadraticCurveTo(0, 13 * u, w * u, 11 * u);
  ctx.quadraticCurveTo((w - 1) * u, b * u, 0, b * u);
  ctx.quadraticCurveTo(-(w - 1) * u, b * u, -w * u, 11 * u);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  pen(ctx, c.w);
  ctx.stroke();
  if (c.coarse) return;
  ctx.beginPath();
  ctx.moveTo(-6 * k * u, (b - 4 * k) * u);
  ctx.quadraticCurveTo(0, (b - 9 * k) * u, 6 * k * u, (b - 4 * k) * u);
  ctx.quadraticCurveTo(3 * k * u, (b - 1 * k) * u, 0, (b - 1 * k) * u);
  ctx.quadraticCurveTo(-3 * k * u, (b - 1 * k) * u, -6 * k * u, (b - 4 * k) * u);
  ctx.fillStyle = ELYSIUM.blush;
  ctx.fill();
}

/** The hunter's jaw: wide, two fangs, a tongue. `open` 0 (shut: a grin line) … 1. */
function chompMouth(c: Ctx, open: number): void {
  const { ctx, u } = c;
  if (open < 0.15) {
    pen(ctx, c.w);
    ctx.beginPath();
    ctx.moveTo(-16 * u, 12 * u);
    ctx.quadraticCurveTo(0, 22 * u, 16 * u, 12 * u);
    ctx.stroke();
    return;
  }
  const b = 8 + 30 * open;
  ctx.beginPath();
  ctx.moveTo(-20 * u, 8 * u);
  ctx.quadraticCurveTo(0, 4 * u, 20 * u, 8 * u);
  ctx.quadraticCurveTo(20 * u, b * u, 0, b * u);
  ctx.quadraticCurveTo(-20 * u, b * u, -20 * u, 8 * u);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  pen(ctx, c.w);
  ctx.stroke();
  if (c.coarse) return;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  for (const x of [-14, 6]) {
    ctx.moveTo(x * u, 8.6 * u);
    ctx.lineTo((x + 4) * u, (8.6 + 6 * Math.min(1, open * 1.4)) * u);
    ctx.lineTo((x + 8) * u, 8.2 * u);
    ctx.closePath();
  }
  ctx.fill();
  const tb = b - 2;
  ctx.beginPath();
  ctx.moveTo(-10 * u, (tb - 4) * u);
  ctx.quadraticCurveTo(0, (tb - 11 * open) * u, 10 * u, (tb - 4) * u);
  ctx.quadraticCurveTo(5 * u, tb * u, 0, tb * u);
  ctx.quadraticCurveTo(-5 * u, tb * u, -10 * u, (tb - 4) * u);
  ctx.fillStyle = ELYSIUM.blush;
  ctx.fill();
}

function smirk(c: Ctx): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo(-6 * u, 15 * u);
  ctx.quadraticCurveTo(4 * u, 19 * u, 12 * u, 11 * u);
  ctx.stroke();
}

function wobble(c: Ctx): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo(-8 * u, 18 * u);
  ctx.quadraticCurveTo(-4 * u, 13 * u, 0, 18 * u);
  ctx.quadraticCurveTo(4 * u, 23 * u, 8 * u, 18 * u);
  ctx.stroke();
}

function oMouth(c: Ctx, s = 1): void {
  const { ctx, u } = c;
  ctx.beginPath();
  ctx.ellipse(0, 17 * u, 4.5 * s * u, 5.5 * s * u, 0, 0, TAU);
  ctx.fillStyle = INK;
  ctx.fill();
}

function catMouth(c: Ctx): void {
  const { ctx, u } = c;
  pen(ctx, c.w);
  ctx.beginPath();
  ctx.moveTo(-10 * u, 13 * u);
  ctx.quadraticCurveTo(-5 * u, 20 * u, 0, 14 * u);
  ctx.quadraticCurveTo(5 * u, 20 * u, 10 * u, 13 * u);
  ctx.stroke();
}

function tongue(c: Ctx): void {
  smile(c);
  if (c.coarse) return;
  const { ctx, u } = c;
  ctx.beginPath();
  ctx.moveTo(-0.5 * u, 17 * u);
  ctx.lineTo(-0.5 * u, 21 * u);
  ctx.arc(3.5 * u, 21 * u, 4 * u, Math.PI, 0, true);
  ctx.lineTo(7.5 * u, 16 * u);
  ctx.closePath();
  ctx.fillStyle = ELYSIUM.blush;
  ctx.fill();
  pen(ctx, c.wf * 0.9);
  ctx.stroke();
}

function fang(c: Ctx): void {
  smile(c, 1.15);
  if (c.coarse) return;
  const { ctx, u } = c;
  ctx.beginPath();
  ctx.moveTo(2 * u, 20.6 * u);
  ctx.lineTo(8 * u, 19.2 * u);
  ctx.lineTo(5.6 * u, 25 * u);
  ctx.closePath();
  ctx.fillStyle = WHITE;
  ctx.fill();
  pen(ctx, c.wf * 0.8);
  ctx.stroke();
}

function sweat(c: Ctx): void {
  const { ctx, u } = c;
  ctx.save();
  ctx.translate(36 * u, (-27 + (c.o.time > 0 ? Math.sin(c.o.time / 200) : 0)) * u);
  ctx.beginPath();
  ctx.moveTo(0, -8 * u);
  ctx.quadraticCurveTo(6 * u, 1 * u, 0, 5 * u);
  ctx.quadraticCurveTo(-6 * u, 1 * u, 0, -8 * u);
  ctx.closePath();
  ctx.fillStyle = ELYSIUM.mist;
  ctx.fill();
  pen(ctx, c.wf);
  ctx.stroke();
  ctx.restore();
}

/** Chomp jaw opening for a time (snaps open and shut ~3.5 times a second; open on a still frame). */
export function chompOpen(time: number, seed: number): number {
  if (time <= 0) return 1;
  const p = ((time + seed * 977) % 290) / 290;
  return p < 0.55 ? Math.sin((p / 0.55) * Math.PI) : 0;
}

function drawMouth(c: Ctx): void {
  const { o } = c;
  switch (o.expression) {
    case 'scared':
      wobble(c);
      if (!c.coarse) sweat(c);
      return;
    case 'dead':
      return wobble(c);
    case 'sleep':
      return oMouth(c, 0.6);
    case 'hungry':
      return openMouth(c, 0.85);
    case 'chomp':
      return chompMouth(c, chompOpen(o.time, o.seed));
    case 'proud':
      return openMouth(c, 1);
    case 'smug':
      return smirk(c);
    case 'love':
      return smile(c, 1.1);
    default:
      break;
  }
  switch (o.mouth) {
    case 'smile':
      return smile(c);
    case 'grin':
      return openMouth(c, 0.9);
    case 'o':
      return oMouth(c);
    case 'tongue':
      return tongue(c);
    case 'cat':
      return catMouth(c);
    case 'fang':
      return fang(c);
  }
}

function cheeks(c: Ctx): void {
  const { ctx, u } = c;
  ctx.save();
  ctx.globalAlpha *= 0.75;
  ctx.fillStyle = c.o.blush;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * 27 * u + 6 * u, 9 * u);
    ctx.ellipse(s * 27 * u, 9 * u, 6 * u, 3.6 * u, 0, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

/** Tiny on screen: two ink dots (or nothing below ~8 px). */
function dotEyes(ctx: CanvasRenderingContext2D, u: number, o: FaceOpts): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const x = (s * 15 + o.lookX * 3) * u;
    const y = (-5 + o.lookY * 2) * u;
    ctx.moveTo(x + 6.5 * u, y);
    ctx.arc(x, y, 6.5 * u, 0, TAU);
  }
  ctx.fill();
}

/** Draws a coin character's face centred on (0,0) for radius r (Storybook style). */
export function drawFace(ctx: CanvasRenderingContext2D, r: number, o: FaceOpts): void {
  const u = r / 46;
  ctx.save();
  if (o.detail < 14) {
    dotEyes(ctx, u, o);
    ctx.restore();
    return;
  }
  const w = Math.min(o.lineW ?? r * 0.065, r * 0.11);
  const c: Ctx = {
    ctx,
    u,
    w,
    wf: w * 0.87,
    o,
    lx: Math.max(-1, Math.min(1, o.lookX)) * 4,
    ly: Math.max(-1, Math.min(1, o.lookY)) * 3,
    coarse: o.detail < 22,
  };
  if (o.eyes !== 'sunglasses' || o.expression === 'scared') cheeks(c);
  drawEyes(c);
  drawMouth(c);
  ctx.restore();
}

import { CARD_PAPER, ELYSIUM, INK, TEXT_INKS } from '@elymum/art';

const MONO_FONT = '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';

/** Font sizes are rasterised in ~10 % steps of device pixels, then drawn scaled. */
const STEP = 1.1;
const MAX_ENTRIES = 600;
const MAX_BYTES = 24 * 1024 * 1024;

interface TextSprite {
  canvas: HTMLCanvasElement;
  /** Text advance in sprite px (the sprite is a little wider). */
  tw: number;
  /** Sprite size, px. */
  w: number;
  h: number;
  /** Bucket font size in device px. */
  px: number;
  bytes: number;
}

export interface StickerLabel {
  name: string | null;
  /** Value (mass) printed after the name in teal, or null. */
  value: string | null;
  verified: boolean;
  /** A server bot: a small ink "BOT" chip after the name. */
  bot?: boolean;
  /** An Elymum emblem holder: a small laurel before the name. */
  holder?: boolean;
  /** My coin: a sun sticker instead of cream. */
  mine: boolean;
  /** Sticker centre, world units. */
  x: number;
  y: number;
  /** Font size, world units. */
  fs: number;
  /** Device px per world unit (zoom × dpr): picks the raster size. */
  devicePx: number;
  /** CSS px per world unit (zoom): ink edges stay 2.5 px on screen. */
  zoom: number;
  alpha?: number;
}

/**
 * Name tags as small mono stickers (spec §6.5 tags): cream stock (sun for
 * me), a 2.5 px ink edge, a 2 px hard ink shadow, the name in ink and the
 * value in teal. The texts are rendered once per (text, colour, size bucket)
 * into small canvases and drawn as images; the sticker itself is two rounded
 * rects. LRU by insertion order with entry and byte caps.
 */
export class LabelCache {
  private readonly map = new Map<string, TextSprite>();
  private bytes = 0;

  constructor() {
    // sprites rasterised before the web fonts arrived would keep the fallback face: start over
    if (typeof document !== 'undefined' && document.fonts) {
      const reset = () => this.clear();
      void document.fonts.ready.then(reset);
      document.fonts.addEventListener?.('loadingdone', reset);
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.map.size;
  }

  private text(text: string, color: string, want: number): TextSprite {
    const bucket = Math.round(Math.log(want) / Math.log(STEP));
    const key = `${color}|${bucket}|${text}`;
    let s = this.map.get(key);
    if (s) {
      // refresh LRU position
      this.map.delete(key);
      this.map.set(key, s);
      return s;
    }
    s = renderText(text, color, STEP ** bucket);
    this.map.set(key, s);
    this.bytes += s.bytes;
    for (const [k, old] of this.map) {
      if (this.map.size <= MAX_ENTRIES && this.bytes <= MAX_BYTES) break;
      this.map.delete(k);
      this.bytes -= old.bytes;
    }
    return s;
  }

  /** Draws a name/value sticker centred at (x, y) in the current (world) transform. */
  drawSticker(ctx: CanvasRenderingContext2D, o: StickerLabel): void {
    const want = o.fs * o.devicePx;
    if (want < 4 || (!o.name && !o.value)) return;
    const fs = o.fs;
    const k = (sp: TextSprite) => fs / sp.px; // world units per sprite px
    const name = o.name ? this.text(o.name, INK, want) : null;
    const value = o.value ? this.text(o.value, o.mine ? INK : TEXT_INKS.day.teal, want) : null;
    const tick = o.name && o.verified ? fs * 0.95 : 0;
    // the BOT chip: paper letters on an ink pill, a size smaller than the name (one cached sprite)
    const bot = o.name && o.bot ? this.text('BOT', CARD_PAPER, want * 0.72) : null;
    const botPad = fs * 0.28;
    const botS = bot ? (fs * 0.72) / bot.px : 0; // world units per BOT sprite px
    const botW = bot ? bot.tw * botS : 0;
    const botBox = bot ? botW + botPad * 2 : 0;
    const botGap = bot ? fs * 0.4 : 0;
    const gap = name && value ? fs * 0.62 : 0;
    const laurel = o.name && o.holder ? fs * 1.15 : 0;
    const textW = laurel + (name ? name.tw * k(name) : 0) + tick + botGap + botBox + gap + (value ? value.tw * k(value) : 0);
    const padX = fs * 0.62;
    const w = textW + padX * 2;
    const h = fs * 1.78;
    const x0 = o.x - w / 2;
    const y0 = o.y - h / 2;
    const edge = 2.5 / o.zoom;
    const sh = 2 / o.zoom;
    const rr = Math.min(7 / o.zoom, h * 0.34);
    const prev = ctx.globalAlpha;
    if (o.alpha !== undefined) ctx.globalAlpha = prev * o.alpha;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(x0 + sh, y0 + sh, w, h, rr);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, rr);
    ctx.fillStyle = o.mine ? ELYSIUM.sun : CARD_PAPER;
    ctx.fill();
    ctx.lineWidth = edge;
    ctx.strokeStyle = INK;
    ctx.stroke();
    let x = x0 + padX;
    if (laurel) {
      drawLaurel(ctx, x + fs * 0.45, o.y, fs * 0.5, edge * 0.5);
      x += laurel;
    }
    if (name) {
      const s = k(name);
      ctx.drawImage(name.canvas, x, o.y - (name.h / 2) * s, name.w * s, name.h * s);
      x += name.tw * s;
    }
    if (tick) {
      const cx = x + tick * 0.55;
      const r = fs * 0.36;
      ctx.beginPath();
      ctx.arc(cx, o.y, r, 0, Math.PI * 2);
      ctx.fillStyle = ELYSIUM.teal;
      ctx.fill();
      ctx.lineWidth = edge * 0.7;
      ctx.stroke();
      ctx.strokeStyle = CARD_PAPER;
      ctx.lineWidth = fs * 0.12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42, o.y);
      ctx.lineTo(cx - r * 0.1, o.y + r * 0.32);
      ctx.lineTo(cx + r * 0.45, o.y - r * 0.36);
      ctx.stroke();
      x += tick;
    }
    if (bot) {
      x += botGap;
      const bh = fs * 1.02;
      ctx.beginPath();
      ctx.roundRect(x, o.y - bh / 2, botBox, bh, Math.min(4 / o.zoom, bh * 0.3));
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.drawImage(bot.canvas, x + botPad, o.y - (bot.h / 2) * botS, bot.w * botS, bot.h * botS);
      x += botBox;
    }
    if (value) {
      x += gap;
      const s = k(value);
      ctx.drawImage(value.canvas, x, o.y - (value.h / 2) * s, value.w * s, value.h * s);
    }
    ctx.globalAlpha = prev;
  }
}

/** A laurel sprig (two leafy arcs) centred at (cx, cy), half-height h: the emblem holder's mark. */
function drawLaurel(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, lw: number): void {
  ctx.save();
  ctx.fillStyle = TEXT_INKS.day.teal;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = (-0.9 + i * 0.75) * side;
      const lx = cx + side * h * 0.55 * Math.cos(i * 0.6);
      const ly = cy + h * (0.55 - i * 0.55);
      ctx.beginPath();
      ctx.ellipse(lx, ly, h * 0.22, h * 0.42, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

let measureCtx: CanvasRenderingContext2D | null = null;

function renderText(text: string, color: string, px: number): TextSprite {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  const font = `600 ${px}px ${MONO_FONT}`;
  measureCtx.font = font;
  const tw = measureCtx.measureText(text).width;
  const w = Math.max(1, Math.ceil(tw + px * 0.2));
  const h = Math.max(1, Math.ceil(px * 1.5));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, h / 2 + px * 0.04);
  return { canvas, tw, w, h, px, bytes: w * h * 4 };
}

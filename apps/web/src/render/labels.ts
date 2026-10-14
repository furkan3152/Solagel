import { CARD_PAPER, INK, RISO } from '@slana/art';

const DISPLAY_FONT = '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif';
const MONO_FONT = '"DM Mono", ui-monospace, monospace';

/** Font sizes are rasterised in ~10 % steps of device pixels, then drawn scaled. */
const STEP = 1.1;
const MAX_ENTRIES = 600;
const MAX_BYTES = 24 * 1024 * 1024;

export type LabelKind = 'name' | 'mass';

interface LabelSprite {
  canvas: HTMLCanvasElement;
  /** Device px per sprite px is 1 at the bucket size; these are in bucket px. */
  w: number;
  h: number;
  /** Anchor: the text's horizontal centre / vertical middle inside the sprite. */
  ax: number;
  ay: number;
  /** Bucket font size in device px. */
  px: number;
  bytes: number;
}

/**
 * Cell name / mass labels rendered once per (text, kind, size bucket) into a
 * small canvas (ink with a card halo, the verified tick baked in) and drawn as
 * images afterwards: no per-frame strokeText / fillText. LRU by insertion
 * order with entry and byte caps.
 */
export class LabelCache {
  private readonly map = new Map<string, LabelSprite>();
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

  /**
   * Draws a label centred at (x, y) in the current (world) transform. `fs` is
   * the font size in world units, `devicePx` the device pixels per world unit.
   */
  draw(ctx: CanvasRenderingContext2D, kind: LabelKind, text: string, verified: boolean, x: number, y: number, fs: number, devicePx: number, alpha = 1): void {
    const want = fs * devicePx;
    if (want < 3) return;
    const bucket = Math.round(Math.log(want) / Math.log(STEP));
    const key = `${kind}|${verified ? 1 : 0}|${bucket}|${text}`;
    let s = this.map.get(key);
    if (s) {
      // refresh LRU position
      this.map.delete(key);
      this.map.set(key, s);
    } else {
      s = render(kind, text, verified, STEP ** bucket);
      this.map.set(key, s);
      this.bytes += s.bytes;
      this.evict();
    }
    const k = fs / s.px; // world units per sprite px
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    ctx.drawImage(s.canvas, x - s.ax * k, y - s.ay * k, s.w * k, s.h * k);
    if (alpha !== 1) ctx.globalAlpha = prev;
  }

  private evict(): void {
    for (const [key, s] of this.map) {
      if (this.map.size <= MAX_ENTRIES && this.bytes <= MAX_BYTES) break;
      this.map.delete(key);
      this.bytes -= s.bytes;
    }
  }

  get size(): number {
    return this.map.size;
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;

function render(kind: LabelKind, text: string, verified: boolean, px: number): LabelSprite {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  const font = kind === 'name' ? `800 ${px}px ${DISPLAY_FONT}` : `500 ${px}px ${MONO_FONT}`;
  measureCtx.font = font;
  const tw = measureCtx.measureText(text).width;
  const halo = px * (kind === 'name' ? 0.26 : 0.28);
  const badge = kind === 'name' && verified ? px * 0.5 + px * 0.33 * 2 : 0;
  const pad = Math.ceil(halo / 2 + 2);
  const w = Math.ceil(tw + badge * 2 + pad * 2);
  const h = Math.ceil(px * 1.3 + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d')!;
  const cx = w / 2;
  const cy = h / 2;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = halo;
  ctx.strokeStyle = CARD_PAPER;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = INK;
  if (kind === 'mass') ctx.globalAlpha = 0.85;
  ctx.fillText(text, cx, cy);
  ctx.globalAlpha = 1;
  if (badge) {
    const bx = cx + tw / 2 + px * 0.5;
    ctx.fillStyle = RISO.teal;
    ctx.strokeStyle = INK;
    ctx.lineWidth = px * 0.08;
    ctx.beginPath();
    ctx.arc(bx, cy, px * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = CARD_PAPER;
    ctx.lineWidth = px * 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - px * 0.14, cy);
    ctx.lineTo(bx - px * 0.03, cy + px * 0.11);
    ctx.lineTo(bx + px * 0.16, cy - px * 0.12);
    ctx.stroke();
  }
  return { canvas, w, h, ax: cx, ay: cy, px, bytes: canvas.width * canvas.height * 4 };
}

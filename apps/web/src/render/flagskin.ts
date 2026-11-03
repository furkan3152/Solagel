import { INK, shadeOf, type CoinLook } from '@elymum/art';
import { FLAG_H, FLAG_W, flagArt, paintFlag, type FlagOp } from './flags';

/**
 * The flag skin: a coin painted with its player's country flag, like a classic agar.io cell named
 * after a country. The flag fills the whole body (cut to the circle, the emblem centred) with the
 * coin's shade crescent, groove and highlight laid over it, and a soft light behind the face so the
 * eyes and mouth read on any flag; the coin still draws its ink outline, face and accessories on top
 * (`CoinState.skinFill`). Countries without a drawn flag wear their flag's colours when they are
 * known (a body in the main colour with a ring in the next ones), else the normal coin.
 */

const TAU = Math.PI * 2;

/**
 * Where the coin's window sits on the flag (the x of its centre on the 30 × 20 field; the window is
 * the 20 × 20 square the coin's circle is cut from). 15, the middle, unless the emblem sits towards
 * the hoist: Turkey's crescent and star, a canton, a hoist triangle with its star.
 */
const FOCUS: Readonly<Record<string, number>> = {
  US: 10, TR: 13, CL: 10, CU: 10, PR: 10, CZ: 12, PH: 10, MY: 10, SG: 10, UY: 10, GR: 10, PK: 17, BD: 13.5, TW: 10, CN: 10,
  PT: 12, SK: 11, RS: 12, SI: 10, ES: 11, SE: 12, NO: 12, DK: 12, FI: 12, IS: 12, FO: 12, AX: 12, QA: 12, AE: 11, AU: 12,
  NZ: 12, BY: 12, MZ: 11, SS: 11, JO: 11, KW: 11, SD: 11, ZW: 11, TL: 11, DJ: 11, KM: 11, GQ: 12, BS: 11, LR: 10, TG: 10,
  KP: 12, UZ: 10, TM: 12, MN: 10, OM: 12, BH: 12, CV: 12, WS: 10, TO: 10, FJ: 12, GL: 12, PW: 13, ZA: 12, GY: 13, ER: 12,
  LK: 14, CD: 13, GW: 12, MG: 12, BJ: 13, AG: 15, LS: 15, SR: 15,
};

/** Side of the coin's window on the flag (field units): the field's height. */
const WINDOW = FLAG_H;

/** The x of the window's left edge on the field for a country. */
function windowX(code: string): number {
  const c = FOCUS[code] ?? FLAG_W / 2;
  return Math.max(0, Math.min(FLAG_W - WINDOW, c - WINDOW / 2));
}

/**
 * The main colours of flags that are not drawn (yet): the body, then the ring (and a thin inner
 * ring). Mostly territories and small states; the rest wear the normal coin.
 */
const COLOURS: Readonly<Record<string, readonly string[]>> = {
  NP: ['#DC143C', '#003893'],
  GD: ['#CE1126', '#FCD116', '#007A5E'],
  KN: ['#009E49', '#CE1126', '#FCD116'],
  DM: ['#006B3F', '#FCD116', '#D41C30'],
  SZ: ['#3E5EB9', '#FFD900', '#B10C0C'],
  VU: ['#009543', '#D21034', '#FDCE12'],
  KI: ['#CE1126', '#003F87', '#FCD116'],
  MH: ['#003893', '#DD7500', '#FFFFFF'],
  GI: ['#DA000C', '#FFFFFF'],
  IM: ['#CF101A', '#FFFFFF'],
  JE: ['#FFFFFF', '#E8112D'],
  GG: ['#FFFFFF', '#E8112D', '#F9DD16'],
  AW: ['#418FDE', '#FFD100', '#EF3340'],
  CW: ['#002B7F', '#F9E814'],
  BQ: ['#012A87', '#F9D90F'],
  SX: ['#ED2939', '#002395', '#FFFFFF'],
  BM: ['#CF142B', '#012169'],
  KY: ['#012169', '#C8102E'],
  VG: ['#012169', '#C8102E'],
  TC: ['#012169', '#C8102E'],
  AI: ['#012169', '#C8102E'],
  MS: ['#012169', '#C8102E'],
  FK: ['#012169', '#C8102E'],
  SH: ['#012169', '#C8102E'],
  PN: ['#012169', '#C8102E'],
  GS: ['#012169', '#C8102E'],
  IO: ['#012169', '#FFFFFF'],
  CK: ['#012169', '#FFFFFF'],
  VI: ['#FFFFFF', '#F4C53D', '#162E73'],
  GU: ['#00297B', '#C62139'],
  AS: ['#002B7F', '#C8102E', '#FFFFFF'],
  MP: ['#0071BC', '#FFFFFF'],
  PF: ['#CE1126', '#FFFFFF'],
  NC: ['#0035AD', '#D21034', '#009543'],
  TF: ['#002395', '#FFFFFF'],
  NU: ['#FEDD00', '#012169'],
  CX: ['#0021AD', '#1C8A42', '#FFC639'],
  CC: ['#008000', '#FFE000'],
  NF: ['#007835', '#FFFFFF'],
  TK: ['#00247D', '#FED100'],
};

/** What a country's flag skin looks like: its drawn flag, its colours, or nothing (the normal coin). */
export type FlagSkinKind = 'flag' | 'colours' | null;

export function flagSkinKind(code: string | null | undefined): FlagSkinKind {
  if (!code) return null;
  if (flagArt(code)) return 'flag';
  return COLOURS[code] ? 'colours' : null;
}

/** Colours of a colours-only country (body first), or null. */
export function flagColours(code: string): readonly string[] | null {
  return COLOURS[code] ?? null;
}

/* ------------------------------------------------------------------ */
/* The main colour (the body paint under a flag: tiny coins, a wobble) */
/* ------------------------------------------------------------------ */

/** Whether the point (x, y) of the field is painted by `op` (shapes as `paintFlag` draws them). */
function covers(op: FlagOp, x: number, y: number): string | null {
  const n = op as readonly number[];
  switch (op[0]) {
    case 'h':
    case 'v': {
      const k = op.length - 1;
      const i = Math.min(k - 1, Math.floor(op[0] === 'h' ? (y / FLAG_H) * k : (x / FLAG_W) * k));
      return op[i + 1] as string;
    }
    case 'r':
      return x >= n[1] && x < n[1] + n[3] && y >= n[2] && y < n[2] + n[4] ? (op[5] as string) : null;
    case 'c':
      return (x - n[1]) ** 2 + (y - n[2]) ** 2 <= n[3] ** 2 ? (op[4] as string) : null;
    case 's':
      // a star covers about the disc of 0.6 its radius
      return (x - n[1]) ** 2 + (y - n[2]) ** 2 <= (n[3] * 0.6) ** 2 ? (op[4] as string) : null;
    case 'a': {
      if ((x - n[1]) ** 2 + (y - n[2]) ** 2 > n[3] ** 2) return null;
      let a = Math.atan2(y - n[2], x - n[1]);
      if (a < n[4]) a += TAU;
      return a >= n[4] && a <= n[5] ? (op[6] as string) : null;
    }
    case 'p': {
      let inside = false;
      for (let i = 2, j = op.length - 2; i + 1 < op.length; j = i, i += 2) {
        const xi = n[i];
        const yi = n[i + 1];
        const xj = n[j];
        const yj = n[j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? (op[1] as string) : null;
    }
    case 'l': {
      const [x1, y1, x2, y2] = [n[3], n[4], n[5], n[6]];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= (n[2] / 2) ** 2 ? (op[1] as string) : null;
    }
    default:
      return null;
  }
}

const MAIN = new Map<string, string | null>();

/**
 * The colour that covers most of the coin's circle on a country's flag skin (sampled on a grid; the
 * last shape over a point wins, as when painted), or the first of its colours, or null.
 */
export function flagMainColour(code: string): string | null {
  const known = MAIN.get(code);
  if (known !== undefined) return known;
  let main: string | null = COLOURS[code]?.[0] ?? null;
  const art = flagArt(code);
  if (art) {
    const x0 = windowX(code);
    const votes = new Map<string, number>();
    const STEPS = 24;
    for (let j = 0; j < STEPS; j++) {
      for (let i = 0; i < STEPS; i++) {
        const u = (i + 0.5) / STEPS - 0.5;
        const v = (j + 0.5) / STEPS - 0.5;
        if (u * u + v * v > 0.25) continue;
        const x = x0 + (i + 0.5) * (WINDOW / STEPS);
        const y = (j + 0.5) * (WINDOW / STEPS);
        let c: string | null = null;
        for (const op of art) c = covers(op, x, y) ?? c;
        if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
      }
    }
    let best = 0;
    for (const [c, k] of votes) {
      if (k > best) {
        best = k;
        main = c;
      }
    }
  }
  MAIN.set(code, main);
  return main;
}

/* ------------------------------------------------------------------ */
/* The coin face (a cached disc per country and size)                  */
/* ------------------------------------------------------------------ */

/** Disc sizes (device px across) a skin is pre-rendered at; a coin uses the smallest one at least its size. */
export const FLAG_SKIN_BUCKETS = [16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512] as const;
/** Bytes of bitmaps kept; past it the cache starts over (a few countries in view at a few zooms). */
const MAX_BYTES = 40 * 1024 * 1024;

/** The smallest bucket index whose size covers `px` (the largest one past it). No allocation. */
export function flagSkinBucket(px: number): number {
  for (let i = 0; i < FLAG_SKIN_BUCKETS.length; i++) if (FLAG_SKIN_BUCKETS[i] >= px) return i;
  return FLAG_SKIN_BUCKETS.length - 1;
}

/** Lit disc offset of the coin's shade crescent (units of r), as in the art package. */
const LIT_DX = -6 / 46;
const LIT_DY = -8 / 46;
/** Highlight arc on the upper left (the coin's own). */
const HL_A0 = (195.5 * Math.PI) / 180;
const HL_A1 = (241 * Math.PI) / 180;

/** Paints the flag skin of `code` as a disc filling a `size` px square (null: nothing to paint). */
export function paintFlagSkin(ctx: CanvasRenderingContext2D, code: string, size: number): boolean {
  const art = flagArt(code);
  const colours = art ? null : COLOURS[code];
  if (!art && !colours) return false;
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.clip();
  if (art) {
    const k = size / WINDOW;
    ctx.save();
    ctx.scale(k, k);
    ctx.translate(-windowX(code), 0);
    paintFlag(ctx, art);
    ctx.restore();
  } else if (colours) {
    ctx.fillStyle = colours[0];
    ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = colours[1] ?? colours[0];
    ctx.beginPath();
    ctx.arc(r, r, r * 0.78, 0, TAU);
    ctx.stroke();
    if (colours[2]) {
      ctx.lineWidth = r * 0.06;
      ctx.strokeStyle = colours[2];
      ctx.beginPath();
      ctx.arc(r, r, r * 0.64, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.translate(r, r);
  // a soft light behind the face: the eyes and the mouth read on any flag (dark stripes too)
  if (typeof ctx.createRadialGradient === 'function') {
    const g = ctx.createRadialGradient(0, r * 0.12, 0, 0, r * 0.12, r * 0.62);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    g.addColorStop(0.6, 'rgba(255, 255, 255, 0.16)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, size, size);
  }
  // the coin's shade crescent on the lower right, in ink
  ctx.globalAlpha = 0.17;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.arc(LIT_DX * r, LIT_DY * r, r, 0, TAU, true);
  ctx.fill('evenodd');
  // the inner groove and the white highlight
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.815, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, HL_A0, HL_A1);
  ctx.stroke();
  ctx.restore();
  return true;
}

/**
 * Flag skins per (country, size bucket), drawn once: a coin then costs one `drawImage`. A lookup
 * allocates nothing (a map of arrays, no string keys), so the renderer may ask for every coin every
 * frame. Also the coin looks of flag-skinned coins: the player's look with the flag's main colour as
 * its body paint (cheeks, eyelids, a tiny coin's dot, a hat's band).
 */
export class FlagSkinCache {
  private readonly discs = new Map<string, (HTMLCanvasElement | null)[] | null>();
  private readonly looks = new Map<string, Map<CoinLook, CoinLook>>();
  private bytes = 0;

  /** Bitmaps' bytes held (tests). */
  get size(): number {
    return this.bytes;
  }

  clear(): void {
    this.discs.clear();
    this.bytes = 0;
  }

  /**
   * The flag skin of `code` cut to a disc about `px` device px across (a square canvas, transparent
   * outside the circle), or null when the country has neither a drawn flag nor known colours.
   */
  fill(code: string, px: number): HTMLCanvasElement | null {
    let row = this.discs.get(code);
    if (row === null) return null;
    if (row === undefined) {
      if (!flagSkinKind(code)) {
        this.discs.set(code, null);
        return null;
      }
      row = [];
      this.discs.set(code, row);
    }
    const b = flagSkinBucket(px);
    return row[b] ?? this.render(code, row, b);
  }

  private render(code: string, row: (HTMLCanvasElement | null)[], b: number): HTMLCanvasElement | null {
    const size = FLAG_SKIN_BUCKETS[b];
    if (this.bytes + size * size * 4 > MAX_BYTES) {
      // start over (the coins in view ask again at once)
      for (const r of this.discs.values()) if (r) r.length = 0;
      this.bytes = 0;
    }
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx || !paintFlagSkin(ctx, code, size)) return null;
    row[b] = c;
    this.bytes += size * size * 4;
    return c;
  }

  /** `base` (the player's coin look) painted in the main colour of `code`'s flag, cached. */
  look(base: CoinLook, code: string): CoinLook {
    let byBase = this.looks.get(code);
    if (!byBase) {
      byBase = new Map();
      this.looks.set(code, byBase);
    }
    let look = byBase.get(base);
    if (!look) {
      const body = flagMainColour(code) ?? base.body;
      look = { ...base, body, shade: shadeOf(body) };
      byBase.set(base, look);
    }
    return look;
  }
}

/** One cache for the game canvas and every portrait. */
export const flagSkins = new FlagSkinCache();

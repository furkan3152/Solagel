import { CARD_PAPER, INK } from '@elymum/art';

/**
 * Country flags without network assets or emoji (Windows Chrome draws no flag emoji): each flag is a
 * few simple shapes on a 30 × 20 field, drawn to canvas (game labels, cached per code and size) or
 * to SVG (lobby rows, `ui/Flag.tsx`) from the same table. Simplified on purpose: at name-tag size a
 * flag reads by its stripes and colours, not its emblems. Countries off the table get a two-letter
 * code badge instead.
 */

/** Field size the shapes are drawn in. */
export const FLAG_W = 30;
export const FLAG_H = 20;

/**
 * One shape:
 * - `['h', ...colours]` / `['v', ...colours]`: equal horizontal / vertical bands over the field
 * - `['r', x, y, w, h, colour]`: rectangle
 * - `['c', cx, cy, r, colour]`: disc
 * - `['s', cx, cy, r, colour]`: five-pointed star, point up
 * - `['p', colour, x1, y1, x2, y2, ...]`: filled polygon
 * - `['l', colour, width, x1, y1, x2, y2]`: straight bar (saltires, diagonals)
 * - `['o', colour, width, x1, y1, ...]`: closed polygon outline
 * - `['a', cx, cy, r, from, to, colour]`: disc sector (radians, clockwise from 3 o'clock)
 */
export type FlagOp = readonly (string | number)[];

const W = '#FFFFFF';
const K = '#000000';
const RED = '#D52B1E';
const NAVY = '#012169';
const GOLD = '#FCD116';

/** The Union Jack in the box (x, y, w, h): for GB, and the cantons of AU and NZ. */
function unionJack(x: number, y: number, w: number, h: number): FlagOp[] {
  const sx = w / 30;
  const sy = h / 20;
  const s = Math.min(sx, sy);
  return [
    ['r', x, y, w, h, NAVY],
    ['l', W, 4 * s, x, y, x + w, y + h],
    ['l', W, 4 * s, x, y + h, x + w, y],
    ['l', '#C8102E', 1.4 * s, x, y, x + w, y + h],
    ['l', '#C8102E', 1.4 * s, x, y + h, x + w, y],
    ['r', x + w / 2 - 3 * s, y, 6 * s, h, W],
    ['r', x, y + h / 2 - 3 * s, w, 6 * s, W],
    ['r', x + w / 2 - 1.8 * s, y, 3.6 * s, h, '#C8102E'],
    ['r', x, y + h / 2 - 1.8 * s, w, 3.6 * s, '#C8102E'],
  ];
}

/** A Nordic cross: background, then (cross colour, outer width), optionally an inner cross. */
function nordic(bg: string, cross: string, inner?: string): FlagOp[] {
  const ops: FlagOp[] = [['r', 0, 0, 30, 20, bg], ['r', 8, 0, inner ? 6 : 4, 20, cross], ['r', 0, inner ? 7 : 8, 30, inner ? 6 : 4, cross]];
  if (inner) ops.push(['r', 9.5, 0, 3, 20, inner], ['r', 0, 8.5, 30, 3, inner]);
  return ops;
}

/** Alternating horizontal stripes (`n` of them, starting with `a`). */
function stripes(n: number, a: string, b: string): FlagOp {
  return ['h', ...Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b))];
}

const ART: Record<string, readonly FlagOp[]> = {
  US: [stripes(7, '#B22234', W), ['r', 0, 0, 13, 10.8, '#3C3B6E'], ['c', 3, 2.6, 0.7, W], ['c', 6.5, 2.6, 0.7, W], ['c', 10, 2.6, 0.7, W], ['c', 4.7, 5.4, 0.7, W], ['c', 8.3, 5.4, 0.7, W], ['c', 3, 8.2, 0.7, W], ['c', 6.5, 8.2, 0.7, W], ['c', 10, 8.2, 0.7, W]],
  GB: unionJack(0, 0, 30, 20),
  CA: [['v', RED, W, W, RED], ['s', 15, 10.4, 4.6, RED]],
  AU: [['r', 0, 0, 30, 20, NAVY], ...unionJack(0, 0, 15, 10), ['s', 7.5, 15, 2.6, W], ['s', 22.5, 4.5, 1.3, W], ['s', 26, 8.5, 1.3, W], ['s', 19.5, 9.5, 1.2, W], ['s', 22.5, 16, 1.5, W]],
  NZ: [['r', 0, 0, 30, 20, NAVY], ...unionJack(0, 0, 15, 10), ['s', 22.5, 4.5, 1.5, '#C8102E'], ['s', 26, 9, 1.5, '#C8102E'], ['s', 19.5, 10, 1.4, '#C8102E'], ['s', 22.5, 16, 1.7, '#C8102E']],
  IE: [['v', '#169B62', W, '#FF883E']],
  DE: [['h', K, '#DD0000', '#FFCE00']],
  FR: [['v', '#002654', W, '#CE1126']],
  IT: [['v', '#009246', W, '#CE2B37']],
  ES: [['h', '#AA151B', '#F1BF00', '#F1BF00', '#AA151B'], ['r', 7, 7, 3.5, 5, '#AA151B']],
  PT: [['r', 0, 0, 12, 20, '#046A38'], ['r', 12, 0, 18, 20, '#DA291C'], ['c', 12, 10, 3.6, '#FFE900'], ['c', 12, 10, 2.2, '#DA291C']],
  NL: [['h', '#AE1C28', W, '#21468B']],
  BE: [['v', K, '#FDDA24', '#EF3340']],
  LU: [['h', '#EF3340', W, '#00A3E0']],
  AT: [['h', '#C8102E', W, '#C8102E']],
  CH: [['r', 0, 0, 30, 20, '#DA291C'], ['r', 13, 4, 4, 12, W], ['r', 9, 8, 12, 4, W]],
  SE: nordic('#006AA7', '#FECC02'),
  NO: nordic('#BA0C2F', W, '#00205B'),
  DK: nordic('#C8102E', W),
  FI: nordic(W, '#002F6C'),
  IS: nordic('#02529C', W, '#DC1E35'),
  PL: [['h', W, '#DC143C']],
  CZ: [['h', W, '#D7141A'], ['p', '#11457E', 0, 0, 15, 10, 0, 20]],
  SK: [['h', W, '#0B4EA2', '#EE1C25'], ['r', 6, 4.5, 6.5, 9, W], ['r', 6.7, 5.2, 5.1, 7.6, '#EE1C25'], ['r', 8.75, 6, 1, 6, W], ['r', 7.5, 7.5, 3.5, 1, W]],
  HU: [['h', '#CD2A3E', W, '#436F4D']],
  RO: [['v', '#002B7F', GOLD, '#CE1126']],
  BG: [['h', W, '#00966E', '#D62612']],
  GR: [stripes(9, '#0D5EAF', W), ['r', 0, 0, 11.1, 11.1, '#0D5EAF'], ['r', 4.44, 0, 2.22, 11.1, W], ['r', 0, 4.44, 11.1, 2.22, W]],
  TR: [['r', 0, 0, 30, 20, '#E30A17'], ['c', 11, 10, 5, W], ['c', 12.3, 10, 4, '#E30A17'], ['s', 17.4, 10, 2.5, W]],
  UA: [['h', '#0057B7', '#FFD700']],
  RU: [['h', W, '#0039A6', '#D52B1E']],
  BY: [['r', 0, 0, 30, 13.3, '#C8313E'], ['r', 0, 13.3, 30, 6.7, '#4AA657'], ['r', 0, 0, 3.5, 20, W]],
  LT: [['h', '#FDB913', '#006A44', '#C1272D']],
  LV: [['h', '#9E3039', '#9E3039', W, '#9E3039', '#9E3039']],
  EE: [['h', '#0072CE', K, W]],
  HR: [['h', '#FF0000', W, '#171796'], ['r', 12, 5.5, 6, 7, W], ['r', 12, 5.5, 2, 2.33, '#FF0000'], ['r', 16, 5.5, 2, 2.33, '#FF0000'], ['r', 14, 7.83, 2, 2.33, '#FF0000'], ['r', 12, 10.17, 2, 2.33, '#FF0000'], ['r', 16, 10.17, 2, 2.33, '#FF0000']],
  RS: [['h', '#C6363C', '#0C4076', W], ['r', 8, 5, 4, 6, '#C6363C']],
  SI: [['h', W, '#005DA4', '#ED1C24'], ['r', 6, 3.5, 5, 6, '#005DA4']],
  MT: [['v', W, '#CF142B']],
  AL: [['r', 0, 0, 30, 20, '#E41E20'], ['s', 15, 10, 5, K]],
  GE: [['r', 0, 0, 30, 20, W], ['r', 13, 0, 4, 20, '#FF0000'], ['r', 0, 8, 30, 4, '#FF0000']],
  AM: [['h', '#D90012', '#0033A0', '#F2A800']],
  AZ: [['h', '#00B5E2', '#EF3340', '#509E2F'], ['c', 14.5, 10, 3, W], ['c', 15.4, 10, 2.4, '#EF3340']],
  BR: [['r', 0, 0, 30, 20, '#009C3B'], ['p', '#FFDF00', 15, 2.5, 27.5, 10, 15, 17.5, 2.5, 10], ['c', 15, 10, 4.2, '#002776']],
  AR: [['h', '#74ACDF', W, '#74ACDF'], ['c', 15, 10, 1.9, '#F6B40E']],
  MX: [['v', '#006847', W, '#CE1126'], ['c', 15, 10, 2.3, '#8C5A2B']],
  CO: [['h', GOLD, GOLD, '#003893', '#CE1126']],
  EC: [['h', '#FFDD00', '#FFDD00', '#034EA2', '#ED1C24'], ['c', 15, 10, 2.4, '#8C5A2B']],
  VE: [['h', '#FFCC00', '#00247D', '#CF142B']],
  CL: [['r', 0, 0, 30, 10, W], ['r', 0, 10, 30, 10, '#D52B1E'], ['r', 0, 0, 10, 10, '#0039A6'], ['s', 5, 5, 2.4, W]],
  PE: [['v', '#D91023', W, '#D91023']],
  BO: [['h', '#D52B1E', '#F9E300', '#007934']],
  PY: [['h', '#D52B1E', W, '#0038A8']],
  UY: [stripes(9, W, '#0038A8'), ['r', 0, 0, 11.1, 11.1, W], ['c', 5.5, 5.5, 2.8, GOLD]],
  CR: [['h', '#002B7F', W, '#CE1126', '#CE1126', W, '#002B7F']],
  PA: [['r', 0, 0, 30, 20, W], ['r', 15, 0, 15, 10, '#DA121A'], ['r', 0, 10, 15, 10, '#072357'], ['s', 7.5, 5, 2.2, '#072357'], ['s', 22.5, 15, 2.2, '#DA121A']],
  DO: [['r', 0, 0, 30, 20, W], ['r', 0, 0, 12.5, 7.5, '#002D62'], ['r', 17.5, 12.5, 12.5, 7.5, '#002D62'], ['r', 17.5, 0, 12.5, 7.5, '#CE1126'], ['r', 0, 12.5, 12.5, 7.5, '#CE1126']],
  CU: [stripes(5, '#002A8F', W), ['p', '#CF142B', 0, 0, 13, 10, 0, 20], ['s', 4.5, 10, 2.6, W]],
  PR: [stripes(5, '#ED0000', W), ['p', '#0050F0', 0, 0, 13, 10, 0, 20], ['s', 4.5, 10, 2.6, W]],
  JM: [['r', 0, 0, 30, 20, '#009B3A'], ['p', K, 0, 0, 13, 10, 0, 20], ['p', K, 30, 0, 17, 10, 30, 20], ['l', '#FED100', 3, 0, 0, 30, 20], ['l', '#FED100', 3, 0, 20, 30, 0]],
  GT: [['v', '#4997D0', W, '#4997D0']],
  HN: [['h', '#00BCE4', W, '#00BCE4']],
  SV: [['h', '#0F47AF', W, '#0F47AF']],
  NI: [['h', '#0067C6', W, '#0067C6']],
  JP: [['r', 0, 0, 30, 20, W], ['c', 15, 10, 6, '#BC002D']],
  KR: [['r', 0, 0, 30, 20, W], ['c', 15, 10, 5, '#CD2E3A'], ['a', 15, 10, 5, 0, Math.PI, '#0047A0'], ['c', 12.5, 10, 2.5, '#CD2E3A'], ['c', 17.5, 10, 2.5, '#0047A0'], ['l', K, 1.4, 4, 5.5, 7, 2.5], ['l', K, 1.4, 23, 2.5, 26, 5.5], ['l', K, 1.4, 4, 14.5, 7, 17.5], ['l', K, 1.4, 23, 17.5, 26, 14.5]],
  CN: [['r', 0, 0, 30, 20, '#EE1C25'], ['s', 5, 5, 3, '#FFFF00'], ['s', 10, 2, 1, '#FFFF00'], ['s', 12, 4, 1, '#FFFF00'], ['s', 12, 7, 1, '#FFFF00'], ['s', 10, 9, 1, '#FFFF00']],
  TW: [['r', 0, 0, 30, 20, '#FE0000'], ['r', 0, 0, 15, 10, '#000095'], ['c', 7.5, 5, 3, W], ['c', 7.5, 5, 2.1, '#000095'], ['c', 7.5, 5, 1.7, W]],
  HK: [['r', 0, 0, 30, 20, '#DE2910'], ['c', 15, 10, 4.5, W], ['c', 15, 10, 1.4, '#DE2910']],
  IN: [['h', '#FF9933', W, '#138808'], ['c', 15, 10, 2.7, '#000080'], ['c', 15, 10, 2.1, W], ['c', 15, 10, 0.7, '#000080']],
  PK: [['r', 0, 0, 30, 20, '#01411C'], ['r', 0, 0, 7.5, 20, W], ['c', 18.5, 10, 6, W], ['c', 20, 8.6, 5.3, '#01411C'], ['s', 21.6, 7.6, 2, W]],
  BD: [['r', 0, 0, 30, 20, '#006A4E'], ['c', 13.5, 10, 6, '#F42A41']],
  ID: [['h', '#CE1126', W]],
  MC: [['h', '#CE1126', W]],
  TH: [['h', '#A51931', W, '#2D2A4A', '#2D2A4A', W, '#A51931']],
  VN: [['r', 0, 0, 30, 20, '#DA251D'], ['s', 15, 10.5, 6, '#FFFF00']],
  PH: [['r', 0, 0, 30, 10, '#0038A8'], ['r', 0, 10, 30, 10, '#CE1126'], ['p', W, 0, 0, 17.3, 10, 0, 20], ['c', 5.6, 10, 2.3, GOLD]],
  MY: [stripes(7, '#CC0001', W), ['r', 0, 0, 15, 11.4, '#010066'], ['c', 6, 5.7, 3.6, '#FFCC00'], ['c', 7.3, 5.7, 3, '#010066'], ['s', 11.4, 5.7, 2.3, '#FFCC00']],
  SG: [['h', '#EF3340', W], ['c', 6, 5, 3.2, W], ['c', 7.4, 5, 2.9, '#EF3340'], ['s', 10, 3, 0.8, W], ['s', 11.6, 5, 0.8, W], ['s', 10, 7, 0.8, W]],
  KZ: [['r', 0, 0, 30, 20, '#00AFCA'], ['c', 15, 9, 4, '#FEC50C']],
  SA: [['r', 0, 0, 30, 20, '#006C35'], ['r', 7, 6.5, 16, 1.6, W], ['r', 7, 9.2, 16, 1.2, W], ['r', 8, 13, 14, 1, W]],
  AE: [['r', 0, 0, 30, 6.67, '#00732F'], ['r', 0, 6.67, 30, 6.67, W], ['r', 0, 13.33, 30, 6.67, K], ['r', 0, 0, 8, 20, '#FF0000']],
  QA: [['r', 0, 0, 30, 20, '#8A1538'], ['p', W, 0, 0, 9, 0, 12, 1.1, 9, 2.2, 12, 3.3, 9, 4.4, 12, 5.6, 9, 6.7, 12, 7.8, 9, 8.9, 12, 10, 9, 11.1, 12, 12.2, 9, 13.3, 12, 14.4, 9, 15.6, 12, 16.7, 9, 17.8, 12, 18.9, 9, 20, 0, 20]],
  IL: [['r', 0, 0, 30, 20, W], ['r', 0, 2, 30, 3, '#0038B8'], ['r', 0, 15, 30, 3, '#0038B8'], ['o', '#0038B8', 0.9, 15, 6.4, 18.2, 12, 11.8, 12], ['o', '#0038B8', 0.9, 15, 13.6, 18.2, 8, 11.8, 8]],
  IR: [['h', '#239F40', W, '#DA0000'], ['c', 15, 10, 1.9, '#DA0000']],
  IQ: [['h', '#CE1126', W, K]],
  LB: [['h', '#ED1C24', W, W, '#ED1C24'], ['p', '#00A651', 15, 6, 19, 13.5, 11, 13.5]],
  EG: [['h', '#CE1126', W, K], ['c', 15, 10, 1.9, '#C09300']],
  MA: [['r', 0, 0, 30, 20, '#C1272D'], ['s', 15, 10.4, 4.6, '#006233']],
  TN: [['r', 0, 0, 30, 20, '#E70013'], ['c', 15, 10, 5, W], ['c', 14.4, 10, 3.6, '#E70013'], ['c', 15.6, 10, 3, W], ['s', 16.2, 10, 2.2, '#E70013']],
  NG: [['v', '#008751', W, '#008751']],
  GH: [['h', '#CE1126', GOLD, '#006B3F'], ['s', 15, 10.3, 3, K]],
  SN: [['v', '#00853F', '#FDEF42', '#E31B23'], ['s', 15, 10.3, 3, '#00853F']],
  CI: [['v', '#F77F00', W, '#009E60']],
  CM: [['v', '#007A5E', '#CE1126', GOLD], ['s', 15, 10.3, 2.8, GOLD]],
  ML: [['v', '#14B53A', GOLD, '#CE1126']],
  ET: [['h', '#078930', '#FCDD09', '#DA121A'], ['c', 15, 10, 4, '#0F47AF'], ['s', 15, 10.3, 2.8, '#FCDD09']],
  KE: [['r', 0, 0, 30, 6, K], ['r', 0, 6, 30, 1.3, W], ['r', 0, 7.3, 30, 5.4, '#BB0000'], ['r', 0, 12.7, 30, 1.3, W], ['r', 0, 14, 30, 6, '#006600'], ['c', 15, 10, 3.6, '#BB0000'], ['r', 14.3, 6, 1.4, 8, W]],
  ZA: [['r', 0, 0, 30, 10, '#E03C31'], ['r', 0, 10, 30, 10, '#001489'], ['l', W, 7, 0, 0, 13, 10], ['l', W, 7, 0, 20, 13, 10], ['r', 13, 6.5, 17, 7, W], ['l', '#007749', 4.2, 0, 0, 13, 10], ['l', '#007749', 4.2, 0, 20, 13, 10], ['r', 13, 7.9, 17, 4.2, '#007749'], ['p', '#FFB612', 0, 2.6, 10, 10, 0, 17.4], ['p', K, 0, 4, 8, 10, 0, 16]],
};

/** The shapes of a country's flag, or null for a code-badge country. */
export function flagArt(code: string): readonly FlagOp[] | null {
  return ART[code] ?? null;
}

/** Codes that have a drawn flag (the rest show a code badge). */
export const DRAWN_FLAGS: readonly string[] = Object.keys(ART);

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

const STAR = new Float64Array(20);

function starPoints(cx: number, cy: number, r: number): Float64Array {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    STAR[i * 2] = cx + Math.cos(a) * rr;
    STAR[i * 2 + 1] = cy + Math.sin(a) * rr;
  }
  return STAR;
}

/** Draws the flag's shapes into the field (0, 0)–(30, 20) of the current transform (no clip, no edge). */
export function paintFlag(ctx: CanvasRenderingContext2D, art: readonly FlagOp[]): void {
  for (const op of art) {
    const n = op as readonly number[];
    switch (op[0]) {
      case 'h':
      case 'v': {
        const k = op.length - 1;
        for (let i = 0; i < k; i++) {
          ctx.fillStyle = op[i + 1] as string;
          // a hair of overlap: no seams between bands
          if (op[0] === 'h') ctx.fillRect(0, (i * FLAG_H) / k, FLAG_W, FLAG_H / k + 0.05);
          else ctx.fillRect((i * FLAG_W) / k, 0, FLAG_W / k + 0.05, FLAG_H);
        }
        break;
      }
      case 'r':
        ctx.fillStyle = op[5] as string;
        ctx.fillRect(n[1], n[2], n[3], n[4]);
        break;
      case 'c':
        ctx.fillStyle = op[4] as string;
        ctx.beginPath();
        ctx.arc(n[1], n[2], n[3], 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'a':
        ctx.fillStyle = op[6] as string;
        ctx.beginPath();
        ctx.moveTo(n[1], n[2]);
        ctx.arc(n[1], n[2], n[3], n[4], n[5]);
        ctx.closePath();
        ctx.fill();
        break;
      case 's': {
        const p = starPoints(n[1], n[2], n[3]);
        ctx.fillStyle = op[4] as string;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < 20; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'p':
      case 'o': {
        const from = op[0] === 'p' ? 2 : 3;
        ctx.beginPath();
        ctx.moveTo(n[from], n[from + 1]);
        for (let i = from + 2; i + 1 < op.length; i += 2) ctx.lineTo(n[i], n[i + 1]);
        ctx.closePath();
        if (op[0] === 'p') {
          ctx.fillStyle = op[1] as string;
          ctx.fill();
        } else {
          ctx.strokeStyle = op[1] as string;
          ctx.lineWidth = n[2];
          ctx.lineJoin = 'miter';
          ctx.stroke();
        }
        break;
      }
      case 'l':
        ctx.strokeStyle = op[1] as string;
        ctx.lineWidth = n[2];
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(n[3], n[4]);
        ctx.lineTo(n[5], n[6]);
        ctx.stroke();
        break;
    }
  }
}

const MONO_FONT = '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';

/** A flag bitmap: the flag (or code badge) with its ink edge, `w × h` device px. */
export interface FlagSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

/** Most bitmaps kept (a few countries in view times a handful of zoom sizes); past it the cache starts over. */
const MAX_FLAGS = 256;

/**
 * Flag bitmaps per (code, whole device px height from 6 up; the width follows 3 : 2), drawn once
 * with their ink edge and rounded corners. A lookup allocates nothing (nested maps, no string
 * keys), so the game's name tags may ask every frame; a flag is then one `drawImage`.
 */
export class FlagCache {
  private readonly map = new Map<string, Map<number, FlagSprite>>();
  private count = 0;

  constructor() {
    // badges rasterised before the web font arrived keep the fallback face: start over
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => this.clear());
    }
  }

  clear(): void {
    this.map.clear();
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  /** The flag of `code` about `heightPx` device px tall (with its edge). */
  get(code: string, heightPx: number): FlagSprite {
    const h = Math.max(6, Math.round(heightPx));
    let sizes = this.map.get(code);
    const hit = sizes?.get(h);
    if (hit) return hit;
    if (this.count >= MAX_FLAGS) {
      this.clear();
      sizes = undefined;
    }
    if (!sizes) {
      sizes = new Map();
      this.map.set(code, sizes);
    }
    const s = renderFlag(code, h);
    sizes.set(h, s);
    this.count++;
    return s;
  }
}

/** Width of a flag sprite for a height (badges of codes without art are as wide). */
export function flagWidth(h: number): number {
  return Math.round(h * 1.5);
}

function renderFlag(code: string, h: number): FlagSprite {
  const w = flagWidth(h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // the ink edge: about 1/8 of the height, at least one px
  const edge = Math.max(1, h / 8);
  const r = Math.min(h * 0.22, 4);
  const inset = edge / 2;
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - edge, h - edge, r);
  const art = flagArt(code);
  ctx.save();
  ctx.clip();
  if (art) {
    ctx.translate(inset, inset);
    ctx.scale((w - edge) / FLAG_W, (h - edge) / FLAG_H);
    paintFlag(ctx, art);
  } else {
    ctx.fillStyle = CARD_PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(h * 0.56)}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code, w / 2, h / 2 + h * 0.04);
  }
  ctx.restore();
  // the shapes replaced the path: the edge is traced again
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - edge, h - edge, r);
  ctx.lineWidth = edge;
  ctx.strokeStyle = INK;
  ctx.stroke();
  return { canvas, w, h };
}

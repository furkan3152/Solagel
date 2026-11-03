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

/**
 * A crescent as one polygon: the disc (cx, cy, R) minus the disc of radius `r2` whose centre sits `d`
 * further along the direction `rot` (radians; 0 opens it to the right). Works on any background (a
 * cut-out disc in the background colour would not, on a flag split behind it).
 */
function crescent(colour: string, cx: number, cy: number, R: number, d: number, r2: number, rot = 0): FlagOp {
  const a = (R * R - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const t1 = Math.atan2(h, a);
  const phi = Math.atan2(h, a - d);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const pts: number[] = [];
  const at = (x: number, y: number) => pts.push(Math.round((cx + x * cos - y * sin) * 100) / 100, Math.round((cy + x * sin + y * cos) * 100) / 100);
  const N = 16;
  // the outer arc round the far side, then the inner arc back
  for (let i = 0; i <= N; i++) {
    const t = t1 + ((Math.PI * 2 - 2 * t1) * i) / N;
    at(Math.cos(t) * R, Math.sin(t) * R);
  }
  for (let i = 0; i <= N; i++) {
    const t = Math.PI * 2 - phi - ((Math.PI * 2 - 2 * phi) * i) / N;
    at(d + Math.cos(t) * r2, Math.sin(t) * r2);
  }
  return ['p', colour, ...pts];
}

/** `n` small stars of radius `r` on a ring of radius `R` round (cx, cy), the first one on top. */
function starRing(colour: string, cx: number, cy: number, R: number, n: number, r: number): FlagOp[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    return ['s', Math.round((cx + Math.cos(a) * R) * 100) / 100, Math.round((cy + Math.sin(a) * R) * 100) / 100, r, colour] as FlagOp;
  });
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
  // more of the most populous and most crypto-active countries (simplified like the rest)
  CD: [['r', 0, 0, 30, 20, '#007FFF'], ['l', '#F7D618', 6.4, 0, 20, 30, 0], ['l', '#CE1021', 4.2, 0, 20, 30, 0], ['s', 5, 4.6, 3, '#F7D618']],
  TZ: [['r', 0, 0, 30, 20, '#1EB53A'], ['p', '#00A3DD', 30, 0, 30, 20, 0, 20], ['l', '#FCD116', 7.4, 0, 20, 30, 0], ['l', K, 4.8, 0, 20, 30, 0]],
  UG: [['h', K, '#FCDC04', '#D90000', K, '#FCDC04', '#D90000'], ['c', 15, 10, 4.2, W], ['c', 15.4, 9.4, 1.5, '#9CA69C'], ['p', '#D90000', 14.6, 7.6, 15.6, 7, 15.6, 8.2]],
  SD: [['h', '#D21034', W, K], ['p', '#007229', 0, 0, 10, 10, 0, 20]],
  DZ: [['v', '#006233', W], crescent('#D21034', 15.4, 10, 5, 1.4, 4.1), ['s', 17.6, 10, 2.2, '#D21034']],
  UZ: [['h', '#0099B5', W, '#1EB53A'], ['r', 0, 6.3, 30, 0.7, '#CE1126'], ['r', 0, 13, 30, 0.7, '#CE1126'], crescent(W, 4.6, 3.4, 2.4, 0.9, 2), ['s', 9, 1.8, 0.55, W], ['s', 11, 1.8, 0.55, W], ['s', 13, 1.8, 0.55, W], ['s', 9, 3.6, 0.55, W], ['s', 11, 3.6, 0.55, W], ['s', 13, 3.6, 0.55, W], ['s', 11, 5.4, 0.55, W], ['s', 13, 5.4, 0.55, W]],
  MM: [['h', '#FECB00', '#34B233', '#EA2839'], ['s', 15, 10.8, 6.4, W]],
  LK: [['r', 0, 0, 30, 20, '#FFBE29'], ['r', 1, 1, 3.6, 18, '#00534E'], ['r', 4.6, 1, 3.6, 18, '#EB7400'], ['r', 9.4, 1, 19.6, 18, '#8D153A'], ['c', 19.2, 10, 4, '#FFBE29'], ['c', 19.2, 10, 2.6, '#8D153A']],
  YE: [['h', '#CE1126', W, K]],
  AO: [['h', '#CC092F', K], ['s', 15, 10.2, 3, '#FFCB00'], ['l', '#FFCB00', 1.2, 11.5, 13, 18, 6.5]],
  MZ: [['h', '#007168', K, '#FCE100'], ['r', 0, 6.3, 30, 0.8, W], ['r', 0, 12.9, 30, 0.8, W], ['p', '#D21034', 0, 0, 13, 10, 0, 20], ['s', 4.6, 10.4, 2.8, '#FCE100']],
  NE: [['h', '#E05206', W, '#0DB02B'], ['c', 15, 10, 2.4, '#E05206']],
  KP: [['r', 0, 0, 30, 20, '#ED1C27'], ['r', 0, 0, 30, 3.4, '#024FA2'], ['r', 0, 3.4, 30, 0.8, W], ['r', 0, 15.8, 30, 0.8, W], ['r', 0, 16.6, 30, 3.4, '#024FA2'], ['c', 10, 10, 4, W], ['s', 10, 10.3, 3.8, '#ED1C27']],
  KH: [['h', '#032EA1', '#E00025', '#E00025', '#032EA1'], ['p', W, 9, 14, 21, 14, 21, 12.4, 19.2, 12.4, 19.2, 9.6, 17.6, 9.6, 17.6, 7.2, 15, 4.6, 12.4, 7.2, 12.4, 9.6, 10.8, 9.6, 10.8, 12.4, 9, 12.4]],
  ZM: [['r', 0, 0, 30, 20, '#198A00'], ['r', 21, 8, 3, 12, '#DE2010'], ['r', 24, 8, 3, 12, K], ['r', 27, 8, 3, 12, '#EF7D00'], ['p', '#EF7D00', 22, 4, 25.5, 2.4, 29, 4, 25.5, 5.6]],
  ZW: [['h', '#319208', '#FFD200', '#DE2010', K, '#DE2010', '#FFD200', '#319208'], ['p', K, 0, 0, 11.6, 10, 0, 20], ['p', W, 0, 1.1, 10.3, 10, 0, 18.9], ['s', 3.9, 10.3, 2.2, '#DE2010']],
  MW: [['h', K, '#CE1126', '#339E35'], ['a', 15, 6.8, 4.4, Math.PI, Math.PI * 2, '#CE1126']],
  TD: [['v', '#002664', '#FECB00', '#C60C30']],
  SO: [['r', 0, 0, 30, 20, '#4189DD'], ['s', 15, 10.6, 5.2, W]],
  RW: [['r', 0, 0, 30, 10, '#00A1DE'], ['r', 0, 10, 30, 5, '#FAD201'], ['r', 0, 15, 30, 5, '#20603D'], ['c', 24.5, 5, 2.6, '#E5BE01'], ['c', 24.5, 5, 1.7, '#00A1DE'], ['c', 24.5, 5, 1.4, '#E5BE01']],
  BJ: [['r', 0, 0, 30, 10, '#FCD116'], ['r', 0, 10, 30, 10, '#E8112D'], ['r', 0, 0, 12, 20, '#008751']],
  BI: [['r', 0, 0, 30, 20, '#CE1126'], ['p', '#1EB53A', 0, 0, 15, 10, 0, 20], ['p', '#1EB53A', 30, 0, 15, 10, 30, 20], ['l', W, 3, 0, 0, 30, 20], ['l', W, 3, 0, 20, 30, 0], ['c', 15, 10, 5, W], ['s', 15, 7.9, 1.3, '#CE1126'], ['s', 13.1, 11.3, 1.3, '#CE1126'], ['s', 16.9, 11.3, 1.3, '#CE1126']],
  HT: [['h', '#00209F', '#D21034'], ['r', 11, 6.5, 8, 7, W], ['c', 15, 10.5, 1.8, '#016A16'], ['r', 12.5, 11.8, 5, 1, '#016A16']],
  JO: [['h', K, W, '#007A3D'], ['p', '#CE1126', 0, 0, 15, 10, 0, 20], ['s', 5, 10.2, 1.7, W]],
  KW: [['h', '#007A3D', W, '#CE1126'], ['p', K, 0, 0, 7.5, 6.67, 7.5, 13.33, 0, 20]],
  OM: [['r', 0, 0, 30, 20, '#DB161B'], ['r', 8, 0, 22, 6.67, W], ['r', 8, 13.33, 22, 6.67, '#008000'], ['c', 4, 3.4, 1.7, W], ['c', 4, 3.4, 0.8, '#DB161B']],
  BH: [['r', 0, 0, 30, 20, '#CE1126'], ['p', W, 0, 0, 7.5, 0, 10.5, 2, 7.5, 4, 10.5, 6, 7.5, 8, 10.5, 10, 7.5, 12, 10.5, 14, 7.5, 16, 10.5, 18, 7.5, 20, 0, 20]],
  KG: [['r', 0, 0, 30, 20, '#E8112D'], ['c', 15, 10, 5.4, '#FFEF00'], ['c', 15, 10, 3.6, '#E8112D'], ['c', 15, 10, 2.8, '#FFEF00'], ['l', '#E8112D', 0.6, 12.2, 10, 17.8, 10], ['l', '#E8112D', 0.6, 13.4, 8, 16.6, 12], ['l', '#E8112D', 0.6, 13.4, 12, 16.6, 8]],
  TJ: [['r', 0, 0, 30, 5.7, '#CC0000'], ['r', 0, 5.7, 30, 8.6, W], ['r', 0, 14.3, 30, 5.7, '#006600'], ['a', 15, 10.6, 1.9, Math.PI, Math.PI * 2, '#F8C300'], ['s', 15, 6.9, 0.55, '#F8C300'], ['s', 12.4, 7.8, 0.55, '#F8C300'], ['s', 17.6, 7.8, 0.55, '#F8C300'], ['s', 11.4, 9.9, 0.55, '#F8C300'], ['s', 18.6, 9.9, 0.55, '#F8C300']],
  TM: [['r', 0, 0, 30, 20, '#00843D'], ['r', 4, 0, 4.6, 20, '#D22630'], ['r', 4.9, 0, 0.6, 20, '#FFC72C'], ['r', 7.1, 0, 0.6, 20, '#FFC72C'], crescent(W, 11.4, 4, 2.4, 1, 2.1), ['s', 14.4, 2.4, 0.6, W], ['s', 15.4, 4, 0.6, W], ['s', 14.4, 5.6, 0.6, W]],
  LA: [['h', '#CE1126', '#002868', '#002868', '#CE1126'], ['c', 15, 10, 4, W]],
  MN: [['v', '#C4272F', '#015197', '#C4272F'], ['c', 5, 4.4, 1.3, '#F9CF02'], ['a', 5, 7.4, 1.6, 0, Math.PI, '#F9CF02'], ['r', 3.4, 9.6, 3.2, 1, '#F9CF02'], ['c', 5, 13, 1.4, '#F9CF02'], ['r', 1.9, 9.6, 1, 6.8, '#F9CF02'], ['r', 7.1, 9.6, 1, 6.8, '#F9CF02']],
  BA: [['r', 0, 0, 30, 20, '#002395'], ['p', '#FECB00', 8, 0, 23, 0, 23, 20], ['s', 4.4, 1.2, 1.1, W], ['s', 7.3, 5, 1.1, W], ['s', 10.2, 8.8, 1.1, W], ['s', 13.1, 12.6, 1.1, W], ['s', 16, 16.4, 1.1, W], ['s', 18.9, 20, 1.1, W]],
  MD: [['v', '#0046AE', '#FFD200', '#CC092F'], ['p', '#B07E31', 13.3, 7, 16.7, 7, 16.7, 11, 15, 13, 13.3, 11]],
  MK: [['r', 0, 0, 30, 20, '#D20000'], ['p', '#FFE600', 0, 0, 4, 0, 15, 10, 0, 3], ['p', '#FFE600', 30, 0, 26, 0, 15, 10, 30, 3], ['p', '#FFE600', 0, 20, 4, 20, 15, 10, 0, 17], ['p', '#FFE600', 30, 20, 26, 20, 15, 10, 30, 17], ['p', '#FFE600', 13.3, 0, 16.7, 0, 15, 10], ['p', '#FFE600', 13.3, 20, 16.7, 20, 15, 10], ['p', '#FFE600', 0, 8.3, 0, 11.7, 15, 10], ['p', '#FFE600', 30, 8.3, 30, 11.7, 15, 10], ['c', 15, 10, 3.2, '#D20000'], ['c', 15, 10, 2.6, '#FFE600']],
  ME: [['r', 0, 0, 30, 20, '#C40308'], ['o', '#D3AE3B', 1.2, 0.6, 0.6, 29.4, 0.6, 29.4, 19.4, 0.6, 19.4], ['p', '#D3AE3B', 11, 6, 13.5, 8, 15, 5.5, 16.5, 8, 19, 6, 18, 12, 15, 14.5, 12, 12]],
  CY: [['r', 0, 0, 30, 20, W], ['p', '#D57800', 8, 8.5, 11, 7, 16, 6.5, 22, 4.6, 21.4, 7, 17.5, 9.4, 13.4, 10.9, 9.2, 10.6], ['l', '#4E5B31', 1, 10.6, 15.4, 14.4, 13.2], ['l', '#4E5B31', 1, 19.4, 15.4, 15.6, 13.2]],
  GN: [['v', '#CE1126', '#FCD116', '#009460']],
  BF: [['h', '#EF2B2D', '#009E49'], ['s', 15, 10.3, 3.2, '#FCD116']],
  MG: [['r', 0, 0, 30, 10, '#FC3D32'], ['r', 0, 10, 30, 10, '#007E3A'], ['r', 0, 0, 10, 20, W]],
  SS: [['h', K, '#DA121A', '#078930'], ['r', 0, 6.1, 30, 0.9, W], ['r', 0, 13, 30, 0.9, W], ['p', '#0F47AF', 0, 0, 13, 10, 0, 20], ['s', 4.4, 10.3, 2.5, '#FCDD09']],
  ER: [['r', 0, 0, 30, 10, '#12AD2B'], ['r', 0, 10, 30, 10, '#4189DD'], ['p', '#EA0437', 0, 0, 30, 10, 0, 20], ['c', 7.5, 10, 3.2, '#FFC726'], ['c', 7.5, 10, 2.3, '#EA0437'], ['r', 7.1, 8, 0.8, 4.6, '#FFC726']],
  LY: [['h', '#E70013', K, K, '#239E46'], crescent(W, 14.2, 10, 2.8, 1, 2.3), ['s', 17.4, 10, 1.3, W]],
  PS: [['h', K, W, '#007A3D'], ['p', '#CE1126', 0, 0, 12, 10, 0, 20]],
  TG: [stripes(5, '#006A4E', '#FFCE00'), ['r', 0, 0, 12, 12, '#D21034'], ['s', 6, 6.3, 3.4, W]],
  SL: [['h', '#1EB53A', W, '#0072C6']],
  LR: [stripes(11, '#BF0A30', W), ['r', 0, 0, 9.1, 9.1, '#002868'], ['s', 4.55, 4.8, 2.9, W]],
  CF: [['h', '#003082', W, '#289728', '#FFCE00'], ['r', 13, 0, 4, 20, '#D21034'], ['s', 5, 2.6, 1.9, '#FFCE00']],
  CG: [['r', 0, 0, 30, 20, '#009543'], ['p', '#DC241F', 30, 0, 30, 20, 0, 20], ['l', '#FBDE4A', 6.4, 0, 20, 30, 0]],
  GA: [['h', '#009E60', '#FCD116', '#3A75C4']],
  MR: [['r', 0, 0, 30, 20, '#00A95C'], ['r', 0, 0, 30, 3, '#D01C1F'], ['r', 0, 17, 30, 3, '#D01C1F'], crescent('#FFD700', 15, 9.4, 5, 2.2, 4.6, -Math.PI / 2), ['s', 15, 8, 1.7, '#FFD700']],
  NA: [['r', 0, 0, 30, 20, '#003580'], ['p', '#009543', 30, 0, 30, 20, 0, 20], ['l', W, 7.4, 0, 20, 30, 0], ['l', '#D21034', 5.2, 0, 20, 30, 0], ['c', 6, 4.8, 2.4, '#FFCE00'], ['c', 6, 4.8, 1.5, '#003580'], ['c', 6, 4.8, 1.2, '#FFCE00']],
  BW: [['r', 0, 0, 30, 20, '#75AADB'], ['r', 0, 7.9, 30, 4.2, W], ['r', 0, 8.7, 30, 2.6, K]],
  LS: [['r', 0, 0, 30, 6, '#00209F'], ['r', 0, 6, 30, 8, W], ['r', 0, 14, 30, 6, '#009543'], ['p', K, 11.5, 12.6, 15, 7.2, 18.5, 12.6], ['r', 14.4, 6.4, 1.2, 1.2, K]],
  GM: [['r', 0, 0, 30, 20, '#CE1126'], ['r', 0, 6.67, 30, 6.67, W], ['r', 0, 7.5, 30, 5, '#0C1C8C'], ['r', 0, 13.33, 30, 6.67, '#3A7728']],
  GW: [['r', 0, 0, 30, 10, '#FCD116'], ['r', 0, 10, 30, 10, '#009E49'], ['r', 0, 0, 10, 20, '#CE1126'], ['s', 5, 10.3, 2.8, K]],
  GQ: [['h', '#3E9A00', W, '#E32118'], ['p', '#0073CE', 0, 0, 7, 10, 0, 20], ['p', '#6B8E23', 13.6, 8, 16.4, 8, 16.4, 11, 15, 12.6, 13.6, 11]],
  MU: [['h', '#EA2839', '#1A206D', '#FFD500', '#00A551']],
  DJ: [['r', 0, 0, 30, 10, '#6AB2E7'], ['r', 0, 10, 30, 10, '#12AD2B'], ['p', W, 0, 0, 14, 10, 0, 20], ['s', 4.8, 10.3, 2.1, '#D7141A']],
  KM: [['h', '#FFC61E', W, '#CE1126', '#3A75C4'], ['p', '#3D8E33', 0, 0, 13, 10, 0, 20], crescent(W, 4.4, 10, 3, 1.3, 2.6), ['s', 6.2, 7.4, 0.5, W], ['s', 6.6, 9.1, 0.5, W], ['s', 6.6, 10.9, 0.5, W], ['s', 6.2, 12.6, 0.5, W]],
  CV: [['r', 0, 0, 30, 20, '#003893'], ['r', 0, 10, 30, 3.3, W], ['r', 0, 11.1, 30, 1.7, '#CF2027'], ...starRing('#F7D116', 11.3, 11.7, 4.4, 10, 0.7)],
  ST: [['h', '#12AD2B', '#FFCE00', '#12AD2B'], ['p', '#D21034', 0, 0, 9, 10, 0, 20], ['s', 15, 10.3, 2.1, K], ['s', 22.5, 10.3, 2.1, K]],
  SC: [['p', '#003F87', 0, 20, 0, 0, 10, 0], ['p', '#FCD856', 0, 20, 10, 0, 20, 0], ['p', '#D62828', 0, 20, 20, 0, 30, 0, 30, 6.67], ['p', W, 0, 20, 30, 6.67, 30, 13.33], ['p', '#007A3D', 0, 20, 30, 13.33, 30, 20]],
  BT: [['r', 0, 0, 30, 20, '#FFD520'], ['p', '#FF4E12', 30, 0, 30, 20, 0, 20], ['p', W, 9, 12.5, 12, 8.5, 17, 9.6, 20.5, 6.5, 21.5, 8.4, 17.6, 11.6, 12.6, 10.6, 10.6, 13.6]],
  MV: [['r', 0, 0, 30, 20, '#D21034'], ['r', 5, 5, 20, 10, '#007E3A'], crescent(W, 15, 10, 3.4, 1.4, 3)],
  TL: [['r', 0, 0, 30, 20, '#DC241F'], ['p', '#FFC726', 0, 0, 15, 10, 0, 20], ['p', K, 0, 0, 10, 10, 0, 20], ['s', 3.4, 10.3, 2.2, W]],
  FJ: [['r', 0, 0, 30, 20, '#68BFE5'], ...unionJack(0, 0, 15, 10), ['p', W, 18.5, 5.5, 25.5, 5.5, 25.5, 11.5, 22, 14.5, 18.5, 11.5], ['r', 18.5, 5.5, 7, 2.2, '#CE1126']],
  PG: [['r', 0, 0, 30, 20, '#CE1126'], ['p', K, 0, 0, 30, 20, 0, 20], ['s', 7.5, 9.5, 1.1, W], ['s', 5, 12.5, 0.9, W], ['s', 10, 12.5, 0.9, W], ['s', 7.5, 16.5, 1.1, W], ['p', '#FCD116', 18, 7.5, 21, 3.5, 25, 5, 22.5, 6.2, 24.5, 9, 20.5, 8]],
  BN: [['r', 0, 0, 30, 20, '#F7E017'], ['p', W, 0, 2.4, 30, 12.4, 30, 16, 0, 6], ['p', K, 0, 6, 30, 16, 30, 19.6, 0, 9.6], ['c', 15, 10, 3.2, '#CF1126'], ['c', 15, 9.2, 2.2, '#F7E017'], ['c', 15, 8.4, 2.2, '#CF1126']],
  MO: [['r', 0, 0, 30, 20, '#00785E'], ['a', 15, 12.6, 4.6, Math.PI, Math.PI * 2, W], ['r', 10.4, 13.4, 9.2, 0.7, W], ['r', 11.4, 14.8, 7.2, 0.7, W], ['s', 15, 4.6, 1.4, '#FBD116'], ['s', 11.4, 5.6, 0.8, '#FBD116'], ['s', 18.6, 5.6, 0.8, '#FBD116'], ['s', 9.4, 7.8, 0.8, '#FBD116'], ['s', 20.6, 7.8, 0.8, '#FBD116']],
  AD: [['v', '#10069F', '#FEDF00', '#D50032'], ['p', '#C7B37F', 13.3, 7, 16.7, 7, 16.7, 11, 15, 13, 13.3, 11]],
  LI: [['h', '#002B7F', '#CE1126'], ['p', '#FFD83D', 4.6, 5.8, 9.4, 5.8, 9.4, 3.4, 8.2, 4.4, 7, 2.4, 5.8, 4.4, 4.6, 3.4]],
  SM: [['h', W, '#5EB6E4'], ['c', 15, 10, 2.6, '#F1BF31'], ['c', 15, 10, 1.6, '#5EB6E4']],
  VA: [['v', '#FFE000', W], ['l', '#C7A33A', 1, 20.5, 7.5, 24.5, 12.5], ['l', '#B0B0B0', 1, 24.5, 7.5, 20.5, 12.5], ['p', '#C7A33A', 21, 5, 24, 5, 23.5, 7, 21.5, 7]],
  BS: [['h', '#00778B', '#FFC72C', '#00778B'], ['p', K, 0, 0, 13, 10, 0, 20]],
  BB: [['v', '#00267F', '#FFC726', '#00267F'], ['r', 14.4, 6, 1.2, 9, K], ['p', K, 11.8, 6, 12.9, 6, 12.9, 9, 17.1, 9, 17.1, 6, 18.2, 6, 18.2, 10.2, 11.8, 10.2]],
  TT: [['r', 0, 0, 30, 20, '#CE1126'], ['l', W, 7.6, 0, 0, 30, 20], ['l', K, 5.6, 0, 0, 30, 20]],
  GY: [['r', 0, 0, 30, 20, '#009E49'], ['p', W, 0, 0, 30, 10, 0, 20], ['p', '#FCD116', 0, 0.9, 28, 10, 0, 19.1], ['p', K, 0, 0, 15, 10, 0, 20], ['p', '#CE1126', 0, 1.3, 13.4, 10, 0, 18.7]],
  SR: [['r', 0, 0, 30, 20, '#377E3F'], ['r', 0, 4, 30, 12, W], ['r', 0, 5.6, 30, 8.8, '#B40A2D'], ['s', 15, 10.3, 3.6, '#ECC81D']],
  BZ: [['r', 0, 0, 30, 20, '#003F87'], ['r', 0, 0, 30, 2, '#CE1126'], ['r', 0, 18, 30, 2, '#CE1126'], ['c', 15, 10, 5.4, W], ['c', 15, 10, 4.6, '#5E8C3A'], ['c', 15, 10, 3.2, W], ['c', 15, 10.4, 1.8, '#4A6FB5']],
  AG: [['r', 0, 0, 30, 20, '#CE1126'], ['p', K, 0, 0, 30, 0, 15, 20], ['a', 15, 6, 4, Math.PI, Math.PI * 2, '#FCD116'], ['p', '#0072C6', 4.5, 6, 25.5, 6, 22.5, 10, 7.5, 10], ['p', W, 7.5, 10, 22.5, 10, 15, 20]],
  LC: [['r', 0, 0, 30, 20, '#65CFFF'], ['p', W, 15, 3, 20.5, 17, 9.5, 17], ['p', K, 15, 5, 19.2, 17, 10.8, 17], ['p', '#FCD116', 15, 10.5, 20.5, 17, 9.5, 17]],
  VC: [['r', 0, 0, 7.5, 20, '#002674'], ['r', 7.5, 0, 15, 20, '#FCD022'], ['r', 22.5, 0, 7.5, 20, '#009E60'], ['p', '#009E60', 12, 6.5, 13.6, 9.2, 12, 11.9, 10.4, 9.2], ['p', '#009E60', 18, 6.5, 19.6, 9.2, 18, 11.9, 16.4, 9.2], ['p', '#009E60', 15, 10.2, 16.6, 12.9, 15, 15.6, 13.4, 12.9]],
  WS: [['r', 0, 0, 30, 20, '#CE1126'], ['r', 0, 0, 15, 10, '#002B7F'], ['s', 7.5, 2.2, 1.1, W], ['s', 4.6, 5, 1.1, W], ['s', 10.2, 4.4, 1, W], ['s', 7.5, 8, 1.2, W], ['s', 9.2, 6.4, 0.6, W]],
  TO: [['r', 0, 0, 30, 20, '#C10000'], ['r', 0, 0, 12, 10, W], ['r', 4.75, 1.5, 2.5, 7, '#C10000'], ['r', 2.5, 3.75, 7, 2.5, '#C10000']],
  PW: [['r', 0, 0, 30, 20, '#4AADD6'], ['c', 13, 10, 6, '#FFDE00']],
  FM: [['r', 0, 0, 30, 20, '#75B2DD'], ['s', 15, 5, 1.8, W], ['s', 10, 10, 1.8, W], ['s', 20, 10, 1.8, W], ['s', 15, 15, 1.8, W]],
  NR: [['r', 0, 0, 30, 20, '#002B7F'], ['r', 0, 9.3, 30, 1.4, '#FFC61E'], ['s', 7.5, 14.6, 2.6, W]],
  SB: [['r', 0, 0, 30, 20, '#0051BA'], ['p', '#215B33', 30, 0, 30, 20, 0, 20], ['l', '#FCD116', 1.8, 0, 20, 30, 0], ['s', 3.5, 2.5, 1, W], ['s', 9.5, 2.5, 1, W], ['s', 6.5, 5, 1, W], ['s', 3.5, 7.5, 1, W], ['s', 9.5, 7.5, 1, W]],
  FO: nordic(W, '#0065BD', '#ED2939'),
  AX: nordic('#0064AD', '#FFD300', '#DA0E15'),
  GL: [['h', W, '#D00C33'], ['a', 11, 10, 5.6, Math.PI, Math.PI * 2, '#D00C33'], ['a', 11, 10, 5.6, 0, Math.PI, W]],
};

/**
 * Territories that fly their country's flag (ISO gives them a code of their own): they borrow its art.
 */
const SAME_FLAG: Readonly<Record<string, string>> = {
  GP: 'FR', MQ: 'FR', GF: 'FR', RE: 'FR', YT: 'FR', BL: 'FR', MF: 'FR', PM: 'FR', WF: 'FR',
  SJ: 'NO', BV: 'NO', UM: 'US', HM: 'AU',
};
for (const [code, of] of Object.entries(SAME_FLAG)) ART[code] = ART[of];

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

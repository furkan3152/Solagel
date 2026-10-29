import type { SymbolKind } from './looks';

const TAU = Math.PI * 2;

/** Traces a star path centred on (0,0) (begins a new path). */
export function starPath(ctx: CanvasRenderingContext2D, outer: number, inner: number, points = 5, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Traces a heart of half-size `s` centred on (0,0) (begins a new path). */
export function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.85);
  ctx.bezierCurveTo(-s * 1.25, s * 0.05, -s * 0.85, -s * 0.95, 0, -s * 0.38);
  ctx.bezierCurveTo(s * 0.85, -s * 0.95, s * 1.25, s * 0.05, 0, s * 0.85);
  ctx.closePath();
}

/** Traces a smooth "S" stroke (used by the dollar symbol). */
function sPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(s * 0.5, -s * 0.48);
  ctx.bezierCurveTo(s * 0.3, -s * 0.72, -s * 0.52, -s * 0.72, -s * 0.5, -s * 0.28);
  ctx.bezierCurveTo(-s * 0.48, s * 0.08, s * 0.5, -s * 0.08, s * 0.5, s * 0.3);
  ctx.bezierCurveTo(s * 0.52, s * 0.74, -s * 0.32, s * 0.74, -s * 0.52, s * 0.46);
}

/** Closed-shape symbols: traces the silhouette (begins a new path). */
function silhouette(ctx: CanvasRenderingContext2D, kind: SymbolKind, s: number): boolean {
  switch (kind) {
    case 'heart':
      heartPath(ctx, s * 1.05);
      return true;
    case 'star':
      starPath(ctx, s * 1.1, s * 0.5);
      return true;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(s * 0.3, -s);
      ctx.lineTo(-s * 0.55, s * 0.14);
      ctx.lineTo(-s * 0.02, s * 0.14);
      ctx.lineTo(-s * 0.28, s);
      ctx.lineTo(s * 0.6, -s * 0.2);
      ctx.lineTo(s * 0.06, -s * 0.2);
      ctx.closePath();
      return true;
    case 'moon':
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.95, Math.PI * 0.3, Math.PI * 1.7, false);
      ctx.bezierCurveTo(-s * 0.05, -s * 0.6, -s * 0.15, s * 0.45, s * 0.56, s * 0.77);
      ctx.closePath();
      return true;
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * 0.62);
      ctx.lineTo(-s * 0.98, -s * 0.42);
      ctx.lineTo(-s * 0.45, 0);
      ctx.lineTo(0, -s * 0.8);
      ctx.lineTo(s * 0.45, 0);
      ctx.lineTo(s * 0.98, -s * 0.42);
      ctx.lineTo(s * 0.9, s * 0.62);
      ctx.closePath();
      return true;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.22);
      ctx.lineTo(-s * 0.56, -s * 0.74);
      ctx.lineTo(s * 0.56, -s * 0.74);
      ctx.lineTo(s, -s * 0.22);
      ctx.lineTo(0, s);
      ctx.closePath();
      return true;
    case 'coin':
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      return true;
    case 'flower':
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 5;
        const x = Math.cos(a) * s * 0.55;
        const y = Math.sin(a) * s * 0.55;
        ctx.moveTo(x + s * 0.45, y);
        ctx.arc(x, y, s * 0.45, 0, TAU);
      }
      return true;
    case 'clover': {
      // four hearts with their tips meeting in the middle (points rotated by hand:
      // transforming mid-path is not portable to every canvas backend)
      ctx.beginPath();
      const k = s * 0.55;
      const heart: [number, number][] = [
        [0, k * 0.85],
        [-k * 1.25, k * 0.05],
        [-k * 0.85, -k * 0.95],
        [0, -k * 0.38],
        [k * 0.85, -k * 0.95],
        [k * 1.25, k * 0.05],
        [0, k * 0.85],
      ];
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * TAU) / 4;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const p = heart.map(([x, y]) => [x * ca - (y - s * 0.5) * sa, x * sa + (y - s * 0.5) * ca] as const);
        ctx.moveTo(p[0][0], p[0][1]);
        ctx.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]);
        ctx.bezierCurveTo(p[4][0], p[4][1], p[5][0], p[5][1], p[6][0], p[6][1]);
        ctx.closePath();
      }
      return true;
    }
    case 'dollar':
      return false;
  }
}

/**
 * Draws a coin symbol in the Storybook style: a hard offset shadow in
 * `overprint` (down-right, no blur), then a flat `fill` with an ink line.
 * `emboss` draws only the flat silhouette in `fill` (a mark struck into the
 * coin: no line, no shadow, no inner details). `s` is the half-size.
 */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  kind: SymbolKind,
  s: number,
  o: { fill: string; ink: string; overprint: string; lineW: number; offX?: number; offY?: number; emboss?: boolean },
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const offX = o.offX ?? s * 0.12;
  const offY = o.offY ?? s * 0.12;

  if (kind === 'dollar') {
    const w = s * 0.34;
    const strokeS = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      sPath(ctx, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.stroke();
    };
    if (o.emboss) {
      strokeS(o.fill, w);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(offX, offY);
    strokeS(o.overprint, w + o.lineW * 2);
    ctx.restore();
    strokeS(o.ink, w + o.lineW * 2);
    strokeS(o.fill, w);
    ctx.restore();
    return;
  }

  if (o.emboss) {
    ctx.fillStyle = o.fill;
    silhouette(ctx, kind, s);
    ctx.fill();
    ctx.restore();
    return;
  }

  // hard shadow
  ctx.save();
  ctx.translate(offX, offY);
  ctx.fillStyle = o.overprint;
  ctx.strokeStyle = o.overprint;
  ctx.lineWidth = o.lineW * 2;
  silhouette(ctx, kind, s);
  ctx.stroke();
  ctx.fill();
  ctx.restore();

  // flat fill + ink line around the union of the shape: a double-width stroke under the fill
  ctx.fillStyle = o.fill;
  ctx.strokeStyle = o.ink;
  ctx.lineWidth = o.lineW * 2;
  silhouette(ctx, kind, s);
  ctx.stroke();
  ctx.fill();

  // inner details
  ctx.fillStyle = o.ink;
  ctx.lineWidth = o.lineW * 0.8;
  switch (kind) {
    case 'coin':
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.62, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.26, 0, TAU);
      ctx.fill();
      break;
    case 'flower':
      ctx.fillStyle = o.overprint;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, TAU);
      ctx.fill();
      ctx.stroke();
      break;
    case 'clover':
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * 0.2, s * 0.85, s * 0.7, s * 1.2);
      ctx.stroke();
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.22);
      ctx.lineTo(s, -s * 0.22);
      ctx.moveTo(-s * 0.3, -s * 0.22);
      ctx.lineTo(0, s);
      ctx.lineTo(s * 0.3, -s * 0.22);
      ctx.moveTo(-s * 0.3, -s * 0.22);
      ctx.lineTo(0, -s * 0.74);
      ctx.lineTo(s * 0.3, -s * 0.22);
      ctx.stroke();
      break;
    case 'crown':
      for (const x of [-s * 0.5, 0, s * 0.5]) {
        ctx.beginPath();
        ctx.arc(x, s * 0.32, s * 0.11, 0, TAU);
        ctx.fill();
      }
      break;
    default:
      break;
  }
  ctx.restore();
}

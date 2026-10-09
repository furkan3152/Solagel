import type { SymbolStyle } from '@solagel/shared';

const TAU = Math.PI * 2;

/** Traces a 5-point star path centred on (0,0). */
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

export function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.85);
  ctx.bezierCurveTo(-s * 1.25, s * 0.05, -s * 0.85, -s * 0.95, 0, -s * 0.38);
  ctx.bezierCurveTo(s * 0.85, -s * 0.95, s * 1.25, s * 0.05, 0, s * 0.85);
  ctx.closePath();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the symbol shape (filled with the current fillStyle / stroked with strokeStyle). */
function shape(ctx: CanvasRenderingContext2D, style: SymbolStyle, s: number): void {
  switch (style) {
    case 'solbars': {
      // three slanted bars (an original take on the three-bar mark)
      const w = s * 1.55;
      const h = s * 0.34;
      const k = s * 0.32;
      const rows = [-s * 0.62, 0, s * 0.62];
      const x0 = -w / 2;
      ctx.beginPath();
      rows.forEach((y, i) => {
        const top = y - h / 2;
        const bot = y + h / 2;
        if (i !== 1) {
          // leaning right: ▱
          ctx.moveTo(x0 + k, top);
          ctx.lineTo(x0 + w, top);
          ctx.lineTo(x0 + w - k, bot);
          ctx.lineTo(x0, bot);
        } else {
          // leaning left
          ctx.moveTo(x0, top);
          ctx.lineTo(x0 + w - k, top);
          ctx.lineTo(x0 + w, bot);
          ctx.lineTo(x0 + k, bot);
        }
        ctx.closePath();
      });
      ctx.fill();
      return;
    }
    case 'star':
      starPath(ctx, s, s * 0.45);
      ctx.fill();
      return;
    case 'heart':
      heartPath(ctx, s);
      ctx.fill();
      return;
    case 'drop':
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.35, -s * 0.45, s * 0.78, -s * 0.05, s * 0.78, s * 0.3);
      ctx.arc(0, s * 0.3, s * 0.78, 0, Math.PI, false);
      ctx.bezierCurveTo(-s * 0.78, -s * 0.05, -s * 0.35, -s * 0.45, 0, -s);
      ctx.closePath();
      ctx.fill();
      return;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(s * 0.25, -s);
      ctx.lineTo(-s * 0.55, s * 0.12);
      ctx.lineTo(-s * 0.02, s * 0.12);
      ctx.lineTo(-s * 0.25, s);
      ctx.lineTo(s * 0.58, -s * 0.18);
      ctx.lineTo(s * 0.04, -s * 0.18);
      ctx.closePath();
      ctx.fill();
      return;
    case 'gem':
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, -s * 0.25);
      ctx.lineTo(-s * 0.45, -s * 0.8);
      ctx.lineTo(s * 0.45, -s * 0.8);
      ctx.lineTo(s * 0.9, -s * 0.25);
      ctx.lineTo(0, s * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.globalAlpha *= 0.45;
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, -s * 0.25);
      ctx.lineTo(s * 0.9, -s * 0.25);
      ctx.moveTo(-s * 0.3, -s * 0.25);
      ctx.lineTo(0, s * 0.95);
      ctx.lineTo(s * 0.3, -s * 0.25);
      ctx.stroke();
      ctx.restore();
      return;
    case 'eth':
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.62, s * 0.05);
      ctx.lineTo(0, s * 0.36);
      ctx.lineTo(-s * 0.62, s * 0.05);
      ctx.closePath();
      ctx.moveTo(0, s * 0.5);
      ctx.lineTo(s * 0.62, s * 0.2);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.62, s * 0.2);
      ctx.closePath();
      ctx.fill();
      return;
    case 'paw': {
      ctx.beginPath();
      ctx.ellipse(0, s * 0.35, s * 0.52, s * 0.42, 0, 0, TAU);
      ctx.fill();
      const toes = [
        [-s * 0.62, -s * 0.12],
        [-s * 0.24, -s * 0.52],
        [s * 0.24, -s * 0.52],
        [s * 0.62, -s * 0.12],
      ];
      for (const [x, y] of toes) {
        ctx.beginPath();
        ctx.ellipse(x, y, s * 0.2, s * 0.26, 0, 0, TAU);
        ctx.fill();
      }
      return;
    }
    case 'lily':
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, s * 0.95, -Math.PI / 2 + 0.45, -Math.PI / 2 - 0.45 + TAU);
      ctx.closePath();
      ctx.fill();
      return;
    case 'bone':
      ctx.save();
      ctx.rotate(-0.6);
      roundRectPath(ctx, -s * 0.7, -s * 0.2, s * 1.4, s * 0.4, s * 0.15);
      ctx.fill();
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(sx * s * 0.72, sy * s * 0.22, s * 0.27, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      return;
    case 'moon':
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.9, Math.PI * 0.32, Math.PI * 1.68, false);
      ctx.arc(s * 0.38, -s * 0.05, s * 0.7, Math.PI * 1.55, Math.PI * 0.45, true);
      ctx.closePath();
      ctx.fill();
      starPath(ctx, s * 0.32, s * 0.13);
      ctx.save();
      ctx.translate(s * 0.55, -s * 0.48);
      starPath(ctx, s * 0.3, s * 0.12);
      ctx.fill();
      ctx.restore();
      return;
    case 'rocket':
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.45, -s * 0.6, s * 0.42, s * 0.2, s * 0.3, s * 0.55);
      ctx.lineTo(-s * 0.3, s * 0.55);
      ctx.bezierCurveTo(-s * 0.42, s * 0.2, -s * 0.45, -s * 0.6, 0, -s);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, s * 0.15);
      ctx.lineTo(-s * 0.62, s * 0.7);
      ctx.lineTo(-s * 0.25, s * 0.55);
      ctx.moveTo(s * 0.3, s * 0.15);
      ctx.lineTo(s * 0.62, s * 0.7);
      ctx.lineTo(s * 0.25, s * 0.55);
      ctx.fill();
      ctx.restore();
      return;
    case 'wave':
      ctx.lineWidth = s * 0.26;
      ctx.lineCap = 'round';
      for (const y of [-s * 0.35, s * 0.35]) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.9, y);
        ctx.bezierCurveTo(-s * 0.45, y - s * 0.45, -s * 0.15, y + s * 0.45, s * 0.2, y);
        ctx.bezierCurveTo(s * 0.45, y - s * 0.35, s * 0.7, y - s * 0.2, s * 0.9, y);
        ctx.stroke();
      }
      return;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(-s * 0.95, -s * 0.2);
      ctx.lineTo(-s * 0.55, -s * 0.72);
      ctx.lineTo(s * 0.55, -s * 0.72);
      ctx.lineTo(s * 0.95, -s * 0.2);
      ctx.lineTo(0, s * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.globalAlpha *= 0.5;
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(-s * 0.95, -s * 0.2);
      ctx.lineTo(s * 0.95, -s * 0.2);
      ctx.moveTo(-s * 0.55, -s * 0.72);
      ctx.lineTo(-s * 0.25, -s * 0.2);
      ctx.lineTo(0, -s * 0.72);
      ctx.lineTo(s * 0.25, -s * 0.2);
      ctx.lineTo(s * 0.55, -s * 0.72);
      ctx.moveTo(-s * 0.25, -s * 0.2);
      ctx.lineTo(0, s * 0.95);
      ctx.lineTo(s * 0.25, -s * 0.2);
      ctx.stroke();
      ctx.restore();
      return;
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(-s * 0.95, s * 0.6);
      ctx.lineTo(-s * 0.95, -s * 0.35);
      ctx.lineTo(-s * 0.45, s * 0.05);
      ctx.lineTo(0, -s * 0.75);
      ctx.lineTo(s * 0.45, s * 0.05);
      ctx.lineTo(s * 0.95, -s * 0.35);
      ctx.lineTo(s * 0.95, s * 0.6);
      ctx.closePath();
      ctx.fill();
      return;
    case 'shuriken':
      starPath(ctx, s, s * 0.3, 4, -Math.PI / 4);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    case 'chartUp':
    case 'chartDown': {
      const up = style === 'chartUp';
      ctx.lineWidth = s * 0.24;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = up
        ? [
            [-s * 0.9, s * 0.6],
            [-s * 0.35, s * 0.05],
            [0, s * 0.35],
            [s * 0.7, -s * 0.5],
          ]
        : [
            [-s * 0.9, -s * 0.6],
            [-s * 0.35, -s * 0.05],
            [0, -s * 0.35],
            [s * 0.7, s * 0.5],
          ];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      const [ex, ey] = pts[3];
      const a = Math.atan2(ey - pts[2][1], ex - pts[2][0]);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * s * 0.25, ey + Math.sin(a) * s * 0.25);
      ctx.lineTo(ex + Math.cos(a + 2.4) * s * 0.42, ey + Math.sin(a + 2.4) * s * 0.42);
      ctx.lineTo(ex + Math.cos(a - 2.4) * s * 0.42, ey + Math.sin(a - 2.4) * s * 0.42);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'cent':
    case 'dollar':
    case 'btc': {
      const glyph = style === 'cent' ? '¢' : style === 'dollar' ? '$' : 'B';
      ctx.font = `700 ${s * 2}px Fredoka, "Baloo 2", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, 0, s * 0.08);
      if (style === 'btc') {
        ctx.fillRect(-s * 0.28, -s * 1.05, s * 0.14, s * 0.32);
        ctx.fillRect(s * 0.02, -s * 1.05, s * 0.14, s * 0.32);
        ctx.fillRect(-s * 0.28, s * 0.78, s * 0.14, s * 0.32);
        ctx.fillRect(s * 0.02, s * 0.78, s * 0.14, s * 0.32);
      }
      return;
    }
    case 'none':
      return;
  }
}

/**
 * Embossed coin symbol: a soft dark offset copy (stamped look) under a
 * light copy. `s` is the symbol's half-size in local units.
 */
export function drawSymbol(ctx: CanvasRenderingContext2D, style: SymbolStyle, s: number, color: string, shadow: string): void {
  if (style === 'none') return;
  ctx.save();
  ctx.globalAlpha *= 0.32;
  ctx.fillStyle = shadow;
  ctx.strokeStyle = shadow;
  ctx.translate(s * 0.07, s * 0.09);
  shape(ctx, style, s);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= 0.92;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  shape(ctx, style, s);
  ctx.restore();
}

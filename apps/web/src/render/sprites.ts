import { INK, heartPath, starPath } from '@slana/art';
import { PowerUpType, getSkin } from '@slana/shared';

const TAU = Math.PI * 2;

/** Pastel coin colours for food variants 0..5: [face, rim]. */
export const FOOD_COLORS: [string, string][] = [
  ['#FFB3CF', '#E0638F'], // pink
  ['#A8F0D4', '#2FB283'], // mint
  ['#FFE58A', '#D9A21C'], // lemon
  ['#B4DCFF', '#4A92D6'], // sky
  ['#D6C6FF', '#8463E0'], // lavender
  ['#FFC9A3', '#D9773E'], // peach
];

type Sprite = { canvas: HTMLCanvasElement; size: number };

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  return [c, ctx];
}

/** Sprites are rendered once at high resolution and drawn scaled (radius → size/2 * 0.8). */
const SPRITE_FILL = 0.8;
export const spriteScale = (r: number, sprite: Sprite): number => (r * 2) / (sprite.size * SPRITE_FILL);

function coinSprite(face: string, rim: string, size = 64, star = false): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.35, face);
  g.addColorStop(1, rim);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, TAU);
  ctx.stroke();
  if (star) {
    ctx.fillStyle = '#FFF7D6';
    starPath(ctx, r * 0.42, r * 0.18);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, -r * 0.38, r * 0.2, r * 0.11, -0.6, 0, TAU);
  ctx.fill();
  return { canvas, size };
}

function gemSprite(size = 64): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const s = (size / 2) * SPRITE_FILL;
  const g = ctx.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, '#E9FFFF');
  g.addColorStop(0.5, '#8DF2FF');
  g.addColorStop(1, '#C59BFF');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#5A6FD6';
  ctx.lineWidth = s * 0.12;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.95, -s * 0.2);
  ctx.lineTo(-s * 0.5, -s * 0.75);
  ctx.lineTo(s * 0.5, -s * 0.75);
  ctx.lineTo(s * 0.95, -s * 0.2);
  ctx.lineTo(0, s * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.moveTo(-s * 0.95, -s * 0.2);
  ctx.lineTo(s * 0.95, -s * 0.2);
  ctx.moveTo(-s * 0.3, -s * 0.2);
  ctx.lineTo(0, s * 0.85);
  ctx.lineTo(s * 0.3, -s * 0.2);
  ctx.stroke();
  return { canvas, size };
}

function goldSprite(size = 96): Sprite {
  const sprite = coinSprite('#FFD54A', '#C98A00', size, true);
  const ctx = sprite.canvas.getContext('2d')!;
  // soft glow behind is drawn at runtime (pulsing); add a sparkle here
  ctx.setTransform(1, 0, 0, 1, size / 2, size / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.save();
  ctx.translate(size * 0.24, -size * 0.24);
  starPath(ctx, size * 0.09, size * 0.03, 4, 0);
  ctx.fill();
  ctx.restore();
  return sprite;
}

/** Rug cactus: a round spiky cactus with a pink flower and a sleepy smile. */
function cactusSprite(size = 256): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL * 0.86;
  const spikes = 22;
  // spikes
  ctx.fillStyle = '#FFF8E7';
  ctx.strokeStyle = '#2E7D4F';
  ctx.lineWidth = size * 0.012;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * TAU;
    const a0 = a - 0.09;
    const a1 = a + 0.09;
    ctx.moveTo(Math.cos(a0) * r * 0.92, Math.sin(a0) * r * 0.92);
    ctx.lineTo(Math.cos(a) * r * 1.18, Math.sin(a) * r * 1.18);
    ctx.lineTo(Math.cos(a1) * r * 0.92, Math.sin(a1) * r * 0.92);
  }
  ctx.fill();
  ctx.stroke();
  // body
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#B8F5A0');
  g.addColorStop(0.55, '#5FCB6E');
  g.addColorStop(1, '#2F9E57');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // ribs
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(30,110,60,0.22)';
  ctx.lineWidth = r * 0.05;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.abs(i) * r * 0.3 + r * 0.05, r * 1.02, 0, -Math.PI / 2, Math.PI / 2, i < 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = '#237A45';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  // little white dots (prickles)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996;
    const d = r * (0.25 + ((i * 37) % 60) / 100);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.025, 0, TAU);
    ctx.fill();
  }
  // face: mischievous eyes with slanted brows and a smirk (it *will* rug you)
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.28, r * 0.06, r * 0.075, r * 0.095, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(s * r * 0.28 - r * 0.025, r * 0.03, r * 0.028, 0, TAU);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.lineWidth = r * 0.055;
    ctx.beginPath();
    ctx.moveTo(s * r * 0.42, -r * 0.1);
    ctx.lineTo(s * r * 0.15, -r * 0.03);
    ctx.stroke();
  }
  ctx.lineWidth = r * 0.055;
  ctx.beginPath();
  ctx.moveTo(-r * 0.12, r * 0.25);
  ctx.quadraticCurveTo(r * 0.04, r * 0.33, r * 0.16, r * 0.2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,160,0.5)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.5, r * 0.25, r * 0.11, r * 0.06, 0, 0, TAU);
    ctx.fill();
  }
  // flower
  ctx.save();
  ctx.translate(r * 0.15, -r * 0.88);
  ctx.fillStyle = '#FF8FB8';
  ctx.strokeStyle = '#D14C7E';
  ctx.lineWidth = r * 0.03;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i / 5) * TAU);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.13, r * 0.08, r * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#FFE873';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.07, 0, TAU);
  ctx.fill();
  ctx.restore();
  return { canvas, size };
}

function powerUpSprite(type: PowerUpType, size = 128): Sprite {
  const [canvas, ctx] = makeCanvas(size);
  const r = (size / 2) * SPRITE_FILL;
  const palette: Record<PowerUpType, [string, string]> = {
    [PowerUpType.Magnet]: ['#FFD1E1', '#FF5C93'],
    [PowerUpType.Pump]: ['#FFE6C2', '#FF9F2E'],
    [PowerUpType.Shield]: ['#D6F0FF', '#4A9EE0'],
    [PowerUpType.Bag]: ['#FFF3B8', '#E6AD00'],
  };
  const [light, main] = palette[type];
  // capsule bubble
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.5, light);
  g.addColorStop(1, main);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = main;
  ctx.stroke();
  ctx.lineWidth = r * 0.05;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.setLineDash([r * 0.18, r * 0.12]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // icon
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (type) {
    case PowerUpType.Magnet: {
      ctx.lineWidth = r * 0.22;
      ctx.strokeStyle = '#E8335F';
      ctx.beginPath();
      ctx.arc(0, -r * 0.02, r * 0.32, Math.PI, 0, true);
      ctx.moveTo(-r * 0.32, -r * 0.02);
      ctx.lineTo(-r * 0.32, -r * 0.3);
      ctx.moveTo(r * 0.32, -r * 0.02);
      ctx.lineTo(r * 0.32, -r * 0.3);
      ctx.stroke();
      ctx.strokeStyle = '#E9EEF5';
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(-r * 0.32, -r * 0.3);
      ctx.lineTo(-r * 0.32, -r * 0.45);
      ctx.moveTo(r * 0.32, -r * 0.3);
      ctx.lineTo(r * 0.32, -r * 0.45);
      ctx.stroke();
      break;
    }
    case PowerUpType.Pump: {
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#E2541B';
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.bezierCurveTo(r * 0.25, -r * 0.3, r * 0.22, r * 0.1, r * 0.16, r * 0.28);
      ctx.lineTo(-r * 0.16, r * 0.28);
      ctx.bezierCurveTo(-r * 0.22, r * 0.1, -r * 0.25, -r * 0.3, 0, -r * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7CC8FF';
      ctx.beginPath();
      ctx.arc(0, -r * 0.12, r * 0.08, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#FF9F2E';
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, r * 0.3);
      ctx.lineTo(0, r * 0.55);
      ctx.lineTo(r * 0.12, r * 0.3);
      ctx.fill();
      ctx.restore();
      break;
    }
    case PowerUpType.Shield: {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#2D72B0';
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.48);
      ctx.quadraticCurveTo(r * 0.3, -r * 0.36, r * 0.4, -r * 0.36);
      ctx.quadraticCurveTo(r * 0.42, r * 0.22, 0, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.42, r * 0.22, -r * 0.4, -r * 0.36);
      ctx.quadraticCurveTo(-r * 0.3, -r * 0.36, 0, -r * 0.48);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7CC8FF';
      heartPath(ctx, r * 0.16);
      ctx.fill();
      break;
    }
    case PowerUpType.Bag: {
      ctx.fillStyle = '#F2C14E';
      ctx.strokeStyle = '#9C6A00';
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.3);
      ctx.quadraticCurveTo(-r * 0.5, -r * 0.1, -r * 0.42, r * 0.25);
      ctx.quadraticCurveTo(-r * 0.35, r * 0.48, 0, r * 0.48);
      ctx.quadraticCurveTo(r * 0.35, r * 0.48, r * 0.42, r * 0.25);
      ctx.quadraticCurveTo(r * 0.5, -r * 0.1, r * 0.12, -r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.14, -r * 0.3);
      ctx.lineTo(-r * 0.24, -r * 0.48);
      ctx.lineTo(r * 0.24, -r * 0.48);
      ctx.lineTo(r * 0.14, -r * 0.3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7A4E00';
      ctx.font = `700 ${r * 0.48}px Fredoka, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, r * 0.12);
      break;
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.4, -r * 0.5, r * 0.2, r * 0.1, -0.6, 0, TAU);
  ctx.fill();
  return { canvas, size };
}

function ejectSprite(skinId: number, size = 64): Sprite {
  const skin = getSkin(skinId);
  return coinSprite(skin.colors.base, skin.colors.rim, size);
}

/** Lazily created, cached sprites. Must only be used in the browser. */
export class SpriteCache {
  private food: Sprite[] | null = null;
  private cactus: Sprite | null = null;
  private powerUps = new Map<number, Sprite>();
  private ejects = new Map<number, Sprite>();

  foodSprite(variant: number): Sprite {
    if (!this.food) {
      this.food = [...FOOD_COLORS.map(([f, r]) => coinSprite(f, r, 48)), gemSprite(56), goldSprite(96)];
    }
    return this.food[variant] ?? this.food[0];
  }

  cactusSprite(): Sprite {
    return (this.cactus ??= cactusSprite(320));
  }

  powerUpSprite(type: number): Sprite {
    let s = this.powerUps.get(type);
    if (!s) {
      s = powerUpSprite(type as PowerUpType, 160);
      this.powerUps.set(type, s);
    }
    return s;
  }

  ejectSprite(skin: number): Sprite {
    let s = this.ejects.get(skin);
    if (!s) {
      s = ejectSprite(skin, 72);
      this.ejects.set(skin, s);
    }
    return s;
  }
}

/** Draws a cached sprite centred at (x, y) with world radius r. */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, r: number, rot = 0): void {
  const s = spriteScale(r, sprite);
  const half = (sprite.size * s) / 2;
  if (rot === 0) {
    ctx.drawImage(sprite.canvas, x - half, y - half, sprite.size * s, sprite.size * s);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sprite.canvas, -half, -half, sprite.size * s, sprite.size * s);
    ctx.restore();
  }
}

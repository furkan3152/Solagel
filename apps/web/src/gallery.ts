import { CellFlag, ELYSIUM, PowerUpType, SKINS, getSkin } from '@elymum/shared';
import { drawCoin } from './render/coin';
import type { Expression } from '@elymum/art';
import { JellyBody } from './render/jelly';
import { SpriteCache, drawSprite } from './render/sprites';

const DISPLAY = '800 28px "Fraunces Variable", Fraunces, Georgia, serif';
const MONO = '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';
const HEIGHT = 1240;

/** Design sheet: every skin, mood and world item on the night floor (open with ?coins). */
export function startGallery(root: HTMLElement): void {
  document.body.style.margin = '0';
  document.body.style.background = ELYSIUM.trench;
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const sprites = new SpriteCache();
  const jellies = SKINS.map(() => new JellyBody());
  let rand = 1;
  const rng = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  const exprs: Expression[] = ['happy', 'proud', 'smug', 'hungry', 'chomp', 'scared', 'love', 'sleep', 'dead'];

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${HEIGHT}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const heading = (text: string, x: number, y: number) => {
    ctx.fillStyle = ELYSIUM.cream;
    ctx.font = DISPLAY;
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
  };
  const caption = (text: string, x: number, y: number) => {
    ctx.fillStyle = ELYSIUM.foam;
    ctx.font = `500 12px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(text.toUpperCase(), x, y);
  };

  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    const w = window.innerWidth;
    ctx.fillStyle = ELYSIUM.trench;
    ctx.fillRect(0, 0, w, HEIGHT);
    heading('Elymum · the cast', 24, 44);

    const cols = 8;
    const cell = Math.min(160, (w - 40) / cols);
    SKINS.forEach((skin, i) => {
      const cx = 20 + (i % cols) * cell + cell / 2;
      const cy = 90 + Math.floor(i / cols) * (cell + 34) + cell / 2;
      const r = cell * 0.32;
      jellies[i].update(dt, r, r, Math.cos(now / 900 + i) * 0.6, Math.sin(now / 900 + i) * 0.6, [], rng);
      drawCoin(ctx, cx, cy, r, skin, {
        time: now,
        lookX: Math.cos(now / 1200 + i),
        lookY: Math.sin(now / 1500 + i) * 0.6,
        expression: 'happy',
        pxPerUnit: 1,
        jelly: jellies[i],
        seed: i,
        flags: i === 16 ? CellFlag.Shield : 0,
      });
      caption(`${skin.id} · ${skin.name}`, cx, cy + r + 30);
    });

    const ey = 90 + Math.ceil(SKINS.length / cols) * (cell + 34) + 30;
    heading('Moods', 24, ey);
    exprs.forEach((e, i) => {
      const cx = 70 + i * 120;
      drawCoin(ctx, cx, ey + 74, 46, getSkin(i % 8), { time: now, lookX: 0.6, lookY: 0.2, expression: e, pxPerUnit: 1, seed: 3 });
      caption(e, cx, ey + 150);
    });

    const iy = ey + 210;
    heading('On the floor', 24, iy);
    for (let v = 0; v < 8; v++) drawSprite(ctx, sprites.foodSprite(v), 50 + v * 50, iy + 60, v === 7 ? 16 : v === 6 ? 14 : 12);
    drawSprite(ctx, sprites.lootSprite(), 470, iy + 60, 20);
    drawSprite(ctx, sprites.cactusSprite(), 580, iy + 64, 60, Math.sin(now / 700) * 0.04);
    [PowerUpType.Magnet, PowerUpType.Pump, PowerUpType.Shield, PowerUpType.Bag].forEach((t, i) =>
      drawSprite(ctx, sprites.powerUpSprite(t), 720 + i * 90, iy + 60, 36),
    );
    for (let s = 0; s < 8; s++) drawSprite(ctx, sprites.ejectSprite(s), 1100 + s * 44, iy + 60, 16);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

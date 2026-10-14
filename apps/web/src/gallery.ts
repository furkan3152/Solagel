import { CellFlag, PowerUpType, SKINS, getSkin } from '@slana/shared';
import { drawCoin } from './render/coin';
import type { Expression } from './render/faces';
import { JellyBody } from './render/jelly';
import { SpriteCache, drawSprite } from './render/sprites';

/** Design sheet: every skin, expression and world item (open with ?gallery). */
export function startGallery(root: HTMLElement): void {
  document.body.style.margin = '0';
  document.body.style.background = '#FFF6E9';
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const sprites = new SpriteCache();
  const jellies = SKINS.map(() => new JellyBody());
  let rand = 1;
  const rng = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  const exprs: Expression[] = ['happy', 'hungry', 'scared', 'proud', 'love', 'sleep', 'dead'];

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = 1180 * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = '1180px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    const w = window.innerWidth;
    ctx.clearRect(0, 0, w, 1180);
    ctx.fillStyle = '#3D2C5E';
    ctx.font = '700 28px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Slana · skin sheet', 24, 40);

    const cols = 8;
    const cell = Math.min(160, (w - 40) / cols);
    SKINS.forEach((skin, i) => {
      const cx = 20 + (i % cols) * cell + cell / 2;
      const cy = 80 + Math.floor(i / cols) * (cell + 34) + cell / 2;
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
      ctx.fillStyle = '#3D2C5E';
      ctx.font = '600 14px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${skin.id} · ${skin.name.en}`, cx, cy + r + 30);
    });

    const ey = 80 + 3 * (cell + 34) + 40;
    ctx.textAlign = 'left';
    ctx.font = '700 18px Fredoka, system-ui, sans-serif';
    ctx.fillText('Expressions', 24, ey);
    exprs.forEach((e, i) => {
      const cx = 70 + i * 120;
      drawCoin(ctx, cx, ey + 70, 46, getSkin(i === 3 ? 4 : 0), { time: now, lookX: 0.6, lookY: 0.2, expression: e, pxPerUnit: 1, seed: 3 });
      ctx.fillStyle = '#3D2C5E';
      ctx.font = '600 13px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(e, cx, ey + 140);
    });

    const iy = ey + 210;
    ctx.textAlign = 'left';
    ctx.font = '700 18px Fredoka, system-ui, sans-serif';
    ctx.fillText('World items', 24, iy);
    for (let v = 0; v < 8; v++) drawSprite(ctx, sprites.foodSprite(v), 50 + v * 50, iy + 50, v === 7 ? 16 : v === 6 ? 12 : 10);
    drawSprite(ctx, sprites.cactusSprite(), 520, iy + 60, 60, now / 4000);
    [PowerUpType.Magnet, PowerUpType.Pump, PowerUpType.Shield, PowerUpType.Bag].forEach((t, i) =>
      drawSprite(ctx, sprites.powerUpSprite(t), 640 + i * 90, iy + 55, 36),
    );
    for (let s = 0; s < 6; s++) drawSprite(ctx, sprites.ejectSprite(s * 3), 1020 + s * 44, iy + 55, 18);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

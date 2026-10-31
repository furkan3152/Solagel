import type { CoinLook, Expression } from '@elymum/art';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../design';
import { drawCoinLook } from '../../render/coin';
import { JellyBody } from '../../render/jelly';
import { LookCache } from '../../render/looks';
import { canvasDpr } from '../../render/renderer';
import { useTicker } from '../ticker';

// one look cache for every portrait
const looks = new LookCache();

let rng = 41;
const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);

/** A coin character on its own canvas. */
export function CoinPortrait({
  skin,
  size,
  expression = 'happy',
  seed = 1,
  className,
  still = false,
  look,
}: {
  skin: number;
  size: number;
  expression?: Expression;
  seed?: number;
  className?: string;
  /** Draw once, no animation loop (grids of many portraits). */
  still?: boolean;
  /** An explicit look instead of the basic `skin`. */
  look?: CoinLook;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const jelly = useRef(new JellyBody());
  const reduced = useReducedMotion();

  const draw = (now: number, dt: number) => {
    const c = ref.current;
    if (!c) return;
    const dpr = canvasDpr();
    const px = Math.round(size * dpr);
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = size * 0.36;
    const lx = reduced ? 0 : Math.cos(now / 1400 + seed) * 0.4;
    const ly = reduced ? 0.2 : Math.sin(now / 1700 + seed) * 0.25;
    if (!reduced) jelly.current.update(dt, r, r, lx * 0.5, ly * 0.5, [], rand);
    drawCoinLook(ctx, size / 2, size / 2 + size * 0.05, r, look ?? looks.lookFor(skin), {
      time: reduced ? 0 : now,
      lookX: lx,
      lookY: ly,
      expression,
      pxPerUnit: dpr,
      jelly: reduced ? null : jelly.current,
      seed,
    });
  };

  const loop = !reduced && !still;
  useTicker(draw, loop);
  useEffect(() => {
    if (!loop) draw(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin, size, expression, loop, look]);

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}

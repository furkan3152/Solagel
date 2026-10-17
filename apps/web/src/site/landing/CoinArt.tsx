import type { CoinLook, Expression } from '@slana/art';
import { useEffect, useRef, useState } from 'react';
import { drawCoinLook } from '../../render/coin';
import { JellyBody } from '../../render/jelly';
import { useTicker } from '../../ui/ticker';

let rng = 7;
const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);

/**
 * One riso coin on its own small canvas. It animates (blinks, wobbles, looks around) only while
 * on screen and when motion is allowed; otherwise it is drawn once.
 */
export function CoinArt({ look, size, expression = 'happy', still, seed = 1, className }: { look: CoinLook; size: number; expression?: Expression; still: boolean; seed?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const jelly = useRef(new JellyBody());
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver((e) => setInView(e.some((x) => x.isIntersecting)), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const draw = (now: number, dt: number) => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = size * 0.36;
    const moving = !still && now > 0;
    const lx = moving ? Math.cos(now / 1300 + seed) * 0.5 : 0.1;
    const ly = moving ? Math.sin(now / 1700 + seed) * 0.3 : 0.2;
    if (moving) jelly.current.update(Math.min(dt, 0.05), r, r * dpr, lx * 0.4, ly * 0.4, [], rand);
    drawCoinLook(ctx, size / 2, size / 2 + size * 0.04, r, look, {
      time: moving ? now : 0,
      lookX: lx,
      lookY: ly,
      expression,
      pxPerUnit: dpr,
      jelly: moving ? jelly.current : null,
      seed,
    });
  };

  const loop = !still && inView;
  useTicker(draw, loop);
  useEffect(() => {
    if (!loop) draw(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, size, expression, loop]);

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}

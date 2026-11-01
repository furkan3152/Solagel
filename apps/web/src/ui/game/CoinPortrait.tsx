import { PICTURE_R, type CoinLook, type Expression } from '@elymum/art';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../design';
import { avatars } from '../../render/avatars';
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
  avatar,
  picture,
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
  /** A profile picture id (loaded through the shared cache) worn on the face. */
  avatar?: string | null;
  /** A picture already at hand (the crop preview), cut to a disc or not: drawn clipped to the face. */
  picture?: CanvasImageSource | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const jelly = useRef(new JellyBody());
  const reduced = useReducedMotion();
  // redraw once the picture arrives
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    if (!avatar) return;
    avatars.request(avatar);
    return avatars.subscribe((id) => id === avatar && setLoaded((n) => n + 1));
  }, [avatar]);

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
    const pic = picture ?? (avatar ? avatars.disc(avatar, r * 2 * PICTURE_R * dpr) : null);
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
      picture: pic,
    });
  };

  const loop = !reduced && !still;
  useTicker(draw, loop);
  useEffect(() => {
    if (!loop) draw(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin, size, expression, loop, look, avatar, picture, loaded]);

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}

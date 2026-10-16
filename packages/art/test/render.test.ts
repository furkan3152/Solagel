import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawRisoCoin, lookForBasicSkin, type CoinLook } from '../src/index';

const hex = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
const ctx2d = (c: { getContext(t: "2d"): unknown }) => c.getContext('2d') as unknown as CanvasRenderingContext2D;
const near = (a: ArrayLike<number>, b: [number, number, number], tol: number) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

/** A look that wears every layer (accessory in front and behind, a symbol on the hat). */
const DRESSED: CoinLook = { ...lookForBasicSkin(0), symbol: 'crown', eyes: 'sunglasses', mouth: 'fang', accessory: 'cap' };

describe('drawRisoCoin', () => {
  it('fills the centre with the body ink', () => {
    for (const look of [lookForBasicSkin(0), lookForBasicSkin(4), DRESSED]) {
      const c = createCanvas(256, 256);
      const ctx = ctx2d(c);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 256, 256);
      ctx.translate(128, 128);
      drawRisoCoin(ctx, look, 90, { time: 0, lookX: 0, lookY: 0, expression: 'happy' });
      const px = ctx.getImageData(128, 128, 1, 1).data;
      expect(px[3]).toBe(255);
      expect(near(px, hex(look.body), 12)).toBe(true);
    }
  });

  it('draws every expression without throwing', () => {
    const c = createCanvas(128, 128);
    const ctx = ctx2d(c);
    ctx.translate(64, 64);
    for (const expression of ['happy', 'hungry', 'scared', 'sleep', 'dead', 'love', 'proud'] as const) {
      drawRisoCoin(ctx, DRESSED, 40, { time: 1234, lookX: 0.5, lookY: -0.3, expression, flags: 1 | 2 | 16 });
    }
  });
});

describe('flag effects keep the caller alpha', () => {
  it('never raises globalAlpha above the coin alpha (cash-out ring, magnet, zzz)', () => {
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    ctx.translate(128, 128);
    // record every globalAlpha write while forwarding to the real accessor
    let proto: object | null = Object.getPrototypeOf(ctx);
    let desc: PropertyDescriptor | undefined;
    while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, 'globalAlpha'))) proto = Object.getPrototypeOf(proto);
    const writes: number[] = [];
    Object.defineProperty(ctx, 'globalAlpha', {
      configurable: true,
      get: () => desc!.get!.call(ctx),
      set: (v: number) => {
        writes.push(v);
        desc!.set!.call(ctx, v);
      },
    });
    // CashingOut | Magnet | Afk
    drawRisoCoin(ctx, lookForBasicSkin(2), 80, { time: 450, lookX: 0, lookY: 0, expression: 'happy', alpha: 0.5, flags: 2 | 4 | 16 });
    expect(writes.length).toBeGreaterThan(3);
    for (const a of writes) expect(a).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

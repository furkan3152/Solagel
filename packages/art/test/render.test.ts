import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { ELYSIUM, INK, SHADE, coinOutlinePx, drawCoinInterior, drawRisoCoin, lookForBasicSkin, shadeOf, type CoinLook } from '../src/index';

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

  it('is deterministic: the same look and state give the same bytes', () => {
    const shot = (look: CoinLook) => {
      const c = createCanvas(160, 160);
      const ctx = ctx2d(c);
      ctx.translate(80, 80);
      drawRisoCoin(ctx, look, 60, { time: 777, lookX: 0.2, lookY: -0.1, expression: 'proud', seed: 42, flags: 1 | 2 | 4 | 16 });
      return Buffer.from(ctx.getImageData(0, 0, 160, 160).data);
    };
    for (const look of [lookForBasicSkin(1), lookForBasicSkin(7), DRESSED]) expect(shot(look).equals(shot(look))).toBe(true);
  });

  it('draws every mood and every eye shape without throwing', () => {
    const c = createCanvas(128, 128);
    const ctx = ctx2d(c);
    ctx.translate(64, 64);
    for (const expression of ['happy', 'hungry', 'scared', 'sleep', 'dead', 'love', 'proud', 'smug', 'chomp'] as const) {
      drawRisoCoin(ctx, DRESSED, 40, { time: 1234, lookX: 0.5, lookY: -0.3, expression, flags: 1 | 2 | 16 });
      for (const eyes of ['round', 'sleepy', 'wink', 'determined', 'star', 'heart', 'sunglasses', 'dizzy'] as const) {
        drawRisoCoin(ctx, { ...lookForBasicSkin(3), eyes }, 40, { time: 0, lookX: 0, lookY: 0, expression });
      }
    }
  });

  it('is cel shaded: flat paint upper left, its one shade tone lower right, an ink outline', () => {
    const look = lookForBasicSkin(0);
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    ctx.fillStyle = ELYSIUM.trench;
    ctx.fillRect(0, 0, 256, 256);
    ctx.translate(128, 128);
    drawRisoCoin(ctx, look, 100, { time: 0, lookX: 0, lookY: 0, expression: 'happy' });
    const at = (x: number, y: number) => ctx.getImageData(128 + x, 128 + y, 1, 1).data;
    // lower-right crescent (inside the rim, outside the lit disc)
    expect(near(at(64, 64), hex(SHADE.cyan), 10)).toBe(true);
    // a lit spot on the cheek line, away from the face and the highlight
    expect(near(at(-50, 40), hex(ELYSIUM.cyan), 10)).toBe(true);
    // the outline at 3 px on screen (pxPerUnit 1)
    expect(near(at(0, 99), hex(INK), 16)).toBe(true);
    expect(near(at(-100, 0), hex(INK), 16)).toBe(true);
  });

  it('the cached interior matches the drawn body', () => {
    const look = lookForBasicSkin(1);
    const a = createCanvas(160, 160);
    const ca = ctx2d(a);
    ca.translate(80, 80);
    drawCoinInterior(ca, look, 70);
    const px = ca.getImageData(80 + 40, 80 + 40, 1, 1).data;
    expect(near(px, hex(SHADE.sun), 10)).toBe(true);
  });
});

describe('ink and paint helpers', () => {
  it('outlines stay about 3 px on screen and thin out on tiny coins', () => {
    expect(coinOutlinePx(60)).toBe(3);
    expect(coinOutlinePx(150)).toBe(3);
    expect(coinOutlinePx(10)).toBeLessThan(2);
    expect(coinOutlinePx(2)).toBe(1);
    expect(coinOutlinePx(1000)).toBeLessThanOrEqual(4.5);
  });

  it('shadeOf: the palette shade for a paint, a darker tone otherwise', () => {
    expect(shadeOf(ELYSIUM.sun)).toBe(SHADE.sun);
    expect(shadeOf(ELYSIUM.cyan.toLowerCase())).toBe(SHADE.cyan);
    const d = hex(shadeOf('#808080'));
    expect(d[0]).toBeLessThan(128);
  });

  it('the basic skins wear the Storybook coin paints', () => {
    const paints = new Set<string>(Object.values(ELYSIUM));
    for (let i = 0; i < 8; i++) {
      const l = lookForBasicSkin(i);
      expect(paints.has(l.body)).toBe(true);
      expect(l.shade).toBe(shadeOf(l.body));
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

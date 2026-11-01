import { describe, expect, it } from 'vitest';
import { FrameGovernor, qualityLevels } from '../src/render/governor';

/** Feeds `ms` of frames at a fixed interval; returns the time reached. */
function run(g: FrameGovernor, from: number, ms: number, interval: number, active = true): number {
  let t = from;
  while (t < from + ms) {
    t += interval;
    g.frame(t, active);
  }
  return t;
}

describe('qualityLevels', () => {
  it('lowers the resolution first (with the invisible savings), the low look only as the last level', () => {
    expect(qualityLevels(2)).toEqual([
      { dpr: 2, lite: false, low: false },
      { dpr: 1.7, lite: true, low: false },
      { dpr: 1.4, lite: true, low: false },
      { dpr: 1.2, lite: true, low: false },
      { dpr: 1, lite: true, low: false },
      { dpr: 1, lite: true, low: true },
    ]);
  });

  it('a phone (capped at 1.5) steps down to 0.75 device px per CSS px, never lower', () => {
    expect(qualityLevels(1.5).map((l) => l.dpr)).toEqual([1.5, 1.27, 1.05, 0.9, 0.75, 0.75]);
    expect(qualityLevels(1)).toEqual([
      { dpr: 1, lite: false, low: false },
      { dpr: 0.85, lite: true, low: false },
      { dpr: 0.75, lite: true, low: false },
      { dpr: 0.75, lite: true, low: true },
    ]);
    for (const d of [1, 1.25, 1.5, 2, 3]) for (const l of qualityLevels(d)) expect(l.dpr).toBeGreaterThanOrEqual(0.75);
  });

  it('only the last level simplifies the look', () => {
    for (const d of [1, 1.5, 2]) {
      const levels = qualityLevels(d);
      expect(levels.filter((l) => l.low)).toHaveLength(1);
      expect(levels[levels.length - 1].low).toBe(true);
      expect(levels[0]).toEqual({ dpr: d, lite: false, low: false });
    }
  });
});

describe('FrameGovernor', () => {
  const make = (levels = 3) => {
    const g = new FrameGovernor();
    g.maxLevel = levels;
    return g;
  };

  it('keeps full quality at the display rate', () => {
    const g = make();
    run(g, 0, 20_000, 1000 / 60);
    expect(g.level).toBe(0);
    run(g, 20_000, 20_000, 1000 / 120);
    expect(g.level).toBe(0);
    expect(g.refreshMs).toBeCloseTo(1000 / 120);
  });

  it('drops a level after frames stay slow, and keeps it when it helps', () => {
    const g = make();
    // 40 ms frames are far too slow for 60 Hz: the first drop comes within about 2 s
    let t = run(g, 0, 3000, 40);
    expect(g.level).toBe(1);
    // the drop helped: 20 ms frames (still a bit slow, not enough for another drop)
    t = run(g, t, 6000, 20);
    expect(g.level).toBe(1);
    // fast again for long enough: back up
    run(g, t, 15_000, 1000 / 60);
    expect(g.level).toBe(0);
  });

  it('undoes a drop that did not help (a 30 Hz cap) and stays put', () => {
    const g = make();
    let t = run(g, 0, 4000, 1000 / 30);
    expect(g.level).toBe(1);
    t = run(g, t, 3000, 1000 / 30);
    expect(g.level).toBe(0);
    run(g, t, 30_000, 1000 / 30);
    expect(g.level).toBe(0);
  });

  it('walks down to the low look when every level helps a little', () => {
    const g = make(3);
    // each level makes frames 15 % faster, still slow
    let t = 0;
    while (t < 30_000) g.frame((t += 60 * 0.85 ** g.level));
    expect(g.level).toBe(3);
  });

  it('ignores inactive frames and long gaps (hidden tab)', () => {
    const g = make();
    let t = run(g, 0, 10_000, 50, false);
    expect(g.level).toBe(0);
    for (let i = 0; i < 40; i++) g.frame((t += 1000));
    expect(g.level).toBe(0);
  });

  it('a phone under 10 fps still gets its drops (slow frames are frames, not a hidden tab)', () => {
    const g = make(4);
    let t = 0;
    // 180 ms frames, a little faster at each level
    while (t < 20_000) g.frame((t += 180 * 0.85 ** g.level));
    expect(g.level).toBeGreaterThanOrEqual(3);
  });

  it('drops later when frames are only a little slow', () => {
    const g = make();
    // 28 ms: slow, not far too slow (the 2.5 s wait)
    let t = run(g, 0, 2500, 28);
    expect(g.level).toBe(0);
    t = run(g, t, 1500, 28);
    expect(g.level).toBe(1);
  });

  it('returns to level 0 when switched off', () => {
    const g = make();
    const t = run(g, 0, 3000, 40);
    expect(g.level).toBe(1);
    g.enabled = false;
    expect(g.frame(t + 16)).toBe(true);
    expect(g.level).toBe(0);
  });
});

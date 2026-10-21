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
  it('steps the resolution down on high-DPI screens, then the low look', () => {
    expect(qualityLevels(2)).toEqual([
      { dpr: 2, low: false },
      { dpr: 1.7, low: false },
      { dpr: 1.4, low: false },
      { dpr: 1.4, low: true },
    ]);
  });

  it('never goes below one device px per CSS px', () => {
    expect(qualityLevels(1)).toEqual([
      { dpr: 1, low: false },
      { dpr: 1, low: true },
    ]);
    expect(qualityLevels(1.25).map((l) => l.dpr)).toEqual([1.25, 1.06, 1, 1]);
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
    let t = run(g, 0, 4000, 40);
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

  it('returns to level 0 when switched off', () => {
    const g = make();
    const t = run(g, 0, 4000, 40);
    expect(g.level).toBe(1);
    g.enabled = false;
    expect(g.frame(t + 16)).toBe(true);
    expect(g.level).toBe(0);
  });
});

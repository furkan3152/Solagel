import { describe, expect, it } from 'vitest';
import { RULES, roundAt } from '../src';

describe('arena round clock', () => {
  it('defaults to 5-minute rounds whose joins close in the last minute', () => {
    expect(RULES.roundMs).toBe(300_000);
    expect(RULES.roundJoinCloseMs).toBe(60_000);
  });

  it('aligns rounds to Unix time', () => {
    const t = 1_791_000_123_456;
    const r = roundAt(t);
    expect(r.n).toBe(Math.floor(t / 300_000));
    expect(r.startsAt).toBe(r.n * 300_000);
    expect(r.endsAt).toBe(r.startsAt + 300_000);
    expect(r.joinsCloseAt).toBe(r.endsAt - 60_000);
    expect(r.startsAt).toBeLessThanOrEqual(t);
    expect(t).toBeLessThan(r.endsAt);
  });

  it('opens the next round exactly at the end of the previous one', () => {
    const start = 600_000 * 3000;
    expect(roundAt(start - 1).n).toBe(roundAt(start).n - 1);
    expect(roundAt(start - 1).endsAt).toBe(start);
    expect(roundAt(start)).toEqual({ n: start / 300_000, startsAt: start, endsAt: start + 300_000, joinsCloseAt: start + 240_000 });
    // the closing instant belongs to the closed window
    const r = roundAt(start);
    expect(roundAt(r.joinsCloseAt).n).toBe(r.n);
    expect(roundAt(r.endsAt - 1).n).toBe(r.n);
  });

  it('takes other lengths (tests, localnet e2e)', () => {
    expect(roundAt(95_000, 30_000, 5_000)).toEqual({ n: 3, startsAt: 90_000, endsAt: 120_000, joinsCloseAt: 115_000 });
    expect(roundAt(0, 30_000, 0)).toEqual({ n: 0, startsAt: 0, endsAt: 30_000, joinsCloseAt: 30_000 });
  });
});

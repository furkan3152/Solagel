import { describe, expect, it } from 'vitest';
import { runIntegritySim } from '../scripts/integrity-sim';

describe('integrity simulation (scripts/integrity-sim.ts)', () => {
  it('honest players raise no flag at the default thresholds', () => {
    for (const seed of [1, 2]) {
      const r = runIntegritySim({ minutes: 5, seed, honest: 12 });
      // the scenario really played: rounds ended, tickets were bought back, value moved between stakers
      expect(r.rounds).toBeGreaterThanOrEqual(4);
      expect(r.tickets).toBeGreaterThan(12);
      expect(r.transfers).toBeGreaterThan(0);
      expect(r.flags.map((f) => `${f.kind}: ${f.summary}`)).toEqual([]);
      expect(r.journal.held()).toEqual([]);
    }
  }, 180_000);

  it('scripted input among them is flagged, and only the scripts', () => {
    const r = runIntegritySim({ minutes: 4, seed: 3, honest: 8, scripted: 2 });
    const bots = r.flags.filter((f) => f.kind === 'bot_input');
    expect(bots.map((f) => f.wallets[0]).sort()).toEqual(['ScriptWallet0', 'ScriptWallet1']);
    expect(r.flags.every((f) => f.wallets.every((w) => w.startsWith('Script')))).toBe(true);
  }, 180_000);
});

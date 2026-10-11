import { describe, expect, it } from 'vitest';
import { accountSize, deploymentBudget } from '../src/deploy-budget';

// Snapshot rate is only a fixture; the command always asks the live RPC.
const rpc = { getMinimumBalanceForRentExemption: async (size: number) => (size + 128) * 5080 };

describe('read-only initial deployment budget', () => {
  it('derives deployed account lengths from the SDK IDL', () => {
    expect(['Config', 'Season', 'Arena', 'Session', 'PlayerProfile'].map(accountSize)).toEqual([162, 1281, 40, 100, 139]);
  });
  it('rejects the original artifact under the owner budget without double-counting the buffer', async () => {
    const result = await deploymentBudget(rpc, 436328);
    expect(result.rentLamports).toBe(2_229_449_440);
    expect(result.accounts.map(a => a.name)).not.toContain('Buffer');
    expect(result.withinBudget).toBe(false);
  });
  it('reserves operating/fee headroom and uses fresh RPC rent instead of defaults', async () => {
    const allowed = await deploymentBudget(rpc, 80_000);
    expect(allowed.allowanceLamports).toBe(20_000_000);
    expect(allowed.withinBudget).toBe(true);
    const doubled = await deploymentBudget({ getMinimumBalanceForRentExemption: async size => (size + 128) * 10160 }, 80_000);
    expect(doubled.withinBudget).toBe(false);
  });
  it('fails closed on malformed RPC rent', async () => {
    await expect(deploymentBudget({ getMinimumBalanceForRentExemption: async () => NaN }, 80_000)).rejects.toThrow('invalid rent');
  });
});

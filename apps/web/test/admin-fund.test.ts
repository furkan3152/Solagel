import { describe, expect, it, vi } from 'vitest';
import { previewOf, sendPlan, type Plan } from '../src/admin/plan';

const KEY = '0xabec7B8ed9b87989106f6d0510ec9Dd9DEE0a1FC' as const;
const ME = '0x08b2B32E932D5f429073A441E6EfD8e3d42369b2' as const;

describe('fund the server key', () => {
  const plan: Plan = { title: 'Fund the server key', contract: 'Server key', transfer: { to: KEY, value: 10n ** 18n } };

  it('previews a plain 1 HYPE transfer to the server key', () => {
    const p = previewOf(plan);
    expect(p.to).toBe(KEY);
    expect(p.value).toBe(10n ** 18n);
    expect(p.valueText).toBe('1 HYPE');
    expect(p.args).toEqual([]);
  });

  it('asks the wallet for a value transfer, not a contract call', async () => {
    const sendTransaction = vi.fn().mockResolvedValue('0xhash');
    const wallet = { sendTransaction, chain: { id: 99801 } } as never;
    await expect(sendPlan(plan, wallet, ME)).resolves.toBe('0xhash');
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: KEY, value: 10n ** 18n, account: ME }));
  });
});

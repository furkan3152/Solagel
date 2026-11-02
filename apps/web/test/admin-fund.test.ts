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

describe('a refused settings save reads in the panel words', () => {
  it('names the field by its label, never the raw key path', async () => {
    const { saveErrorText, fieldLabel } = await import('../src/admin/ui');
    const err = (message: string, field: string | null) => Object.assign(new Error(message), { field });
    expect(saveErrorText(err('prices.magnet must be above 0 and at most 1000000000', 'prices.magnet'))).toBe('Pack price Magnet must be above 0 and at most 1000000000');
    expect(saveErrorText(err('kinds.practiceRookie.massCap must be 0 (no cap) or at least 200', 'kinds.practiceRookie.massCap'))).toBe('Practice · rookie mass cap must be 0 (no cap) or at least 200');
    expect(saveErrorText(err('priceHype must be a HYPE amount like "0.05"', 'priceHype'))).toBe('Price (HYPE) must be a HYPE amount like "0.05"');
    expect(saveErrorText(err('Not allowed', 'testnet.arenas.2.bankroll'))).toBe('Staked bots arena #2 bankroll: Not allowed');
    expect(saveErrorText(err('The server is busy', null))).toBe('The server is busy');
    expect(fieldLabel('someNewKey')).toBe('Some new key');
  });
});

describe('the server key balance after funding', () => {
  it("shows this page's own chain read first: the server's figure lags until its next balance check", async () => {
    const { serverKeyBalance } = await import('../src/admin/NetworkTab');
    const info = { serverBalanceWei: (10n ** 17n).toString(), low: false };
    // 0.1 HYPE on the server's last check; 1.1 HYPE read just now after sending 1 HYPE
    expect(serverKeyBalance(info, 11n * 10n ** 17n)).toEqual({ wei: 11n * 10n ** 17n, low: false });
    expect(serverKeyBalance(info, null)).toEqual({ wei: 10n ** 17n, low: false });
    expect(serverKeyBalance({ serverBalanceWei: '0', low: true }, 10n ** 18n).low).toBe(false);
    expect(serverKeyBalance({ serverBalanceWei: null, low: true }, null)).toEqual({ wei: null, low: true });
    expect(serverKeyBalance(null, 1n).low).toBe(true);
  });
});

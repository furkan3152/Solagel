import { INTEGRITY_SETTINGS_DEFAULT, type IntegrityFlag, type IntegrityOverview, type IntegrityWalletView } from '@slana/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrityTab } from '../src/admin/site/IntegrityTab';
import { Kb } from '../src/design';
import { adminApi } from '../src/site/api';
import { installDomStubs, mockFetch, type Call } from './site-helpers';

const api = adminApi('admin-token');
const A = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const B = 'D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm';
const KEY = 'Sess1111111111111111111111111111111111111';

const flag: IntegrityFlag = {
  id: 'pair_transfer:0123456789abcdef',
  kind: 'pair_transfer',
  status: 'open',
  score: 82,
  wallets: [B, A],
  beneficiary: B,
  arenaId: 1,
  summary: 'D2Ts…tvm took value from 9xQe…VFin on 6 occasions in 6 rounds.',
  evidence: { occasions: 6, rounds: 6, pValue: 0.00001, afkEaterOccasions: 2 },
  firstSeen: 1,
  lastSeen: 2,
  statusBy: null,
  statusAt: null,
  note: '',
  scoreAtStatus: null,
};

const overview = (over: Partial<IntegrityOverview> = {}): IntegrityOverview => ({
  settings: structuredClone(INTEGRITY_SETTINGS_DEFAULT),
  defaults: structuredClone(INTEGRITY_SETTINGS_DEFAULT),
  counts: { open: 1, reviewed: 0, dismissed: 0, held: 1, bans: 0, sessions: 40, transfers: 12 },
  held: [{ key: KEY, player: B, arenaId: 1, payout: 5_000_000_000, reason: 'round', createdAt: 1, heldAt: Date.now(), score: 93, why: flag.summary, flags: [flag.id] }],
  bans: [],
  scannedAt: 1,
  ...over,
});

const walletView: IntegrityWalletView = {
  wallet: B,
  ban: null,
  risk: 82,
  flags: [flag],
  sessions: [],
  transfers: [{ at: 5, arenaId: 1, roomId: 'arena-1-1', round: 9, from: A, to: B, amount: 1_000_000_000, fee: 1_000_000_000, fromKey: 'a#1', toKey: 'b#2', others: 7, afkEater: true }],
};

let restore = () => {};
let calls: Call[] = [];
beforeEach(() => {
  installDomStubs();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});
const ui = () => render(
  <Kb>
    <IntegrityTab api={api} />
  </Kb>,
);
const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /api/config': { chain: { token: { mint: 'M', symbol: '$SLANA', decimals: 6 } } },
  'GET /api/admin/integrity': overview(),
  'GET /api/admin/integrity/flags': { flags: [flag] },
  [`GET /api/admin/integrity/wallet/${B}`]: walletView,
  ...extra,
});
const sent = (method: string, path: string) => calls.find((c) => c.method === method && c.path.startsWith(path));

describe('admin: Integrity tab (mocked fetch)', { timeout: 30_000 }, () => {
  it('shows counts, the held settlement and the flags; releases a held payout', async () => {
    ({ calls, restore } = mockFetch(routes({ [`POST /api/admin/integrity/held/${KEY}/release`]: { ok: true, held: [] } })));
    ui();
    expect(await screen.findByText('Held settlements')).toBeTruthy();
    expect(within(screen.getByLabelText('Integrity counts')).getByText('40')).toBeTruthy();
    expect(await screen.findByText('5,000 $SLANA')).toBeTruthy();
    expect(screen.getAllByText(flag.summary).length).toBeGreaterThan(0);
    expect(sent('GET', '/api/admin/integrity')?.auth).toBe('Bearer admin-token');
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(sent('POST', `/api/admin/integrity/held/${KEY}/release`)).toBeTruthy());
  });

  it('settle at 0 needs a reason, which is sent', async () => {
    ({ calls, restore } = mockFetch(routes({ [`POST /api/admin/integrity/held/${KEY}/settle-zero`]: { ok: true, forfeited: 5_000_000_000, held: [] } })));
    ui();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle at 0…' }));
    const go = await screen.findByRole('button', { name: 'Settle at 0' });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason (kept in the journal)'), { target: { value: 'Confirmed feeding' } });
    fireEvent.click(go);
    await waitFor(() => expect(sent('POST', `/api/admin/integrity/held/${KEY}/settle-zero`)?.body).toEqual({ reason: 'Confirmed feeding' }));
  });

  it('a flag opens with its evidence and the transfer timeline; review and ban from there', async () => {
    ({ calls, restore } = mockFetch(
      routes({
        [`POST /api/admin/integrity/flags/${encodeURIComponent(flag.id)}/status`]: { flag: { ...flag, status: 'reviewed' } },
        'POST /api/admin/integrity/bans': { ban: { wallet: B, at: 1, by: 'x', reason: 'r' } },
      }),
    ));
    ui();
    await screen.findByText('Flags');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('afkEaterOccasions')).toBeTruthy();
    expect(await within(sheet).findByText('idle eater')).toBeTruthy();
    expect(within(sheet).getByText(/1 value transfer/)).toBeTruthy();
    expect(sent('GET', `/api/admin/integrity/wallet/${B}?other=${A}`)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => expect(sent('POST', `/api/admin/integrity/flags/${encodeURIComponent(flag.id)}/status`)?.body).toMatchObject({ status: 'reviewed' }));
    fireEvent.click(within(sheet).getAllByRole('button', { name: 'Ban…' })[0]);
    const ban = await screen.findByRole('dialog');
    fireEvent.change(within(ban).getByLabelText('Reason'), { target: { value: 'Farming a partner' } });
    fireEvent.click(within(ban).getByRole('button', { name: 'Ban wallet' }));
    await waitFor(() => expect(sent('POST', '/api/admin/integrity/bans')?.body).toEqual({ wallet: B, reason: 'Farming a partner' }));
  });

  it('turning auto-hold on asks first and saves the settings', async () => {
    ({ calls, restore } = mockFetch(routes({ 'PUT /api/admin/integrity/settings': { settings: { ...INTEGRITY_SETTINGS_DEFAULT, autoHold: true } } })));
    ui();
    fireEvent.click(await screen.findByLabelText(/Auto-hold risky payouts/));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(sent('PUT', '/api/admin/integrity/settings')?.body).toMatchObject({ autoHold: true, holdScore: 90 }));
    expect(window.confirm).toHaveBeenCalled();
  });
});

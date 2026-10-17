import { vi } from 'vitest';

// jsdom swaps in its own Uint8Array; web3.js' curve check (noble) wants Node's. Same fix as admin-panel.test.
vi.hoisted(() => {
  globalThis.Uint8Array = Object.getPrototypeOf((globalThis as unknown as { Buffer: { prototype: object } }).Buffer.prototype).constructor as Uint8ArrayConstructor;
});

import type { CollabPublic } from '@slana/shared';
import { Keypair } from '@solana/web3.js';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollabPage } from '../src/site/collab/CollabPage';
import { countdown, fillRows, parsePastedList, rafflePost, rowErrors } from '../src/site/collab/logic';
import { useSession } from '../src/site/session';
import { resetSiteSettings } from '../src/site/settings';
import { SETTINGS, installDomStubs, json, mockFetch, type Call } from './site-helpers';

const ME = Keypair.generate().publicKey.toBase58();
const w = () => Keypair.generate().publicKey.toBase58();
const RAFFLE = 'https://x.com/risoguild/status/1849000000000000003';

const collab = (over: Partial<CollabPublic> = {}): CollabPublic => ({
  id: 'c1',
  wallet: ME,
  community: 'Riso Guild',
  type: 'guild',
  members: 2500,
  communityX: 'risoguild',
  contactX: 'riso_rita',
  discord: '',
  role: 'founder',
  postUrl: 'https://x.com/risoguild/status/1849000000000000002',
  about: 'Printers.',
  status: 'pending',
  phase: 'in_review',
  spots: null,
  deadline: null,
  wallets: [],
  raffleUrl: null,
  submittedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

let restore = () => {};
beforeEach(() => {
  installDomStubs();
  resetSiteSettings();
  localStorage.clear();
  useSession.setState({ session: null, signing: false, error: null });
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

describe('collab logic', () => {
  it('parses a pasted list of "name wallet" lines in the usual shapes', () => {
    const [a, b, c] = [w(), w(), w()];
    expect(parsePastedList(`alice ${a}\nbob, ${b}\n\n3. carol\t${c}\nno wallet here`)).toEqual([
      { name: 'alice', wallet: a },
      { name: 'bob', wallet: b },
      { name: 'carol', wallet: c },
    ]);
    expect(parsePastedList(`${a}`)).toEqual([{ name: '', wallet: a }]);
  });

  it('fills rows from a position, never past the spots, and flags bad and repeated wallets', () => {
    const [a, b] = [w(), w()];
    const rows = fillRows([{ name: '', wallet: '' }], 1, [{ name: 'x', wallet: a }, { name: 'y', wallet: b }, { name: 'z', wallet: a }], 3);
    expect(rows.map((r) => r.wallet)).toEqual(['', a, b]);
    expect(rowErrors([{ name: 'a', wallet: a }, { name: 'b', wallet: 'nope' }, { name: 'c', wallet: a }, { name: '', wallet: '' }])).toEqual([null, 'Not a Solana wallet address.', 'Listed twice (row 1).', null]);
  });

  it('counts down and writes a raffle post that names @slanaio and slana.io', () => {
    expect(countdown(1000 + 3_723_000, 1000)).toBe('01:02:03');
    expect(countdown(2 * 86_400_000 + 5000, 0)).toBe('2d 00:00:05');
    expect(countdown(0, 5000)).toBe('00:00:00');
    const post = rafflePost('Riso Guild', 20, Date.UTC(2026, 9, 20));
    expect(post).toMatch(/@slanaio/);
    expect(post).toMatch(/slana\.io/);
    expect(post).toMatch(/20 Slana WL spots/);
  });
});

describe('/collab', { timeout: 30_000 }, () => {
  it('applies with the form (validated inline) once signed in', async () => {
    let body: unknown = null;
    ({ restore } = mockFetch({
      'GET /api/site/settings': { settings: SETTINGS },
      'GET /api/site/collab': { collabs: [] },
      'POST /api/site/collab': (c: Call) => {
        body = c.body;
        return json(201, { collab: collab() });
      },
    }));
    useSession.setState({ session: { pubkey: ME, token: 'tok', admin: false } });
    render(<CollabPage />);
    const apply = await screen.findByRole('button', { name: 'Apply' });
    fireEvent.click(apply);
    expect(await screen.findByText('Pick a type.')).toBeTruthy();
    expect(screen.getByText(/Post about Slana on your community's X first/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Community name'), { target: { value: 'Riso Guild' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'guild' } });
    fireEvent.change(screen.getByLabelText('Members'), { target: { value: '2,500' } });
    fireEvent.change(screen.getByLabelText('Community X'), { target: { value: '@RisoGuild' } });
    fireEvent.change(screen.getByLabelText('Your X'), { target: { value: 'riso_rita' } });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'founder' } });
    fireEvent.change(screen.getByLabelText('Your post about Slana on X'), { target: { value: 'https://x.com/risoguild/status/1849000000000000002' } });
    fireEvent.change(screen.getByLabelText('About your community'), { target: { value: 'Printers.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Thanks for applying.')).toBeTruthy();
    expect(body).toEqual({ community: 'Riso Guild', type: 'guild', members: 2500, communityX: 'risoguild', contactX: 'riso_rita', role: 'founder', postUrl: 'https://x.com/risoguild/status/1849000000000000002', about: 'Printers.' });
    expect(screen.getAllByText('In review').length).toBeGreaterThan(0);
  });

  it('approved: spots, a live countdown, paste-a-list, then submit locks the list', async () => {
    const deadline = Date.now() + 3_600_000 + 2000;
    const rows = [w(), w(), w()];
    let submitted: { wallets: unknown[]; raffleUrl: string } | null = null;
    ({ restore } = mockFetch({
      'GET /api/site/settings': { settings: SETTINGS },
      'GET /api/site/collab': { collabs: [collab({ status: 'approved', phase: 'approved', spots: 3, deadline })] },
      'POST /api/site/collab/c1/submit': (c: Call) => {
        submitted = c.body as typeof submitted;
        return { collab: collab({ status: 'submitted', phase: 'submitted', spots: 3, deadline, wallets: submitted!.wallets as CollabPublic['wallets'], raffleUrl: RAFFLE, submittedAt: Date.now() }) };
      },
    }));
    useSession.setState({ session: { pubkey: ME, token: 'tok', admin: false } });
    render(<CollabPage />);
    expect(await screen.findByText('You have spots. Run your raffle.')).toBeTruthy();
    const timer = screen.getByTestId('cb-countdown');
    expect(timer.textContent).toMatch(/^01:00:0\d$/);
    const first = timer.textContent;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(screen.getByTestId('cb-countdown').textContent).not.toBe(first);

    // paste a list into row 1: it fills the rows below
    const cell = screen.getByLabelText('Row 1 wallet');
    const text = rows.map((r, i) => `winner${i + 1} ${r}`).join('\n');
    const ev = createEvent.paste(cell, { clipboardData: { getData: () => text } });
    fireEvent(cell, ev);
    expect((screen.getByLabelText('Row 3 wallet') as HTMLInputElement).value).toBe(rows[2]);
    expect((screen.getByLabelText('Row 2 name') as HTMLInputElement).value).toBe('winner2');
    expect(screen.getByText('Pasted 3 rows.')).toBeTruthy();

    // submit needs the raffle post
    fireEvent.click(screen.getByRole('button', { name: /Submit wallets/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, submit' }));
    expect(await screen.findByText(/You cannot submit without it/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your raffle post on X'), { target: { value: RAFFLE } });
    fireEvent.click(screen.getByRole('button', { name: /Submit wallets/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, submit' }));
    expect(await screen.findByText('The list is in.')).toBeTruthy();
    expect(submitted).toEqual({ raffleUrl: RAFFLE, wallets: rows.map((r, i) => ({ name: `winner${i + 1}`, wallet: r })) });
    // locked: no inputs, no submit
    expect(screen.queryByLabelText('Row 1 wallet')).toBeNull();
    expect(screen.queryByRole('button', { name: /Submit wallets/ })).toBeNull();
    expect(screen.getByText(rows[0])).toBeTruthy();
  });

  it('shows "not this time", the closed form and the guide with a copyable post', async () => {
    ({ restore } = mockFetch({
      'GET /api/site/settings': { settings: { ...SETTINGS, collabOpen: false } },
      'GET /api/site/collab': { collabs: [collab({ status: 'rejected', phase: 'rejected' })] },
    }));
    render(<CollabPage />);
    expect(await screen.findByRole('heading', { name: 'Applications are closed.' })).toBeTruthy();
    act(() => useSession.setState({ session: { pubkey: ME, token: 'tok', admin: false } }));
    await waitFor(() => expect(screen.getAllByText('Not this time.').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Collab guide/ }));
    const post = (await screen.findByLabelText('Raffle post')) as HTMLTextAreaElement;
    expect(post.value).toMatch(/@slanaio/);
    expect(screen.getByRole('button', { name: 'Copy the post' })).toBeTruthy();
  });
});

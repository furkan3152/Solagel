import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayGate, playAccess } from '../src/site/play/PlayGate';
import { TOKEN_KEY } from '../src/site/session';
import { SETTINGS, installDomStubs, json, mockFetch } from './site-helpers';

const ADMIN = '0xAdA0000000000000000000000000000000000001';
const USER = '0x1111111111111111111111111111111111111111';
const store = (address: string, token: string) => localStorage.setItem(TOKEN_KEY, JSON.stringify({ address, token, exp: Date.now() + 3600_000 }));

let restore = () => {};
beforeEach(() => {
  installDomStubs();
  localStorage.clear();
});
afterEach(() => restore());

describe('the /play gate', { timeout: 30_000 }, () => {
  it('blocks a visitor with no session: "The arena opens soon", a link back to /', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS } }));
    const onAllowed = vi.fn();
    render(<PlayGate onAllowed={onAllowed} />);
    expect(await screen.findByRole('heading', { name: /The arena opens soon/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back home' }).getAttribute('href')).toBe('/');
    expect(onAllowed).not.toHaveBeenCalled();
  });

  it('blocks a signed-in wallet that is not an admin', async () => {
    store(USER, 'user-token');
    const { calls, restore: r } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS }, 'GET /api/auth/me': { address: USER, admin: false, canPlay: false } });
    restore = r;
    expect(await playAccess()).toEqual({ allowed: false, reason: 'closed', session: null });
    expect(calls.find((c) => c.path === '/api/auth/me')?.auth).toBe('Bearer user-token');
    // an expired token too
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS }, 'GET /api/auth/me': json(401, { error: 'unauthorized' }) }));
    expect((await playAccess()).allowed).toBe(false);
  });

  it('lets the admin in with their session (the game then authenticates with it)', async () => {
    store(ADMIN, 'admin-token');
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS }, 'GET /api/auth/me': { address: ADMIN, admin: true } }));
    const onAllowed = vi.fn();
    render(<PlayGate onAllowed={onAllowed} />);
    await waitFor(() => expect(onAllowed).toHaveBeenCalledWith({ address: ADMIN, token: 'admin-token', admin: true }));
    expect(screen.queryByRole('heading', { name: /opens soon/ })).toBeNull();
  });

  it('opens to everyone when the game is public', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: { ...SETTINGS, gameAccess: 'public' } } }));
    const onAllowed = vi.fn();
    render(<PlayGate onAllowed={onAllowed} />);
    await waitFor(() => expect(onAllowed).toHaveBeenCalledWith(null));
    expect(await playAccess()).toMatchObject({ allowed: true, reason: 'public' });
  });

  it('holders mode: a signed-in holder plays; anyone else is asked to sign in with the NFT wallet', async () => {
    const holders = { settings: { ...SETTINGS, gameAccess: 'holders' } };
    ({ restore } = mockFetch({ 'GET /api/site/settings': holders }));
    expect(await playAccess()).toEqual({ allowed: false, reason: 'holders', session: null });
    render(<PlayGate onAllowed={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: /open to holders/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the mint' }).getAttribute('href')).toBe('/mint');
    restore();
    store(USER, 'holder-token');
    ({ restore } = mockFetch({ 'GET /api/site/settings': holders, 'GET /api/auth/me': { address: USER, admin: false, canPlay: true } }));
    expect(await playAccess()).toEqual({ allowed: true, reason: 'holder', session: { address: USER, token: 'holder-token', admin: false } });
    restore();
    // a non-holder stays outside
    ({ restore } = mockFetch({ 'GET /api/site/settings': holders, 'GET /api/auth/me': { address: USER, admin: false, canPlay: false } }));
    expect((await playAccess()).reason).toBe('holders');
  });
});

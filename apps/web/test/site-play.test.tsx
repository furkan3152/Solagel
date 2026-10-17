import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayGate, playAccess } from '../src/site/play/PlayGate';
import { TOKEN_KEY } from '../src/site/session';
import { SETTINGS, installDomStubs, json, mockFetch } from './site-helpers';

const ADMIN = '4re3F7w3Nn15Qj4R8tgdshoX8jRN1UUvrc8amKABuZb3';
const store = (pubkey: string, token: string) => localStorage.setItem(TOKEN_KEY, JSON.stringify({ pubkey, token, exp: Date.now() + 3600_000 }));

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
    expect(screen.getByRole('link', { name: 'Back to slana.io' }).getAttribute('href')).toBe('/');
    expect(onAllowed).not.toHaveBeenCalled();
  });

  it('blocks a signed-in wallet that is not an admin', async () => {
    store('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 'user-token');
    const { calls, restore: r } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS }, 'GET /api/auth/me': { pubkey: '9xQe', admin: false } });
    restore = r;
    expect(await playAccess()).toEqual({ allowed: false, reason: 'closed', session: null });
    expect(calls.find((c) => c.path === '/api/auth/me')?.auth).toBe('Bearer user-token');
    // an expired token too
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS }, 'GET /api/auth/me': json(401, { error: 'unauthorized' }) }));
    expect((await playAccess()).allowed).toBe(false);
  });

  it('lets the admin in with their session (the game then authenticates with it)', async () => {
    store(ADMIN, 'admin-token');
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS }, 'GET /api/auth/me': { pubkey: ADMIN, admin: true } }));
    const onAllowed = vi.fn();
    render(<PlayGate onAllowed={onAllowed} />);
    await waitFor(() => expect(onAllowed).toHaveBeenCalledWith({ pubkey: ADMIN, token: 'admin-token', admin: true }));
    expect(screen.queryByRole('heading', { name: /opens soon/ })).toBeNull();
  });

  it('opens to everyone when the game is public', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: { ...SETTINGS, gamePublic: true } } }));
    const onAllowed = vi.fn();
    render(<PlayGate onAllowed={onAllowed} />);
    await waitFor(() => expect(onAllowed).toHaveBeenCalledWith(null));
    expect(await playAccess()).toMatchObject({ allowed: true, reason: 'public' });
  });
});

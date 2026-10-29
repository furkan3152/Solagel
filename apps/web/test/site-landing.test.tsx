import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Landing } from '../src/site/landing/Landing';
import { resetSiteSettings } from '../src/site/settings';
import { setReducedMotion } from '../src/test/media';
import { SETTINGS, installDomStubs, mockFetch } from './site-helpers';

let restore = () => {};
beforeEach(() => {
  installDomStubs();
  resetSiteSettings();
});
afterEach(() => restore());

describe('the landing (/)', { timeout: 30_000 }, () => {
  it('renders the hero, the sections, the CTAs and the footer, with no way into the game', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: { ...SETTINGS, collabOpen: false } } }));
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1, name: 'Elymum' })).toBeTruthy();
    expect(screen.getByText('Last the round.')).toBeTruthy();
    const wl = screen.getAllByRole('link', { name: /Join the WL/ });
    expect(wl.every((a) => a.getAttribute('href') === '/wl')).toBe(true);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Collab, soon' }).getAttribute('href')).toBe('/collab'));
    for (const h of ['Coins that eat coins.', 'Four tickets, one round.', 'Meet the pond.', 'Small print.']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /@elymum/ }).some((a) => a.getAttribute('href') === 'https://x.com/elymum')).toBe(true);
    expect(screen.queryByRole('link', { name: /^Play$/ })).toBeNull();
    expect(document.querySelector('a[href="/play"]')).toBeNull();
    // sound is off until the visitor turns it on
    expect(screen.getByRole('button', { name: /Sound off/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows Collab without "Soon" when collabs are open, and Play when the game is public', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: { ...SETTINGS, collabOpen: true, gameAccess: 'public' } } }));
    render(<Landing />);
    await waitFor(() => expect(screen.getByRole('link', { name: /^Play$/ }).getAttribute('href')).toBe('/play'));
    expect(screen.queryByRole('link', { name: 'Collab, soon' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Collab/ })[0].getAttribute('href')).toBe('/collab');
  });

  it('animates the pond and the wordmark, and holds them still with reduced motion', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS } }));
    const { unmount } = render(<Landing />);
    expect(document.querySelector('.ld-pond')?.getAttribute('data-still')).toBe('false');
    expect(document.querySelector('.ld-hero .st-mark')?.classList.contains('is-live')).toBe(true);
    unmount();
    setReducedMotion(true);
    render(<Landing />);
    expect(document.querySelector('.ld-pond')?.getAttribute('data-still')).toBe('true');
    expect(document.querySelector('.ld-hero .st-mark')?.classList.contains('is-live')).toBe(false);
  });

  it('keeps working when the server cannot be reached (defaults: WL open, collab soon)', async () => {
    ({ restore } = mockFetch({}));
    render(<Landing />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Collab, soon' })).toBeTruthy());
    expect(screen.getByText(/WL is open/)).toBeTruthy();
  });
});

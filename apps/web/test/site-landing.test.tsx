import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Landing } from '../src/site/landing/Landing';
import { SiteApp } from '../src/site/mount';
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
    expect(screen.getByText('You are small change with a big appetite.')).toBeTruthy();
    const wl = screen.getAllByRole('link', { name: /Join the WL/ });
    expect(wl.every((a) => a.getAttribute('href') === '/wl')).toBe(true);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Collab, soon' }).getAttribute('href')).toBe('/collab'));
    for (const h of [/everything is a feast/, 'One lap, four stops, then lunch.', 'Usual suspects of the plain.', /Your seat at the feast/, 'Pick a table. Same rules, bigger plates.', 'Small print, large font.'])
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    // the four arenas as places on the ring, with their fees in the game token
    for (const [name, fee] of [['Asphodel Meadow', '1,000'], ['Lethe Shore', '10,000'], ['Golden Bough', '50,000'], ['Isles of the Blessed', '250,000']]) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
      expect(screen.getByText(fee)).toBeTruthy();
    }
    expect(screen.getByText('Opens after the mint')).toBeTruthy();
    // the NFT plate links to the mint; the header has the nav and Connect
    expect(screen.getAllByRole('link', { name: 'See the mint' })[0].getAttribute('href')).toBe('/mint');
    const nav = screen.getByRole('navigation', { name: 'Site' });
    for (const n of ['The feast', 'Arenas', 'Mint', 'WL', 'Docs']) expect(nav.textContent).toContain(n);
    expect(screen.getByRole('button', { name: /Connect/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /@elymumio/ }).some((a) => a.getAttribute('href') === 'https://x.com/elymumio')).toBe(true);
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

  it('animates the pond, the chase and the wordmark, and holds them still with reduced motion', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS } }));
    const { unmount } = render(<Landing />);
    expect(document.querySelector('.ld-pond')?.getAttribute('data-still')).toBe('false');
    expect(document.querySelector('.ld-chase')?.classList.contains('is-still')).toBe(false);
    expect(document.querySelector('.ld-hero .kb-wordmark')?.classList.contains('kb-wordmark--playful')).toBe(true);
    unmount();
    setReducedMotion(true);
    render(<Landing />);
    expect(document.querySelector('.ld-pond')?.getAttribute('data-still')).toBe('true');
    expect(document.querySelector('.ld-chase')?.classList.contains('is-still')).toBe(true);
    expect(document.querySelector('.ld-hero .kb-wordmark')?.classList.contains('kb-wordmark--playful')).toBe(false);
  });

  it('takes the X handle in the footer and the FAQ from the settings', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: { ...SETTINGS, xHandle: 'feastbot' } } }));
    render(<Landing />);
    await waitFor(() => expect(screen.getAllByRole('link', { name: /@feastbot/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('link', { name: /@feastbot/ }).every((a) => a.getAttribute('href') === 'https://x.com/feastbot')).toBe(true);
    expect(screen.getByText(/Kinetiq ecosystem/)).toBeTruthy();
  });

  it('keeps working when the server cannot be reached (defaults: WL open, collab soon)', async () => {
    ({ restore } = mockFetch({}));
    render(<Landing />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Collab, soon' })).toBeTruthy());
    expect(screen.getByText(/WL is open/)).toBeTruthy();
  });

  it('feeds a pond coin on click and shuffles the sealed emblems on demand', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS } }));
    setReducedMotion(false);
    render(<Landing />);
    const hungry = document.querySelector('.ld-pond__c--hungry') as HTMLElement;
    fireEvent.click(hungry);
    expect(hungry.classList.contains('is-drop')).toBe(true);
    await waitFor(() => expect(hungry.classList.contains('is-chew')).toBe(true), { timeout: 4000 });
    expect(hungry.textContent).toContain('+a bite');
    const front = () => (document.querySelector('.ld-fan__card[data-slot="front"] .ld-emblem__coin') as HTMLElement).closest('.ld-fan__card')?.getAttribute('data-slot');
    const before = [...document.querySelectorAll('.ld-fan__card')].map((c) => c.getAttribute('data-slot')).join();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Shuffle the deck' })));
    const after = [...document.querySelectorAll('.ld-fan__card')].map((c) => c.getAttribute('data-slot')).join();
    expect(after).not.toBe(before);
    expect(front()).toBe('front');
  });

  it('shows the unbuilt terrace for a path the site does not know', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/settings': { settings: SETTINGS } }));
    history.pushState(null, '', '/Terrace-Nine');
    try {
      render(<SiteApp />);
      expect(screen.getByRole('heading', { level: 1, name: /This terrace hasn.t been built yet/ })).toBeTruthy();
      expect(screen.getByText('/Terrace-Nine', { selector: 'code' })).toBeTruthy();
      expect(screen.getByRole('link', { name: /Walk back to the plain/ }).getAttribute('href')).toBe('/');
      await waitFor(() => expect(document.title).toBe('Off the map · Elymum'));
    } finally {
      history.pushState(null, '', '/');
    }
  });
});

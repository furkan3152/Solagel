import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_KEY, RELOAD_WINDOW_MS, PageBoundary, isChunkError, reloadOnce } from '../src/site/recover';
import { installDomStubs } from './site-helpers';

// a tab from before a deploy: the MintPage chunk it names is gone on the host (404)
vi.mock('../src/site/mint/MintPage', () => {
  throw new TypeError('Failed to fetch dynamically imported module: https://elymum.io/assets/MintPage-OLDHASH.js');
});
const { SiteApp } = await import('../src/site/mount');
const { resetPages, pageFailed } = await import('../src/site/pages');

const fakeWin = () => {
  const store = new Map<string, string>();
  return {
    reload: vi.fn(),
    win: {
      location: { reload: vi.fn() } as unknown as Location,
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage,
    },
  };
};

describe('reload once on a stale chunk', () => {
  it('reloads the first time, not again within the window, again after it', () => {
    const { win } = fakeWin();
    expect(reloadOnce(win, 1_000_000)).toBe(true);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(win, 1_000_000 + 5_000)).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(win, 1_000_000 + RELOAD_WINDOW_MS + 1)).toBe(true);
    expect(win.location.reload).toHaveBeenCalledTimes(2);
  });

  it('knows a failed chunk from a bug in the page', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/MintPage-x.js'))).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'priceWei')"))).toBe(false);
  });
});

describe('PageBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('a crash inside a page shows a friendly retry instead of a blank page, and Try again renders it anew', () => {
    let broken = true;
    function Page() {
      if (broken) throw new TypeError('boom');
      return <p>the page</p>;
    }
    function Host() {
      const [, force] = useState(0);
      return (
        <PageBoundary resetKey="/mint" onRetry={() => force((n) => n + 1)}>
          <Page />
        </PageBoundary>
      );
    }
    render(<Host />);
    expect(screen.getByTestId('site-crash').textContent).toMatch(/This page did not open\..*Something tripped|Something tripped.*This page did not open/);
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('the page')).toBeTruthy();
  });
});

describe('/mint whose chunk is gone (a tab from before a deploy)', () => {
  beforeEach(() => {
    installDomStubs();
    resetPages();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // a reload already happened a moment ago: this time the page must say so, not loop
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    history.replaceState(null, '', '/mint');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('shows "a fresh version is out" with Reload, never the 404 page', async () => {
    render(<SiteApp />);
    const box = await screen.findByTestId('site-crash');
    expect(box.textContent).toMatch(/A fresh version is out/);
    expect(box.textContent).toMatch(/Reload to get the new version/);
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
    expect(screen.queryByText(/terrace hasn.t been built/i)).toBeNull();
    expect(pageFailed('/mint')).toBe(true);
    // Try again asks for the chunk again (it is still gone here: the note stays)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('site-crash')).toBeTruthy());
  });
});

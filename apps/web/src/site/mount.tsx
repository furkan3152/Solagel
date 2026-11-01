import { lazy, StrictMode, Suspense, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import { NotFound } from './NotFound';
import { prefetchMintState } from './mint/mintState';
import { isLazyPage, loadPage, loadedPage, warmPage } from './pages';
import { installChunkRecovery, PageBoundary } from './recover';
import { isSitePath, usePath } from './router';
import { SiteLoader } from './SiteLoader';

// the form pages carry the wallet adapter; the landing does not. A page that was warmed (link
// hover / touch, see pages.ts) renders directly, without Suspense, so it never flashes the loader.
const lazies = new Map<string, ComponentType>();
function lazyPage(path: string): ComponentType {
  let c = lazies.get(path);
  if (!c) {
    // warm already: the page itself; else a lazy wrapper (once resolved it never suspends again).
    // A failed download rejects: the boundary reloads once (a stale tab after a deploy) or offers
    // a retry; it is never shown as "not found".
    c = loadedPage(path) ?? lazy(() => loadPage(path).then((p) => ({ default: p })));
    lazies.set(path, c);
  }
  return c;
}

/**
 * `/mint`'s stand-in while its heavy chunk (wallets, viem) downloads: a small chunk of its own with
 * the site frame and the skeleton card, so the page has its shape at once.
 */
const loadMintShell = () => import('./mint/MintShell').then((m) => ({ default: m.MintPageSkeleton }));
const MintShell = lazy(loadMintShell);
const SHELLS: Record<string, ComponentType> = { '/mint': MintShell };

/** After the landing has settled (idle), fetch the mint page's code so the click finds it ready. */
function warmFromLanding(): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    const go = () => {
      void loadMintShell();
      void warmPage('/mint');
    };
    if (w.requestIdleCallback) idle = w.requestIdleCallback(go, { timeout: 4000 });
    else go();
  }, 1500);
  return () => {
    clearTimeout(timer);
    if (idle !== undefined) w.cancelIdleCallback?.(idle);
  };
}

const TITLES: Record<string, string> = {
  '/': 'Elymum · Eat. Grow. Last the round.',
  '/wl': 'Join the WL · Elymum',
  '/collab': 'Collab · Elymum',
  '/docs': 'Player guide · Elymum',
  '/mint': 'Mint · Elymum NFT',
  '/faucet': 'Faucet · Elymum testnet',
};

export function SiteApp() {
  const path = usePath();
  useEffect(() => {
    document.title = TITLES[path] ?? (isSitePath(path) ? TITLES['/'] : 'Off the map · Elymum');
  }, [path]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => (path === '/' ? warmFromLanding() : undefined), [path]);
  if (path === '/')
    return (
      <PageBoundary resetKey={path}>
        <Landing />
      </PageBoundary>
    );
  if (!isLazyPage(path)) return <NotFound path={path} />;
  const Page = lazyPage(path);
  const Shell = SHELLS[path];
  return (
    <PageBoundary
      resetKey={`${path}#${attempt}`}
      onRetry={() => {
        // a failed lazy keeps its rejection: build a fresh one for the next try
        if (!loadedPage(path)) lazies.delete(path);
        setAttempt((n) => n + 1);
      }}
    >
      <Suspense fallback={<SiteLoader />}>
        {Shell ? (
          <Suspense fallback={<Shell />}>
            <Page />
          </Suspense>
        ) : (
          <Page />
        )}
      </Suspense>
    </PageBoundary>
  );
}

/** The public site: `/`, `/mint`, `/faucet`, `/wl`, `/collab`, `/docs`. */
export function mount(root: HTMLElement): void {
  document.documentElement.dataset.theme = 'light';
  installChunkRecovery();
  if ((location.pathname.replace(/\/+$/, '') || '/') === '/mint') {
    // the mint state, the page's code and its skeleton all start now, side by side
    prefetchMintState();
    void loadMintShell();
    void warmPage('/mint');
  }
  createRoot(root).render(
    <StrictMode>
      <SiteApp />
    </StrictMode>,
  );
}

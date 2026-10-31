import { lazy, StrictMode, Suspense, useEffect, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import { NotFound } from './NotFound';
import { isLazyPage, loadedPage, warmPage } from './pages';
import { isSitePath, usePath } from './router';
import { SiteLoader } from './SiteLoader';

// the form pages carry the wallet adapter; the landing does not. A page that was warmed (link
// hover / touch, see pages.ts) renders directly, without Suspense, so it never flashes the loader.
const lazies = new Map<string, ComponentType>();
function lazyPage(path: string): ComponentType {
  let c = lazies.get(path);
  if (!c) {
    // warm already: the page itself; else a lazy wrapper (once resolved it never suspends again)
    c = loadedPage(path) ?? lazy(() => warmPage(path).then((p) => ({ default: p ?? (() => <NotFound path={path} />) })));
    lazies.set(path, c);
  }
  return c;
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
  if (path === '/') return <Landing />;
  if (!isLazyPage(path)) return <NotFound path={path} />;
  const Page = lazyPage(path);
  return (
    <Suspense fallback={<SiteLoader />}>
      <Page />
    </Suspense>
  );
}

/** The public site: `/`, `/mint`, `/faucet`, `/wl`, `/collab`, `/docs`. */
export function mount(root: HTMLElement): void {
  document.documentElement.dataset.theme = 'light';
  createRoot(root).render(
    <StrictMode>
      <SiteApp />
    </StrictMode>,
  );
}

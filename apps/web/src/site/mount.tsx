import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import { NotFound } from './NotFound';
import { isSitePath, usePath } from './router';
import { SiteLoader } from './SiteLoader';

// the form pages carry the wallet adapter; the landing does not
const WlPage = lazy(() => import('./wl/WlPage').then((m) => ({ default: m.WlPage })));
const CollabPage = lazy(() => import('./collab/CollabPage').then((m) => ({ default: m.CollabPage })));
const DocsRoute = lazy(() => import('./DocsRoute').then((m) => ({ default: m.DocsRoute })));
const MintPage = lazy(() => import('./mint/MintPage').then((m) => ({ default: m.MintPage })));

const TITLES: Record<string, string> = {
  '/': 'Elymum · Eat. Grow. Last the round.',
  '/wl': 'Join the WL · Elymum',
  '/collab': 'Collab · Elymum',
  '/docs': 'Player guide · Elymum',
  '/mint': 'Mint · Elymum NFT',
};

export function SiteApp() {
  const path = usePath();
  useEffect(() => {
    document.title = TITLES[path] ?? (isSitePath(path) ? TITLES['/'] : 'Off the map · Elymum');
  }, [path]);
  let page;
  if (path === '/wl') page = <WlPage />;
  else if (path === '/collab') page = <CollabPage />;
  else if (path === '/docs') page = <DocsRoute />;
  else if (path === '/mint') page = <MintPage />;
  else if (path === '/') page = <Landing />;
  else page = <NotFound path={path} />;
  return <Suspense fallback={<SiteLoader />}>{page}</Suspense>;
}

/** The public site: `/`, `/wl`, `/collab`, `/docs`, `/mint`. */
export function mount(root: HTMLElement): void {
  document.documentElement.dataset.theme = 'light';
  createRoot(root).render(
    <StrictMode>
      <SiteApp />
    </StrictMode>,
  );
}

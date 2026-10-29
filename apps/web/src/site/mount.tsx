import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Kb, StampSpinner } from '../design';
import { Landing } from './landing/Landing';
import { usePath } from './router';

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

function Loading() {
  return (
    <Kb theme="paper" className="st-root" style={{ display: 'grid', placeItems: 'center' }}>
      <StampSpinner label="Loading" />
    </Kb>
  );
}

export function SiteApp() {
  const path = usePath();
  useEffect(() => {
    document.title = TITLES[path] ?? TITLES['/'];
  }, [path]);
  let page;
  if (path === '/wl') page = <WlPage />;
  else if (path === '/collab') page = <CollabPage />;
  else if (path === '/docs') page = <DocsRoute />;
  else if (path === '/mint') page = <MintPage />;
  else page = <Landing />;
  return <Suspense fallback={<Loading />}>{page}</Suspense>;
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

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Recovery for the site's lazily loaded pages.
 *
 * A tab opened before a deploy still runs the old `index` chunk; its lazy page chunks
 * (`MintPage-<oldhash>.js`) are gone on the host after the deploy (Vercel serves only the current
 * deployment's assets: 404). The cure is one full reload, which fetches the new index and its
 * chunks. `reloadOnce` does that at most once per short window (a page that keeps failing does
 * not loop); after that the page shows a friendly retry instead of a blank or a 404.
 */
export const RELOAD_KEY = 'elymum.chunk-reload.v1';
/** A second failure within this window shows the retry instead of reloading again. */
export const RELOAD_WINDOW_MS = 30_000;

/** Reloads the page unless it already did so in the last `RELOAD_WINDOW_MS`. True when reloading. */
export function reloadOnce(win: Pick<Window, 'location' | 'sessionStorage'> = window, now = Date.now()): boolean {
  try {
    const last = Number(win.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    win.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  win.location.reload();
  return true;
}

/** True when `err` is a failed dynamic import / chunk preload (not a bug in the page itself). */
export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|ChunkLoadError|Unable to preload CSS|MIME type/i.test(msg);
}

let installed = false;
/**
 * Vite's `vite:preloadError` (a chunk's dependency or CSS failed to preload): reload once instead
 * of letting the import throw. Safe to call more than once.
 */
export function installChunkRecovery(win: Window = window): void {
  if (installed || typeof win === 'undefined') return;
  installed = true;
  win.addEventListener('vite:preloadError', (e) => {
    if (reloadOnce(win)) e.preventDefault();
  });
}

/** What a page shows when it could not open: a short note, Try again and Reload. */
export function PageTrouble({ chunk, onRetry }: { chunk: boolean; onRetry: () => void }) {
  return (
    <main className="site-trouble" role="alert" data-testid="site-crash">
      <div className="site-trouble__card">
        <span className="kicker">{chunk ? 'A fresh version is out' : 'Something tripped'}</span>
        <h1 className="site-trouble__h display">This page did not open.</h1>
        <p>{chunk ? 'The site was updated while this tab was open. Reload to get the new version.' : 'A part of this page fell over. Try again; if it keeps happening, reload the page.'}</p>
        <div className="site-trouble__row">
          <button type="button" className="kb-btn kb-btn--primary kb-btn--md" onClick={() => window.location.reload()}>
            <span className="kb-btn__label">
              <span className="kb-btn__text">Reload the page</span>
            </span>
          </button>
          <button type="button" className="kb-btn kb-btn--secondary kb-btn--md" onClick={onRetry}>
            <span className="kb-btn__label">
              <span className="kb-btn__text">Try again</span>
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** A change (the path) clears a caught error, so the next page renders normally. */
  resetKey?: string;
  /** Called by Try again, before the boundary renders its children again. */
  onRetry?: () => void;
}

/**
 * Keeps a crash inside a page from blanking the whole site: shows `PageTrouble` instead. A failed
 * chunk load reloads the page once first (a stale tab after a deploy).
 */
export class PageBoundary extends Component<BoundaryProps, { error: unknown; key?: string }> {
  override state: { error: unknown; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: unknown; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('page crashed', error, info.componentStack);
    if (isChunkError(error)) reloadOnce();
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <PageTrouble
        chunk={isChunkError(this.state.error)}
        onRetry={() => {
          this.props.onRetry?.();
          this.setState({ error: null });
        }}
      />
    );
  }
}

// Ring Storybook design system (spec §6): fonts, tokens (on :root and every `.kb`) and styles.
// Fraunces "full" carries the SOFT and WONK axes (display); DM Sans with optical sizes (body);
// Geist Mono (every number).
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource-variable/dm-sans/opsz-italic.css';
import '@fontsource-variable/geist-mono/wght.css';
import './design/tokens.css';
import './design/storybook.css';
import { initLocale, t } from './i18n';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

const path = location.pathname.replace(/\/+$/, '') || '/';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The entry's own chunk failed (a tab or cache from before a deploy, or the network): reload once,
 * then say so plainly instead of leaving a blank page.
 */
function bootFailed(err: unknown): void {
  console.error('the page failed to load', err);
  const KEY = 'elymum.boot-reload.v1';
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (!last || Date.now() - last > 30_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      location.reload();
      return;
    }
  } catch {
    /* no storage: show the note */
  }
  root.innerHTML =
    '<main style="max-width:520px;margin:15vh auto;padding:24px;font-family:system-ui,sans-serif;text-align:center" role="alert" data-testid="boot-failed">' +
    `<h1 style="font-size:28px;margin:0 0 12px">${esc(t('boot.title'))}</h1>` +
    `<p style="margin:0 0 20px;line-height:1.5">${esc(t('boot.body'))}</p>` +
    `<button type="button" onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:12px;border:2px solid #0f2a30;background:#ffd23f;cursor:pointer">${esc(t('boot.reload'))}</button></main>`;
}

/** Mounts once the page's chunk and the visitor's language are both in (they download side by side). */
function boot<M>(page: Promise<M>, start: (m: M) => void): void {
  void Promise.all([page, initLocale()])
    .then(([m]) => start(m))
    .catch(bootFailed);
}

if (path === '/admin') {
  // Operator panel (chain admin, WL, collabs, site settings): its own lazy chunk, English only.
  void import('./admin/mount').then((m) => m.mount(root)).catch(bootFailed);
} else if (params.has('gallery')) {
  // Design-system proof sheet (every component, both themes).
  boot(import('./design/Gallery'), (m) => m.startDesignGallery(root));
} else if (params.has('coins')) {
  // Coin / world sprite sheet (was ?gallery before v2).
  boot(import('./gallery'), (m) => m.startGallery(root));
} else if (path === '/play') {
  // The arena (lobby + game engine), behind the game gate: admins only until the game is public.
  boot(import('./site/play/start'), (m) => m.startPlay(root));
} else {
  // The site: the landing, the WL and collab applications, the mint and the player guide. No game engine.
  boot(import('./site/mount'), (m) => m.mount(root));
}

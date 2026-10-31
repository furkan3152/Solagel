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

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

const path = location.pathname.replace(/\/+$/, '') || '/';

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
    '<h1 style="font-size:28px;margin:0 0 12px">This page did not open.</h1>' +
    '<p style="margin:0 0 20px;line-height:1.5">The site may have been updated while this tab was open, or the connection dropped.</p>' +
    '<button type="button" onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:12px;border:2px solid #0f2a30;background:#ffd23f;cursor:pointer">Reload the page</button></main>';
}

if (path === '/admin') {
  // Operator panel (chain admin, WL, collabs, site settings): its own lazy chunk.
  void import('./admin/mount').then((m) => m.mount(root)).catch(bootFailed);
} else if (params.has('gallery')) {
  // Design-system proof sheet (every component, both themes).
  void import('./design/Gallery').then((m) => m.startDesignGallery(root)).catch(bootFailed);
} else if (params.has('coins')) {
  // Coin / world sprite sheet (was ?gallery before v2).
  void import('./gallery').then((m) => m.startGallery(root)).catch(bootFailed);
} else if (path === '/play') {
  // The arena (lobby + game engine), behind the game gate: admins only until the game is public.
  void import('./site/play/start').then((m) => m.startPlay(root)).catch(bootFailed);
} else {
  // The site: the landing, the WL and collab applications, the mint and the player guide. No game engine.
  void import('./site/mount').then((m) => m.mount(root)).catch(bootFailed);
}

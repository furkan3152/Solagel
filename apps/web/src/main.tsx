// Paper Ticket design system: fonts, tokens (on :root and every `.kb`) and paper.
import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './design/tokens.css';
import './design/paper.css';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

const path = location.pathname.replace(/\/+$/, '') || '/';

if (path === '/admin') {
  // Operator panel (chain admin, WL, collabs, site settings): its own lazy chunk.
  void import('./admin/mount').then((m) => m.mount(root));
} else if (params.has('gallery')) {
  // Design-system proof sheet (every component, both themes).
  void import('./design/Gallery').then((m) => m.startDesignGallery(root));
} else if (params.has('coins')) {
  // Coin / world sprite sheet (was ?gallery before v2).
  void import('./gallery').then((m) => m.startGallery(root));
} else if (path === '/play') {
  // The arena (lobby + game engine), behind the game gate: admins only until the game is public.
  void import('./site/play/start').then((m) => m.startPlay(root));
} else {
  // slana.io: the landing, the WL and collab applications and the player guide. No game engine.
  void import('./site/mount').then((m) => m.mount(root));
}

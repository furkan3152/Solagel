import './polyfills';
// Paper Ticket design system: fonts, tokens (on :root and every `.kb`) and paper.
import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './design/tokens.css';
import './design/paper.css';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

if (params.has('gallery')) {
  // Design-system proof sheet (every component, both themes).
  void import('./design/Gallery').then((m) => m.startDesignGallery(root));
} else if (params.has('coins')) {
  // Coin / world sprite sheet (was ?gallery before v2).
  void import('./gallery').then((m) => m.startGallery(root));
} else {
  void import('./app-entry').then((m) => m.mount(root));
}

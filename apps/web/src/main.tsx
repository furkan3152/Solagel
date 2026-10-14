import './polyfills';
// Legacy UI font: still used by the current lobby/HUD (removed in Task 15).
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
// Kâğıt Bilet design system: fonts + tokens + paper. Scoped under `.kb`, so it
// loads alongside the legacy styles.css without restyling legacy markup.
import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './design/tokens.css';
import './design/paper.css';

const root = document.getElementById('root')!;
const params = new URLSearchParams(location.search);

if (params.has('gallery')) {
  // Design-system proof sheet (every component, both themes, TR/EN).
  void import('./design/Gallery').then((m) => m.startDesignGallery(root));
} else if (params.has('coins')) {
  // Coin / world sprite sheet (was ?gallery before v2).
  void import('./gallery').then((m) => m.startGallery(root));
} else {
  void import('./app-entry').then((m) => m.mount(root));
}

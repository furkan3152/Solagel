import './polyfills';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';

const root = document.getElementById('root')!;

if (new URLSearchParams(location.search).has('gallery')) {
  void import('./gallery').then((m) => m.startGallery(root));
} else {
  void import('./app-entry').then((m) => m.mount(root));
}

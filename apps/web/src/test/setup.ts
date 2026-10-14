import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout or media queries. Pretend the user prefers reduced
// motion so every motion transition is instant/fade, and give elements a
// client rect so "is it rendered?" checks (Sheet focus trap) see them.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
Element.prototype.getClientRects = function getClientRects() {
  return [{ width: 1, height: 1 }] as unknown as DOMRectList;
};

afterEach(() => cleanup());

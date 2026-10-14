import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installMatchMedia, setReducedMotion } from './media';

// jsdom has no media queries or layout. matchMedia is a configurable stub
// (reduced motion off by default; see ./media.ts), and elements get a client
// rect so "is it rendered?" checks (Sheet focus trap) see them.
installMatchMedia();
Element.prototype.getClientRects = function getClientRects() {
  return [{ width: 1, height: 1 }] as unknown as DOMRectList;
};

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});

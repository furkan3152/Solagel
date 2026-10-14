import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installMatchMedia, setReducedMotion } from './media';

// jsdom has no media queries or layout. matchMedia is a configurable stub
// (reduced motion off by default; see ./media.ts), and elements get a client
// rect so "is it rendered?" checks (Sheet focus trap) see them.
// Files that opt into `@vitest-environment node` (pure logic, web3.js PDAs) have no DOM.
const dom = typeof window !== 'undefined';
if (dom) {
  installMatchMedia();
  Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };
}

afterEach(() => {
  if (!dom) return;
  cleanup();
  setReducedMotion(false);
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setPageHead } from '../src/site/seo';

const head = () => ({
  canon: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  og: document.head.querySelector('meta[property="og:url"]')?.getAttribute('content'),
  robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
});

describe('per-page head tags', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="canonical" href="https://elymum.io/" /><meta property="og:url" content="https://elymum.io/" />';
  });

  it('points canonical and og:url at the page, on the build origin', () => {
    setPageHead('/mint');
    expect(head()).toEqual({ canon: 'https://elymum.io/mint', og: 'https://elymum.io/mint', robots: null });
    setPageHead('/');
    expect(head().canon).toBe('https://elymum.io/');
  });

  it('marks the not-found page noindex, and drops it again on a real page', () => {
    setPageHead('/nope', false);
    expect(head().robots).toBe('noindex');
    setPageHead('/docs');
    expect(head().robots).toBeNull();
  });

  it('ships robots.txt and a sitemap (the SPA rewrite would answer them with the landing HTML)', () => {
    const pub = resolve(__dirname, '../public');
    expect(readFileSync(resolve(pub, 'robots.txt'), 'utf8')).toMatch(/Sitemap: https:\/\/elymum\.io\/sitemap\.xml/);
    const sitemap = readFileSync(resolve(pub, 'sitemap.xml'), 'utf8');
    for (const p of ['/play', '/mint', '/wl', '/collab', '/docs', '/faucet']) expect(sitemap).toContain(`https://elymum.io${p}<`);
  });
});

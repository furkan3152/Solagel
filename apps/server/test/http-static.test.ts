import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NullChain } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { createHttpServer } from '../src/http';

/** The single-origin deploy (`WEB_DIST`): static files plus the SPA fallback for client routes like `/docs`. */
describe('static web client', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function start(): Promise<string> {
    const web = mkdtempSync(join(tmpdir(), 'slana-web-'));
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>Slana</title>');
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'assets', 'app-1234.js'), 'console.log(1)');
    const cfg = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'slana-data-')), WEB_DIST: web } as NodeJS.ProcessEnv);
    server = createHttpServer(cfg, { chain: new NullChain(), rooms: {} as never, leaderboards: {} as never, auth: {} as never, startedAt: Date.now() });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }

  it('serves index.html for the player guide path /docs (SPA fallback)', async () => {
    const url = await start();
    for (const path of ['/docs', '/docs/', '/']) {
      const res = await fetch(url + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toMatch(/text\/html/);
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
      expect(await res.text(), path).toContain('<title>Slana</title>');
    }
  });

  it('serves hashed assets immutable and 404s missing files and API paths', async () => {
    const url = await start();
    const asset = await fetch(`${url}/assets/app-1234.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toMatch(/immutable/);
    // a missing file with an extension is not the SPA
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
    // API paths and missing files with an extension (e.g. the removed /pass/<n>.json) never fall back to index.html
    const api = await fetch(`${url}/api/docs`);
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).toMatch(/json/);
    expect((await fetch(`${url}/pass/1.json`)).headers.get('content-type')).toMatch(/json/);
  });
});

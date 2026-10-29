import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { siwsMessage } from '@elymum/shared';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedLoginMessage } from '../src/solana/siws';
import { gameServerProxy } from '../vite.config';

/**
 * The documented dev setup (`pnpm dev`: web on :5173 proxying `/api` to the game
 * server on :8787). The server names the request's Host in the SIWS message, so
 * the proxy must pass the browser's Host through or the client refuses to sign.
 */
describe('dev proxy keeps the page host for sign-in', () => {
  let game: Server;
  let vite: ViteDevServer;
  let webPort = 0;
  let targetHost = '';
  const pubkey = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

  beforeAll(async () => {
    // a stand-in game server: answers the nonce request the way apps/server does (domain = Host)
    game = createHttpServer((req, res) => {
      const domain = req.headers.host ?? '';
      const fields = { domain, uri: `http://${domain}`, chainId: 'solana:devnet', nonce: 'n0nce', issuedAt: '2026-10-15T00:00:00.000Z' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...fields, message: siwsMessage({ ...fields, address: pubkey }) }));
    });
    await new Promise<void>((r) => game.listen(0, '127.0.0.1', r));
    targetHost = `127.0.0.1:${(game.address() as AddressInfo).port}`;
    const target = `http://${targetHost}`;
    vite = await createServer({
      configFile: false,
      root: __dirname,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', proxy: gameServerProxy(target), hmr: false, watch: null },
    });
    await vite.listen();
    webPort = (vite.httpServer!.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await vite?.close();
    await new Promise((r) => game?.close(r));
  });

  it('forwards the browser Host, so the client accepts the sign-in message', async () => {
    // the page's host (here the dev server's own address), never the proxy target's
    const pageHost = `127.0.0.1:${webPort}`;
    const res = await fetch(`http://${pageHost}/api/auth/nonce?pubkey=${pubkey}`);
    const body = await res.json();
    expect(body.domain).toBe(pageHost);
    expect(body.domain).not.toBe(targetHost);
    expect(expectedLoginMessage(body, pubkey, [pageHost])).toBe(body.message);
  });

  it('keeps the proxy target for the WebSocket', () => {
    const p = gameServerProxy('http://127.0.0.1:8787');
    expect(p['/api'].changeOrigin).toBe(false);
    expect(p['/ws'].target).toBe('ws://127.0.0.1:8787');
  });
});

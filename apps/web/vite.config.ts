import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gameServer = process.env.GAME_SERVER ?? 'http://127.0.0.1:8787';

// index.html uses %VITE_PUBLIC_URL% for its absolute canonical / Open Graph URLs (they must be
// absolute: crawlers need them, and Vite would try to bundle a relative og:image). Default: the
// server's PUBLIC_URL, else the planned public domain. Set VITE_PUBLIC_URL (or PUBLIC_URL) at build time.
process.env.VITE_PUBLIC_URL = (process.env.VITE_PUBLIC_URL || process.env.PUBLIC_URL || 'https://elymum.io').replace(/\/+$/, '');

/**
 * Dev / preview proxy to the game server. `/api` keeps the browser's Host header
 * (no `changeOrigin`): the server names the request host in the SIWE sign-in
 * message, and the client only signs a message for the page it is on
 * (`localhost:5173`), not for the proxy target (`127.0.0.1:8787`).
 * The WebSocket carries no host-bound data, so it keeps the target's host.
 */
export function gameServerProxy(target: string) {
  return {
    '/api': { target, changeOrigin: false },
    '/ws': { target: target.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: gameServerProxy(gameServer),
  },
  preview: {
    port: 4173,
    proxy: gameServerProxy(gameServer),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // long-term cacheable vendor chunks
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // package roots only (`node_modules/<pkg>/`): viem and its crypto / ABI dependencies in one cacheable chunk
          if (/node_modules[\\/](viem|ox|abitype|@noble|@scure|isows)[\\/]/.test(id)) return 'viem';
          if (/node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});

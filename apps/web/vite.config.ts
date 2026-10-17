import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gameServer = process.env.GAME_SERVER ?? 'http://127.0.0.1:8787';

/**
 * Dev / preview proxy to the game server. `/api` keeps the browser's Host header
 * (no `changeOrigin`): the server names the request host in the SIWS sign-in
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
  define: {
    // web3.js / anchor expect a node-ish global
    global: 'globalThis',
  },
  resolve: {
    alias: { buffer: 'buffer/' },
  },
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
          // package roots only (`node_modules/<pkg>/`): a bare `/buffer` also matched motion-dom's stats/buffer.mjs and
          // pulled the whole Solana chunk into the landing
          if (/node_modules[\\/](@solana|@anchor-lang|@wallet-standard|bn\.js|borsh|buffer|bs58|base-x|superstruct|@noble|rpc-websockets|jayson|eventemitter3)[\\/]/.test(id)) return 'solana';
          if (/node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});

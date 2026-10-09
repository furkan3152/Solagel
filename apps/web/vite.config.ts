import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const gameServer = process.env.GAME_SERVER ?? 'http://127.0.0.1:8787';

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
    proxy: {
      '/api': { target: gameServer, changeOrigin: true },
      '/ws': { target: gameServer.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: gameServer, changeOrigin: true },
      '/ws': { target: gameServer.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});

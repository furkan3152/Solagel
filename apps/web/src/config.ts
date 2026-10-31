/** Where the game server lives. Same origin by default (Vite dev proxies /ws and /api). */
function resolveServer(): { http: string; ws: string } {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) {
    const http = env.replace(/\/$/, '').replace(/^ws/, 'http');
    return { http, ws: `${http.replace(/^http/, 'ws')}/ws` };
  }
  const { protocol, host } = window.location;
  const http = `${protocol}//${host}`;
  // A static host (Vercel) proxies /api to the game server but cannot carry the WebSocket:
  // VITE_WS_URL points the socket straight at the game server.
  const ws = (import.meta.env.VITE_WS_URL as string | undefined)?.replace(/\/$/, '');
  return { http, ws: ws ? `${ws.replace(/^http/, 'ws')}/ws` : `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws` };
}

export const SERVER = resolveServer();

/** Optional client-side overrides for the chain settings the server advertises. */
export const CHAIN_OVERRIDES = {
  rpcUrl: (import.meta.env.VITE_RPC_URL as string | undefined) || null,
};

export const APP_VERSION = '0.1.0';

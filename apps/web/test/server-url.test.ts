import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The web on Vercel talks to the game server on its own origin (VITE_SERVER_URL=https://game.elymum.io):
 * every REST call, the socket, the pictures and the admin backup command use that absolute origin.
 */
describe('VITE_SERVER_URL (web and game server on different origins)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const load = async (url: string) => {
    vi.stubEnv('VITE_SERVER_URL', url);
    vi.resetModules();
    return import('../src/config');
  };

  it('resolves the http base and the wss socket from the https origin', async () => {
    expect((await load('https://game.elymum.io')).SERVER).toEqual({ http: 'https://game.elymum.io', ws: 'wss://game.elymum.io/ws' });
    expect((await load('https://game.elymum.io/')).SERVER).toEqual({ http: 'https://game.elymum.io', ws: 'wss://game.elymum.io/ws' });
    expect((await load('wss://game.elymum.io')).SERVER).toEqual({ http: 'https://game.elymum.io', ws: 'wss://game.elymum.io/ws' });
  });

  it('sends admin calls to the game server with the bearer token, and builds the backup command for it', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://game.elymum.io');
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ address: '0xabc', admin: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { adminApi } = await import('../src/site/api');
    const api = adminApi('tok.en');
    await api.me();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://game.elymum.io/api/admin/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok.en');
    expect(api.backupCommand()).toBe("curl -fsS -H 'Authorization: Bearer tok.en' 'https://game.elymum.io/api/admin/backup' -o elymum-backup.tar.gz");
  });

  it('loads profile pictures from the game server', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://game.elymum.io');
    vi.resetModules();
    const { AvatarCache } = await import('../src/render/avatars');
    const cache = new AvatarCache() as unknown as { urlOf: (id: string) => string };
    expect(cache.urlOf('abc')).toMatch(/^https:\/\/game\.elymum\.io\/api\/avatar\//);
  });

  it('quotes a token safely in the shell command', async () => {
    const { backupCurlCommand } = await import('../src/site/api');
    expect(backupCurlCommand('https://game.elymum.io/', "a'b")).toBe("curl -fsS -H 'Authorization: Bearer a'\\''b' 'https://game.elymum.io/api/admin/backup' -o elymum-backup.tar.gz");
  });
});

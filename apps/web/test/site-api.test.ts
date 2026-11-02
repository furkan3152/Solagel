import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, SERVER_DOWN, SiteApiError } from '../src/site/api';

const answer = (status: number, body: string, type = 'text/html') => vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': type } }));

describe('site API errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a proxy 5xx without a JSON error says the server is not answering, not that the form is wrong', async () => {
    vi.stubGlobal('fetch', answer(502, '<html>Bad Gateway</html>'));
    const err = await request('/api/site/wl/status').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteApiError);
    expect((err as SiteApiError).code).toBe('network');
    expect((err as SiteApiError).message).toBe(SERVER_DOWN);
  });

  it("keeps the server's own JSON error on a 5xx and a 4xx", async () => {
    vi.stubGlobal('fetch', answer(503, JSON.stringify({ error: 'price_unavailable', message: 'No price.' }), 'application/json'));
    expect(await request('/x').catch((e: SiteApiError) => [e.code, e.message])).toEqual(['price_unavailable', 'No price.']);
    vi.stubGlobal('fetch', answer(400, 'nope'));
    expect(await request('/x').catch((e: SiteApiError) => e.code)).toBe('bad_request');
  });
});

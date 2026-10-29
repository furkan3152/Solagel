import { describe, expect, it } from 'vitest';
import { clientIp, trustProxyHops } from '../src/net/gateway';
import { Limiter } from '../src/net/limiter';

const req = (xff: string | string[] | undefined, remote = '10.0.0.1') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } }) as never;

describe('clientIp (TRUST_PROXY)', () => {
  it('ignores X-Forwarded-For without a trusted proxy', () => {
    expect(clientIp(req('1.2.3.4'), false)).toBe('10.0.0.1');
    expect(clientIp(req('1.2.3.4'), 0)).toBe('10.0.0.1');
  });

  it('takes the right-most hop (the address the proxy saw), never a client-written left-most value', () => {
    // the client forged "6.6.6.6"; the proxy appended the real peer
    expect(clientIp(req('6.6.6.6, 203.0.113.9'), true)).toBe('203.0.113.9');
    expect(clientIp(req('6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIp(req(['6.6.6.6', '203.0.113.9']), 1)).toBe('203.0.113.9');
    expect(clientIp(req('203.0.113.9'), 1)).toBe('203.0.113.9');
    // two proxies (CDN + load balancer): the second entry from the right
    expect(clientIp(req('6.6.6.6, 203.0.113.9, 198.51.100.2'), 2)).toBe('203.0.113.9');
    // fewer entries than hops: the left-most there is; none: the socket
    expect(clientIp(req('203.0.113.9'), 3)).toBe('203.0.113.9');
    expect(clientIp(req(' , '), 1)).toBe('10.0.0.1');
    expect(clientIp(req(undefined), 1)).toBe('10.0.0.1');
  });

  it('reads TRUST_PROXY / TRUST_PROXY_HOPS', () => {
    expect(trustProxyHops({})).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY: '0', TRUST_PROXY_HOPS: '2' })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY: '1' })).toBe(1);
    expect(trustProxyHops({ TRUST_PROXY: '1', TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(trustProxyHops({ TRUST_PROXY: '1', TRUST_PROXY_HOPS: 'x' })).toBe(1);
    expect(trustProxyHops({ TRUST_PROXY: '1', TRUST_PROXY_HOPS: '0' })).toBe(1);
  });
});

describe('Limiter', () => {
  it('a flood of fresh keys never resets a rate-limited key', () => {
    const lim = new Limiter(20, 60_000);
    for (let i = 0; i < 20; i++) expect(lim.allow('ip', 1000)).toBe(true);
    expect(lim.allow('ip', 1000)).toBe(false);
    for (let i = 0; i < 10_001; i++) lim.allow(`spoofed-${i}`, 1000 + i / 100);
    expect(lim.allow('ip', 1200)).toBe(false);
    // bounded memory
    expect(lim.size).toBeLessThanOrEqual(10_000);
    // the window still ends on time
    expect(lim.allow('ip', 61_001)).toBe(true);
  });

  it('evicts expired windows first, then the oldest under-limit ones', () => {
    const lim = new Limiter(2, 1000, 10);
    for (let i = 0; i < 5; i++) lim.allow(`old-${i}`, 0);
    for (let i = 0; i < 5; i++) lim.allow(`new-${i}`, 1500);
    expect(lim.size).toBe(10);
    lim.allow('x', 1600);
    // the 5 expired ones went, the live ones stayed
    expect(lim.size).toBe(6);
    // full of live keys: the oldest under-limit key makes room, a blocked one stays blocked
    const l2 = new Limiter(1, 60_000, 3);
    l2.allow('blocked', 0);
    l2.allow('blocked', 0);
    l2.allow('a', 1);
    l2.allow('b', 2);
    l2.allow('c', 3);
    expect(l2.size).toBeLessThanOrEqual(3);
    expect(l2.allow('blocked', 4)).toBe(false);
  });
});

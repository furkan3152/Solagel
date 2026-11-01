import { describe, expect, it } from 'vitest';
import { RpcBudget, bodyRateLimited, formatRpcMinute, isRateLimited, methodsOf, retryAfterMs, withRpcPriority } from '../src/chain/rpc-budget';

const body = (method: string | string[]) =>
  JSON.stringify(Array.isArray(method) ? method.map((m, i) => ({ jsonrpc: '2.0', id: i, method: m, params: [] })) : { jsonrpc: '2.0', id: 1, method, params: [] });
const ok = (result: unknown = '0x1') => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
const http429 = (retryAfter?: string) =>
  new Response('Rate Limit Exceeded. Please get an api key', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
const json429 = () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Rate Limit Exceeded. Please get an api key' } }), { status: 200 });

describe('rpc budget', () => {
  it('recognises the public RPC rate limit in every shape it comes in', () => {
    expect(isRateLimited(Object.assign(new Error('HTTP request failed.'), { status: 429 }))).toBe(true);
    expect(isRateLimited(new Error('RPC Request failed.', { cause: { code: 429, message: 'Rate Limit Exceeded. Please get an api key' } }))).toBe(true);
    expect(isRateLimited({ code: -32005, message: 'limit exceeded' })).toBe(true);
    expect(isRateLimited(new Error('execution reverted: NotServer'))).toBe(false);
    expect(bodyRateLimited(JSON.stringify([{ id: 1, result: '0x' }, { id: 2, error: { code: 429, message: 'x' } }]))).toBe(true);
    expect(bodyRateLimited(JSON.stringify({ id: 1, error: { code: 3, message: 'execution reverted' } }))).toBe(false);
    expect(bodyRateLimited(JSON.stringify({ id: 1, result: '0xerror' }))).toBe(false);
    expect(methodsOf(body(['eth_call', 'eth_blockNumber']))).toEqual(['eth_call', 'eth_blockNumber']);
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(null)).toBeNull();
  });

  it('retries a 429 after the backoff (Retry-After respected), counts calls and 429s per method', async () => {
    const budget = new RpcBudget({ ratePerSec: 1000, burst: 10, backoffBaseMs: 5, backoffMaxMs: 20 });
    const answers = [http429('0.03'), json429(), ok('0x2a')];
    const sent: number[] = [];
    const fetchFn = budget.fetchFn(async () => {
      sent.push(Date.now());
      return answers.shift()!;
    });
    const t0 = Date.now();
    const res = await fetchFn('http://rpc', { method: 'POST', body: body('eth_blockNumber') });
    expect(await res.json()).toMatchObject({ result: '0x2a' });
    expect(sent).toHaveLength(3);
    // Retry-After: 0.03 s held the second attempt back
    expect(sent[1] - t0).toBeGreaterThanOrEqual(25);
    const m = budget.takeMinute();
    expect(m).toMatchObject({ calls: 3, limited: 2, byMethod: { eth_blockNumber: 3 } });
    expect(formatRpcMinute(m)).toMatch(/^rpc: 3 calls\/min, 2 429s · eth_blockNumber 3/);
    // the rate was cut by the 429s and climbs back on success
    expect(budget.currentRate).toBeLessThan(1000);
  });

  it('gives up after the attempts of its priority and hands the 429 to viem (low priority gives up first)', async () => {
    const budget = new RpcBudget({ ratePerSec: 1000, burst: 10, backoffBaseMs: 1, backoffMaxMs: 2, attempts: { high: 4, normal: 3, low: 2 } });
    let n = 0;
    const fetchFn = budget.fetchFn(async () => {
      n++;
      return http429();
    });
    const res = await withRpcPriority('low', () => fetchFn('http://rpc', { method: 'POST', body: body('eth_getLogs') }));
    expect(res.status).toBe(429);
    expect(n).toBe(2);
    n = 0;
    await withRpcPriority('high', () => fetchFn('http://rpc', { method: 'POST', body: body('eth_call') }));
    expect(n).toBe(4);
  });

  it('keeps to the rate: a burst, then one call per 1/rate seconds', async () => {
    const budget = new RpcBudget({ ratePerSec: 50, burst: 2 });
    const at: number[] = [];
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => budget.acquire(1, 'high').then(() => at.push(Date.now() - t0))));
    // 2 at once, then 4 more at 50/s: at least ~80 ms in all
    expect(at[1]).toBeLessThan(15);
    expect(at[5]).toBeGreaterThanOrEqual(70);
  });

  it('serves high priority first and keeps a reserve low priority cannot touch', async () => {
    const budget = new RpcBudget({ ratePerSec: 20, burst: 5 });
    const order: string[] = [];
    // drain the bucket
    for (let i = 0; i < 5; i++) await budget.acquire(1, 'high');
    const jobs = [
      ...Array.from({ length: 3 }, (_, i) => budget.acquire(1, 'low').then(() => order.push(`low${i}`))),
      budget.acquire(1, 'normal').then(() => order.push('normal')),
      budget.acquire(1, 'high').then(() => order.push('high')),
    ];
    await Promise.all(jobs);
    expect(order[0]).toBe('high');
    expect(order[1]).toBe('normal');
    expect(order.slice(2)).toEqual(['low0', 'low1', 'low2']);
  });

  it('a 429 holds every request for the cool-down (no hammering)', async () => {
    const budget = new RpcBudget({ ratePerSec: 1000, burst: 10, backoffBaseMs: 40, backoffMaxMs: 40, random: () => 1 });
    budget.noteRateLimited();
    const t0 = Date.now();
    await budget.acquire(1, 'high');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });
});

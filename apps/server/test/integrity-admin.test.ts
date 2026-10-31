import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type ServerMessage } from '@elymum/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import { loadConfig } from '../src/config';
import { Limiter } from '../src/net/limiter';
import type { SettlementItem } from '../src/stake/journal';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

const wallet = () => testSigner().address;

interface Harness {
  app: App;
  port: number;
  dir: string;
  admin: string;
  token(w: string): string;
  call(method: string, path: string, opts?: { wallet?: string | null; body?: unknown }): Promise<{ status: number; body: any; text: string; headers: Headers }>;
}

async function harness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'elymum-integrity-'));
  const admin = wallet();
  const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '2', BOT_MIN: '0', BOT_MAX: '2', ADMIN_WALLETS: admin, TRUST_PROXY: '0', GAME_ACCESS: 'public', ROUND_JOIN_CLOSE_SECONDS: '0' } as NodeJS.ProcessEnv);
  const app = await createApp(cfg, {
    chain: new ArenaChain([arena(1, 1000)]),
    log: () => {},
    persist: true,
    siteLimits: { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
    apiLimiter: new Limiter(10_000, 60_000),
  });
  const port = await app.listen();
  const token = (w: string) => app.auth.issueToken(w);
  return {
    app,
    port,
    dir,
    admin,
    token,
    call: async (method, path, opts = {}) => {
      const headers: Record<string, string> = {};
      if (opts.wallet) headers.Authorization = `Bearer ${token(opts.wallet)}`;
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed, text, headers: res.headers };
    },
  };
}

class Ws {
  msgs: ServerMessage[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d, bin) => {
      if (!bin) this.msgs.push(JSON.parse(d.toString()) as ServerMessage);
    });
  }
  static async open(port: number): Promise<Ws> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
    const c = new Ws(ws);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.next('welcome');
    return c;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async next<T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> {
    const until = Date.now() + 3000;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
      if (i >= 0) return this.msgs.splice(0, i + 1)[i] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > until) throw new Error(`no ${t}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async attempt(msg: unknown): Promise<ServerMessage> {
    this.msgs = [];
    this.send(msg);
    const until = Date.now() + 3000;
    for (;;) {
      const m = this.msgs.find((x) => x.t === 'joined' || x.t === 'error');
      if (m) return m;
      if (Date.now() > until) throw new Error('no reply');
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  close() {
    this.ws.close();
  }
}

const held = (key: string, player: string, payout: number): SettlementItem => ({
  kind: 'settle',
  key,
  player,
  arenaId: 1,
  session: key,
  sessionId: 3,
  payout,
  score: 0,
  kills: 0,
  xp: 0,
  reason: 'round',
  attempts: 0,
  nextAttemptAt: Date.now(),
  createdAt: Date.now(),
  held: { at: Date.now(), score: 96, why: 'test hold', flags: [] },
});

describe('integrity admin API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.app.close();
  });

  const someKey = '0x00000000000000000000000000000000000000a1';
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/admin/integrity'],
    ['GET', '/api/admin/integrity/settings'],
    ['PUT', '/api/admin/integrity/settings', { autoHold: false }],
    ['GET', '/api/admin/integrity/flags'],
    ['GET', '/api/admin/integrity/flags.csv'],
    ['POST', '/api/admin/integrity/scan', {}],
    ['GET', '/api/admin/integrity/held'],
    ['GET', '/api/admin/integrity/bans'],
    ['POST', '/api/admin/integrity/bans', { wallet: someKey, reason: 'x' }],
    ['DELETE', `/api/admin/integrity/bans/${someKey}`],
    ['GET', `/api/admin/integrity/wallet/${someKey}`],
    ['POST', '/api/admin/integrity/flags/pair_transfer%3Aabc/status', { status: 'reviewed' }],
    ['POST', `/api/admin/integrity/held/${someKey}/release`, {}],
    ['POST', `/api/admin/integrity/held/${someKey}/settle-zero`, { reason: 'abc' }],
  ];

  it('every endpoint: 401 without a session, 403 for a non-admin wallet', async () => {
    const user = wallet();
    for (const [m, p, body] of routes) {
      expect((await h.call(m, p, { body })).status, `${m} ${p}`).toBe(401);
      expect((await h.call(m, p, { wallet: user, body })).status, `${m} ${p}`).toBe(403);
    }
    // nothing changed by the refused calls
    expect(h.app.integrity.overview().bans).toEqual([]);
  });

  it('the admin reads the overview and settings; bad settings are refused', async () => {
    const o = await h.call('GET', '/api/admin/integrity', { wallet: h.admin });
    expect(o.status).toBe(200);
    expect(o.body.settings.autoHold).toBe(false);
    expect(o.body.defaults.thresholds.flagMinScore).toBe(40);
    expect(o.body.counts).toMatchObject({ open: 0, held: 0, bans: 0 });

    for (const bad of [{ autoHold: 'yes' }, { holdScore: 10 }, { thresholds: { flagMinScore: 500 } }, { thresholds: { nope: 1 } }, { other: 1 }]) {
      const r = await h.call('PUT', '/api/admin/integrity/settings', { wallet: h.admin, body: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error).toBe('bad_request');
    }
    const ok = await h.call('PUT', '/api/admin/integrity/settings', { wallet: h.admin, body: { autoHold: true, holdScore: 95, thresholds: { pairMinEvents: 6 } } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ autoHold: true, holdScore: 95 });
    expect(ok.body.settings.thresholds.pairMinEvents).toBe(6);
    // persisted atomically under DATA_DIR/integrity/
    const state = JSON.parse(readFileSync(join(h.dir, 'integrity', 'state.json'), 'utf8'));
    expect(state.settings.autoHold).toBe(true);
    expect(existsSync(join(h.dir, 'integrity', 'state.json.tmp'))).toBe(false);
    const reset = await h.call('PUT', '/api/admin/integrity/settings', { wallet: h.admin, body: { reset: true } });
    expect(reset.body.settings.autoHold).toBe(false);
    expect(reset.body.settings.thresholds.pairMinEvents).toBe(4);
  });

  it('a ban refuses arena joins with `banned` (practice still works); an unban lifts it', async () => {
    const player = wallet();
    const c = await Ws.open(h.port);
    c.send({ t: 'auth', token: h.token(player) });
    await c.next('authed');
    const arenaJoin = { t: 'join', room: 'arena:1', name: 'p', skin: 0, fp: 'ab'.repeat(16) };
    // not banned: past the gate to the ticket check (the test chain has no ticket)
    expect(await c.attempt(arenaJoin)).toMatchObject({ t: 'error', code: 'no_session' });

    expect((await h.call('POST', '/api/admin/integrity/bans', { wallet: h.admin, body: { wallet: 'not-a-wallet', reason: 'x' } })).status).toBe(400);
    expect((await h.call('POST', '/api/admin/integrity/bans', { wallet: h.admin, body: { wallet: player, reason: '' } })).status).toBe(400);
    const ban = await h.call('POST', '/api/admin/integrity/bans', { wallet: h.admin, body: { wallet: player, reason: 'Fed a second wallet' } });
    expect(ban.status).toBe(201);
    expect(ban.body.ban).toMatchObject({ wallet: player, by: h.admin, reason: 'Fed a second wallet' });

    expect(await c.attempt(arenaJoin)).toMatchObject({ t: 'error', code: 'banned' });
    expect((await c.attempt({ t: 'join', room: 'practice', name: 'p', skin: 0 })).t).toBe('joined');
    c.send({ t: 'leave' });
    // another wallet is not affected
    const other = await Ws.open(h.port);
    other.send({ t: 'auth', token: h.token(wallet()) });
    await other.next('authed');
    expect(await other.attempt(arenaJoin)).toMatchObject({ t: 'error', code: 'no_session' });
    other.close();

    // the ban survives a restart of the service state (state.json)
    const state = JSON.parse(readFileSync(join(h.dir, 'integrity', 'state.json'), 'utf8'));
    expect(state.bans.map((b: { wallet: string }) => b.wallet)).toContain(player);

    expect((await h.call('DELETE', `/api/admin/integrity/bans/${player}`, { wallet: h.admin })).status).toBe(200);
    expect((await h.call('DELETE', `/api/admin/integrity/bans/${player}`, { wallet: h.admin })).status).toBe(404);
    expect(await c.attempt(arenaJoin)).toMatchObject({ t: 'error', code: 'no_session' });
    c.close();
  });

  it('held settlements: listed, released, or settled at 0 with a reason (journal books unchanged)', async () => {
    const j = h.app.journal;
    const p1 = wallet();
    const p2 = wallet();
    const k1 = `1:${p1.toLowerCase()}:3`;
    const k2 = `1:${p2.toLowerCase()}:3`;
    j.commit({ enqueue: [held(k1, p1, 5000), held(k2, p2, 7000)] });
    const books = () => j.pending.reduce((s, p) => s + (p.kind === 'settle' ? (p.payout ?? 0) : p.amount), 0) + j.forfeitedByArena(1);
    const before = books();

    const list = await h.call('GET', '/api/admin/integrity/held', { wallet: h.admin });
    expect(list.body.held.map((x: { key: string }) => x.key).sort()).toEqual([k1, k2].sort());
    expect(list.body.held[0]).toMatchObject({ score: 96, why: 'test hold', arenaId: 1 });

    expect((await h.call('POST', `/api/admin/integrity/held/${k1}/release`, { wallet: h.admin, body: {} })).status).toBe(200);
    expect(j.pending.find((p) => p.key === k1)).toMatchObject({ payout: 5000 });
    expect((j.pending.find((p) => p.key === k1) as SettlementItem).held).toBeUndefined();
    expect((await h.call('POST', `/api/admin/integrity/held/${k1}/release`, { wallet: h.admin, body: {} })).status).toBe(404);

    expect((await h.call('POST', `/api/admin/integrity/held/${k2}/settle-zero`, { wallet: h.admin, body: { reason: '' } })).status).toBe(400);
    const z = await h.call('POST', `/api/admin/integrity/held/${k2}/settle-zero`, { wallet: h.admin, body: { reason: 'Confirmed collusion' } });
    expect(z.status).toBe(200);
    expect(z.body.forfeited).toBe(7000);
    expect(z.body.held).toEqual([]);
    expect(j.pending.find((p) => p.key === k2)).toMatchObject({ payout: 0 });
    expect(j.forfeits().at(-1)).toMatchObject({ key: k2, amount: 7000, reason: 'Confirmed collusion', by: h.admin });
    expect(books()).toBe(before);
    // journaled on disk
    const disk = JSON.parse(readFileSync(join(h.dir, 'journal.json'), 'utf8'));
    expect(disk.forfeits.at(-1)).toMatchObject({ key: k2, amount: 7000 });
    j.remove(k1);
    j.remove(k2);
  });

  it('flags: list, filter, review, dismiss, CSV; wallet view', async () => {
    const svc = h.app.integrity;
    // two wallets sharing a browser in one arena: a shared-device flag
    const room = { id: 'arena-1-1', now: () => Date.now(), round: () => ({ n: 1, endsAt: Date.now() + 100_000, joinsCloseAt: Date.now() + 50_000 }), opts: { stake: { arenaId: 1, buyIn: 1000 } } };
    const a = wallet();
    const b = wallet();
    svc.join(room, 9001, { ip: '9.9.9.9', fp: 'cd'.repeat(16) }, { player: a, session: 'sa', sessionId: 1, arenaId: 1, entryFee: 1000 });
    svc.join(room, 9002, { ip: '9.9.9.9', fp: 'cd'.repeat(16) }, { player: b, session: 'sb', sessionId: 2, arenaId: 1, entryFee: 1000 });
    const late = { ...room, now: () => Date.now() + 120_000 };
    svc.settle(late, 9001, null, { reason: 'round', payout: 1000, killer: null, killerIsBot: false });
    svc.settle(late, 9002, null, { reason: 'round', payout: 1000, killer: null, killerIsBot: false });

    const scan = await h.call('POST', '/api/admin/integrity/scan', { wallet: h.admin, body: {} });
    expect(scan.status).toBe(200);
    expect(scan.body.counts.open).toBeGreaterThanOrEqual(1);
    const flags = (await h.call('GET', '/api/admin/integrity/flags?status=open&kind=shared_device', { wallet: h.admin })).body.flags;
    expect(flags).toHaveLength(1);
    const f = flags[0];
    expect(f.wallets.sort()).toEqual([a, b].sort());
    expect(f.evidence.sameBrowser).toBe(true);
    // raw IPs and fingerprints never appear, only keyed hashes
    expect(JSON.stringify(f)).not.toContain('9.9.9.9');
    expect((await h.call('GET', '/api/admin/integrity/flags?kind=nope', { wallet: h.admin })).status).toBe(400);
    expect((await h.call('GET', `/api/admin/integrity/flags?q=${a.slice(0, 6)}`, { wallet: h.admin })).body.flags).toHaveLength(1);

    const id = encodeURIComponent(f.id);
    expect((await h.call('POST', `/api/admin/integrity/flags/${id}/status`, { wallet: h.admin, body: { status: 'bogus' } })).status).toBe(400);
    const rev = await h.call('POST', `/api/admin/integrity/flags/${id}/status`, { wallet: h.admin, body: { status: 'dismissed', note: 'Siblings, checked' } });
    expect(rev.body.flag).toMatchObject({ status: 'dismissed', note: 'Siblings, checked', statusBy: h.admin });
    // a re-scan does not re-open it (same score)
    await h.call('POST', '/api/admin/integrity/scan', { wallet: h.admin, body: {} });
    expect((await h.call('GET', `/api/admin/integrity/flags/${id}`, { wallet: h.admin })).body.flag.status).toBe('dismissed');

    const csv = await h.call('GET', '/api/admin/integrity/flags.csv', { wallet: h.admin });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toContain('id,kind,status,score');
    expect(csv.text).toContain(f.id);

    const view = await h.call('GET', `/api/admin/integrity/wallet/${a}`, { wallet: h.admin });
    expect(view.status).toBe(200);
    expect(view.body.sessions).toHaveLength(1);
    expect(view.body.flags.map((x: { id: string }) => x.id)).toContain(f.id);
    expect((await h.call('GET', '/api/admin/integrity/wallet/zzz', { wallet: h.admin })).status).toBe(400);

    // summaries are persisted as immutable log chunks
    svc.flush();
    const logs = readdirSync(join(h.dir, 'integrity', 'log'));
    expect(logs.length).toBeGreaterThan(0);
    const chunk = JSON.parse(readFileSync(join(h.dir, 'integrity', 'log', logs[0]), 'utf8'));
    expect(chunk.sessions.some((s: { wallet: string }) => s.wallet === a)).toBe(true);
  });
});

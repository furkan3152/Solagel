import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PROTOCOL_VERSION, type CollabAdmin, type CollabPublic, type ServerMessage, type WlEntryAdmin, type WlEntryPublic } from '@elymum/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import { loadConfig, parseAdminWallets } from '../src/config';
import { Limiter } from '../src/net/limiter';
import { SiteApi } from '../src/site/routes';
import { SITE_FILES, SiteStore, csvCell } from '../src/site/store';
import { isUserWallet } from '../src/site/validate';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

const wallet = () => testSigner().address;
/** Not an EVM address: never a user wallet. */
const notEvmWallet = 'not-an-evm-wallet';
const post = (h = 'alice', id = '1790000000000000001') => `https://x.com/${h}/status/${id}`;
const HOUR = 3_600_000;

interface Harness {
  app: App;
  port: number;
  dir: string;
  admin: string;
  clock: { t: number };
  token(w: string): string;
  call(method: string, path: string, opts?: { wallet?: string | null; body?: unknown; raw?: string; type?: string; ip?: string }): Promise<{ status: number; body: any; text: string; headers: Headers }>;
}

async function harness(env: Record<string, string> = {}, limits?: ConstructorParameters<typeof SiteApi>[3]): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'elymum-site-'));
  const admin = wallet();
  const clock = { t: Date.now() };
  const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '2', BOT_MIN: '0', BOT_MAX: '2', ADMIN_WALLETS: admin, TRUST_PROXY: '0', ...env } as NodeJS.ProcessEnv);
  const app = await createApp(cfg, { chain: new ArenaChain([arena(1, 1000)]), log: () => {}, persist: true, siteNow: () => clock.t,
    siteLimits: limits ?? { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
    apiLimiter: new Limiter(10_000, 60_000),
  });
  const port = await app.listen();
  const token = (w: string) => app.auth.issueToken(w);
  const call: Harness['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = {};
    if (opts.wallet) headers.Authorization = `Bearer ${token(opts.wallet)}`;
    let body: string | undefined;
    if (opts.raw !== undefined || opts.body !== undefined) {
      headers['Content-Type'] = opts.type ?? 'application/json';
      body = opts.raw ?? JSON.stringify(opts.body);
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
  };
  return { app, port, dir, admin, clock, token, call };
}

/** A complete WL application for the default tasks (the launch post is not live: that task is skipped). */
const wlBody = (handle: string, extra: Record<string, unknown> = {}) => ({
  xHandle: handle,
  answers: { follow_x: true, post_x: post(handle.replace(/^@/, '').toLowerCase()) },
  ...extra,
});

const collabBody = (contactX: string, extra: Record<string, unknown> = {}) => ({
  community: 'Coin Guild',
  type: 'guild',
  members: 1200,
  communityX: '@coinguild',
  contactX,
  discord: 'mod#1',
  role: 'founder',
  postUrl: post('coinguild'),
  about: 'We eat coins.',
  ...extra,
});

describe('admin wallets config', () => {
  it('has no default: nobody is admin until ADMIN_WALLETS lists 0x addresses', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).adminWallets).toEqual([]);
    expect(parseAdminWallets('')).toEqual([]);
    const a = wallet();
    const b = wallet();
    expect(parseAdminWallets(` ${a.toLowerCase()}, ${b},not-a-key,${a},${notEvmWallet}`)).toEqual([a, b]);
    expect(loadConfig({} as NodeJS.ProcessEnv).gameAccess).toBeNull();
    expect(loadConfig({ GAME_ACCESS: 'public' } as NodeJS.ProcessEnv).gameAccess).toBe('public');
  });

  it('user wallets are EVM addresses', () => {
    const w = wallet();
    expect(isUserWallet(w)).toBe(true);
    expect(isUserWallet(w.toLowerCase())).toBe(true);
    expect(isUserWallet(`0x${w.slice(2).toUpperCase()}`)).toBe(true);
    // a mixed-case typo fails the EIP-55 checksum
    const typo = w.slice(0, 2) + (w[2] === w[2].toLowerCase() ? w[2].toUpperCase() : w[2].toLowerCase()) + w.slice(3);
    if (/[a-fA-F]/.test(w[2])) expect(isUserWallet(typo)).toBe(false);
    expect(isUserWallet(`0x${'0'.repeat(40)}`)).toBe(false);
    expect(isUserWallet(notEvmWallet)).toBe(false);
    expect(isUserWallet('nope')).toBe(false);
  });
});

describe('site API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.app.close();
  });

  describe('auth', () => {
    it('admin routes: 401 without a session, 403 for a non-admin, 200 for the admin', async () => {
      for (const path of [
        '/api/admin/me',
        '/api/admin/settings',
        '/api/admin/wl',
        '/api/admin/collabs',
        '/api/admin/counts',
        '/api/admin/wl.csv',
        '/api/admin/tasks',
        '/api/admin/contracts',
        '/api/admin/mint/allowlist',
      ]) {
        expect((await h.call('GET', path)).status).toBe(401);
        const r = await h.call('GET', path, { wallet: wallet() });
        expect(r.status).toBe(403);
        expect(r.body.error).toBe('forbidden');
        expect((await h.call('GET', path, { wallet: h.admin })).status).toBe(200);
      }
      expect((await h.call('PUT', '/api/admin/settings', { wallet: wallet(), body: { gameAccess: 'public' } })).status).toBe(403);
      expect((await h.call('GET', '/api/admin/settings', { wallet: h.admin })).body).toMatchObject({ settings: { gameAccess: 'admins' }, gameAccessEnv: null });
      // admin addresses compare case-insensitively
      expect((await h.call('GET', '/api/admin/me', { wallet: h.admin.toLowerCase() })).body).toEqual({ address: h.admin, admin: true });
      // a forged token
      const res = await fetch(`http://127.0.0.1:${h.port}/api/admin/me`, { headers: { Authorization: `Bearer ${h.admin}.9999999999999.forged` } });
      expect(res.status).toBe(401);
    });

    it('logs in over HTTP with a signed SIWE message', async () => {
      const signer = testSigner();
      const address = signer.address;
      const nonce = (await (await fetch(`http://127.0.0.1:${h.port}/api/auth/nonce?address=${address}`)).json()) as { message: string };
      const bad = await h.call('POST', '/api/auth/login', { body: { address, message: nonce.message, signature: await testSigner().sign(nonce.message) } });
      expect(bad.status).toBe(401);
      expect(bad.body.error).toBe('auth_failed');
      const sig = await signer.sign(nonce.message);
      const ok = await h.call('POST', '/api/auth/login', { body: { address: address.toLowerCase(), message: nonce.message, signature: sig } });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ address, admin: false });
      const me = await fetch(`http://127.0.0.1:${h.port}/api/auth/me`, { headers: { Authorization: `Bearer ${ok.body.token}` } });
      expect(await me.json()).toEqual({ address, admin: false, holder: false, canPlay: false });
      // the nonce is single-use
      expect((await h.call('POST', '/api/auth/login', { body: { address, message: nonce.message, signature: sig } })).status).toBe(401);
      expect((await h.call('GET', '/api/auth/me')).status).toBe(401);
      expect((await h.call('GET', '/api/auth/me', { wallet: h.admin })).body).toEqual({ address: h.admin, admin: true, holder: false, canPlay: true });
    });

    it('my WL and my collabs need a session', async () => {
      expect((await h.call('GET', '/api/site/wl')).status).toBe(401);
      expect((await h.call('POST', '/api/site/wl', { body: wlBody('nobody') })).status).toBe(401);
      expect((await h.call('GET', '/api/site/collab')).status).toBe(401);
      expect((await h.call('POST', '/api/site/collab', { body: collabBody('nobody') })).status).toBe(401);
    });

    it('allows the site methods and the Authorization header over CORS', async () => {
      const res = await fetch(`http://127.0.0.1:${h.port}/api/site/wl`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    });
  });

  describe('public settings and tasks', () => {
    it('serves the defaults; the launch-post task opens when the link is set', async () => {
      const s = await h.call('GET', '/api/site/settings');
      expect(s.body.settings).toEqual({ wlOpen: true, collabOpen: false, gameAccess: 'admins', xHandle: 'elymumio', launchPostUrl: null });
      const t = await h.call('GET', '/api/site/tasks');
      expect(t.body.tasks.map((x: { id: string }) => x.id)).toEqual(['follow_x', 'post_x', 'engage_launch', 'x_handle', 'wallet']);
      const engage = t.body.tasks[2];
      expect(engage).toMatchObject({ kind: 'engage_x', target: null, available: false, required: false });
      expect((await h.call('POST', '/api/site/settings', {})).status).toBe(405);
    });
  });

  describe('WL', () => {
    it('validates every field', async () => {
      const w = wallet();
      const sub = (body: unknown) => h.call('POST', '/api/site/wl', { wallet: w, body });
      const expectBad = async (body: unknown, field: string) => {
        const r = await sub(body);
        expect(r.status, JSON.stringify(r.body)).toBe(400);
        expect(r.body.field).toBe(field);
      };
      await expectBad(wlBody('bad handle!'), 'xHandle');
      await expectBad(wlBody('a'.repeat(16)), 'xHandle');
      await expectBad({ xHandle: 'val1', answers: { follow_x: true } }, 'answers.post_x');
      await expectBad({ xHandle: 'val1', answers: { follow_x: true, post_x: 'https://x.com/val1' } }, 'answers.post_x');
      await expectBad({ xHandle: 'val1', answers: { follow_x: true, post_x: 'https://evil.com/val1/status/1' } }, 'answers.post_x');
      await expectBad({ xHandle: 'val1', answers: { follow_x: 'yes', post_x: post('val1') } }, 'answers.follow_x');
      await expectBad({ xHandle: 'val1', answers: [] }, 'answers');
      // honeypot
      const hp = await sub(wlBody('val1', { website: 'http://spam' }));
      expect(hp.status).toBe(400);
      expect(hp.body.error).toBe('bad_request');
      // body format and size
      expect((await h.call('POST', '/api/site/wl', { wallet: w, raw: '{nope', type: 'application/json' })).status).toBe(400);
      expect((await h.call('POST', '/api/site/wl', { wallet: w, raw: 'xHandle=a', type: 'application/x-www-form-urlencoded' })).status).toBe(415);
      const big = await h.call('POST', '/api/site/wl', { wallet: w, body: wlBody('val1', { pad: 'x'.repeat(33 * 1024) }) });
      expect(big.status).toBe(413);
      expect(big.body.error).toBe('body_too_large');
      expect((await h.call('POST', '/api/site/wl', { wallet: w, raw: '[1]' })).status).toBe(400);
      // nothing was stored
      expect((await h.call('GET', '/api/site/wl', { wallet: w })).body.entry).toBeNull();
    });

    it('submits, shows the entry back with a task snapshot, and is unique per wallet and handle', async () => {
      const w = wallet();
      const r = await h.call('POST', '/api/site/wl', { wallet: w, body: wlBody('@Alice') });
      expect(r.status).toBe(201);
      const entry = r.body.entry as WlEntryPublic;
      expect(entry).toMatchObject({ wallet: w, xHandle: 'alice', status: 'pending' });
      expect(entry.tasks.find((t) => t.id === 'wallet')?.answer).toBe(w);
      expect(entry.tasks.find((t) => t.id === 'x_handle')?.answer).toBe('alice');
      expect(entry.tasks.find((t) => t.id === 'follow_x')?.answer).toBe(true);
      expect(entry.tasks.find((t) => t.id === 'engage_launch')).toMatchObject({ answer: null, required: false });
      expect((await h.call('GET', '/api/site/wl', { wallet: w })).body.entry).toEqual(entry);
      // one per wallet
      const again = await h.call('POST', '/api/site/wl', { wallet: w, body: wlBody('alice2') });
      expect([again.status, again.body.error]).toEqual([409, 'already_applied']);
      // one per handle, after normalisation
      for (const handle of ['ALICE', 'https://x.com/Alice']) {
        const dup = await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody(handle, { answers: { follow_x: true, post_x: post('x') } }) });
        expect([dup.status, dup.body.error]).toEqual([409, 'handle_taken']);
      }
      // the task list changes later: the entry keeps what was answered
      expect((await h.call('PUT', '/api/admin/tasks/follow_x', { wallet: h.admin, body: { title: 'Follow us' } })).status).toBe(200);
      const after = (await h.call('GET', '/api/site/wl', { wallet: w })).body.entry as WlEntryPublic;
      expect(after.tasks.find((t) => t.id === 'follow_x')?.title).toBe('Follow @elymumio');
      expect((await h.call('PUT', '/api/admin/tasks/follow_x', { wallet: h.admin, body: { title: 'Follow @elymumio' } })).status).toBe(200);
    });

    it('requires the launch-post task once its link is live; closes with wlOpen', async () => {
      const set = await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { launchPostUrl: 'https://x.com/elymumio/status/42' } });
      expect(set.body.settings.launchPostUrl).toBe('https://x.com/elymumio/status/42');
      const tasks = (await h.call('GET', '/api/site/tasks')).body.tasks;
      expect(tasks[2]).toMatchObject({ target: 'https://x.com/elymumio/status/42', available: true, required: true });
      const w = wallet();
      const miss = await h.call('POST', '/api/site/wl', { wallet: w, body: wlBody('bob') });
      expect([miss.status, miss.body.field]).toEqual([400, 'answers.engage_launch']);
      const ok = await h.call('POST', '/api/site/wl', { wallet: w, body: { ...wlBody('bob'), answers: { ...wlBody('bob').answers, engage_launch: post('bob', '77') } } });
      expect(ok.status).toBe(201);
      expect((ok.body.entry as WlEntryPublic).tasks[2]).toMatchObject({ target: 'https://x.com/elymumio/status/42', answer: post('bob', '77') });
      expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { launchPostUrl: 'https://example.com/x' } })).status).toBe(400);
      await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { launchPostUrl: null, wlOpen: false } });
      const closed = await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody('carol') });
      expect([closed.status, closed.body.error]).toEqual([403, 'wl_closed']);
      await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { wlOpen: true } });
      expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { wlOpen: 'yes' } })).body.field).toBe('wlOpen');
      expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { bogus: 1 } })).body.field).toBe('bogus');
      expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { xHandle: '@ElymumIO' } })).body.settings.xHandle).toBe('elymumio');
      expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { gameAccess: 'everyone' } })).body.field).toBe('gameAccess');
      await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { xHandle: 'elymumio' } });
    });
  });

  describe('admin tasks', () => {
    it('creates, edits, reorders, disables and deletes tasks', async () => {
      const a = h.admin;
      const bad = await h.call('POST', '/api/admin/tasks', { wallet: a, body: { kind: 'nope', title: 'x' } });
      expect([bad.status, bad.body.field]).toEqual([400, 'kind']);
      expect((await h.call('POST', '/api/admin/tasks', { wallet: a, body: { kind: 'text', title: '' } })).body.field).toBe('title');
      expect((await h.call('POST', '/api/admin/tasks', { wallet: a, body: { kind: 'join_link', title: 'Discord', target: 'javascript:alert(1)' } })).body.field).toBe('target');
      const made = await h.call('POST', '/api/admin/tasks', { wallet: a, body: { kind: 'join_link', title: 'Join the Discord', target: 'https://discord.gg/elymum', required: false } });
      expect(made.status).toBe(201);
      const id = made.body.task.id as string;
      let list = (await h.call('GET', '/api/admin/tasks', { wallet: a })).body.tasks as { id: string; order: number }[];
      expect(list.at(-1)).toMatchObject({ id, order: 5 });
      const order = [id, ...list.filter((t) => t.id !== id).map((t) => t.id)];
      expect((await h.call('PUT', '/api/admin/tasks/order', { wallet: a, body: { ids: order.slice(1) } })).status).toBe(400);
      expect((await h.call('PUT', '/api/admin/tasks/order', { wallet: a, body: { ids: [...order.slice(1), 'zzz'] } })).status).toBe(400);
      list = (await h.call('PUT', '/api/admin/tasks/order', { wallet: a, body: { ids: order } })).body.tasks;
      expect(list.map((t) => t.id)).toEqual(order);
      expect((await h.call('GET', '/api/site/tasks')).body.tasks[0].id).toBe(id);
      await h.call('PUT', `/api/admin/tasks/${id}`, { wallet: a, body: { enabled: false } });
      expect((await h.call('GET', '/api/site/tasks')).body.tasks.map((t: { id: string }) => t.id)).not.toContain(id);
      expect((await h.call('PUT', '/api/admin/tasks/none', { wallet: a, body: { title: 'x' } })).status).toBe(404);
      expect((await h.call('DELETE', `/api/admin/tasks/${id}`, { wallet: a })).status).toBe(200);
      expect((await h.call('DELETE', `/api/admin/tasks/${id}`, { wallet: a })).status).toBe(404);
      expect((await h.call('GET', '/api/admin/tasks', { wallet: a })).body.tasks.map((t: { id: string }) => t.id)).toEqual([
        'follow_x',
        'post_x',
        'engage_launch',
        'x_handle',
        'wallet',
      ]);
    });
  });

  describe('collabs', () => {
    let ownerW: string;
    let collabId: string;

    it('is closed by default, then validates the form', async () => {
      const w = wallet();
      const closed = await h.call('POST', '/api/site/collab', { wallet: w, body: collabBody('dave') });
      expect([closed.status, closed.body.error]).toEqual([403, 'collab_closed']);
      await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { collabOpen: true } });
      expect((await h.call('GET', '/api/site/settings')).body.settings.collabOpen).toBe(true);
      const cases: [Record<string, unknown>, string][] = [
        [{ community: 'x' }, 'community'],
        [{ community: 'x'.repeat(61) }, 'community'],
        [{ type: 'cult' }, 'type'],
        [{ members: 0 }, 'members'],
        [{ members: 1.5 }, 'members'],
        [{ communityX: 'no spaces' }, 'communityX'],
        [{ contactX: '' }, 'contactX'],
        [{ discord: 'd'.repeat(41) }, 'discord'],
        [{ role: 'king' }, 'role'],
        [{ postUrl: 'https://x.com/coinguild' }, 'postUrl'],
        [{ about: '' }, 'about'],
        [{ about: 'a'.repeat(601) }, 'about'],
      ];
      for (const [patch, field] of cases) {
        const r = await h.call('POST', '/api/site/collab', { wallet: w, body: collabBody('dave', patch) });
        expect([r.status, r.body.field], JSON.stringify(patch)).toEqual([400, field]);
      }
      expect((await h.call('POST', '/api/site/collab', { wallet: w, body: collabBody('dave', { website: 'x' }) })).status).toBe(400);
      expect((await h.call('GET', '/api/site/collab', { wallet: w })).body.collabs).toEqual([]);
    });

    it('accepts at most 2 applications per contact X handle', async () => {
      ownerW = wallet();
      const first = await h.call('POST', '/api/site/collab', { wallet: ownerW, body: collabBody('@Dave', { about: 'line one\nline two' }) });
      expect(first.status).toBe(201);
      const c = first.body.collab as CollabPublic;
      expect(c).toMatchObject({ wallet: ownerW, contactX: 'dave', communityX: 'coinguild', status: 'pending', phase: 'in_review', spots: null, wallets: [], about: 'line one\nline two' });
      expect(c).not.toHaveProperty('note');
      collabId = c.id;
      expect((await h.call('POST', '/api/site/collab', { wallet: wallet(), body: collabBody('dave') })).status).toBe(201);
      const third = await h.call('POST', '/api/site/collab', { wallet: wallet(), body: collabBody('DAVE') });
      expect([third.status, third.body.error]).toEqual([409, 'collab_limit']);
      expect((await h.call('GET', '/api/site/collab', { wallet: ownerW })).body.collabs).toHaveLength(1);
    });

    it('runs the state machine: approve, draft, submit (locked), unlock, deadline, extend, reject', async () => {
      const id = collabId;
      const put = (body: unknown, w = ownerW) => h.call('PUT', `/api/site/collab/${id}/wallets`, { wallet: w, body });
      const submit = (body: unknown, w = ownerW) => h.call('POST', `/api/site/collab/${id}/submit`, { wallet: w, body });
      const [w1, w2, w3] = [wallet(), wallet(), wallet()];
      // pending: no list yet
      expect((await put({ wallets: [] })).body.error).toBe('wrong_state');
      // approve: spots + a future deadline
      const approve = (body: unknown) => h.call('POST', `/api/admin/collabs/${id}/approve`, { wallet: h.admin, body });
      expect((await approve({ spots: 0, deadline: h.clock.t + HOUR })).body.field).toBe('spots');
      expect((await approve({ spots: 2, deadline: h.clock.t - 1 })).body.field).toBe('deadline');
      expect((await h.call('POST', `/api/admin/collabs/${id}/approve`, { wallet: wallet(), body: { spots: 2, deadline: h.clock.t + HOUR } })).status).toBe(403);
      const ok = await approve({ spots: 2, deadline: h.clock.t + HOUR });
      expect(ok.body.collab).toMatchObject({ status: 'approved', phase: 'approved', spots: 2, deadline: h.clock.t + HOUR });
      // drafts: validated, at most `spots`, unique (any case), EVM; someone else's collab reads as not found
      expect((await put({ wallets: [{ name: 'a', wallet: w1 }] }, wallet())).status).toBe(404);
      expect((await put({ wallets: [{ name: 'a', wallet: w1 }, { name: 'b', wallet: w2 }, { name: 'c', wallet: w3 }] })).body.error).toBe('too_many_wallets');
      expect((await put({ wallets: [{ name: 'x', wallet: notEvmWallet }] })).body.field).toBe('wallets[0].wallet');
      expect((await put({ wallets: [{ name: 'a', wallet: w1 }, { name: 'b', wallet: w1.toLowerCase() }] })).body.field).toBe('wallets[1].wallet');
      expect((await put({ wallets: [{ name: 'x', wallet: 'notakey' }] })).body.field).toBe('wallets[0].wallet');
      expect((await put({ wallets: [{ name: 'a', wallet: w1 }, { name: 'b', wallet: w1 }] })).body.field).toBe('wallets[1].wallet');
      expect((await put({ wallets: [{ name: 'n'.repeat(41), wallet: w1 }] })).body.field).toBe('wallets[0].name');
      expect((await put({ wallets: [{ name: 'a', wallet: w1 }], raffleUrl: 'https://x.com/coinguild' })).body.field).toBe('raffleUrl');
      const draft = await put({ wallets: [{ name: 'winner one', wallet: w1 }] });
      expect(draft.status).toBe(200);
      expect(draft.body.collab.wallets).toEqual([{ name: 'winner one', wallet: w1 }]);
      expect(draft.body.collab.status).toBe('approved');
      // submit: needs the raffle post
      expect((await submit({})).body.field).toBe('raffleUrl');
      expect((await submit({ raffleUrl: 'https://example.com' })).body.field).toBe('raffleUrl');
      expect((await submit({ raffleUrl: post('coinguild', '9'), wallets: [] })).body.field).toBe('wallets');
      const done = await submit({ raffleUrl: post('coinguild', '9'), wallets: [{ name: 'a', wallet: w1 }, { name: '', wallet: w2 }] });
      expect(done.status).toBe(200);
      expect(done.body.collab).toMatchObject({ status: 'submitted', phase: 'submitted', raffleUrl: post('coinguild', '9') });
      expect(done.body.collab.submittedAt).toBe(h.clock.t);
      // locked
      expect((await put({ wallets: [] })).body.error).toBe('wrong_state');
      expect((await submit({ raffleUrl: post('coinguild', '9') })).body.error).toBe('wrong_state');
      expect((await approve({ spots: 5, deadline: h.clock.t + HOUR })).body.error).toBe('wrong_state');
      // admin unlock: editable again
      expect((await h.call('POST', `/api/admin/collabs/${id}/unlock`, { wallet: h.admin })).body.collab.status).toBe('approved');
      expect((await h.call('POST', `/api/admin/collabs/${id}/unlock`, { wallet: h.admin })).body.error).toBe('wrong_state');
      expect((await put({ wallets: [{ name: 'a', wallet: w1 }] })).status).toBe(200);
      // the deadline passes: closed, nothing can change
      h.clock.t += 2 * HOUR;
      expect((await h.call('GET', '/api/site/collab', { wallet: ownerW })).body.collabs[0].phase).toBe('closed');
      expect((await put({ wallets: [] })).body.error).toBe('deadline_passed');
      expect((await submit({ raffleUrl: post('coinguild', '9') })).body.error).toBe('deadline_passed');
      expect((await h.call('GET', '/api/admin/collabs?status=closed', { wallet: h.admin })).body.items.map((c: CollabAdmin) => c.id)).toEqual([id]);
      // extend (with more spots): open again
      const ext = await h.call('POST', `/api/admin/collabs/${id}/extend`, { wallet: h.admin, body: { deadline: h.clock.t + HOUR, spots: 3 } });
      expect(ext.body.collab).toMatchObject({ phase: 'approved', spots: 3 });
      expect((await h.call('POST', `/api/admin/collabs/${id}/extend`, { wallet: h.admin, body: { deadline: h.clock.t - 5 } })).body.field).toBe('deadline');
      const final = await submit({ raffleUrl: post('coinguild', '10'), wallets: [{ name: 'a', wallet: w1 }, { name: 'b', wallet: w2 }, { name: 'c', wallet: w3 }] });
      expect(final.body.collab.status).toBe('submitted');
      // extending a submitted list keeps it locked
      expect((await h.call('POST', `/api/admin/collabs/${id}/extend`, { wallet: h.admin, body: { deadline: h.clock.t + 2 * HOUR } })).body.collab.status).toBe('submitted');
      // spots cannot drop below the listed wallets
      expect((await h.call('POST', `/api/admin/collabs/${id}/extend`, { wallet: h.admin, body: { deadline: h.clock.t + HOUR, spots: 2 } })).body.field).toBe('spots');
      // reject: the other application by the same handle
      const other = (await h.call('GET', '/api/admin/collabs?q=dave', { wallet: h.admin })).body.items.find((c: CollabAdmin) => c.id !== id) as CollabAdmin;
      const rej = await h.call('POST', `/api/admin/collabs/${other.id}/reject`, { wallet: h.admin });
      expect(rej.body.collab).toMatchObject({ status: 'rejected', phase: 'rejected' });
      expect((await h.call('POST', `/api/admin/collabs/${other.id}/extend`, { wallet: h.admin, body: { deadline: h.clock.t + HOUR } })).body.error).toBe('wrong_state');
      expect((await h.call('POST', `/api/admin/collabs/${id}/reject`, { wallet: h.admin })).body.error).toBe('wrong_state');
      expect((await h.call('POST', '/api/admin/collabs/nope/reject', { wallet: h.admin })).status).toBe(404);
      const note = await h.call('PUT', `/api/admin/collabs/${id}/note`, { wallet: h.admin, body: { note: 'great raffle' } });
      expect(note.body.collab.note).toBe('great raffle');
    });

    it('flags wallets that are on the WL or in another collab', async () => {
      const shared = wallet();
      // the shared wallet applies to the WL itself
      expect((await h.call('POST', '/api/site/wl', { wallet: shared, body: wlBody('sharedguy') })).status).toBe(201);
      // a second community lists it, and a wallet of the first collab
      const owner2 = wallet();
      const c2 = (await h.call('POST', '/api/site/collab', { wallet: owner2, body: collabBody('erin', { community: 'Second' }) })).body.collab as CollabPublic;
      await h.call('POST', `/api/admin/collabs/${c2.id}/approve`, { wallet: h.admin, body: { spots: 5, deadline: h.clock.t + HOUR } });
      const first = (await h.call('GET', `/api/admin/collabs/${collabId}`, { wallet: h.admin })).body.collab as CollabAdmin;
      const firstWallet = first.wallets[0].wallet;
      await h.call('POST', `/api/site/collab/${c2.id}/submit`, {
        wallet: owner2,
        body: { raffleUrl: post('second', '5'), wallets: [{ name: 's', wallet: shared }, { name: 'f', wallet: firstWallet }] },
      });
      const view = (await h.call('GET', `/api/admin/collabs/${c2.id}`, { wallet: h.admin })).body.collab as CollabAdmin;
      expect(view.wallets).toEqual([
        { name: 's', wallet: shared, dupWl: true, dupCollabs: [] },
        { name: 'f', wallet: firstWallet, dupWl: false, dupCollabs: [collabId] },
      ]);
      const firstAgain = (await h.call('GET', `/api/admin/collabs/${collabId}`, { wallet: h.admin })).body.collab as CollabAdmin;
      expect(firstAgain.wallets[0].dupCollabs).toEqual([c2.id]);
      // the WL view flags the collab
      const wl = (await h.call('GET', `/api/admin/wl?q=sharedguy`, { wallet: h.admin })).body.items as WlEntryAdmin[];
      expect(wl[0].dupCollabs).toEqual([c2.id]);
      // the public view carries no flags
      expect((await h.call('GET', '/api/site/collab', { wallet: owner2 })).body.collabs[0].wallets[0]).toEqual({ name: 's', wallet: shared });
    });

    it('exports CSVs of a collab and of every submitted collab', async () => {
      const one = await h.call('GET', `/api/admin/collabs/${collabId}/wallets.csv`, { wallet: h.admin });
      expect(one.status).toBe(200);
      expect(one.headers.get('content-type')).toContain('text/csv');
      expect(one.headers.get('content-disposition')).toContain('attachment');
      const lines = one.text.trim().split('\r\n');
      expect(lines[0]).toBe('collab_id,community,name,wallet,dup_wl,dup_collabs');
      expect(lines).toHaveLength(4);
      expect(lines[1].startsWith(`${collabId},Coin Guild,a,`)).toBe(true);
      const all = await h.call('GET', '/api/admin/collabs/wallets.csv', { wallet: h.admin });
      const rows = all.text.trim().split('\r\n');
      expect(rows).toHaveLength(1 + 3 + 2);
      expect(rows.some((r) => r.endsWith(`,yes,`))).toBe(true);
      expect((await h.call('GET', '/api/admin/collabs/nope/wallets.csv', { wallet: h.admin })).status).toBe(404);
      expect((await h.call('GET', `/api/admin/collabs/${collabId}/wallets.csv`, { wallet: wallet() })).status).toBe(403);
    });
  });

  describe('admin WL review', () => {
    it('lists with filters, search and pages; sets status singly and in bulk; notes; counts; CSV', async () => {
      const a = h.admin;
      const handles = ['page1', 'page2', 'page3', 'page4', 'page5'];
      for (const x of handles) expect((await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody(x) })).status).toBe(201);
      const all = await h.call('GET', '/api/admin/wl?q=page&pageSize=2', { wallet: a });
      expect(all.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(all.body.items.map((e: WlEntryAdmin) => e.xHandle)).toHaveLength(2);
      const p3 = await h.call('GET', '/api/admin/wl?q=page&pageSize=2&page=3', { wallet: a });
      expect(p3.body.items).toHaveLength(1);
      const ids = (await h.call('GET', '/api/admin/wl?q=page', { wallet: a })).body.items.map((e: WlEntryAdmin) => e.id) as string[];
      expect((await h.call('GET', '/api/admin/wl?status=maybe', { wallet: a })).status).toBe(400);
      // bulk
      expect((await h.call('POST', '/api/admin/wl/status', { wallet: a, body: { ids: ids.slice(0, 3), status: 'approved' } })).body.updated).toBe(3);
      expect((await h.call('POST', '/api/admin/wl/status', { wallet: a, body: { ids: [...ids, 'ghost'], status: 'approved' } })).status).toBe(404);
      expect((await h.call('POST', '/api/admin/wl/status', { wallet: a, body: { ids, status: 'maybe' } })).body.field).toBe('status');
      expect((await h.call('POST', '/api/admin/wl/status', { wallet: a, body: { ids: [], status: 'approved' } })).body.field).toBe('ids');
      // single
      expect((await h.call('PUT', `/api/admin/wl/${ids[3]}/status`, { wallet: a, body: { status: 'rejected' } })).body.entry.status).toBe('rejected');
      expect((await h.call('PUT', `/api/admin/wl/${ids[0]}/status`, { wallet: a, body: { status: 'pending' } })).body.entry.status).toBe('pending');
      expect((await h.call('PUT', '/api/admin/wl/ghost/status', { wallet: a, body: { status: 'pending' } })).status).toBe(404);
      const approved = (await h.call('GET', '/api/admin/wl?status=approved&q=page', { wallet: a })).body.items.map((e: WlEntryAdmin) => e.id);
      expect(approved.sort()).toEqual([ids[1], ids[2]].sort());
      // the applicant sees the decision
      const one = (await h.call('GET', `/api/admin/wl/${ids[1]}`, { wallet: a })).body.entry as WlEntryAdmin;
      expect((await h.call('GET', '/api/site/wl', { wallet: one.wallet })).body.entry.status).toBe('approved');
      // notes (searchable, admin only)
      const noted = await h.call('PUT', `/api/admin/wl/${ids[1]}/note`, { wallet: a, body: { note: '=HYPERLINK("x") checked' } });
      expect(noted.body.entry.note).toBe('=HYPERLINK("x") checked');
      expect((await h.call('PUT', `/api/admin/wl/${ids[1]}/note`, { wallet: a, body: { note: 'n'.repeat(1001) } })).status).toBe(400);
      expect((await h.call('GET', '/api/site/wl', { wallet: one.wallet })).body.entry).not.toHaveProperty('note');
      expect((await h.call('GET', '/api/admin/wl?q=hyperlink', { wallet: a })).body.total).toBe(1);
      // CSV: approved only by default, or all; formulas defused
      const csvA = (await h.call('GET', '/api/admin/wl.csv', { wallet: a })).text.trim().split('\r\n');
      expect(csvA[0]).toBe('wallet,x_handle,status,created_at,dup_collabs,note');
      expect(csvA.slice(1).every((l) => l.split(',')[2] === 'approved')).toBe(true);
      expect(csvA.some((l) => l.includes(`"'=HYPERLINK(""x"") checked"`))).toBe(true);
      const total = (await h.call('GET', '/api/admin/counts', { wallet: a })).body;
      const csvAll = (await h.call('GET', '/api/admin/wl.csv?scope=all', { wallet: a })).text.trim().split('\r\n');
      expect(csvAll).toHaveLength(1 + total.wl.total);
      expect(csvA).toHaveLength(1 + total.wl.approved);
      expect(total.wl.pending + total.wl.approved + total.wl.rejected).toBe(total.wl.total);
      expect(total.collab).toMatchObject({ submitted: 2, rejected: 1, wallets: 5 });
    });

    it('csv cells are quoted and defused', () => {
      expect(csvCell('plain')).toBe('plain');
      expect(csvCell('a,b')).toBe('"a,b"');
      expect(csvCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvCell('=1+1')).toBe("'=1+1");
      expect(csvCell('-2')).toBe("'-2");
      expect(csvCell('@x')).toBe("'@x");
      expect(csvCell(null)).toBe('');
    });
  });

  describe('persistence', () => {
    it('writes site/*.json atomically and loads them back', () => {
      for (const f of Object.values(SITE_FILES)) expect(existsSync(join(h.dir, f)), f).toBe(true);
      expect(readdirSync(join(h.dir, 'site')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
      const live = h.app.site.store;
      const reloaded = new SiteStore(h.dir, { now: () => h.clock.t });
      expect(reloaded.settings).toEqual(live.settings);
      expect(reloaded.tasks).toEqual(live.tasks);
      expect(reloaded.counts()).toEqual(live.counts());
      expect(reloaded.listWl({ pageSize: 200 })).toEqual(live.listWl({ pageSize: 200 }));
      expect(reloaded.listCollabs()).toEqual(live.listCollabs());
      // uniqueness indexes are rebuilt
      const someone = live.listWl({ pageSize: 1 }).items[0];
      expect(() => reloaded.submitWl(someone.wallet, wlBody('fresh'))).toThrow(/already applied/);
      expect(() => reloaded.submitWl(wallet(), wlBody(someone.xHandle))).toThrow(/handle already applied/);
    });

    it('starts fresh (and keeps the bad file) when a file is unreadable', () => {
      const dir = mkdtempSync(join(tmpdir(), 'elymum-site-bad-'));
      const a = new SiteStore(dir);
      a.updateSettings({ collabOpen: true });
      writeFileSync(join(dir, SITE_FILES.wl), '{not json');
      const logs: string[] = [];
      const b = new SiteStore(dir, { log: (m) => logs.push(m) });
      expect(b.settings.collabOpen).toBe(true);
      expect(b.counts().wl.total).toBe(0);
      expect(readdirSync(join(dir, 'site')).some((f) => f.startsWith('wl.json.corrupt-'))).toBe(true);
      expect(logs.join()).toMatch(/unreadable/);
      // no files until something changes
      const empty = mkdtempSync(join(tmpdir(), 'elymum-site-empty-'));
      new SiteStore(empty);
      expect(existsSync(join(empty, 'site'))).toBe(false);
    });

    it('survives an app restart on the same data dir', async () => {
      const x = await harness();
      const w = wallet();
      expect((await x.call('POST', '/api/site/wl', { wallet: w, body: wlBody('restart') })).status).toBe(201);
      await x.call('PUT', '/api/admin/settings', { wallet: x.admin, body: { gameAccess: 'holders' } });
      await x.app.close();
      const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: x.dir, ADMIN_WALLETS: x.admin } as NodeJS.ProcessEnv);
      const app2 = await createApp(cfg, { chain: new ArenaChain([]), log: () => {}, persist: true });
      try {
        expect(app2.site.store.myWl(w)?.xHandle).toBe('restart');
        expect(app2.site.store.settings.gameAccess).toBe('holders');
      } finally {
        await app2.close();
      }
    });
  });
});

describe('site rate limits', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness({}, { writeIp: new Limiter(5, 60_000), writeWallet: new Limiter(2, 60_000), login: new Limiter(2, 60_000) });
  });
  afterAll(async () => {
    await h.app.close();
  });

  it('limits writes per wallet, then per IP; reads are not counted', async () => {
    const w = wallet();
    for (let i = 0; i < 2; i++) expect((await h.call('POST', '/api/site/wl', { wallet: w, body: { xHandle: '!' } })).status).toBe(400);
    const third = await h.call('POST', '/api/site/wl', { wallet: w, body: wlBody('limited') });
    expect([third.status, third.body.error]).toEqual([429, 'rate_limited']);
    for (let i = 0; i < 3; i++) expect((await h.call('GET', '/api/site/wl', { wallet: w })).status).toBe(200);
    // the same IP with fresh wallets: 2 more writes, then the IP is limited
    expect((await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody('ipone') })).status).toBe(201);
    expect((await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody('iptwo') })).status).toBe(201);
    expect((await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody('ipthree') })).status).toBe(429);
    expect((await h.call('POST', '/api/site/collab', { wallet: wallet(), body: collabBody('ipfour') })).status).toBe(429);
    // admin routes are not under the site write limits
    expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { collabOpen: true } })).status).toBe(200);
  });

  it('limits HTTP sign-ins per IP', async () => {
    const body = { address: wallet(), message: 'x', signature: '0x00' };
    expect((await h.call('POST', '/api/auth/login', { body })).status).toBe(401);
    expect((await h.call('POST', '/api/auth/login', { body })).status).toBe(401);
    expect((await h.call('POST', '/api/auth/login', { body })).status).toBe(429);
  });
});

/** A WebSocket client that keeps every JSON message. */
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
  /** The first message of type `t` after the current ones are dropped. */
  async next<T extends ServerMessage['t']>(t: T, timeoutMs = 3000): Promise<Extract<ServerMessage, { t: T }>> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
      if (i >= 0) return this.msgs.splice(0, i + 1)[i] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > until) throw new Error(`no ${t}: ${JSON.stringify(this.msgs.map((m) => m.t))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  /** Sends `msg` and returns the reply: `joined`, `spectating` or `error`. */
  async attempt(msg: unknown): Promise<ServerMessage> {
    this.msgs = [];
    this.send(msg);
    const until = Date.now() + 3000;
    for (;;) {
      const m = this.msgs.find((x) => x.t === 'joined' || x.t === 'error' || x.t === 'spectating');
      if (m) return m;
      if (Date.now() > until) throw new Error(`no reply: ${JSON.stringify(this.msgs.map((x) => x.t))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  close() {
    this.ws.close();
  }
}

describe('game gate', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.app.close();
  });

  const entries = [
    { t: 'join', room: 'practice', name: 'gate', skin: 0 },
    { t: 'join', room: 'private:NEW', name: 'gate', skin: 0 },
    { t: 'join', room: 'arena:1', name: 'gate', skin: 0 },
    { t: 'spectate' },
  ];

  it('refuses every room entry for guests and non-admin wallets with game_closed', async () => {
    const guest = await Ws.open(h.port);
    const user = await Ws.open(h.port);
    user.send({ t: 'auth', token: h.token(wallet()) });
    await user.next('authed');
    for (const c of [guest, user]) {
      for (const m of entries) {
        const r = await c.attempt(m);
        expect(r.t === 'error' && r.code, JSON.stringify(m)).toBe('game_closed');
      }
    }
    expect(guest.msgs.some((m) => m.t === 'joined')).toBe(false);
    guest.close();
    user.close();
  });

  it('lets an admin session play', async () => {
    const c = await Ws.open(h.port);
    expect(await c.attempt(entries[0])).toMatchObject({ t: 'error', code: 'game_closed' });
    c.send({ t: 'auth', token: h.token(h.admin) });
    await c.next('authed');
    expect((await c.attempt(entries[0])).t).toBe('joined');
    // an arena join gets past the gate to the ticket check
    const arenaReply = await c.attempt(entries[2]);
    expect(arenaReply.t === 'error' && arenaReply.code).not.toBe('game_closed');
    // after logout the gate applies again
    c.send({ t: 'leave' });
    c.send({ t: 'logout' });
    expect(await c.attempt(entries[0])).toMatchObject({ t: 'error', code: 'game_closed' });
    c.close();
  });

  it('lets everyone in once gameAccess is public, and closes again when it is admins', async () => {
    expect((await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { gameAccess: 'public' } })).body.settings.gameAccess).toBe('public');
    expect((await h.call('GET', '/api/site/settings')).body.settings.gameAccess).toBe('public');
    const guest = await Ws.open(h.port);
    expect((await guest.attempt(entries[0])).t).toBe('joined');
    const watcher = await Ws.open(h.port);
    expect((await watcher.attempt(entries[3])).t).toBe('spectating');
    watcher.close();
    // arena: past the gate (a guest needs a wallet for a ticket)
    expect(await guest.attempt(entries[2])).toMatchObject({ t: 'error', code: 'auth_required' });
    guest.close();
    await h.call('PUT', '/api/admin/settings', { wallet: h.admin, body: { gameAccess: 'admins' } });
    const late = await Ws.open(h.port);
    expect(await late.attempt(entries[0])).toMatchObject({ t: 'error', code: 'game_closed' });
    late.close();
  });

  it('GAME_ACCESS=public opens the game whatever the setting; /api/config stays public', async () => {
    const cfg = loadConfig({ GAME_ACCESS: 'public', ADMIN_WALLETS: h.admin } as NodeJS.ProcessEnv);
    const api = new SiteApi(cfg, h.app.auth, new SiteStore(null));
    expect(await api.gameOpenFor(null)).toBe(true);
    expect(api.publicSettings().gameAccess).toBe('public');
    const closed = new SiteApi(loadConfig({ ADMIN_WALLETS: h.admin } as NodeJS.ProcessEnv), h.app.auth, new SiteStore(null));
    expect(await closed.gameOpenFor(null)).toBe(false);
    expect(await closed.gameOpenFor(wallet())).toBe(false);
    expect(await closed.gameOpenFor(h.admin)).toBe(true);
    expect(await closed.gameOpenFor(h.admin.toLowerCase())).toBe(true);
    const res = await fetch(`http://127.0.0.1:${h.port}/api/config`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chain: { enabled: boolean } }).chain.enabled).toBe(true);
  });
});

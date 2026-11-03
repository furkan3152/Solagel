import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, PlayerFlag, decodeSnapshot, type PlayerInfo, type ServerMessage } from '@elymum/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import { loadConfig } from '../src/config';
import { Leaderboards } from '../src/leaderboards';
import { Limiter } from '../src/net/limiter';
import { ProfileError, ProfileStore } from '../src/profiles';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

const NOW = Date.UTC(2026, 10, 3, 12);
const DAY = 24 * 60 * 60_000;

describe('countries board (leaderboards)', () => {
  it('adds up mass, games and payouts per country, today and all time, best first', () => {
    const lb = new Leaderboards(null, NOW);
    lb.countryGame({ country: 'DE', mass: 500, paid: 0, at: NOW });
    lb.countryGame({ country: 'DE', mass: 250, paid: 1200, at: NOW });
    lb.countryGame({ country: 'BR', mass: 900, paid: 0, at: NOW });
    // never on the board: no country, off the allowlist, nothing done
    lb.countryGame({ country: null, mass: 999, paid: 0, at: NOW });
    lb.countryGame({ country: 'XX', mass: 999, paid: 0, at: NOW });
    lb.countryGame({ country: 'de', mass: 999, paid: 0, at: NOW });
    lb.countryGame({ country: 'FR', mass: 0, paid: 0, at: NOW });
    const snap = lb.snapshot(10, NOW);
    expect(snap.countries.allTime).toEqual([
      { country: 'BR', mass: 900, games: 1, paid: 0 },
      { country: 'DE', mass: 750, games: 2, paid: 1200 },
    ]);
    expect(snap.countries.daily).toEqual(snap.countries.allTime);

    // the next UTC day: today starts empty, all time keeps counting
    lb.countryGame({ country: 'US', mass: 100, paid: 0, at: NOW + DAY });
    const next = lb.snapshot(10, NOW + DAY);
    expect(next.countries.daily).toEqual([{ country: 'US', mass: 100, games: 1, paid: 0 }]);
    expect(next.countries.allTime.map((r) => r.country)).toEqual(['BR', 'DE', 'US']);
    // the snapshot is a copy
    next.countries.allTime[0].mass = 1;
    expect(lb.snapshot(10, NOW + DAY).countries.allTime[0].mass).toBe(900);
  });

  it('persists, reads back only allowlisted rows and is cleared by the reset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-countries-'));
    const path = join(dir, 'leaderboards.json');
    const lb = new Leaderboards(path, NOW);
    lb.countryGame({ country: 'JP', mass: 300, paid: 0, at: NOW });
    lb.flush();
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file.countriesAllTime).toEqual([{ country: 'JP', mass: 300, games: 1, paid: 0 }]);
    // a hand-edited file: junk rows are dropped, numbers cleaned
    file.countriesAllTime.push({ country: 'ZZ', mass: 5, games: 1, paid: 0 }, { country: 'IT', mass: -4, games: 'x', paid: 2.7 }, null);
    writeFileSync(path, JSON.stringify(file));
    const again = new Leaderboards(path, NOW + 1000);
    expect(again.snapshot(10, NOW + 1000).countries.allTime).toEqual([
      { country: 'JP', mass: 300, games: 1, paid: 0 },
      { country: 'IT', mass: 0, games: 0, paid: 2 },
    ]);
    again.reset('0xAdmin', NOW + 2000);
    expect(again.snapshot(10, NOW + 2000).countries).toEqual({ daily: [], allTime: [] });
  });
});

describe('country on the profile', () => {
  const w = '0x1111111111111111111111111111111111111111';

  it('stores an allowlisted code or null, keeps it when the update leaves it out, refuses anything else', () => {
    const p = new ProfileStore(null);
    expect(p.view(w).country).toBeUndefined();
    expect(p.update(w, { name: 'Ada', skin: 0, country: 'GB' }).country).toBe('GB');
    expect(p.country(w)).toBe('GB');
    expect(p.update(w, { name: 'Ada', skin: 1 }).country).toBe('GB');
    expect(p.update(w, { name: 'Ada', skin: 1, country: null }).country).toBeNull();
    expect(p.country(w)).toBeNull();
    for (const bad of ['gb', 'UK', 'XX', '', 7, {}]) {
      expect(() => p.update(w, { name: 'Ada', skin: 0, country: bad })).toThrow(ProfileError);
    }
  });
});

/* ------------------------------------------------------------------ */
/* In game                                                             */
/* ------------------------------------------------------------------ */

class Ws {
  msgs: ServerMessage[] = [];
  players = new Map<number, PlayerInfo>();
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d, bin) => {
      if (!bin) this.msgs.push(JSON.parse(d.toString()) as ServerMessage);
      else for (const p of decodeSnapshot(d as Buffer).players) this.players.set(p.id, p);
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
  async next<T extends ServerMessage['t']>(t: T, timeoutMs = 3000): Promise<Extract<ServerMessage, { t: T }>> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
      if (i >= 0) return this.msgs.splice(0, i + 1)[i] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > until) throw new Error(`no ${t}: ${JSON.stringify(this.msgs.map((m) => m.t))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  async joinAs(msg: Record<string, unknown>): Promise<PlayerInfo> {
    this.send({ t: 'join', room: 'practice', skin: 1, ...msg });
    const joined = await this.next('joined');
    await this.until(() => this.players.has(joined.playerId));
    return this.players.get(joined.playerId)!;
  }
  close() {
    this.ws.close();
  }
}

describe('flags in game', () => {
  let app: App;
  let port: number;
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-flags-'));
    const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '3', BOT_MIN: '3', BOT_MAX: '3', TRUST_PROXY: '0', GAME_ACCESS: 'public' } as NodeJS.ProcessEnv);
    const big = () => new Limiter(10_000, 60_000);
    app = await createApp(cfg, {
      chain: new ArenaChain([arena(1, 1000)]),
      log: () => {},
      persist: false,
      siteLimits: { writeIp: big(), writeWallet: big(), login: big(), avatarIp: big(), avatarWallet: big() },
      apiLimiter: big(),
    });
    port = await app.listen();
  });
  afterAll(async () => {
    await app.close();
  });

  it('broadcasts an allowlisted country with the player, nothing for anything else', async () => {
    const a = await Ws.open(port);
    const mine = await a.joinAs({ name: 'Flagged', country: 'DE' });
    expect(mine.country).toBe('DE');
    expect(mine.flags & PlayerFlag.Country).toBe(PlayerFlag.Country);

    for (const bad of ['de', 'XX', 'DEU', 42, { code: 'DE' }, '']) {
      const c = await Ws.open(port);
      const p = await c.joinAs({ name: 'Plain', country: bad });
      expect(p.country).toBeUndefined();
      c.close();
    }

    a.close();
  }, 20_000);

  it('a signed-in join without a country takes the saved one; an empty one means no flag', async () => {
    const w = testSigner().address;
    const token = app.auth.issueToken(w);
    const res = await fetch(`http://127.0.0.1:${port}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Saved', skin: 0, country: 'BR' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { profile: { country: string } }).profile.country).toBe('BR');
    const bad = await fetch(`http://127.0.0.1:${port}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Saved', skin: 0, country: 'Brazil' }),
    });
    expect(bad.status).toBe(400);

    const c = await Ws.open(port);
    c.send({ t: 'auth', token });
    await c.next('authed');
    expect((await c.joinAs({ name: 'x' })).country).toBe('BR');
    c.send({ t: 'leave' });
    await c.next('left').catch(() => {});
    c.players.clear();
    expect((await c.joinAs({ name: 'x', country: '' })).country).toBeUndefined();
    c.close();
  }, 20_000);
});

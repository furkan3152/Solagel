import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerFlag, TICK_MS, decodeSnapshot, isNaturalBotName, roundAt, type ServerMessage, type SnapshotData } from '@elymum/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';
import { BotManager } from '../src/bots/manager';
import { BotSettingsError, BotSettingsStore, applyBotSettings, defaultBotSettings } from '../src/bots/settings';
import type { StakedBotSource, StakedBotTicket } from '../src/bots/staked';
import { loadConfig } from '../src/config';
import type { Player } from '../src/game/entities';
import { mulberry32 } from '../src/game/rng';
import { World } from '../src/game/world';
import { Conn } from '../src/net/conn';
import { Limiter } from '../src/net/limiter';
import { Room } from '../src/rooms/room';
import { Journal } from '../src/stake/journal';
import { ArenaChain, arena, fakeConn, roomDeps, stakeJoin, testWallet, type TestConn } from './helpers';
import { testSigner } from './signers';

const FEE = 1_000_000;
const tick = (room: Room, n = 1) => {
  for (let i = 0; i < n; i++) room.tick(TICK_MS);
};
const of = <T extends ServerMessage['t']>(c: TestConn, t: T) => c.msgs.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

function practice(bots: { target: number; min: number; max: number; enabled?: boolean }, maxPlayers = 50): Room {
  return new Room({ id: 'practice-rookie-1', mode: 'practice', league: 'rookie', name: 'Pond', maxPlayers, bots, seed: 5 }, roomDeps(new ArenaChain([])));
}

const joinHuman = (room: Room, name: string, conn = fakeConn()) => {
  room.join(conn, { name, skin: 1, flags: 0 });
  return conn;
};

describe('bot seats: cap and make-room', () => {
  it('a human joining a room at the target sends a bot home at once, with a "went home" feed line', () => {
    const room = practice({ target: 12, min: 0, max: 12 });
    tick(room);
    expect(room.bots!.bots.size).toBe(12);
    const watcher = fakeConn();
    room.spectate(watcher);
    const a = joinHuman(room, 'alice');
    expect(room.bots!.bots.size).toBe(11);
    expect(room.info()).toMatchObject({ players: 1, bots: 11 });
    const lines = of(watcher, 'feed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'left', isBot: true, reason: 'make_room' });
    expect(isNaturalBotName(lines[0].name)).toBe(true);
    expect(room.world.players.has(lines[0].pid)).toBe(false);
    // the joiner sees it too, and the room info in `joined` already counts the bot gone
    expect(of(a, 'feed')).toHaveLength(1);
    expect(of(a, 'joined')[0].room.bots).toBe(11);
    // every further join: one more bot leaves, humans + bots stays at the target
    for (let i = 0; i < 5; i++) joinHuman(room, `p${i}`);
    expect(room.humans.size + room.bots!.bots.size).toBe(12);
  });

  it('bots never block a join: humans fill up to the room capacity whatever the bots', () => {
    const room = practice({ target: 12, min: 12, max: 12 }, 3);
    tick(room);
    expect(room.bots!.bots.size).toBe(12);
    for (let i = 0; i < 3; i++) {
      expect(room.isFull).toBe(false);
      joinHuman(room, `h${i}`);
    }
    expect(room.humans.size).toBe(3);
    expect(room.isFull).toBe(true); // full of humans, not bots
    // `min` keeps bots around even past the target
    expect(room.bots!.bots.size).toBe(12);
  });

  it('never more bots than the cap, however high the target', () => {
    const room = practice({ target: 40, min: 0, max: 12 });
    for (let i = 0; i < 400; i++) {
      tick(room);
      expect(room.bots!.bots.size).toBeLessThanOrEqual(12);
    }
    expect(room.bots!.bots.size).toBeGreaterThanOrEqual(10);
  });

  it('admin settings apply live: lower cap trims now, off sends every bot home, on refills', () => {
    const room = practice({ target: 12, min: 0, max: 12 });
    const c = fakeConn();
    room.spectate(c);
    tick(room);
    room.setBotOptions({ target: 12, min: 0, max: 5 });
    expect(room.bots!.bots.size).toBe(5);
    expect(of(c, 'feed').filter((f) => f.reason === 'settings')).toHaveLength(7);
    room.setBotOptions({ target: 12, min: 0, max: 5, enabled: false });
    expect(room.bots!.bots.size).toBe(0);
    tick(room, 200);
    expect(room.bots!.bots.size).toBe(0);
    room.setBotOptions({ target: 12, min: 0, max: 8, enabled: true });
    tick(room, 400);
    expect(room.bots!.bots.size).toBe(8);
  });

  it('names are unique in a room (humans count, case-insensitive) and regulars come back across rounds', () => {
    const world = new World({ width: 4000, height: 4000, foodTarget: 0, virusTarget: 0, maxPowerUps: 0, powerUps: false, coinRain: false, seed: 1 });
    world.addPlayer({ name: 'MARCO88', skin: 0 });
    const m = new BotManager(world, { target: 60, min: 0, max: 60 }, mulberry32(3));
    m.update(0, 1);
    const names = [...world.players.values()].map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const first = new Set([...m.bots.values()].map((b) => b.player.name));
    m.resetRound();
    m.update(1000, 1);
    const second = [...m.bots.values()].map((b) => b.player.name);
    const back = second.filter((n) => first.has(n)).length;
    expect(back).toBeGreaterThan(0); // some regulars return…
    expect(back).toBeLessThan(second.length); // …but not the whole room
  });
});

describe('isBot on the wire', () => {
  it('snapshots, leaderboard, kill feed and death say which players are bots', () => {
    const room = practice({ target: 4, min: 4, max: 4 });
    const bins: ArrayBuffer[] = [];
    const msgs: ServerMessage[] = [];
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      send(data: unknown) {
        if (typeof data === 'string') msgs.push(JSON.parse(data) as ServerMessage);
        else bins.push(data as ArrayBuffer);
      },
    };
    const conn = new Conn(ws as never, '127.0.0.1');
    tick(room);
    const me = room.join(conn, { name: 'human', skin: 1, flags: 0 });
    me.shieldUntil = 0;
    tick(room); // the first snapshot (the human's own player info)
    // a bot on top of the human: the human is eaten
    const bot = [...room.bots!.bots.values()][0].player;
    bot.cells[0].setMass(600);
    for (const c of bot.cells.slice(1)) c.setMass(1);
    bot.shieldUntil = 0;
    const c = me.cells[0];
    c.setMass(30);
    bot.cells[0].x = c.x;
    bot.cells[0].y = c.y;
    room.world.setTarget(bot.id, c.x, c.y);
    room.world.setTarget(me.id, c.x, c.y);
    // the leaderboard goes out once a second
    (room as unknown as { lastLbAt: number }).lastLbAt = 0;
    for (let i = 0; i < 40 && me.alive; i++) tick(room);
    expect(me.alive).toBe(false);

    expect(bins.length).toBeGreaterThan(0);
    const players = bins.map((b) => decodeSnapshot(b) as SnapshotData).flatMap((s) => s.players);
    const botInfo = players.find((p) => p.id === bot.id)!;
    expect(botInfo.isBot).toBe(true);
    expect(botInfo.flags & PlayerFlag.Bot).toBe(PlayerFlag.Bot);
    expect(players.find((p) => p.id === me.id)!.isBot).toBe(false);

    const lb = msgs.find((m): m is Extract<ServerMessage, { t: 'lb' }> => m.t === 'lb')!;
    expect(lb.top.find((e) => e.pid === bot.id)).toMatchObject({ isBot: true, bot: true });
    expect(lb.top.find((e) => e.pid === me.id)?.isBot).toBeUndefined();

    const kf = msgs.find((m): m is Extract<ServerMessage, { t: 'kf' }> => m.t === 'kf' && m.victim === 'human')!;
    expect(kf).toMatchObject({ killer: bot.name, killerIsBot: true });
    expect(kf.victimIsBot).toBeUndefined();
    const death = msgs.find((m): m is Extract<ServerMessage, { t: 'death' }> => m.t === 'death')!;
    expect(death).toMatchObject({ killer: bot.name, killerIsBot: true });
  });
});

/* ------------------------------------------------------------------ */
/* Staked bots: the seam                                               */
/* ------------------------------------------------------------------ */

const ROUND = { roundMs: 60_000, closeMs: 10_000 };

function botTicket(n: number): StakedBotTicket {
  const player = testWallet(0xb000 + n);
  return {
    stake: { player, session: `1:${player.toLowerCase()}:${9000 + n}`, sessionId: 9000 + n, arenaId: 1, entryFee: FEE, value: FEE, openedAt: Math.floor(Date.now() / 1000) },
  };
}

function stakedArena(source?: StakedBotSource) {
  const clock = { now: roundAt(1_791_000_000_000, ROUND.roundMs, ROUND.closeMs).startsAt + 1_000 };
  const journal = new Journal(null);
  const room = new Room(
    { id: 'arena-1-1', mode: 'arena', name: 'Arena', instance: 1, maxPlayers: 50, bots: { target: 4, min: 0, max: 4 }, stake: { arenaId: 1, buyIn: FEE }, seed: 3 },
    { ...roomDeps(new ArenaChain([arena(1, FEE)]), journal, () => clock.now), round: ROUND, stakedBots: source },
  );
  return { room, journal, clock };
}

/** Puts `eater` on top of `victim` until the victim dies. */
function eat(room: Room, eater: Player, victim: Player): void {
  eater.shieldUntil = 0;
  victim.shieldUntil = 0;
  eater.cells[0].setMass(400);
  for (const c of eater.cells.slice(1)) c.setMass(1);
  victim.cells[0].setMass(20);
  for (const c of victim.cells.slice(1)) c.setMass(1);
  eater.cells[0].x = victim.cells[0].x;
  eater.cells[0].y = victim.cells[0].y;
  room.world.setTarget(eater.id, victim.cells[0].x, victim.cells[0].y);
  room.world.setTarget(victim.id, victim.cells[0].x, victim.cells[0].y);
  for (let i = 0; i < 40 && victim.alive; i++) room.tick(TICK_MS);
  expect(victim.alive).toBe(false);
}

describe('staked bots (testnet seam)', () => {
  it('a staked bot is a staker: tagged bot + staker, in the ledger, never sent home to make room', () => {
    const { room } = stakedArena();
    tick(room);
    expect(room.bots!.bots.size).toBe(4);
    const p = room.seatStakedBot(botTicket(1))!;
    expect(p.flags).toBe(PlayerFlag.Bot | PlayerFlag.Staker);
    expect(room.ledger!.value(p.id)).toBe(FEE);
    // the cap holds: a zero-value bot went home for it
    expect(room.bots!.bots.size).toBe(4);
    expect(room.botCounts()).toEqual({ humans: 0, bots: 4, stakedBots: 1 });
    for (let i = 0; i < 4; i++) room.join(fakeConn(`w${i}`), stakeJoin(1, FEE));
    // humans took every target seat; only the staked bot (it holds a ticket) stays
    expect(room.bots!.bots.size).toBe(1);
    expect(room.bots!.isBot(p.id)).toBe(true);
    expect(room.liveStakes().some((s) => s.player === botTicket(1).stake.player)).toBe(true);
  });

  it('eating a staked bot moves its value like a player; its ticket settles and the source hears of it', () => {
    const released: [string, string][] = [];
    const source: StakedBotSource = { wanted: () => 0, acquire: async () => null, released: (t, r) => released.push([t.stake.session, r]) };
    const { room, journal } = stakedArena(source);
    const conn = fakeConn('wh');
    const human = room.join(conn, stakeJoin(1, FEE));
    const bot = room.seatStakedBot(botTicket(2))!;
    eat(room, human, bot);
    expect(room.ledger!.value(human.id)).toBe(2 * FEE);
    const item = journal.settlements().find((i) => i.key === botTicket(2).stake.session)!;
    expect(item).toMatchObject({ reason: 'death', payout: 0, player: botTicket(2).stake.player });
    expect(released).toEqual([[botTicket(2).stake.session, 'death']]);
  });

  it('a zero-value bot eating a staker still spills the value as loot (economics unchanged)', () => {
    const { room } = stakedArena();
    tick(room);
    const conn = fakeConn('wz');
    const human = room.join(conn, stakeJoin(1, FEE));
    const bot = [...room.bots!.bots.values()].find((b) => !b.staked)!.player;
    eat(room, bot, human);
    expect(room.lootValue()).toBe(FEE);
    expect(room.ledger!.has(bot.id)).toBe(false);
  });

  it('the bell settles staked bots with everyone; the room buys tickets from the source up to the wanted count', async () => {
    const tickets = [botTicket(3), botTicket(4), botTicket(5)];
    let asked = 0;
    const released: string[] = [];
    const source: StakedBotSource = {
      wanted: () => 2,
      acquire: async () => tickets[asked++] ?? null,
      released: (t, r) => released.push(`${t.stake.session}:${r}`),
    };
    const { room, journal, clock } = stakedArena(source);
    const realNow = Date.now;
    let fake = realNow();
    Date.now = () => fake;
    try {
      for (let i = 0; i < 4; i++) {
        tick(room);
        await Promise.resolve();
        await Promise.resolve();
        fake += 3500;
      }
    } finally {
      Date.now = realNow;
    }
    expect(room.bots!.stakedCount).toBe(2);
    expect(asked).toBe(2);
    clock.now += ROUND.roundMs;
    tick(room);
    const settled = journal.settlements().filter((i) => i.reason === 'round').map((i) => i.key).sort();
    expect(settled).toEqual([tickets[0].stake.session, tickets[1].stake.session].sort());
    expect(released.sort()).toEqual([`${tickets[0].stake.session}:round`, `${tickets[1].stake.session}:round`].sort());
    expect(room.bots!.stakedCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

describe('bot settings (validation)', () => {
  const base = defaultBotSettings(loadConfig({}).bots);

  it('defaults: cap 12, presets as weights, 6 staked bots per testnet arena', () => {
    expect(base.kinds.arena).toEqual({ massCap: 2500, enabled: true, cap: 12, min: 2, target: 12, mix: { easy: 45, medium: 40, hard: 15 } });
    expect(base.kinds.practiceRookie.mix).toEqual({ easy: 70, medium: 30, hard: 0 });
    expect(base.testnet).toEqual({ stakedPerArena: 6, bankroll: '1000000', gasHype: '0.05', arenas: {} });
  });

  it('refuses bad values with the field name and clamps min to cap', () => {
    const bad = (body: Record<string, unknown>) => {
      try {
        applyBotSettings(base, body);
      } catch (e) {
        return (e as BotSettingsError).field;
      }
      return null;
    };
    expect(bad({ kinds: { arena: { cap: 65 } } })).toBe('kinds.arena.cap');
    expect(bad({ kinds: { arena: { cap: 1.5 } } })).toBe('kinds.arena.cap');
    expect(bad({ kinds: { lobby: {} } })).toBe('kinds.lobby');
    expect(bad({ kinds: { arena: { mix: { easy: 0, medium: 0, hard: 0 } } } })).toBe('kinds.arena.mix');
    expect(bad({ testnet: { bankroll: '-5' } })).toBe('testnet.bankroll');
    expect(bad({ testnet: { arenas: { x: {} } } })).toBe('testnet.arenas.x');
    expect(bad({ other: 1 })).toBe('other');
    expect(applyBotSettings(base, { kinds: { arena: { cap: 3, min: 9 } } }).kinds.arena).toMatchObject({ cap: 3, min: 3 });
  });

  it('stakedWanted: per-arena override, else the default; never above the arena cap; 0 when arena bots are off', () => {
    const s = new BotSettingsStore(null, base);
    s.update({ testnet: { arenas: { '2': { stakedBots: 9, bankroll: '500' } } } });
    expect(s.stakedWanted(1)).toBe(6);
    expect(s.stakedWanted(2)).toBe(9);
    expect(s.bankroll(2)).toBe('500');
    expect(s.bankroll(1)).toBe('1000000');
    s.update({ kinds: { arena: { cap: 4 } } });
    expect(s.stakedWanted(2)).toBe(4);
    s.update({ kinds: { arena: { enabled: false } } });
    expect(s.stakedWanted(1)).toBe(0);
    s.update({ testnet: { arenas: { '2': null } } });
    expect(s.settings.testnet.arenas).toEqual({});
  });
});

describe('/api/admin/bots', () => {
  const apps: App[] = [];
  afterAll(async () => {
    for (const a of apps) await a.close();
  });

  async function start(dir: string, admin: string) {
    const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '6', BOT_MIN: '0', BOT_MAX: '6', ADMIN_WALLETS: admin, TRUST_PROXY: '0' } as NodeJS.ProcessEnv);
    const app = await createApp(cfg, {
      chain: new ArenaChain([arena(1, 1000)]),
      log: () => {},
      persist: true,
      siteLimits: { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
      apiLimiter: new Limiter(10_000, 60_000),
    });
    apps.push(app);
    const port = await app.listen();
    const call = async (method: string, wallet: string | null, body?: unknown) => {
      const headers: Record<string, string> = {};
      if (wallet) headers.Authorization = `Bearer ${app.auth.issueToken(wallet)}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/bots`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    return { app, call };
  }

  it('admin only; GET shows settings and live counts; PUT persists to DATA_DIR/site/bots.json and applies live', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-bots-'));
    const admin = testSigner().address;
    const { app, call } = await start(dir, admin);
    expect((await call('GET', null)).status).toBe(401);
    expect((await call('GET', testSigner().address)).status).toBe(403);
    expect((await call('PUT', testSigner().address, { kinds: { arena: { cap: 1 } } })).status).toBe(403);

    app.rooms.tickAll(TICK_MS);
    const got = await call('GET', admin);
    expect(got.status).toBe(200);
    expect(got.body.settings.kinds.practiceRookie).toMatchObject({ enabled: true, cap: 6, target: 6, min: 0 });
    expect(got.body.testnet).toBe(false);
    expect(got.body.stakedActive).toBe(false);
    const rookie = got.body.live.rooms.find((r: { id: string }) => r.id === 'practice-rookie-1');
    expect(rookie).toMatchObject({ kind: 'practiceRookie', humans: 0, bots: 6, stakedBots: 0 });
    expect(got.body.live.byKind.practiceRookie.bots).toBe(6);
    expect(got.body.live.totals.bots).toBeGreaterThanOrEqual(6);

    const put = await call('PUT', admin, { kinds: { practiceRookie: { cap: 2, mix: { hard: 0 } } }, testnet: { stakedPerArena: 3, arenas: { '1': { stakedBots: 2, bankroll: '250000' } } } });
    expect(put.status).toBe(200);
    expect(put.body.settings.kinds.practiceRookie).toMatchObject({ cap: 2 });
    // applied at once, no restart
    expect(put.body.live.rooms.find((r: { id: string }) => r.id === 'practice-rookie-1').bots).toBe(2);
    const file = join(dir, 'site', 'bots.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).testnet.arenas['1']).toEqual({ stakedBots: 2, bankroll: '250000' });

    const bad = await call('PUT', admin, { kinds: { arena: { target: -1 } } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'bad_request', field: 'kinds.arena.target' });

    // a restart reads the file back
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const again = await start(dir, admin);
    const after = await again.call('GET', admin);
    expect(after.body.settings.kinds.practiceRookie.cap).toBe(2);
    expect(after.body.settings.testnet.stakedPerArena).toBe(3);
    expect(again.app.rooms.botSettings.stakedWanted(1)).toBe(2);
  });

  it('an unreadable bots.json is set aside and the defaults are used', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-bots-'));
    mkdirSync(join(dir, 'site'), { recursive: true });
    writeFileSync(join(dir, 'site', 'bots.json'), '{nope');
    const admin = testSigner().address;
    const { call } = await start(dir, admin);
    const got = await call('GET', admin);
    expect(got.body.settings.kinds.arena.cap).toBe(12);
    expect(existsSync(join(dir, 'site', 'bots.json'))).toBe(false);
  });
});

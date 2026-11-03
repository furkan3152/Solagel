import { PlayerFlag, TICK_MS, type ServerMessage } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/net/gateway';
import { Room } from '../src/rooms/room';
import { ArenaChain, fakeConn, roomDeps } from './helpers';

type Standings = Extract<ServerMessage, { t: 'standings' }>;
const standingsOf = (msgs: ServerMessage[]) => msgs.filter((m): m is Standings => m.t === 'standings');

const pond = () =>
  new Room({ id: 'practice-rookie-1', mode: 'practice', league: 'rookie', name: 'Rookie', maxPlayers: 40, bots: { target: 6, min: 2, max: 6 }, seed: 7 }, roomDeps(new ArenaChain([])));

/** Ticks until the room's once-a-second leaderboard went out (the room reads the wall clock for it). */
async function nextSecond(room: Room): Promise<void> {
  await new Promise((r) => setTimeout(r, 1010));
  room.tick(TICK_MS);
}

describe('full standings (standings sheet)', () => {
  it('only connections that asked get every coin in play, ranked, with BOT, holder and picture marks', async () => {
    const room = pond();
    for (let i = 0; i < 30; i++) room.tick(TICK_MS);
    const me = fakeConn('0x1111111111111111111111111111111111111111');
    const other = fakeConn(null);
    const watcher = fakeConn(null);
    const p = room.join(me, { name: 'Daphne', skin: 4, flags: PlayerFlag.Verified | PlayerFlag.Holder, avatar: '0123456789abcdef', country: 'NL' });
    room.join(other, { name: 'Guest', skin: 2, flags: 0 });
    room.spectate(watcher, false);

    // nothing unasked
    room.tick(TICK_MS);
    await nextSecond(room);
    expect(standingsOf(me.msgs)).toHaveLength(0);

    // asking sends the rows at once, then with every leaderboard
    me.standings = true;
    room.sendStandings(me);
    const first = standingsOf(me.msgs).at(-1)!;
    expect(first.rows.length).toBe(first.players);
    expect(first.rows.length).toBeGreaterThanOrEqual(4);
    const scores = first.rows.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const mine = first.rows.find((r) => r.pid === p.id)!;
    expect(mine).toMatchObject({ name: 'Daphne', skin: 4, holder: true, verified: true, avatar: '0123456789abcdef', country: 'NL' });
    expect(first.rows.find((r) => r.name === 'Guest')?.country).toBeUndefined();
    for (const b of first.rows.filter((r) => r.isBot)) expect(b.country).toMatch(/^[A-Z]{2}$/);
    expect(mine.isBot).toBeUndefined();
    const bots = first.rows.filter((r) => r.isBot);
    expect(bots.length).toBeGreaterThan(0);
    for (const b of bots) expect(b.avatar).toBeUndefined();
    expect(first.rows.find((r) => r.name === 'Guest')?.holder).toBeUndefined();
    // the spectator has no coin: it is counted as watching
    expect(first.watching).toBe(1);

    const before = standingsOf(me.msgs).length;
    await nextSecond(room);
    expect(standingsOf(me.msgs).length).toBe(before + 1);
    expect(standingsOf(other.msgs)).toHaveLength(0);

    // off: no more rows
    me.standings = false;
    await nextSecond(room);
    expect(standingsOf(me.msgs).length).toBe(before + 1);
  });

  it('the gateway turns the sheet on and off (and answers at once)', async () => {
    const room = pond();
    const conn = fakeConn(null);
    room.join(conn, { name: 'Pip', skin: 1, flags: 0 });
    conn.helloed = true;
    const gw = Object.create(Gateway.prototype) as Gateway;
    await gw.onMessage(conn, Buffer.from(JSON.stringify({ t: 'standings', on: true })), false);
    expect(conn.standings).toBe(true);
    expect(standingsOf(conn.msgs)).toHaveLength(1);
    await gw.onMessage(conn, Buffer.from(JSON.stringify({ t: 'standings', on: false })), false);
    expect(conn.standings).toBe(false);
    // anything but `true` is off
    await gw.onMessage(conn, Buffer.from(JSON.stringify({ t: 'standings', on: 'yes' })), false);
    expect(conn.standings).toBe(false);
  });
});

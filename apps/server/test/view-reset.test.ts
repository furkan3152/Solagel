import { TICK_MS, decodeSnapshot, type ServerMessage } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { Conn } from '../src/net/conn';
import { Room } from '../src/rooms/room';
import { ArenaChain, roomDeps } from './helpers';

/**
 * A client's world mirror, fed by the connection's messages in wire order, cleared the way the web
 * client clears it: on every `joined` and `spectating` (`GameEngine.onMessage`).
 */
function mirroredConn(): { conn: Conn; mirror: Map<number, number> } {
  const mirror = new Map<number, number>();
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: unknown) {
      if (typeof data === 'string') {
        const m = JSON.parse(data) as ServerMessage;
        if (m.t === 'joined' || m.t === 'spectating') mirror.clear();
        return;
      }
      const s = decodeSnapshot(data as ArrayBuffer);
      for (const u of s.upserts) mirror.set(u.id, u.kind);
      for (const r of s.removals) mirror.delete(r.id);
    },
  };
  return { conn: new Conn(ws as never, '127.0.0.1'), mirror };
}

const pond = (id: string, seed: number) =>
  new Room({ id, mode: 'practice', league: 'rookie', name: id, maxPlayers: 40, bots: { target: 8, min: 2, max: 8 }, seed }, roomDeps(new ArenaChain([])));

const tick = (rooms: Room[], n: number) => {
  for (let i = 0; i < n; i++) for (const r of rooms) r.tick(TICK_MS);
};

describe('client mirror vs server view', () => {
  it('after lobby → another room, rejoining the same room and a respawn, the mirror holds exactly what is in view (no ghosts)', () => {
    const a = pond('practice-rookie-1', 11);
    const b = pond('practice-rookie-2', 12);
    const rooms = [a, b];
    const { conn, mirror } = mirroredConn();
    const check = (room: Room) => {
      // everything the client holds exists in its room right now, and the server knows it holds it
      for (const id of mirror.keys()) expect(room.world.entities.has(id), `ghost entity ${id}`).toBe(true);
      expect([...mirror.keys()].sort((x, y) => x - y)).toEqual([...conn.view.known.keys()].sort((x, y) => x - y));
      expect(mirror.size).toBeGreaterThan(0);
    };

    // the lobby's live view watches room A
    a.spectate(conn);
    tick(rooms, 20);
    check(a);

    // the player picks room B: nothing of room A may stay on screen
    b.join(conn, { name: 'newbie', skin: 0, flags: 0 });
    tick(rooms, 20);
    check(b);

    // back to the lobby (same room), then play again in the same room
    b.leave(conn, 'left');
    b.spectate(conn);
    tick(rooms, 15);
    check(b);
    // "watch" again: the same room, the same camera, a fresh `spectating`
    b.spectate(conn);
    tick(rooms, 5);
    check(b);
    b.join(conn, { name: 'newbie', skin: 0, flags: 0 });
    tick(rooms, 15);
    check(b);

    // the camera moved on and things were eaten meanwhile: still exact
    tick(rooms, 300);
    check(b);
  });
});

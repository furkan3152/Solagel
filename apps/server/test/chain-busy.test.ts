/**
 * The 2026-11-01 incident: the public Elysium RPC answered HTTP 429 to most calls. A player who had
 * paid a ticket (arena #3, session 3877) could not get back into the arena: the arena list read failed
 * right after a settlement had dropped the cached list, so `arenaRoom` answered null ("Arena not
 * available." → the client's "Room not found."), even for the resume of a ticket whose coin was in
 * the room (AFK) — the coin was eaten while the player was locked out. These tests replay it with the
 * RPC throwing 429s in `listArenas` / `getSession`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage } from '@elymum/shared';
import { PROTOCOL_VERSION } from '@elymum/shared';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Auth } from '../src/auth';
import { EvmChain } from '../src/chain/evm';
import { ChainBusyError, sessionKey } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Gateway, JOIN_CHAIN_RETRY_MS } from '../src/net/gateway';
import { RoomManager } from '../src/rooms/manager';
import { Journal } from '../src/stake/journal';
import { ARENA, FakeEvm } from './fake-evm';
import { MID_ROUND, fakeConn, roomDeps, type TestConn } from './helpers';
import { testSigner } from './signers';

const T0 = MID_ROUND;

function config() {
  return loadConfig({ EVM_RPC_URL: 'http://127.0.0.1:1', SERVER_PRIVATE_KEY: generatePrivateKey(), GAME_ACCESS: 'public' } as unknown as NodeJS.ProcessEnv);
}

async function setup(opts: { cacheDir?: string | null; evm?: FakeEvm } = {}) {
  const evm = opts.evm ?? new FakeEvm();
  if (!opts.evm) {
    evm.addArena(1, 1_000n);
    evm.addArena(3, 50_000n);
  }
  const cfg = config();
  const journal = new Journal(null);
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const chain = new EvmChain(cfg, journal, log, { client: evm, contracts: () => ({ arena: ARENA, nft: null }), loops: false, now: () => T0, receiptTimeoutMs: 10, cacheDir: opts.cacheDir ?? null });
  await chain.start();
  const rooms = new RoomManager(cfg, { ...roomDeps(chain, journal, () => T0), log }, chain);
  chain.setLiveSessionProvider(() => rooms.liveSessions());
  const gateway = new Gateway(cfg, rooms, new Auth(cfg.authSecret), chain, journal, log);
  const send = (conn: TestConn, msg: Record<string, unknown>) => gateway.onMessage(conn, Buffer.from(JSON.stringify(msg)) as never, false);
  const connect = async (wallet: string | null) => {
    const conn = fakeConn(wallet);
    rooms.conns.add(conn);
    await send(conn, { t: 'hello', v: PROTOCOL_VERSION });
    return conn;
  };
  return { evm, chain, rooms, gateway, journal, logs, send, connect };
}

const errors = (c: TestConn) => c.msgs.filter((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
const RETRY_DEFAULT = [...JOIN_CHAIN_RETRY_MS];

afterEach(() => {
  JOIN_CHAIN_RETRY_MS.splice(0, JOIN_CHAIN_RETRY_MS.length, ...RETRY_DEFAULT);
});

describe('paid joins while the RPC answers 429', () => {
  it('reproduces the lock-out: a settlement drops the arena list, the re-read is rate-limited — the AFK ticket still resumes', async () => {
    const t = await setup();
    const w = testSigner().address;
    const s = t.evm.join(3, w, { openedAt: Math.floor(Date.now() / 1000) - 60 });
    const a = await t.connect(w);
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(a.msgs.find((m) => m.t === 'joined')).toMatchObject({ session: sessionKey(3, w, s.id) });
    // the tab drops: the coin stays in the arena (AFK)
    a.room!.leave(a, 'disconnect');
    // a bot settlement lands (the chain marks its arena list stale), the room manager's cache expires, and
    // from now on every read of the arena list and of sessions is refused with HTTP 429
    (t.chain as unknown as { arenasStale(): void }).arenasStale();
    (t.rooms as unknown as { arenaCache: unknown }).arenaCache = null;
    t.evm.limited.set('arenas', Infinity).set('session', Infinity).set('arena', Infinity);
    const sessionReads = t.evm.sessionReads;
    // "Resume Golden Bough · no transaction": the same join again, from a new connection
    const b = await t.connect(w);
    await t.send(b, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(errors(b)).toEqual([]);
    expect(b.msgs.find((m) => m.t === 'joined')).toMatchObject({ session: sessionKey(3, w, s.id) });
    // the coin was in this process: no chain read was needed at all
    expect(t.evm.sessionReads).toBe(sessionReads);
    // spectating the arena (the death screen, the lobby live view) works too
    const c = await t.connect(null);
    await t.send(c, { t: 'spectate', room: 'arena-3-1' });
    expect(errors(c)).toEqual([]);
    expect(c.msgs.find((m) => m.t === 'spectating')).toBeTruthy();
  });

  it('a new paid join retries a rate-limited ticket read, tells the player once, then seats the ticket', async () => {
    JOIN_CHAIN_RETRY_MS.splice(0, JOIN_CHAIN_RETRY_MS.length, 5, 5, 5);
    const t = await setup();
    await t.rooms.ensureArenaRooms();
    const w = testSigner().address;
    const s = t.evm.join(3, w, { openedAt: Math.floor(Date.now() / 1000) - 30 });
    // the arena list is known; the session read is refused twice (the RPC budget gave up on both)
    t.evm.limited.set('session', 2);
    const a = await t.connect(w);
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(errors(a).map((e) => e.code)).toEqual(['chain_busy']);
    expect(errors(a)[0].message).toMatch(/network is busy, retrying/);
    expect(a.msgs.find((m) => m.t === 'joined')).toMatchObject({ session: sessionKey(3, w, s.id) });
    expect(a.msgs.some((m) => m.t === 'error' && (m.code === 'no_session' || m.code === 'room_not_found'))).toBe(false);
  });

  it('when every retry is refused the player hears chain_busy (ticket safe), never no_session or room_not_found', async () => {
    JOIN_CHAIN_RETRY_MS.splice(0, JOIN_CHAIN_RETRY_MS.length, 2, 2);
    const t = await setup();
    await t.rooms.ensureArenaRooms();
    const w = testSigner().address;
    t.evm.join(3, w, { openedAt: Math.floor(Date.now() / 1000) - 30 });
    t.evm.limited.set('session', Infinity);
    const a = await t.connect(w);
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    const codes = errors(a).map((e) => e.code);
    expect(codes).toEqual(['chain_busy', 'chain_busy']);
    expect(errors(a)[1].message).toMatch(/ticket is safe/);
    expect(a.msgs.some((m) => m.t === 'joined')).toBe(false);
    // the RPC is back: the same click seats the ticket
    t.evm.limited.delete('session');
    a.msgs.length = 0;
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(a.msgs.find((m) => m.t === 'joined')).toBeTruthy();
  });

  it('getSession throws ChainBusyError on a 429 (it never answers "no ticket"); listArenas serves the last good list', async () => {
    const t = await setup();
    const w = testSigner().address;
    t.evm.join(3, w);
    expect(await t.chain.listArenas()).toHaveLength(2);
    t.evm.limited.set('session', 1).set('arenas', Infinity);
    await expect(t.chain.getSession(3, w)).rejects.toBeInstanceOf(ChainBusyError);
    expect(await t.chain.getSession(3, w)).toMatchObject({ arenaId: 3 });
    // stale after a settlement, then a refused re-read: the last good list, not []
    (t.chain as unknown as { arenasStale(): void }).arenasStale();
    expect((await t.chain.listArenas()).map((a) => a.id)).toEqual([1, 3]);
    expect((await t.chain.listArenas(true)).map((a) => a.id)).toEqual([1, 3]);
    // its vaults are unknown now: the vault guard skips them instead of blocking a running arena
    expect((await t.chain.listArenas()).every((a) => a.pot === null)).toBe(true);
    expect(t.logs.join('\n')).toMatch(/arena list failed .* serving the last good list/);
  });

  it('with no list ever read, a refused arena list is ChainBusyError (chain_busy), not "Arena not available"', async () => {
    const evm = new FakeEvm();
    evm.addArena(1, 1_000n);
    evm.addArena(3, 50_000n);
    evm.limited.set('arenas', Infinity);
    const t = await setup({ evm });
    await expect(t.chain.listArenas()).rejects.toBeInstanceOf(ChainBusyError);
    const w = testSigner().address;
    t.evm.join(3, w);
    const a = await t.connect(w);
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(errors(a).map((e) => e.code)).toEqual(['chain_busy']);
    // it comes back: the join goes through
    t.evm.limited.delete('arenas');
    a.msgs.length = 0;
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(a.msgs.find((m) => m.t === 'joined')).toBeTruthy();
  });

  it('a restart while rate-limited: the persisted config and arena list open the arenas, spectate creates them on demand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-busy-'));
    const first = await setup({ cacheDir: dir });
    expect(await first.chain.listArenas()).toHaveLength(2);
    await first.chain.stop(); // flushes the cache
    // the new process: the RPC answers chainId and blocks, but refuses the code check, the config and the arena list
    const evm = first.evm;
    evm.limited.set('codeCheck', Infinity).set('arenaConfig', Infinity).set('arenas', Infinity);
    const t = await setup({ cacheDir: dir, evm });
    expect(t.chain.tokenReady).toBe(true);
    expect(t.chain.stakeEnabled).toBe(true);
    expect((await t.chain.listArenas()).map((a) => a.id)).toEqual([1, 3]);
    // no arena room yet (lazy); a spectator of a non-existent instance gets the arena's first one
    expect(t.rooms.rooms.has('arena-3-1')).toBe(false);
    const c = await t.connect(null);
    await t.send(c, { t: 'spectate', room: 'arena-3-2' });
    expect(errors(c)).toEqual([]);
    expect(c.msgs.find((m) => m.t === 'spectating')).toMatchObject({ room: { id: 'arena-3-1' } });
    // and a paid join is seated from the persisted list
    const w = testSigner().address;
    evm.join(3, w);
    const a = await t.connect(w);
    await t.send(a, { t: 'join', room: 'arena:3', name: 'Paid', skin: 0 });
    expect(a.msgs.find((m) => m.t === 'joined')).toBeTruthy();
  });
});

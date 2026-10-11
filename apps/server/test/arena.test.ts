import { PlayerFlag, RULES, TICK_MS, type ServerMessage } from '@solagel/shared';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { Auth } from '../src/auth';
import type { ChainGateway, ChainSession } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Leaderboards } from '../src/leaderboards';
import { Conn } from '../src/net/conn';
import { Gateway } from '../src/net/gateway';
import { RoomManager } from '../src/rooms/manager';
import { Room, type RoomDeps } from '../src/rooms/room';
import { Journal } from '../src/stake/journal';

const ticket = (wallet = 'wallet'): ChainSession => ({ address: `ticket-${wallet}`, id: 1, player: wallet,
  arenaId: 1, buyIn: 10_000_000, openedAt: Math.floor(Date.now() / 1000), activated: false });
const admission = (wallet = 'wallet') => {
  const t = ticket(wallet);
  return { player: wallet, session: t.address, sessionId: t.id, arenaId: t.arenaId, buyIn: t.buyIn, value: t.buyIn, openedAt: t.openedAt };
};

function client(wallet: string | null = 'wallet') {
  const messages: ServerMessage[] = [];
  const socket = { readyState: 1, bufferedAmount: 0, send: (data: unknown) => {
    if (typeof data === 'string') messages.push(JSON.parse(data));
  } };
  const conn = new Conn(socket as unknown as WebSocket, 'test');
  conn.helloed = true;
  conn.wallet = wallet;
  return { conn, socket, messages };
}

function fixture() {
  const chain: ChainGateway = {
    enabled: true, stakeEnabled: true,
    status: () => ({ enabled: true, stakeEnabled: true, cluster: 'test', programId: null, rpcUrl: null, currentSeason: null }),
    getProfile: vi.fn(async () => null),
    getSession: vi.fn(async (_arena, wallet) => ticket(wallet)),
    activateSession: vi.fn(async () => true),
    listArenas: vi.fn(async () => [{ id: 1, address: 'arena', buyIn: 10_000_000, maxPlayers: 4, enabled: true, openSessions: 0, pot: 0 }]),
    season: async () => null, kick: vi.fn(), setLiveSessionProvider: () => {}, onSettled: () => {}, start: async () => {}, stop: async () => {},
  };
  const journal = new Journal(null);
  const deps: RoomDeps = { chain, journal, leaderboards: new Leaderboards(null), canRecord: () => false, recordMinScore: 40, log: () => {} };
  const cfg = loadConfig({ BOT_TARGET: '4', BOT_MIN: '0', BOT_MAX: '4' });
  const manager = new RoomManager(cfg, deps, chain);
  const auth = new Auth(Buffer.alloc(32, 1));
  const gateway = new Gateway(cfg, manager, auth, chain, journal, () => {});
  return { chain, journal, deps, manager, gateway, auth };
}

const send = (gateway: Gateway, conn: Conn, msg: unknown) => gateway.onMessage(conn, Buffer.from(JSON.stringify(msg)), false);
const join = (gateway: Gateway, conn: Conn) => send(gateway, conn, { t: 'join', room: 'stake:1', name: 'Player', skin: 0 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('continuous public arenas', () => {
  it('refreshes arena capacity and enabled state without ejecting existing players', async () => {
    const f = fixture();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    let maxPlayers = 4;
    let enabled = true;
    f.chain.listArenas = async () => [{ id: 1, address: 'arena', buyIn: 10_000_000, maxPlayers, enabled, openSessions: 0, pot: 0 }];
    try {
      const players = [client('a'), client('b'), client('c')];
      for (const player of players) await join(f.gateway, player.conn);
      const room = players[0].conn.room!;
      const originalCells = players.map((p) => p.conn.player);
      maxPlayers = 2;
      clock.mockReturnValue(now + 31_000);
      await f.manager.ensureStakeRooms();
      expect(room.opts.maxPlayers).toBe(2);
      expect(room.info().players).toBe(3);
      expect(room.opts.bots!.target).toBe(2);
      const late = client('d');
      await join(f.gateway, late.conn);
      expect(late.conn.player).toBeNull();
      expect(players.map((p) => p.conn.player)).toEqual(originalCells);

      maxPlayers = 4;
      clock.mockReturnValue(now + 62_000);
      await f.manager.ensureStakeRooms();
      await join(f.gateway, late.conn);
      expect(late.conn.room).toBe(room);
      expect(room.info().players).toBe(4);
      expect(room.ledger!.total()).toBe(40_000_000);

      enabled = false;
      clock.mockReturnValue(now + 93_000);
      await f.manager.ensureStakeRooms();
      expect(room.info().enabled).toBe(false);
      expect(f.manager.list().some((r) => r.id === room.id)).toBe(false);
      const pid = players[0].conn.player!.id;
      room.leave(players[0].conn, 'disconnect');
      const reconnected = client('a');
      await join(f.gateway, reconnected.conn);
      expect(reconnected.conn.player?.id).toBe(pid);
      expect(room.ledger!.total()).toBe(40_000_000);
    } finally { clock.mockRestore(); }
  });

  it('settles an activating reservation if an admin lowers capacity below the current population', async () => {
    const f = fixture();
    await join(f.gateway, client('a').conn);
    await join(f.gateway, client('b').conn);
    const pendingActivation = deferred<boolean>();
    const started = deferred<void>();
    f.chain.activateSession = async () => { started.resolve(); return pendingActivation.promise; };
    const late = client('c');
    const joining = join(f.gateway, late.conn);
    await started.promise;
    const room = f.manager.rooms.get('stake-1')!;
    room.opts.maxPlayers = 2;
    pendingActivation.resolve(true);
    await joining;
    expect(late.conn.player).toBeNull();
    expect(room.humans.size).toBe(2);
    expect(f.journal.pending).toMatchObject([{ player: 'c', payout: 10_000_000 }]);
    expect(room.ledger!.total()).toBe(20_000_000);
  });

  it('applies admin bot targets to live and future rooms without removing human cells', async () => {
    const f = fixture();
    const a = client('a');
    await join(f.gateway, a.conn);
    const existing = a.conn.player;
    f.manager.applyRuntime({ admissionsPaused: false, bots: { target: 9, min: 1, max: 5, privateTarget: 3 } });
    expect(a.conn.player).toBe(existing);
    expect(a.conn.room!.bots!.desired(1)).toBe(3); // paid capacity caps the target at 4
    expect(f.manager.freeRoom().bots!.desired(0)).toBe(5);
    expect(f.manager.privateRoom(null)!.bots!.desired(0)).toBe(3);
    expect(f.journal.live()[0].value).toBe(10_000_000);
  });

  it('pauses new admissions while allowing an active paid player to reconnect and cash out', async () => {
    const f = fixture();
    const original = client('a');
    await join(f.gateway, original.conn);
    const room = original.conn.room!;
    const pid = original.conn.player!.id;
    room.leave(original.conn, 'disconnect');
    f.manager.applyRuntime({ admissionsPaused: true, bots: { target: 0, min: 0, max: 0, privateTarget: 0 } });
    const blocked = client('b');
    await join(f.gateway, blocked.conn);
    expect(blocked.conn.player).toBeNull();
    const practice = client(null);
    await send(f.gateway, practice.conn, { t: 'join', room: 'free', name: 'Guest', skin: 0 });
    expect(practice.conn.player).toBeNull();
    const reconnected = client('a');
    await join(f.gateway, reconnected.conn);
    expect(reconnected.conn.player?.id).toBe(pid);
    await send(f.gateway, reconnected.conn, { t: 'cashout' });
    room.world.now += RULES.cashoutMs + TICK_MS;
    room.tick(TICK_MS);
    expect(f.journal.pending).toMatchObject([{ player: 'a', payout: 10_000_000 }]);
  });

  it('cancels admission safely when admin pause arrives during activation', async () => {
    const f = fixture();
    const active = deferred<boolean>();
    const started = deferred<boolean>();
    f.chain.activateSession = async () => { started.resolve(true); return active.promise; };
    const a = client();
    const joining = join(f.gateway, a.conn);
    await started.promise;
    f.manager.applyRuntime({ admissionsPaused: true, bots: { target: 0, min: 0, max: 0, privateTarget: 0 } });
    active.resolve(true);
    await joining;
    expect(a.conn.player).toBeNull();
    expect(f.journal.pending).toMatchObject([{ player: 'wallet', payout: 10_000_000 }]);
    expect(f.journal.live()).toHaveLength(0);
  });
  it('shares one simulation when the first paid joins discover the arena concurrently', async () => {
    const { manager } = fixture();
    const rooms = await Promise.all([manager.stakeRoom(1), manager.stakeRoom(1), manager.stakeRoom(1)]);
    expect(rooms[0]).toBe(rooms[1]);
    expect(rooms[1]).toBe(rooms[2]);
    expect(manager.rooms.get('stake-1')).toBe(rooms[0]);
  });

  it('admits late arrivals without resetting existing cells and gives a spawn shield', async () => {
    const { manager, gateway } = fixture();
    const a = client('a');
    await join(gateway, a.conn);
    const room = manager.rooms.get('stake-1')!;
    const player = a.conn.player!;
    player.cells[0].setMass(350);
    room.tick(TICK_MS);
    const b = client('b');
    await join(gateway, b.conn);
    expect(b.conn.room).toBe(room);
    expect(a.conn.player).toBe(player);
    expect(player.totalMass()).toBeGreaterThan(300);
    expect(b.conn.player!.shieldUntil).toBe(room.world.now + RULES.spawnShieldMs);
    expect(room.info().players).toBe(2);
    expect(room.ledger!.total()).toBe(20_000_000);
  });

  it('paid bots cannot eat humans and provide mass without changing SOL balances', async () => {
    const { manager, gateway, journal } = fixture();
    const a = client();
    await join(gateway, a.conn);
    const room = a.conn.room!;
    room.tick(TICK_MS);
    const human = a.conn.player!;
    const bot = [...room.bots!.bots.values()][0].player;
    expect(bot.flags & PlayerFlag.Bot).toBe(PlayerFlag.Bot);
    expect(room.ledger!.has(bot.id)).toBe(false);
    for (const p of [human, bot]) {
      p.shieldUntil = 0;
      p.cells[0].x = 1000;
      p.cells[0].y = 1000;
      room.world.setTarget(p.id, 1000, 1000);
    }
    bot.cells[0].setMass(1000);
    human.cells[0].setMass(100);
    room.tick(TICK_MS);
    expect(human.alive).toBe(true);
    expect(room.ledger!.value(human.id)).toBe(10_000_000);
    human.cells[0].setMass(2000);
    bot.cells[0].setMass(100);
    bot.cells[0].x = human.cells[0].x;
    bot.cells[0].y = human.cells[0].y;
    room.world.setTarget(bot.id, bot.cells[0].x, bot.cells[0].y);
    room.tick(TICK_MS);
    expect(bot.alive).toBe(false);
    expect(human.totalMass()).toBeGreaterThan(2000);
    expect(room.ledger!.total()).toBe(10_000_000);
    expect(journal.pending).toHaveLength(0);
    expect(manager.freeRoom().bots!.desired(4)).toBe(0);
  });

  it('lets an owner reattach to a full room and rejects another wallet', async () => {
    const { deps } = fixture();
    const room = new Room({ id: 'stake-1', mode: 'stake', name: 'Test', maxPlayers: 1, bots: null, stake: { arenaId: 1, buyIn: 10_000_000 } }, deps);
    const a = client();
    const player = room.join(a.conn, { name: 'Player', skin: 0, flags: PlayerFlag.Staker, stake: admission() });
    room.leave(a.conn, 'disconnect');
    expect(room.isFull).toBe(true);
    expect(room.reattach(client('intruder').conn, player.id)).toBe(false);
    expect(room.reattach(client().conn, player.id)).toBe(true);
    expect(room.humans.size).toBe(1);
  });
});

describe('paid admission lifecycle', () => {
  it('persists a capacity reservation before activation and retains it across ticks', async () => {
    const f = fixture();
    const active = deferred<boolean>();
    const started = deferred<boolean>();
    f.chain.activateSession = vi.fn(async () => {
      expect(f.journal.live()).toMatchObject([{ session: 'ticket-wallet', value: 10_000_000 }]);
      started.resolve(true);
      return active.promise;
    });
    const a = client();
    const pending = join(f.gateway, a.conn);
    await started.promise;
    const room = f.manager.rooms.get('stake-1')!;
    expect(room.humans.size).toBe(0);
    room.tick(TICK_MS);
    expect(f.journal.live()).toHaveLength(1);
    expect(f.manager.liveSessions().has('ticket-wallet')).toBe(true);
    active.resolve(true);
    await pending;
    expect(room.humans.size).toBe(1);
    expect(f.journal.live()).toHaveLength(1);
    expect(a.messages.find((m) => m.t === 'joined')).toMatchObject({ sessionId: 1, arenaId: 1 });
  });

  it('allows only one of two tabs to activate the same ticket', async () => {
    const f = fixture();
    const a = client();
    const b = client();
    await Promise.all([join(f.gateway, a.conn), join(f.gateway, b.conn)]);
    expect(f.chain.activateSession).toHaveBeenCalledTimes(1);
    expect(f.manager.rooms.get('stake-1')!.humans.size).toBe(1);
    expect([...a.messages, ...b.messages].filter((m) => m.t === 'joined')).toHaveLength(1);
    expect([...a.messages, ...b.messages]).toContainEqual(expect.objectContaining({ t: 'error', code: 'session_busy' }));
  });

  it.each(['rejected', 'throws'] as const)('settles the reservation without spawning when activation %s', async (failure) => {
    const f = fixture();
    f.chain.activateSession = async () => {
      if (failure === 'throws') throw new Error('RPC disconnected');
      return false;
    };
    const a = client();
    await join(f.gateway, a.conn);
    expect(a.conn.player).toBeNull();
    expect(f.journal.live()).toHaveLength(0);
    expect(f.journal.pending).toMatchObject([{ key: 'ticket-wallet', payout: 10_000_000 }]);
    expect(a.messages).toContainEqual(expect.objectContaining({ t: 'error', code: 'no_session' }));
  });

  it('fails closed if a runtime chain adapter has no activation capability', async () => {
    const f = fixture();
    // Simulate an old adapter loaded by plain JavaScript, outside TS checks.
    Reflect.deleteProperty(f.chain, 'activateSession');
    const a = client();
    await join(f.gateway, a.conn);
    expect(a.conn.player).toBeNull();
    expect(f.journal.live()).toHaveLength(0);
    expect(f.journal.pending).toMatchObject([{ payout: 10_000_000 }]);
  });

  it('does not admit an activating ticket after the room shuts down', async () => {
    const f = fixture();
    const active = deferred<boolean>();
    const started = deferred<boolean>();
    f.chain.activateSession = async () => { started.resolve(true); return active.promise; };
    const a = client();
    const pending = join(f.gateway, a.conn);
    await started.promise;
    f.manager.shutdown();
    active.resolve(true);
    await pending;
    expect(a.conn.player).toBeNull();
    expect(f.journal.live()).toHaveLength(0);
    expect(f.journal.pending).toMatchObject([{ key: 'ticket-wallet', payout: 10_000_000 }]);
  });

  it('counts activating tickets against human capacity while leaving bots outside it', async () => {
    const f = fixture();
    const room = await f.manager.stakeRoom(1);
    room!.tick(TICK_MS);
    expect(room!.info().bots).toBe(4);
    for (const wallet of ['a', 'b', 'c', 'd']) room!.reserveStake(admission(wallet));
    expect(room!.isFull).toBe(true);
    expect(room!.info().players).toBe(0);
    const a = client('e');
    await join(f.gateway, a.conn);
    expect(f.chain.activateSession).not.toHaveBeenCalled();
    expect(a.messages).toContainEqual(expect.objectContaining({ t: 'error', code: 'room_full' }));
    room!.cancelReservation('ticket-a');
    expect(room!.isFull).toBe(false);
  });

  it('keeps the reservation recoverable if committing spawned player state fails', async () => {
    const f = fixture();
    const persist = f.journal.commit.bind(f.journal);
    let calls = 0;
    vi.spyOn(f.journal, 'commit').mockImplementation((opts) => {
      if (++calls === 2) throw new Error('Disk write failed');
      persist(opts);
    });
    const a = client();
    await join(f.gateway, a.conn);
    expect(a.conn.player).toBeNull();
    expect(f.manager.rooms.get('stake-1')!.humans.size).toBe(0);
    expect(f.journal.live()).toHaveLength(0);
    expect(f.journal.pending).toMatchObject([{ key: 'ticket-wallet', payout: 10_000_000 }]);
  });

  it('restores a cash-out liability and freezes the arena after a settlement write failure', async () => {
    const f = fixture();
    const a = client();
    await join(f.gateway, a.conn);
    const room = a.conn.room!;
    const player = a.conn.player!;
    vi.spyOn(f.journal, 'commit').mockImplementation(() => { throw new Error('Disk unavailable'); });
    room.cashout(a.conn);
    expect(() => room.tick(RULES.cashoutMs + 1)).toThrow('Disk unavailable');
    expect(room.ledger!.value(player.id)).toBe(10_000_000);
    expect(f.journal.live()).toMatchObject([{ value: 10_000_000 }]);
    expect(f.journal.pending).toHaveLength(0);
    expect(a.messages.some((m) => m.t === 'cashout' && m.state === 'done')).toBe(false);
    const stoppedAt = room.world.now;
    room.tick(TICK_MS);
    expect(room.world.now).toBe(stoppedAt);
    expect(a.messages).toContainEqual(expect.objectContaining({ t: 'error', code: 'stake_disabled' }));
  });

  it('rolls back a failed SOL transfer write and halts before publishing the result', async () => {
    const f = fixture();
    const a = client('a');
    const b = client('b');
    await join(f.gateway, a.conn);
    await join(f.gateway, b.conn);
    const room = a.conn.room!;
    const eater = a.conn.player!;
    const victim = b.conn.player!;
    for (const p of [eater, victim]) {
      p.shieldUntil = 0;
      p.cells[0].x = 1000;
      p.cells[0].y = 1000;
      room.world.setTarget(p.id, 1000, 1000);
    }
    eater.cells[0].setMass(1000);
    victim.cells[0].setMass(100);
    vi.spyOn(f.journal, 'commit').mockImplementation(() => { throw new Error('Disk unavailable'); });
    expect(() => room.tick(TICK_MS)).toThrow('Disk unavailable');
    expect(room.ledger!.value(eater.id)).toBe(10_000_000);
    expect(room.ledger!.value(victim.id)).toBe(10_000_000);
    expect(f.journal.live().map((e) => e.value)).toEqual([10_000_000, 10_000_000]);
    expect(b.messages.some((m) => m.t === 'death')).toBe(false);
    const stoppedAt = room.world.now;
    room.tick(TICK_MS);
    expect(room.world.now).toBe(stoppedAt);
  });

  it('stops an active paid simulation when another journal operation has faulted', async () => {
    const f = fixture();
    const a = client();
    await join(f.gateway, a.conn);
    const room = a.conn.room!;
    vi.spyOn(f.journal, 'healthy', 'get').mockReturnValue(false);
    const stoppedAt = room.world.now;
    expect(() => room.tick(TICK_MS)).toThrow('Settlement journal is unavailable');
    expect(room.world.now).toBe(stoppedAt);
    expect(f.journal.live()).toMatchObject([{ value: 10_000_000 }]);
    const persist = vi.spyOn(f.journal, 'commit');
    room.shutdown();
    expect(persist).not.toHaveBeenCalled();
  });

  it.each(['leave', 'disconnect', 'logout'] as const)('settles a reserved ticket if the client cancels by %s during activation', async (cancel) => {
    const f = fixture();
    const active = deferred<boolean>();
    const started = deferred<boolean>();
    f.chain.activateSession = vi.fn(async () => { started.resolve(true); return active.promise; });
    const a = client();
    const pending = join(f.gateway, a.conn);
    await started.promise;
    if (cancel === 'disconnect') a.socket.readyState = 3;
    else await send(f.gateway, a.conn, { t: cancel });
    active.resolve(true);
    await pending;
    expect(a.conn.player).toBeNull();
    expect(f.manager.rooms.get('stake-1')!.humans.size).toBe(0);
    expect(f.journal.live()).toHaveLength(0);
    expect(f.journal.pending).toMatchObject([{ key: 'ticket-wallet', payout: 10_000_000, reason: 'kicked' }]);
  });

  it('does not spawn or activate after leaving during a delayed session read', async () => {
    const f = fixture();
    const response = deferred<ChainSession | null>();
    const started = deferred<boolean>();
    f.chain.getSession = async () => { started.resolve(true); return response.promise; };
    const a = client();
    const pending = join(f.gateway, a.conn);
    await started.promise;
    await send(f.gateway, a.conn, { t: 'leave' });
    response.resolve(ticket());
    await pending;
    expect(f.chain.activateSession).not.toHaveBeenCalled();
    expect(a.conn.player).toBeNull();
    expect(f.journal.live()).toHaveLength(0);
  });

  it('rejects an activated ticket with no live player rather than minting its original value again', async () => {
    const f = fixture();
    f.chain.getSession = async () => ({ ...ticket(), activated: true });
    const a = client();
    await join(f.gateway, a.conn);
    expect(a.messages).toContainEqual(expect.objectContaining({ t: 'error', code: 'no_session' }));
    expect(f.chain.activateSession).not.toHaveBeenCalled();
    expect(f.journal.live()).toHaveLength(0);
  });

  it('discards a delayed auth response after logout', async () => {
    const f = fixture();
    const profile = deferred<null>();
    f.chain.getProfile = vi.fn(() => profile.promise);
    const a = client(null);
    const pending = send(f.gateway, a.conn, { t: 'auth', token: f.auth.issueToken('11111111111111111111111111111111') });
    expect(f.chain.getProfile).toHaveBeenCalledTimes(1);
    await send(f.gateway, a.conn, { t: 'logout' });
    profile.resolve(null);
    await pending;
    expect(a.conn.wallet).toBeNull();
    expect(a.messages.some((m) => m.t === 'authed')).toBe(false);
  });

  it('replays confirmed receipts only after wallet authentication with their exact session identity', async () => {
    const f = fixture();
    const wallet = '11111111111111111111111111111111';
    vi.spyOn(f.journal, 'receiptsFor').mockImplementation((owner) => owner === wallet ? [{ key: 'old-ticket', player: wallet,
      kind: 'settle', signature: 'confirmed-signature', payout: 12_000_000, sessionId: 7, arenaId: 1, settledAt: Date.now() }] : []);
    const a = client(null);
    await send(f.gateway, a.conn, { t: 'auth', token: f.auth.issueToken(wallet) });
    expect(a.messages.map((m) => m.t)).toEqual(['authed', 'settled']);
    expect(a.messages[1]).toMatchObject({ signature: 'confirmed-signature', payout: 12_000_000, sessionId: 7, arenaId: 1 });
  });
});

import type { ClientMessage, RoomInfo, ServerMessage } from '@elymum/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine without a canvas renderer or a real socket: the test drives the server side.
vi.mock('../src/render/renderer', () => ({
  Renderer: class {
    levels = [{ dpr: 1, low: false }];
    autoLow = false;
    resize() {}
    setLevel() {}
    draw() {}
    drawMinimap() {}
    lookFor() {
      return {};
    }
  },
}));
const net = vi.hoisted(() => ({ open: true, sent: [] as unknown[], handlers: null as null | { onMessage(m: unknown): void } }));
vi.mock('../src/game/net', () => ({
  Net: class {
    rtt = 0;
    constructor(_url: string, handlers: { onMessage(m: unknown): void }) {
      net.handlers = handlers;
    }
    connect() {}
    close() {}
    get open() {
      return net.open;
    }
    send(msg: unknown) {
      if (net.open) net.sent.push(msg);
    }
    sendBinary() {}
  },
}));

const { GameEngine } = await import('../src/game/engine');
const { HELD_JITTER_MS, HELD_MAX_ATTEMPTS, HELD_RETRY_MS } = await import('../src/game/held');
const { serverClock } = await import('../src/game/clock');
const { useUi } = await import('../src/store');

const T = 1_800_000_000_000; // a round boundary (5-minute rounds)
const OPENS = T + 300_000;
const ARENA: RoomInfo = { id: 'arena-1-1', mode: 'arena', name: 'Penny Pond', width: 6400, height: 6400, players: 1, bots: 0, maxPlayers: 50, arenaId: 1, entryFee: 1, round: { n: T / 300_000, endsAt: OPENS, joinsCloseAt: OPENS - 60_000 } };
// jsdom has no canvas: the same null it returns, without the "not implemented" warning
HTMLCanvasElement.prototype.getContext = (() => null) as never;
const initial = useUi.getState();

let engine: InstanceType<typeof GameEngine>;
const recv = (m: Partial<ServerMessage> & { t: string }) => net.handlers!.onMessage(m);
const joins = () => (net.sent as ClientMessage[]).filter((m) => m.t === 'join');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(OPENS - 40_000); // the final minute: joins are closed
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  serverClock.reset();
  // a returning player: the first-play brief does not hold the join
  localStorage.setItem('elymum.brief', '1');
  net.open = true;
  net.sent = [];
  useUi.setState({ ...initial, rooms: [ARENA], screen: 'lobby' }, true);
  engine = new GameEngine(document.createElement('canvas'));
  recv({ t: 'welcome', v: 1, serverTime: Date.now(), serverNow: Date.now(), rooms: [ARENA], chain: initial.chain as never, online: 1 });
  net.sent = [];
});
afterEach(() => {
  engine.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useUi.setState(initial, true);
});

/** Buys in during the closed window: the server refuses with round_closed. */
function refusedJoin() {
  engine.play('arena:1');
  expect(joins()).toHaveLength(1);
  recv({ t: 'error', code: 'round_closed', message: 'closed', opensAt: OPENS });
}

describe('held ticket in the engine', () => {
  it('round_closed holds the ticket; the same join goes out once the round opens; joined clears it', () => {
    refusedJoin();
    expect(useUi.getState().held).toEqual({ arenaId: 1, opensAt: OPENS });
    expect(useUi.getState().toasts).toEqual([]); // not an error
    vi.advanceTimersByTime(40_000 + 0.5 * HELD_JITTER_MS - 1);
    expect(joins()).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(joins()).toHaveLength(2);
    expect(joins()[1]).toMatchObject({ t: 'join', room: 'arena:1' });
    recv({ t: 'joined', room: { ...ARENA }, playerId: 7, name: 'Daphne', skin: 0, value: 1, entryFee: 1, session: 'S' });
    expect(useUi.getState().held).toBeNull();
    expect(useUi.getState().screen).toBe('playing');
  });

  it('a repeated round_closed (server clock behind) asks again shortly, then gives up after the cap', () => {
    refusedJoin();
    vi.advanceTimersByTime(40_000 + HELD_JITTER_MS);
    expect(joins()).toHaveLength(2);
    // the server still says closed: re-held, next try after the retry gap
    recv({ t: 'error', code: 'round_closed', message: 'closed', opensAt: OPENS });
    expect(useUi.getState().held).not.toBeNull();
    vi.advanceTimersByTime(HELD_RETRY_MS + HELD_JITTER_MS);
    expect(joins()).toHaveLength(3);
    for (let i = 3; i <= HELD_MAX_ATTEMPTS; i++) {
      recv({ t: 'error', code: 'round_closed', message: 'closed', opensAt: OPENS });
      vi.advanceTimersByTime(HELD_RETRY_MS + HELD_JITTER_MS);
    }
    expect(joins()).toHaveLength(1 + HELD_MAX_ATTEMPTS);
    recv({ t: 'error', code: 'round_closed', message: 'closed', opensAt: OPENS });
    expect(useUi.getState().held).toBeNull();
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'warn', text: expect.stringContaining('Resume') });
    vi.advanceTimersByTime(60_000);
    expect(joins()).toHaveLength(1 + HELD_MAX_ATTEMPTS);
  });

  it('a held join refused for another reason lets go (after the quiet no_session retries)', () => {
    refusedJoin();
    vi.advanceTimersByTime(40_000 + HELD_JITTER_MS);
    expect(joins()).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      recv({ t: 'error', code: 'no_session', message: 'none' });
      expect(useUi.getState().held).not.toBeNull();
      vi.advanceTimersByTime(1500);
    }
    expect(joins()).toHaveLength(4);
    recv({ t: 'error', code: 'no_session', message: 'none' });
    expect(useUi.getState().held).toBeNull();
    expect(useUi.getState().toasts.at(-1)?.kind).toBe('error');
  });

  it('an unrelated error before the opening does not drop the hold', () => {
    refusedJoin();
    recv({ t: 'error', code: 'rate_limited', message: 'chat' });
    expect(useUi.getState().held).not.toBeNull();
  });

  it('never pulls a player out of a practice game: the hold lets go and says so', () => {
    refusedJoin();
    useUi.setState({ screen: 'playing', room: { ...ARENA, id: 'practice-rookie-1', mode: 'practice', arenaId: undefined, round: undefined } });
    vi.advanceTimersByTime(40_000 + HELD_JITTER_MS);
    expect(joins()).toHaveLength(1);
    expect(useUi.getState().held).toBeNull();
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'info', text: expect.stringContaining('Resume') });
  });

  it('a join lost with the socket goes again after the next welcome', () => {
    refusedJoin();
    net.open = false;
    vi.advanceTimersByTime(40_000 + HELD_JITTER_MS);
    expect(joins()).toHaveLength(1);
    expect(useUi.getState().held).not.toBeNull();
    net.open = true;
    recv({ t: 'welcome', v: 1, serverTime: Date.now(), serverNow: Date.now(), rooms: [ARENA], chain: initial.chain as never, online: 1 });
    vi.advanceTimersByTime(HELD_RETRY_MS + HELD_JITTER_MS);
    expect(joins().filter((j) => (j as { room: string }).room === 'arena:1')).toHaveLength(2);
  });

  it('round_ended clears a hold', () => {
    refusedJoin();
    recv({ t: 'error', code: 'round_ended', message: 'away' });
    expect(useUi.getState().held).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(joins()).toHaveLength(1);
  });
});

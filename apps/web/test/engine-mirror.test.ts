import { EntityKind, encodeSnapshot, type RoomInfo, type ServerMessage, type SnapshotData } from '@elymum/shared';
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
const net = vi.hoisted(() => ({ open: true, sent: [] as unknown[], handlers: null as null | { onMessage(m: unknown): void; onSnapshot(b: ArrayBuffer): void } }));
vi.mock('../src/game/net', () => ({
  Net: class {
    rtt = 0;
    constructor(_url: string, handlers: { onMessage(m: unknown): void; onSnapshot(b: ArrayBuffer): void }) {
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
const { useUi } = await import('../src/store');

// jsdom has no canvas: the same null it returns, without the "not implemented" warning
HTMLCanvasElement.prototype.getContext = (() => null) as never;
const initial = useUi.getState();
const POND = (id: string): RoomInfo => ({ id, mode: 'practice', league: 'rookie', name: id, width: 6800, height: 6800, players: 1, bots: 8, maxPlayers: 40 });
const A = POND('practice-rookie-1');
const B = POND('practice-rookie-2');

let engine: InstanceType<typeof GameEngine>;
const recv = (m: Partial<ServerMessage> & { t: string }) => net.handlers!.onMessage(m);
const welcome = () => recv({ t: 'welcome', v: 1, serverTime: Date.now(), serverNow: Date.now(), rooms: [A, B], chain: initial.chain as never, online: 1 });
/** A snapshot with a frozen-looking bot cluster (cells 100..103 of player 9) and a coin. */
const snapshot = (): ArrayBuffer => {
  const s: SnapshotData = {
    tick: 1,
    view: { x: 1000, y: 1000, h: 1200 },
    players: [{ id: 9, skin: 1, flags: 0, name: 'jakeyboy', isBot: true }],
    upserts: [
      ...[0, 1, 2, 3].map((i) => ({ id: 100 + i, kind: EntityKind.Cell, x: 1000 + i * 90, y: 1000, r: 160, playerId: 9, flags: 0 })),
      { id: 200, kind: EntityKind.Food, x: 900, y: 900, r: 10, variant: 1 },
    ],
    removals: [],
  };
  return encodeSnapshot(s);
};
const joined = (room: RoomInfo, playerId = 7) => recv({ t: 'joined', room, playerId, name: 'Daphne', skin: 0 });

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  localStorage.setItem('elymum.brief', '1');
  net.open = true;
  net.sent = [];
  useUi.setState({ ...initial, rooms: [A, B], screen: 'lobby' }, true);
  engine = new GameEngine(document.createElement('canvas'));
  welcome();
});
afterEach(() => {
  engine.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useUi.setState(initial, true);
});

describe('engine: the world mirror starts afresh with the server view', () => {
  it('lobby (watching room A) → joined room B: nothing of room A stays as a ghost', () => {
    recv({ t: 'spectating', room: A, targetPid: 9 });
    net.handlers!.onSnapshot(snapshot());
    expect(engine.world.entities.size).toBe(5);
    joined(B);
    expect(engine.world.entities.size).toBe(0);
    expect(engine.world.players.size).toBe(0);
    expect(engine.world.myPid).toBe(7);
  });

  it('joined again in the same room (play again after the lobby) and a fresh spectating clear it too', () => {
    joined(A);
    net.handlers!.onSnapshot(snapshot());
    expect(engine.world.entities.size).toBe(5);
    recv({ t: 'spectating', room: A, targetPid: 9 });
    expect(engine.world.entities.size).toBe(0);
    net.handlers!.onSnapshot(snapshot());
    joined(A, 8);
    expect(engine.world.entities.size).toBe(0);
    expect(engine.world.myPid).toBe(8);
  });

  it('a new socket (welcome after a reconnect) clears it: the new connection starts with an empty view', () => {
    joined(A);
    net.handlers!.onSnapshot(snapshot());
    welcome();
    expect(engine.world.entities.size).toBe(0);
  });

  it('a reconnect out of a free game goes back to the lobby with nothing of that game left over', () => {
    joined(A);
    useUi.setState({ chatOpen: true, powerups: [{ type: 1 as never, until: Date.now() + 9000 }] });
    welcome();
    const s = useUi.getState();
    expect(s.screen).toBe('lobby');
    // the open chat line would otherwise pop up over the next game
    expect(s.chatOpen).toBe(false);
    expect(s.powerups).toEqual([]);
  });
});

describe('engine: snapshots with no frame in between', () => {
  /** A one-food snapshot: food `id` upserted, or removed (eaten by nobody: it left the view). */
  const food = (tick: number, id: number, remove = false): ArrayBuffer =>
    encodeSnapshot({
      tick,
      view: { x: 1000, y: 1000, h: 1200 },
      players: [],
      upserts: remove ? [] : [{ id, kind: EntityKind.Food, x: 900 + tick, y: 900, r: 10, variant: 1 }],
      removals: remove ? [{ id, eaterId: 0 }] : [],
    });
  let clock = 0;
  beforeEach(() => {
    clock = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  it('after the bell freeze, the held (older) snapshots go before a newer one: no ghost comes back', () => {
    joined(A);
    recv({ t: 'roundOver', round: 1, payout: 0, stats: null as never, standings: [] });
    // held during the freeze: the food moves
    net.handlers!.onSnapshot(food(1, 300));
    clock += 3000;
    // the freeze is over; before any frame, a newer snapshot says the food left the view
    net.handlers!.onSnapshot(food(2, 300, true));
    // the next frame thaws whatever is still held
    (engine as unknown as { thaw(): void }).thaw();
    const e = engine.world.entities.get(300);
    expect(!e || e.dying > 0).toBe(true);
  });

  it('a hidden tab (no frames) still lets go of what left the view', () => {
    clock += 5000;
    for (let i = 0; i < 50; i++) {
      net.handlers!.onSnapshot(food(10 + i, 1000 + i));
      clock += 100;
      net.handlers!.onSnapshot(food(10 + i, 1000 + i, true));
      clock += 100;
    }
    // without frames every gone food would stay in the mirror, and every eat in its queue
    expect(engine.world.entities.size).toBeLessThan(10);
  });
});


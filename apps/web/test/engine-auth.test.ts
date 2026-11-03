import type { ServerMessage } from '@elymum/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine without a canvas renderer or a real socket: the test plays the server.
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
const net = vi.hoisted(() => ({ sent: [] as { t: string; token?: string }[], handlers: null as null | { onMessage(m: unknown): void } }));
vi.mock('../src/game/net', () => ({
  Net: class {
    rtt = 0;
    constructor(_url: string, handlers: { onMessage(m: unknown): void }) {
      net.handlers = handlers;
    }
    connect() {}
    close() {}
    get open() {
      return true;
    }
    send(msg: { t: string }) {
      net.sent.push(msg);
    }
    sendBinary() {}
  },
}));

const { GameEngine } = await import('../src/game/engine');
const { setLocale } = await import('../src/i18n');
const { default: tr } = await import('../src/i18n/locales/tr');
const { useUi } = await import('../src/store');

HTMLCanvasElement.prototype.getContext = (() => null) as never;
const initial = useUi.getState();
const ADDR = '0x00000000000000000000000000000000000000A1';
const STALE = `${ADDR}.1.stale`;
const recv = (m: Partial<ServerMessage> & { t: string }) => net.handlers!.onMessage(m);
const welcome = () => recv({ t: 'welcome', v: 1, serverTime: Date.now(), serverNow: Date.now(), rooms: [], chain: null as never, online: 1 });
const authFailed = () => recv({ t: 'error', code: 'auth_failed', message: 'Wallet sign-in failed. Please sign again.' });

let engine: InstanceType<typeof GameEngine>;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  net.sent = [];
  localStorage.clear();
  useUi.setState({ ...initial, screen: 'lobby' }, true);
});
afterEach(() => {
  engine.destroy();
  vi.unstubAllGlobals();
  useUi.setState(initial, true);
  localStorage.clear();
});

describe('a session token the server refuses', () => {
  it('signs the lobby out and forgets the stored token (the /play gate handed it over)', () => {
    localStorage.setItem('elymum.auth.v1', JSON.stringify({ address: ADDR, token: STALE, exp: Date.now() + 3600_000 }));
    useUi.setState({ auth: { address: ADDR, token: STALE, profile: null } });
    engine = new GameEngine(document.createElement('canvas'));
    welcome();
    expect(net.sent.find((m) => m.t === 'auth')?.token).toBe(STALE);
    authFailed();
    expect(useUi.getState().auth).toBeNull();
    expect(localStorage.getItem('elymum.auth.v1')).toBeNull();
    // the wallet hook now finds no token and no session: the lobby offers "Sign in"
    expect(GameEngine.storedToken(ADDR)).toBeNull();
  });

  it('keeps a session that was renewed meanwhile, and ignores a failed signature sign-in', () => {
    engine = new GameEngine(document.createElement('canvas'));
    welcome();
    engine.authToken(STALE);
    recv({ t: 'authed', address: ADDR, token: `${ADDR}.2.fresh`, profile: null });
    // a later failure (a signature sign-in, not this token) leaves the fresh session alone
    authFailed();
    expect(useUi.getState().auth?.token).toBe(`${ADDR}.2.fresh`);
    expect(GameEngine.storedToken(ADDR)).toBe(`${ADDR}.2.fresh`);
  });
});

describe('a custom room that closes', () => {
  it("says so in the interface language (the server's reason is English)", async () => {
    engine = new GameEngine(document.createElement('canvas'));
    welcome();
    await setLocale('tr', false);
    try {
      recv({ t: 'error', code: 'room_closed', message: 'The room creator closed this room.' });
      expect(useUi.getState().toasts.at(-1)?.text).toBe(tr['err.room_closed']);
      await setLocale('en', false);
      recv({ t: 'error', code: 'room_closed', message: 'The room creator closed this room.' });
      expect(useUi.getState().toasts.at(-1)?.text).toBe('The room creator closed this room.');
    } finally {
      await setLocale('en', false);
    }
  });
});

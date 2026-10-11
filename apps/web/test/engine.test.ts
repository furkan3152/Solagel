import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ChainStatus, type RoomInfo, type ServerMessage } from '@solagel/shared';
import type { NetHandlers } from '../src/game/net';

const mocks = vi.hoisted(() => ({ send: vi.fn(), sendBinary: vi.fn(), handlers: null as NetHandlers | null, open: true }));
vi.mock('../src/config', () => ({ SERVER: { ws: 'ws://localhost/ws' } }));
vi.mock('../src/game/net', () => ({
  Net: class {
    constructor(_url: string, handlers: NetHandlers) { mocks.handlers = handlers; }
    get open() { return mocks.open; }
    send = mocks.send;
    sendBinary = mocks.sendBinary;
    connect() {}
    close() {}
  },
}));
vi.mock('../src/render/renderer', () => ({ Renderer: class { resize() {} } }));
vi.mock('../src/game/input', () => ({ Input: class { destroy() {} } }));
vi.mock('../src/game/sound', () => ({ sound: { unlock() {}, setVolume() {}, cashout() {}, death() {} } }));

import { GameEngine } from '../src/game/engine';
import { useUi } from '../src/store';

const chain = { enabled: true, stakeEnabled: true, cluster: 'devnet', programId: 'program', rpcUrl: null, currentSeason: 1 } as ChainStatus;
const room: RoomInfo = { id: 'stake-1', name: 'SOL Arena', mode: 'stake', width: 5600, height: 5600, players: 1, bots: 0, maxPlayers: 100, arenaId: 1, buyIn: 1_000_000 };
const welcome = { t: 'welcome', v: PROTOCOL_VERSION, serverTime: 0, rooms: [room], chain, online: 1 } satisfies ServerMessage;
const send = (message: ServerMessage) => mocks.handlers!.onMessage(message);
const join = (sessionId = 10) => send({ t: 'joined', room, playerId: 7, name: 'Coinie', skin: 0, value: 1_000_000, arenaId: 1, sessionId });

describe('paid game client flow', () => {
  let engine: GameEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
    useUi.setState(useUi.getInitialState(), true);
    useUi.setState({ auth: { pubkey: 'wallet-a', token: 'token-a', profile: null } });
    mocks.open = true;
    mocks.send.mockClear();
    engine = new GameEngine({} as HTMLCanvasElement);
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('updates arena availability when the server enables or pauses paid entry', () => {
    send({ t: 'rooms', rooms: [room], online: 2, chain: { ...chain, stakeEnabled: false } });
    expect(useUi.getState().chain?.stakeEnabled).toBe(false);
    send({ t: 'rooms', rooms: [room], online: 2, chain });
    expect(useUi.getState().chain?.stakeEnabled).toBe(true);
  });

  it('reclaims paid cells only after authentication succeeds on the new connection', () => {
    join();
    mocks.handlers!.onClose();
    mocks.send.mockClear();
    send(welcome);
    expect(mocks.send).toHaveBeenCalledWith({ t: 'auth', token: 'token-a' });
    expect(mocks.send.mock.calls.some(([m]) => m.t === 'join')).toBe(false);
    send({ t: 'authed', pubkey: 'wallet-a', token: 'renewed', profile: null });
    expect(mocks.send).toHaveBeenCalledWith({ t: 'join', room: 'stake:1', name: 'Coinie', skin: 0 });
    expect(useUi.getState().screen).toBe('playing');
  });

  it.each(['auth_failed', 'no_session', 'session_busy'] as const)('returns to a usable lobby when resume fails: %s', (code) => {
    join();
    mocks.handlers!.onClose();
    send(welcome);
    if (code !== 'auth_failed') send({ t: 'authed', pubkey: 'wallet-a', token: 'renewed', profile: null });
    send({ t: 'error', code, message: 'The session could not be resumed.' });
    expect(useUi.getState().screen).toBe('lobby');
    expect(engine.world.myPid).toBeNull();
    expect(mocks.send).toHaveBeenCalledWith({ t: 'spectate' });
    if (code === 'auth_failed') expect(useUi.getState().auth).toBeNull();
  });

  it.each(['lobby', 'watch', 'spectate', 'play'] as const)('keeps paid cells visible when requesting %s', (action) => {
    join();
    mocks.send.mockClear();
    if (action === 'lobby') engine.backToLobby();
    if (action === 'watch') engine.watch();
    if (action === 'spectate') engine.spectate();
    if (action === 'play') engine.play('free');
    expect(mocks.send.mock.calls.map(([m]) => m.t)).toEqual(['cashout']);
    expect(useUi.getState().screen).toBe('playing');
    expect(engine.world.myPid).toBe(7);
    send({ t: 'cashout', state: 'started', ms: 10_000 });
    expect(useUi.getState().cashout.state).toBe('channel');
    send({ t: 'cashout', state: 'canceled' });
    expect(useUi.getState().screen).toBe('playing');
    expect(useUi.getState().cashout.state).toBe('idle');
    engine.backToLobby();
    send({ t: 'cashout', state: 'done', value: 1_000_000 });
    expect(useUi.getState().screen).toBe('cashedout');
    engine.backToLobby();
    expect(useUi.getState().screen).toBe('lobby');
  });

  it('resumes before requesting a cash-out selected while disconnected', () => {
    join();
    mocks.open = false;
    mocks.handlers!.onClose();
    mocks.send.mockClear();
    engine.backToLobby();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(useUi.getState().screen).toBe('playing');
    mocks.open = true;
    send(welcome);
    send({ t: 'authed', pubkey: 'wallet-a', token: 'renewed', profile: null });
    join();
    expect(mocks.send).toHaveBeenLastCalledWith({ t: 'cashout' });
  });

  it('defers wallet switches until paid cells have left the arena', () => {
    join();
    mocks.send.mockClear();
    engine.logout();
    engine.authToken('wallet-b-token');
    expect(mocks.send.mock.calls.map(([m]) => m.t)).toEqual(['cashout']);
    expect(useUi.getState().auth?.pubkey).toBe('wallet-a');
    send({ t: 'cashout', state: 'done', value: 1_000_000 });
    expect(mocks.send.mock.calls.slice(-2).map(([m]) => m)).toEqual([{ t: 'logout' }, { t: 'auth', token: 'wallet-b-token' }]);
    send({ t: 'authed', pubkey: 'wallet-b', token: 'wallet-b-renewed', profile: null });
    expect(useUi.getState().auth?.pubkey).toBe('wallet-b');
  });

  it('allows retrying a cash-out request if the server did not acknowledge it', () => {
    join();
    mocks.send.mockClear();
    engine.cashout();
    engine.cashout();
    expect(mocks.send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    engine.cashout();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('clears old receipts on join and rejects delayed receipts for other sessions or arenas', () => {
    useUi.setState({ lastSettlement: { kind: 'cashout', signature: 'old', payout: 10, at: Date.now() } });
    join(11);
    expect(useUi.getState().lastSettlement).toBeNull();
    send({ t: 'cashout', state: 'done', value: 1_000_000 });
    send({ t: 'settled', kind: 'cashout', signature: 'old-session', payout: 10, arenaId: 1, sessionId: 10 });
    send({ t: 'settled', kind: 'cashout', signature: 'other-arena', payout: 10, arenaId: 2, sessionId: 11 });
    send({ t: 'settled', kind: 'cashout', signature: 'unidentified', payout: 10 });
    send({ t: 'settled', kind: 'record', signature: 'practice' });
    expect(useUi.getState().lastSettlement).toBeNull();
    send({ t: 'settled', kind: 'cashout', signature: 'confirmed', payout: 1_000_000, arenaId: 1, sessionId: 11 });
    expect(useUi.getState().lastSettlement?.signature).toBe('confirmed');
  });

  it('accepts its receipt replay after reconnecting from the cash-out result screen', () => {
    join(11);
    send({ t: 'cashout', state: 'done', value: 1_000_000 });
    mocks.handlers!.onClose();
    mocks.send.mockClear();
    send(welcome);
    expect(mocks.send.mock.calls.some(([m]) => m.t === 'join')).toBe(false);
    send({ t: 'authed', pubkey: 'wallet-a', token: 'renewed', profile: null });
    send({ t: 'settled', kind: 'cashout', signature: 'replayed', payout: 1_000_000, arenaId: 1, sessionId: 11 });
    expect(useUi.getState().screen).toBe('cashedout');
    expect(useUi.getState().cashoutResult?.value).toBe(1_000_000);
    expect(useUi.getState().lastSettlement).toMatchObject({ signature: 'replayed', payout: 1_000_000 });
    join(12);
    send({ t: 'settled', kind: 'cashout', signature: 'replayed', payout: 1_000_000, arenaId: 1, sessionId: 11 });
    expect(useUi.getState().lastSettlement).toBeNull();
  });
});

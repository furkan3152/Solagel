import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net, type NetHandlers } from '../src/game/net';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  });

  constructor(_url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

describe('WebSocket lifecycle', () => {
  let handlers: NetHandlers;
  let net: Net;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    handlers = { onOpen: vi.fn(), onClose: vi.fn(), onMessage: vi.fn(), onSnapshot: vi.fn() };
    net = new Net('ws://localhost/ws', handlers, () => 'en');
  });

  afterEach(() => {
    net.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not reconnect after destruction during a retry delay', () => {
    net.connect();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].close();
    expect(handlers.onClose).toHaveBeenCalledOnce();
    net.close();
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale socket callbacks without disrupting the new connection', () => {
    net.connect();
    const old = FakeSocket.instances[0];
    old.open();
    old.close();
    vi.advanceTimersByTime(500);
    const current = FakeSocket.instances[1];
    current.open();
    old.onclose?.();
    old.onopen?.();
    old.onmessage?.({ data: JSON.stringify({ t: 'error', code: 'auth_failed', message: 'stale' }) });
    expect(net.open).toBe(true);
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
    expect(handlers.onClose).toHaveBeenCalledOnce();
    expect(handlers.onMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(current.send).toHaveBeenCalledTimes(2); // hello + ping
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('keeps only one connection and cancels a scheduled retry when connected manually', () => {
    net.connect();
    net.connect();
    expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.instances[0].close();
    net.connect();
    FakeSocket.instances[1].open();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('does not start a ping timer if the owner closes in its open callback', () => {
    handlers.onOpen = () => net.close();
    net.connect();
    FakeSocket.instances[0].open();
    expect(net.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

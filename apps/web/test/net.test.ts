import { afterEach, describe, expect, it, vi } from 'vitest';
import { Net } from '../src/game/net';

/** A stand-in socket: records every instance; the test closes them as the network would. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
});

describe('Net', () => {
  it('reconnects after a drop, but not once it was closed while the retry waited', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const net = new Net('ws://x/ws', { onOpen() {}, onClose() {}, onMessage() {}, onSnapshot() {} });
    net.connect();
    expect(FakeSocket.all).toHaveLength(1);
    // the network drops the socket: a retry is scheduled
    FakeSocket.all[0].close();
    vi.advanceTimersByTime(600);
    expect(FakeSocket.all).toHaveLength(2);
    // dropped again, and the engine is destroyed while the retry waits
    FakeSocket.all[1].close();
    net.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(2);
  });
});

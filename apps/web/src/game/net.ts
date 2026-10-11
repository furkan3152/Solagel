import { PROTOCOL_VERSION, decodeSnapshot, type ClientMessage, type ServerMessage, type SnapshotData } from '@solagel/shared';

export interface NetHandlers {
  onOpen(): void;
  onClose(): void;
  onMessage(msg: ServerMessage): void;
  onSnapshot(s: SnapshotData): void;
}

/** WebSocket with automatic reconnect, JSON + binary routing and ping. */
export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closedByUser = false;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  rtt = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: NetHandlers,
    private readonly lang: () => string,
  ) {}

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    this.clearTimers();
    this.closedByUser = false;
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws || this.closedByUser) return;
      this.retry = 0;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, lang: this.lang() });
      this.handlers.onOpen();
      if (this.ws !== ws || this.closedByUser) return;
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || this.closedByUser) return;
      if (typeof ev.data === 'string') {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') this.rtt = Math.max(0, performance.now() - msg.ts);
        this.handlers.onMessage(msg);
      } else {
        try {
          this.handlers.onSnapshot(decodeSnapshot(ev.data as ArrayBuffer));
        } catch (err) {
          console.warn('bad snapshot', err);
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.ws = null;
      this.handlers.onClose();
      if (!this.closedByUser && !this.ws) {
        const delay = Math.min(8000, 500 * 2 ** this.retry++);
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.closedByUser) this.connect();
        }, delay);
      }
    };
    ws.onerror = () => {
      if (this.ws === ws && !this.closedByUser) ws.close();
    };
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.open) this.ws!.send(buf);
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }
}

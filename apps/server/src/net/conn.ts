import type { ServerMessage } from '@solagel/shared';
import { WebSocket } from 'ws';
import type { ChainProfile } from '../chain/types';
import type { Player } from '../game/entities';
import { ViewState } from '../rooms/visibility';
import type { Room } from '../rooms/room';

let nextConnId = 1;

/** One WebSocket client. */
export class Conn {
  readonly id = nextConnId++;
  room: Room | null = null;
  player: Player | null = null;
  spectating = false;
  spectatePid: number | null = null;
  /** Last place the camera was (used while dead / spectating nobody). */
  lastCenter = { x: 0, y: 0 };
  aspect = 16 / 9;
  wallet: string | null = null;
  profile: ChainProfile | null = null;
  lang = 'en';
  helloed = false;
  joining = false;
  /** Name used for chat while dead/spectating after having played. */
  lastName: string | null = null;
  lastSkin = 0;
  lastChatAt = 0;
  lastEmoteAt = 0;
  readonly view = new ViewState();

  private tokens = 120;
  private lastRefill = Date.now();

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
  ) {}

  /** Token bucket: ~90 messages/s sustained, bursts up to 120. */
  allow(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(120, this.tokens + ((now - this.lastRefill) / 1000) * 90);
    this.lastRefill = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ServerMessage): void {
    if (this.open) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.open) this.ws.send(buf, { binary: true });
  }

  get buffered(): number {
    return this.ws.bufferedAmount;
  }
}

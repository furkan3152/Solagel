/**
 * The server's clock, as this browser sees it. Round times (`RoundInfo.endsAt`, `opensAt`)
 * are Unix ms on the server clock; a phone whose clock runs a few seconds off would show the
 * wrong countdown, so every `welcome` / `pong` carries `serverNow` and the client keeps an
 * offset. Of the recent samples the one with the shortest round trip wins (its half-RTT
 * guess is the tightest).
 */

interface Sample {
  offset: number;
  rtt: number;
}

/** Recent samples kept (a pong every 2 s: about half a minute). */
const KEEP = 16;
/** A sample without a measured round trip (`welcome`) counts as this slow. */
const UNKNOWN_RTT = 1000;

export class ServerClock {
  private samples: Sample[] = [];
  private best: Sample | null = null;

  constructor(private readonly local: () => number = () => Date.now()) {}

  /** A server timestamp received now; `rttMs` = the round trip of the message (null if unknown). */
  sync(serverNow: number, rttMs: number | null = null): void {
    if (!Number.isFinite(serverNow)) return;
    const rtt = rttMs !== null && Number.isFinite(rttMs) && rttMs >= 0 ? rttMs : UNKNOWN_RTT;
    const offset = serverNow + (rttMs !== null ? rtt / 2 : 0) - this.local();
    this.samples.push({ offset, rtt });
    if (this.samples.length > KEEP) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rtt <= a.rtt ? b : a));
  }

  /** Server clock minus local clock (ms); 0 before the first sample. */
  get offset(): number {
    return this.best?.offset ?? 0;
  }

  get synced(): boolean {
    return this.best !== null;
  }

  /** The server's Unix ms now. */
  now(): number {
    return this.local() + this.offset;
  }

  /** A server time as a local `Date.now()` time (timers). */
  toLocal(serverMs: number): number {
    return serverMs - this.offset;
  }

  reset(): void {
    this.samples = [];
    this.best = null;
  }
}

/** The one clock the app runs on (the engine feeds it). */
export const serverClock = new ServerClock();

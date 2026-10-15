import { useUi } from '../store';
import { serverClock } from './clock';

/** A held ticket joins this much after the round opens, at random (not every client on the bell). */
export const HELD_JITTER_MS = 400;
/** A refusal at (or after) the opening by our clock: the server's clock is a bit behind; ask again after this. */
export const HELD_RETRY_MS = 500;

export interface HeldDeps {
  /** Local `Date.now()` time of a server time. */
  toLocal: (serverMs: number) => number;
  now: () => number;
  random: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const defaults: HeldDeps = {
  toLocal: (ms) => serverClock.toLocal(ms),
  now: () => Date.now(),
  random: Math.random,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * A ticket bought (or resumed) while a round's joins were closed (`round_closed` + `opensAt`).
 * The ticket is not lost: the store shows it as held ("Ticket held — next round in 0:41") and
 * the same join goes out by itself once the next round opens, 0–400 ms after the bell at
 * random so a crowd of held tickets does not hit the server on the same millisecond.
 */
export class HeldTicket {
  private timer: unknown = null;

  constructor(
    /** Sends the join again. */
    private readonly join: (room: string, pass: string | null) => void,
    /** False when the player is already in an arena game by then (another tab, a reconnect). */
    private readonly wanted: () => boolean,
    private readonly deps: HeldDeps = defaults,
  ) {}

  hold(room: string, pass: string | null, opensAt: number): void {
    const arenaId = Number(room.slice('arena:'.length));
    this.cancel();
    useUi.setState({ held: { arenaId, opensAt } });
    const until = this.deps.toLocal(opensAt) - this.deps.now();
    const wait = (until > 0 ? until : HELD_RETRY_MS) + this.deps.random() * HELD_JITTER_MS;
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      const held = useUi.getState().held;
      if (!held || held.arenaId !== arenaId || !this.wanted()) return;
      this.join(room, pass);
    }, wait);
  }

  /** Drops the automatic join (the ticket joined, or there is nothing to hold any more). */
  clear(): void {
    this.cancel();
    if (useUi.getState().held) useUi.setState({ held: null });
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }
}

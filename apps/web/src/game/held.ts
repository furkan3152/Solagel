import { useUi } from '../store';
import { serverClock } from './clock';

/**
 * A held ticket joins this much after the round opens, at random: a crowd of held tickets
 * must not hit the server (and its chain reads) on the same millisecond.
 */
export const HELD_JITTER_MS = 1500;
/** A refusal at (or after) the opening by our clock: the server's clock is a bit behind; ask again after this. */
export const HELD_RETRY_MS = 500;
/** Joins a held ticket may try (each `round_closed` or reconnect counts); then it lets go. */
export const HELD_MAX_ATTEMPTS = 5;

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
  random: () => Math.random(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Why a held ticket let go (the engine tells the player what to do next). */
export type ReleaseReason = 'busy' | 'gaveUp';

export interface HeldHooks {
  /** Sends the join. Returns false when it could not go out (the socket is down): the hold waits for `rearm`. */
  join(room: string): boolean;
  /**
   * Whether the player is free to be moved into the arena now: only from the lobby (or a
   * results / watch screen), never out of a game they are playing (practice included).
   */
  free(): boolean;
  /** The hold let go without joining; the ticket stays open on chain ("Resume" in the lobby). */
  released(reason: ReleaseReason): void;
}

/**
 * A ticket bought (or resumed) while a round's joins were closed (`round_closed` + `opensAt`).
 * The ticket is not lost: the store shows it as held ("Ticket held — next round in 0:41") and
 * the same join goes out by itself once the next round opens. The hold never sticks: it ends
 * when the join lands (`clear` on `joined`), when the join is refused for any other reason
 * (`refused`), when the player is busy in a game at the opening, or after
 * `HELD_MAX_ATTEMPTS` tries. A join that could not be sent (socket down) waits for `rearm`
 * on the next `welcome`.
 */
export class HeldTicket {
  private timer: unknown = null;
  private job: { room: string; opensAt: number; attempts: number } | null = null;
  /** A held join is out and not answered yet. */
  private sent = false;

  constructor(
    private readonly hooks: HeldHooks,
    private readonly deps: HeldDeps = defaults,
  ) {}

  /** A held join went out and its answer is pending (an error now belongs to it). */
  get inFlight(): boolean {
    return this.sent;
  }

  /** Joins were closed: hold (or keep holding) this ticket until `opensAt` (server clock). */
  hold(room: string, opensAt: number): void {
    const arenaId = Number(room.slice('arena:'.length));
    const attempts = this.job && this.job.room === room ? this.job.attempts : 0;
    this.cancel();
    if (attempts >= HELD_MAX_ATTEMPTS) {
      this.release('gaveUp');
      return;
    }
    this.job = { room, opensAt, attempts };
    useUi.setState({ held: { arenaId, opensAt } });
    this.schedule();
  }

  /** The socket is back (`welcome`): a hold whose join was lost (or still waiting) is scheduled again. */
  rearm(): void {
    if (!this.job) return;
    this.cancel();
    this.schedule();
  }

  /** A held join was refused for a reason other than `round_closed`: let go. */
  refused(): void {
    if (this.sent) this.clear();
  }

  /** Drops the hold (the ticket joined, or there is nothing to hold any more). */
  clear(): void {
    this.cancel();
    this.job = null;
    if (useUi.getState().held) useUi.setState({ held: null });
  }

  private release(reason: ReleaseReason): void {
    this.clear();
    this.hooks.released(reason);
  }

  private schedule(): void {
    const job = this.job!;
    const until = this.deps.toLocal(job.opensAt) - this.deps.now();
    const wait = (until > 0 ? until : HELD_RETRY_MS) + this.deps.random() * HELD_JITTER_MS;
    this.timer = this.deps.setTimeout(() => this.fire(), wait);
  }

  private fire(): void {
    this.timer = null;
    const job = this.job;
    const held = useUi.getState().held;
    if (!job) return;
    if (!held || held.arenaId !== Number(job.room.slice('arena:'.length))) {
      this.clear();
      return;
    }
    if (!this.hooks.free()) {
      this.release('busy');
      return;
    }
    job.attempts++;
    if (this.hooks.join(job.room)) this.sent = true;
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
    this.sent = false;
  }
}

import type { RoundState } from './round';

/** What the round clock sounds like (the engine wires these to the sfx kit and the announcer). */
export interface RoundCueSink {
  /** A soft tick each second of the last ten. */
  tick(secondsLeft: number): void;
  /** The bell at the round end. */
  bell(round: number): void;
  say(line: 'oneMinute' | 'tenSeconds' | 'countdown' | 'roundOver'): void;
  /** The final minute is on (the music's tension layer) or over (the bell, a new round, gone). */
  tension?(on: boolean): void;
}

/** Spoken at one minute left: when the final minute starts (joins close). */
const ONE_MINUTE_MS = 60_000;
const TEN_SECONDS_MS = 10_000;
/** "Three! Two! One!" starts here (its words land on 3, 2 and 1). */
const COUNTDOWN_MS = 3_000;
/**
 * A cue fires only when the clock moved on smoothly across it (frame to frame); after a hidden
 * tab or a clock correction the clock jumps, and a late "Ten seconds." would be wrong.
 */
const MAX_STEP_MS = 1500;

/**
 * Turns the round clock into sound cues while a player is in an arena (playing, eaten or
 * watching): "One minute left." when the final minute starts, "Ten seconds." and a tick each
 * second of the last ten, "Three! Two! One!", then the bell and "Round over."; the music's
 * tension layer through the final minute. `update` runs every frame; the bell
 * rings once per round, whether the clock reaches it first or the server's `roundOver` does
 * (`ring`).
 */
export class RoundCues {
  private prev: { n: number; msLeft: number } | null = null;
  private rung = -1;
  private tense = false;

  constructor(private readonly sink: RoundCueSink) {}

  /** The round state of the arena on screen, or null when none is (the lobby, practice). */
  update(state: RoundState | null): void {
    const p = this.prev;
    this.prev = state ? { n: state.n, msLeft: state.msLeft } : null;
    this.setTension(!!state && state.msLeft > 0 && state.msLeft <= ONE_MINUTE_MS);
    if (!state || !p) return;
    if (state.n !== p.n) {
      // the clock rolled into the next round: the bell, if we watched the last seconds
      if (state.n === p.n + 1 && p.msLeft <= MAX_STEP_MS) this.ring(p.n);
      return;
    }
    if (p.msLeft - state.msLeft > MAX_STEP_MS || state.msLeft >= p.msLeft) return;
    const crossed = (at: number) => p.msLeft > at && state.msLeft <= at;
    if (crossed(ONE_MINUTE_MS)) this.sink.say('oneMinute');
    if (crossed(TEN_SECONDS_MS)) this.sink.say('tenSeconds');
    if (crossed(COUNTDOWN_MS)) this.sink.say('countdown');
    const s = Math.ceil(state.msLeft / 1000);
    // the tick lands as each of the last ten seconds begins (10, 9, ... 1 left)
    if (s >= 1 && s < 10 && Math.ceil(p.msLeft / 1000) > s) this.sink.tick(s);
    else if (crossed(TEN_SECONDS_MS)) this.sink.tick(10);
  }

  /** Rings the bell of `round` (once). */
  ring(round: number): void {
    if (round <= this.rung) return;
    this.rung = round;
    this.setTension(false);
    this.sink.bell(round);
    this.sink.say('roundOver');
  }

  private setTension(on: boolean): void {
    if (on === this.tense) return;
    this.tense = on;
    this.sink.tension?.(on);
  }
}

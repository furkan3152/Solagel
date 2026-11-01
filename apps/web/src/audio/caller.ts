import type { LineId } from './announcer';

/**
 * The play-by-play: turns what happens to my coin into effects and announcer lines. The engine
 * reports facts (a bite, a lost cell, my mass, my rank, being chased); this decides what is worth
 * a call. Lines go through the announcer, which still applies its cooldowns, so a call here is
 * a wish, not a promise. Nothing here speaks at a join or a death (turned off on purpose).
 *
 * - bites: the first of a life, then double / triple / multi (4+) within 4 s of each other;
 *   a bite of a coin near my own size is a big eat
 * - a big coin now (mass >= whale): once a life
 * - comeback: down to under 45 % of this life's best (from 200+), then back to 90 % of it
 * - leader: up to #1 of the room (with 3+ players); any other climb is a soft mallet
 * - danger: scared of a bigger coin, a whoosh at the start, "watch your back" if it lasts; the
 *   engine's "phew" (got away) is the escape line
 */

export interface CallerFx {
  chomp(size: number): void;
  danger(): void;
  rankUp(top: boolean): void;
  coinRain(): void;
  powerup(): void;
}

export const STREAK_MS = 4000;
/** A bite of a coin at least this big against my largest cell is a big eat. */
export const BIG_EAT_RATIO = 0.7;
export const BIG_EAT_MIN_R = 55;
export const COMEBACK_LOW = 0.45;
export const COMEBACK_BACK = 0.9;
export const COMEBACK_MIN_PEAK = 200;
/** Scared this long: "watch your back". */
export const CHASED_MS = 1400;

export type PowerUpKind = 'magnet' | 'push' | 'other';

export class Caller {
  private bites = 0;
  private streak = 0;
  private streakAt = -Infinity;
  private whale = false;
  private peak = 0;
  private down = false;
  private rank = 0;
  private scaredSince: number | null = null;
  private chasedSaid = false;

  constructor(
    private readonly say: (id: LineId) => boolean,
    private readonly fx: CallerFx,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** A new life (a join): every count starts again. Silent. */
  life(): void {
    this.bites = 0;
    this.streak = 0;
    this.streakAt = -Infinity;
    this.whale = false;
    this.peak = 0;
    this.down = false;
    this.scaredSince = null;
    this.chasedSaid = false;
  }

  /** My coin is gone (a death or the bell): no more calls about it. Silent. */
  end(): void {
    this.life();
    this.rank = 0;
  }

  /** A cell of mine ate a player's cell of radius `r`; `myR` is my largest cell. */
  bite(r: number, myR: number): void {
    const t = this.now();
    this.streak = t - this.streakAt < STREAK_MS ? this.streak + 1 : 1;
    this.streakAt = t;
    this.bites++;
    const size = myR > 0 ? Math.min(1, r / myR) : 0.3;
    this.fx.chomp(size);
    const big = r >= BIG_EAT_MIN_R && myR > 0 && r >= myR * BIG_EAT_RATIO;
    const streakLine: LineId | null = this.bites === 1 ? 'firstBite' : this.streak === 2 ? 'double' : this.streak === 3 ? 'triple' : this.streak === 4 ? 'multi' : null;
    // a streak of three or more is the bigger story; then a big eat; then the plain streak line
    if (streakLine && (streakLine === 'triple' || streakLine === 'multi')) {
      if (!this.say(streakLine) && big) this.say('bigEat');
    } else if (big) {
      if (!this.say('bigEat') && streakLine) this.say(streakLine);
    } else if (streakLine) this.say(streakLine);
  }

  /** My mass (a few times a second while playing). */
  mass(m: number, whaleMass: number): void {
    if (!this.whale && m >= whaleMass) {
      this.whale = true;
      this.say('whale');
    }
    if (m > this.peak && !this.down) this.peak = m;
    if (!this.down && this.peak >= COMEBACK_MIN_PEAK && m < this.peak * COMEBACK_LOW) this.down = true;
    else if (this.down && m >= this.peak * COMEBACK_BACK) {
      this.down = false;
      this.peak = m;
      this.say('comeback');
    }
  }

  /** My leaderboard rank (1 is the top; 0: not ranked) among `players`. */
  ranked(rank: number, players: number): void {
    const prev = this.rank;
    this.rank = rank;
    if (prev <= 0 || rank <= 0 || rank >= prev) return;
    const top = rank === 1 && players >= 3;
    this.fx.rankUp(top);
    if (top) this.say('leader');
  }

  /** Is a bigger coin after me right now? (Called while playing, a few times a second.) */
  threat(scared: boolean): void {
    const t = this.now();
    if (!scared) {
      this.scaredSince = null;
      this.chasedSaid = false;
      return;
    }
    if (this.scaredSince === null) {
      this.scaredSince = t;
      this.fx.danger();
      return;
    }
    if (!this.chasedSaid && t - this.scaredSince >= CHASED_MS) {
      this.chasedSaid = true;
      this.say('chased');
    }
  }

  /** Got away from a bigger coin that was after me (the engine's "phew"). */
  escaped(): void {
    this.say('escape');
  }

  coinRain(): void {
    this.fx.coinRain();
    this.say('coinRain');
  }

  /** A power-up of mine went off: its own line when it has one, else the generic one. */
  powerUp(kind: PowerUpKind): void {
    this.fx.powerup();
    if (kind === 'magnet') {
      if (!this.say('magnet')) this.say('powerUp');
    } else if (kind === 'push') {
      if (!this.say('push')) this.say('powerUp');
    } else this.say('powerUp');
  }
}

import type { Mixer } from './mixer';

/**
 * The effects kit: every sound is synthesized (oscillators and shaped noise),
 * so there are no files. Paper sounds (rustle, tick, punch, stamp, tear,
 * printer, envelope, seal) for the interface; soft eats, meaty chomps, pops,
 * whooshes and shimmers for the game. Levels sit well under the mixer's
 * −12 dBFS ceiling: loudest voices peak around 0.2 before the sfx bus (0.7)
 * and master (0.6).
 *
 * Busy moments stay clean: every game sound has its own rate limit, and a
 * voice cap counts the oscillators and noise grains still ringing. Small
 * sounds (food, coins) give way first (`low`: under 14 voices), game sounds
 * next (`mid`: under 26); the bell, chomps and payouts always play.
 */

export type StampKind = 'plain' | 'paid' | 'valid';
export type PinKind = 'info' | 'success' | 'error' | 'warn';
export type Tier = 'low' | 'mid' | 'high';

/** Allows at most one call per `gapMs` (hover ticks: 125 ms, so 8 per second). */
export function rateLimiter(gapMs: number, now: () => number = () => performance.now()): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < gapMs) return false;
    last = t;
    return true;
  };
}

/** Hover ticks: at most 8 per second (spec). */
export const HOVER_GAP_MS = 125;
/** Round countdown ticks: one per second at most (a late frame never doubles one). */
export const TICK_GAP_MS = 700;
/** Voices ringing at once above which a tier's sounds are skipped. */
export const VOICE_CAP: Record<Tier, number> = { low: 14, mid: 26, high: Infinity };
/** Minimum gap per game sound, ms. */
export const GAPS = {
  eat: 45,
  coin: 60,
  chomp: 60,
  split: 90,
  eject: 70,
  virus: 150,
  danger: 4000,
  rank: 1500,
  coinRain: 3000,
  powerup: 200,
} as const;
/** Food eaten within this of the last one climbs the little scale (ms). */
const COMBO_MS = 380;
/** C major pentatonic from G5 up: food eats walk up it while they keep coming. */
const EAT_STEPS = [784, 880, 1046, 1175, 1318, 1568, 1760, 2093];

interface ToneOpts {
  type?: OscillatorType;
  slideTo?: number;
  gain?: number;
  delay?: number;
  attack?: number;
}

interface NoiseOpts {
  type?: BiquadFilterType;
  q?: number;
  gain?: number;
  delay?: number;
  attack?: number;
  /** Start offset into the noise buffer (varies the grain). */
  offset?: number;
}

export class Sfx {
  private printing: AudioScheduledSourceNode[] = [];
  private lastPlayed = -Infinity;
  private readonly hoverOk: () => boolean;
  private readonly tickOk: () => boolean;
  private readonly gaps: Record<keyof typeof GAPS, () => boolean>;
  /** Context end times of the voices still ringing (the cap counts them). */
  private ends: number[] = [];
  private combo = { at: -Infinity, step: 0 };

  constructor(
    private readonly mixer: Mixer,
    private readonly now: () => number = () => performance.now(),
    private readonly random: () => number = Math.random,
  ) {
    this.hoverOk = rateLimiter(HOVER_GAP_MS, now);
    this.tickOk = rateLimiter(TICK_GAP_MS, now);
    this.gaps = Object.fromEntries(Object.entries(GAPS).map(([k, ms]) => [k, rateLimiter(ms, now)])) as Record<keyof typeof GAPS, () => boolean>;
  }

  /** Did any effect start in the last `ms`? (The generic click yields to a specific sound.) */
  playedWithin(ms: number): boolean {
    return this.now() - this.lastPlayed < ms;
  }

  /** Voices still ringing now. */
  busy(): number {
    const t = this.mixer.ctx?.currentTime ?? 0;
    if (this.ends.length) this.ends = this.ends.filter((e) => e > t);
    return this.ends.length;
  }

  /** May a game sound of `tier` start now (audible, under its rate limit and the voice cap)? */
  private may(gap: keyof typeof GAPS, tier: Tier): boolean {
    if (!this.mixer.input('sfx')) return false;
    if (this.busy() >= VOICE_CAP[tier]) return false;
    return this.gaps[gap]();
  }

  /* ── voices ─────────────────────────────────────────────────────── */

  private out(): { ctx: AudioContext; bus: GainNode } | null {
    const bus = this.mixer.input('sfx');
    const ctx = this.mixer.ctx;
    if (!bus || !ctx) return null;
    this.lastPlayed = this.now();
    return { ctx, bus };
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}): void {
    const io = this.out();
    if (!io) return;
    const { ctx, bus } = io;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this.ends.push(t + dur + 0.02);
  }

  private noise(dur: number, from: number, to: number, o: NoiseOpts = {}): AudioBufferSourceNode | null {
    const io = this.out();
    const buf = this.mixer.noise;
    if (!io || !buf) return null;
    const { ctx, bus } = io;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'bandpass';
    filter.Q.value = o.q ?? 1.4;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.15;
    if (o.attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + o.attack);
    } else g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(bus);
    const offset = o.offset ?? this.random() * (buf.duration - dur - 0.05);
    src.start(t, Math.max(0, offset), dur + 0.02);
    this.ends.push(t + dur + 0.02);
    return src;
  }

  /* ── interface: paper ───────────────────────────────────────────── */

  /** A soft paper tap: buttons and links. */
  click(): void {
    this.noise(0.035, 2600, 1800, { gain: 0.07, q: 1.1 });
    this.tone(1250 + this.random() * 120, 0.045, { type: 'sine', gain: 0.03 });
  }

  /** A pencil tick on hover (tickets, buttons): very quiet, at most 8 per second. */
  hover(): void {
    if (!this.mixer.input('sfx') || !this.hoverOk()) return;
    this.noise(0.016, 5200 + this.random() * 1400, 4200, { type: 'highpass', q: 0.7, gain: 0.025 });
  }

  /** Picking a ticket: a tick and a small paper lift. */
  select(): void {
    this.noise(0.03, 4200, 2600, { gain: 0.05 });
    this.tone(980, 0.06, { type: 'triangle', gain: 0.025, delay: 0.012 });
  }

  /** A punched-ticket switch: a click and a pitch up (on) or down (off). */
  toggle(on: boolean): void {
    this.noise(0.03, 3000, 1600, { gain: 0.08, q: 2 });
    this.tone(on ? 660 : 520, 0.07, { type: 'sine', slideTo: on ? 880 : 390, gain: 0.04, delay: 0.01 });
  }

  /** A page turn (lobby tabs): a rising rustle with a few crinkles. */
  rustle(dir: 1 | -1 = 1): void {
    this.noise(0.26, dir > 0 ? 1100 : 3600, dir > 0 ? 3600 : 1100, { gain: 0.07, q: 0.8, attack: 0.07 });
    for (let i = 0; i < 3; i++) this.noise(0.022, 3800 + this.random() * 2000, 2600, { gain: 0.035, delay: 0.05 + i * 0.05 + this.random() * 0.02 });
  }

  /** A sheet lifts off the table / settles back. */
  sheet(open: boolean): void {
    this.noise(0.2, open ? 900 : 2400, open ? 2400 : 800, { type: 'bandpass', gain: 0.045, q: 0.7, attack: 0.06 });
    if (!open) this.noise(0.04, 1200, 700, { gain: 0.04, delay: 0.17 });
  }

  /** The ticket punch: a sharp click, a low thunk and the chad falling. */
  punch(): void {
    this.noise(0.012, 6000, 4000, { gain: 0.12, q: 0.9 });
    this.tone(150, 0.09, { type: 'sine', slideTo: 70, gain: 0.16 });
    this.noise(0.05, 2400, 1200, { gain: 0.05, delay: 0.03 });
    this.noise(0.02, 5000, 3800, { gain: 0.03, delay: 0.16 });
  }

  /** A rubber stamp landing. PAID rings like a till, VALID double-taps. */
  stamp(kind: StampKind = 'plain'): void {
    const low = 115;
    this.tone(low, 0.16, { type: 'sine', slideTo: 55, gain: 0.2 });
    this.noise(0.08, 900, 280, { gain: 0.13 });
    if (kind === 'valid') {
      this.tone(low * 1.1, 0.1, { type: 'sine', slideTo: 60, gain: 0.1, delay: 0.11 });
      this.noise(0.05, 1100, 400, { gain: 0.06, delay: 0.11 });
    } else if (kind === 'paid') {
      this.tone(1568, 0.5, { type: 'sine', gain: 0.045, delay: 0.06 });
      this.tone(2093, 0.6, { type: 'sine', gain: 0.03, delay: 0.1 });
      this.mixer.duck(0.8);
    }
  }

  /** Paper torn along a perforation: a stuttering zip of noise. */
  tear(): void {
    const n = 9;
    for (let i = 0; i < n; i++) this.noise(0.03, 2800 + this.random() * 1600, 1800, { gain: 0.045 + (i / n) * 0.02, delay: i * 0.026, q: 1.6 });
  }

  /** Receipt printer chatter for `ms` (cash-out channel): line feeds every ~72 ms. */
  print(ms: number): void {
    this.stopPrint();
    const lines = Math.max(1, Math.floor(ms / 72));
    for (let i = 0; i < lines; i++) {
      const src = this.noise(0.035, 5200 + (i % 3) * 400, 2600, { gain: 0.03, delay: i * 0.072 });
      if (src) this.printing.push(src);
    }
  }

  stopPrint(): void {
    for (const src of this.printing) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.printing = [];
  }

  /** A paper whoosh for screen transitions: in (into the room) rises, out falls. */
  whoosh(dir: 'in' | 'out'): void {
    const up = dir === 'in';
    this.noise(0.55, up ? 400 : 2600, up ? 2600 : 380, { type: 'bandpass', q: 0.6, gain: 0.06, attack: 0.22 });
  }

  /** A toast pinned to the screen: a tape tick and a soft pop (errors lower). */
  pin(kind: PinKind = 'info'): void {
    this.noise(0.02, 4600, 3000, { gain: 0.045 });
    const f = kind === 'error' ? 330 : kind === 'warn' ? 440 : kind === 'success' ? 880 : 660;
    this.tone(f, 0.12, { type: 'sine', gain: 0.035, delay: 0.02, slideTo: kind === 'error' ? f * 0.85 : undefined });
    if (kind === 'success') this.tone(f * 1.5, 0.14, { type: 'sine', gain: 0.025, delay: 0.08 });
  }

  /* ── game ───────────────────────────────────────────────────────── */

  /** A token gain: a small bright coin clink. */
  coin(): void {
    if (!this.may('coin', 'low')) return;
    this.tone(1760, 0.08, { type: 'triangle', gain: 0.035 });
    this.tone(2637, 0.12, { type: 'sine', gain: 0.025, delay: 0.05 });
  }

  /**
   * Food: a very soft bloop. Eats that keep coming walk up a pentatonic scale (a little tune
   * instead of a buzz); a gold pellet adds a sparkle. Rate limited, the first to give way.
   */
  eat(gold = false): void {
    if (!this.may('eat', 'low')) return;
    const t = this.now();
    const c = this.combo;
    c.step = t - c.at < COMBO_MS ? Math.min(EAT_STEPS.length - 1, c.step + 1) : 0;
    c.at = t;
    const f = EAT_STEPS[c.step] * (1 + (this.random() - 0.5) * 0.01);
    this.tone(f * 0.8, 0.07, { type: 'sine', slideTo: f, gain: 0.022, attack: 0.004 });
    this.noise(0.012, 3800, 2600, { gain: 0.012, q: 1.2 });
    if (gold) {
      this.tone(f * 1.5, 0.14, { type: 'triangle', gain: 0.03, delay: 0.04 });
      this.tone(f * 2, 0.18, { type: 'sine', gain: 0.02, delay: 0.08 });
    }
  }

  /** Old name of `eat` (food pellets). */
  blip(gold = false): void {
    this.eat(gold);
  }

  /**
   * Eating a player: a meaty chomp. A jaw thump, two or three crunches, a gulp and a small coin
   * chime. `size` 0..1 (the victim against me) makes it lower and longer.
   */
  chomp(size = 0.3): void {
    if (!this.may('chomp', 'high')) return;
    const s = Math.min(1, Math.max(0, size));
    const low = 1 - 0.3 * s;
    this.tone(150 * low, 0.16 + 0.06 * s, { type: 'sine', slideTo: 52, gain: 0.17, attack: 0.003 });
    const bites = s > 0.5 ? 3 : 2;
    for (let i = 0; i < bites; i++) this.noise(0.032, 1500 * low, 480, { gain: 0.085 - i * 0.018, q: 1.1, delay: i * 0.038 });
    this.tone(330 * low, 0.13, { type: 'triangle', slideTo: 140 * low, gain: 0.055, delay: 0.09 + 0.02 * s, attack: 0.01 });
    this.tone(1046, 0.12, { type: 'triangle', gain: 0.035, delay: 0.17 });
    this.tone(1568, 0.16, { type: 'triangle', gain: 0.03, delay: 0.22 });
  }

  /** One of my cells eaten (not a death): a short squeak down. */
  ouch(): void {
    if (!this.may('chomp', 'mid')) return;
    this.tone(500, 0.22, { type: 'triangle', slideTo: 140, gain: 0.07 });
    this.noise(0.05, 1200, 500, { gain: 0.04 });
  }

  /** Split: a quick "fwip" up and two little pops. */
  split(): void {
    if (!this.may('split', 'mid')) return;
    this.noise(0.13, 600, 4200, { type: 'bandpass', q: 0.9, gain: 0.06, attack: 0.03 });
    this.tone(520, 0.05, { type: 'sine', slideTo: 790, gain: 0.045, delay: 0.07 });
    this.tone(620, 0.05, { type: 'sine', slideTo: 930, gain: 0.035, delay: 0.1 });
  }

  /** Tip / eject: a soft "pfft" and a drop. */
  eject(): void {
    if (!this.may('eject', 'mid')) return;
    this.noise(0.08, 2200, 900, { gain: 0.045, q: 1 });
    this.tone(620, 0.07, { type: 'sine', slideTo: 280, gain: 0.035, delay: 0.01 });
  }

  /** A virus popped on me: a pop, a sproing and a few flying bits. */
  virus(): void {
    if (!this.may('virus', 'mid')) return;
    this.noise(0.05, 1800, 700, { gain: 0.11, q: 0.9 });
    this.tone(160, 0.38, { type: 'sine', slideTo: 540, gain: 0.1, attack: 0.004 });
    this.tone(322, 0.3, { type: 'triangle', slideTo: 1080, gain: 0.03, delay: 0.01 });
    for (let i = 0; i < 4; i++) this.noise(0.015, 5200 + this.random() * 1500, 3500, { gain: 0.025, delay: 0.08 + i * 0.05 + this.random() * 0.02 });
  }

  /** Old name of `virus`. */
  boing(): void {
    this.virus();
  }

  /** A bigger coin is right behind me: a low whoosh and a double thump. Once every 4 s at most. */
  danger(): void {
    if (!this.may('danger', 'mid')) return;
    this.noise(0.7, 260, 1100, { type: 'bandpass', q: 0.8, gain: 0.06, attack: 0.35 });
    this.tone(72, 0.22, { type: 'sine', slideTo: 52, gain: 0.09, attack: 0.008 });
    this.tone(70, 0.22, { type: 'sine', slideTo: 50, gain: 0.07, delay: 0.27, attack: 0.008 });
  }

  /** Up the leaderboard: two mallet notes up; to the top: three and a sparkle. */
  rankUp(top = false): void {
    // reaching the top always rings (it often comes right after a climb); climbs are rate-limited
    const ok = top ? !!this.mixer.input('sfx') && this.busy() < VOICE_CAP.mid && (this.gaps.rank(), true) : this.may('rank', 'mid');
    if (!ok) return;
    const notes = top ? [784, 988, 1175] : [784, 988];
    notes.forEach((f, i) => {
      this.tone(f, 0.28, { type: 'sine', gain: 0.05, delay: i * 0.09, attack: 0.003 });
      this.tone(f * 3.93, 0.05, { type: 'sine', gain: 0.012, delay: i * 0.09, attack: 0.002 });
    });
    if (top) this.tone(2349, 0.4, { type: 'triangle', gain: 0.02, delay: 0.3 });
  }

  /** Power-up pickup: a sparkle up-sweep and a rising mallet arpeggio. */
  powerup(): void {
    if (!this.may('powerup', 'mid')) return;
    this.noise(0.3, 2000, 8000, { type: 'bandpass', q: 0.8, gain: 0.025, attack: 0.12 });
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', gain: 0.04, delay: i * 0.05 }));
    this.tone(2349, 0.3, { type: 'sine', gain: 0.018, delay: 0.22 });
  }

  /** A payout: a cascade of coins settling into a pile. */
  coinCascade(n = 14): void {
    for (let i = 0; i < n; i++) {
      const at = i * 0.045 + this.random() * 0.03;
      this.tone(1500 + this.random() * 1100, 0.07, { type: 'triangle', gain: 0.03 * (1 - i / (n * 1.6)), delay: at });
    }
    this.mixer.duck(1);
  }

  cashout(): void {
    this.coinCascade(10);
    this.tone(784, 0.4, { type: 'sine', gain: 0.06, delay: 0.5 });
    this.tone(1046, 0.5, { type: 'sine', gain: 0.06, delay: 0.62 });
    this.mixer.duck(1.6);
  }

  /**
   * The round's last seconds: a soft clock tick, a little brighter for the last three. Very
   * quiet (it sits under the game) and rate-limited to one per second.
   */
  roundTick(secondsLeft: number): void {
    if (!this.mixer.input('sfx') || !this.tickOk()) return;
    const last = secondsLeft <= 3;
    this.noise(0.014, 4600, 3200, { type: 'highpass', q: 0.8, gain: 0.03 });
    this.tone(last ? 1760 : 1320, 0.05, { type: 'triangle', gain: last ? 0.035 : 0.025, delay: 0.004 });
  }

  /**
   * The round bell: two strikes of a small brass bell (inharmonic partials, a long ring); the
   * music ducks under it.
   */
  bell(): void {
    const partials: [ratio: number, gain: number, dur: number][] = [
      [1, 0.09, 2.2],
      [2.01, 0.05, 1.6],
      [2.42, 0.035, 1.2],
      [3.03, 0.025, 0.9],
      [4.17, 0.015, 0.6],
    ];
    for (const [i, at] of [0, 0.34].entries()) {
      const soft = i === 0 ? 1 : 0.8;
      this.noise(0.03, 3600, 1800, { gain: 0.05 * soft, delay: at });
      for (const [ratio, gain, dur] of partials) this.tone(659 * ratio, dur, { type: 'sine', gain: gain * soft, delay: at, attack: 0.004 });
    }
    this.mixer.duck(2.2);
  }

  /** Coin rain: a shimmer of little bells falling over a second and a half, and a high sparkle. */
  coinRain(): void {
    if (!this.may('coinRain', 'mid')) return;
    this.noise(0.9, 6000, 9000, { type: 'bandpass', q: 0.7, gain: 0.02, attack: 0.4 });
    for (let i = 0; i < 12; i++) {
      const at = 0.05 + (i / 12) ** 0.85 * 1.4 + this.random() * 0.04;
      const f = 1800 + this.random() * 2400 - i * 60;
      this.tone(f, 0.16, { type: i % 2 ? 'sine' : 'triangle', gain: 0.022, delay: at, attack: 0.002 });
    }
    this.mixer.duck(0.8);
  }
}

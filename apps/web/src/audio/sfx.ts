import type { Mixer } from './mixer';

/**
 * The effects kit: every sound is synthesized (oscillators and shaped noise),
 * so there are no files. Paper sounds (rustle, tick, punch, stamp, tear,
 * printer, envelope, seal) for the interface; coins and chomps for the game.
 * Levels sit well under the mixer's −12 dBFS ceiling: loudest voices peak
 * around 0.3 before the sfx bus (0.7) and master (0.6).
 */

export type StampKind = 'plain' | 'paid' | 'valid' | 'eaten';
export type PinKind = 'info' | 'success' | 'error' | 'warn';

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
  private readonly blipOk: () => boolean;
  private readonly tickOk: () => boolean;

  constructor(
    private readonly mixer: Mixer,
    private readonly now: () => number = () => performance.now(),
    private readonly random: () => number = Math.random,
  ) {
    this.hoverOk = rateLimiter(HOVER_GAP_MS, now);
    this.blipOk = rateLimiter(55, now);
    this.tickOk = rateLimiter(TICK_GAP_MS, now);
  }

  /** Did any effect start in the last `ms`? (The generic click yields to a specific sound.) */
  playedWithin(ms: number): boolean {
    return this.now() - this.lastPlayed < ms;
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

  /** A rubber stamp landing. PAID rings like a till, VALID double-taps, EATEN is darker. */
  stamp(kind: StampKind = 'plain'): void {
    const low = kind === 'eaten' ? 90 : 115;
    this.tone(low, 0.16, { type: 'sine', slideTo: 55, gain: 0.2 });
    this.noise(0.08, 900, 280, { gain: 0.13 });
    if (kind === 'valid') {
      this.tone(low * 1.1, 0.1, { type: 'sine', slideTo: 60, gain: 0.1, delay: 0.11 });
      this.noise(0.05, 1100, 400, { gain: 0.06, delay: 0.11 });
    } else if (kind === 'paid') {
      this.tone(1568, 0.5, { type: 'sine', gain: 0.045, delay: 0.06 });
      this.tone(2093, 0.6, { type: 'sine', gain: 0.03, delay: 0.1 });
      this.mixer.duck(0.8);
    } else if (kind === 'eaten') {
      this.noise(0.12, 500, 200, { type: 'lowpass', q: 0.7, gain: 0.08, delay: 0.02 });
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

  /** A letter slides out of its envelope and the flap settles. */
  envelope(): void {
    this.noise(0.42, 700, 2200, { gain: 0.05, q: 0.6, attack: 0.12 });
    this.noise(0.06, 1400, 600, { gain: 0.05, delay: 0.4 });
  }

  /** A wax seal cracks: a crunchy knock and a few crumbs. */
  seal(): void {
    this.tone(180, 0.1, { type: 'triangle', slideTo: 90, gain: 0.12 });
    this.noise(0.07, 3200, 900, { gain: 0.11, q: 2.2 });
    for (let i = 0; i < 4; i++) this.noise(0.018, 4500 + this.random() * 2000, 3000, { gain: 0.03, delay: 0.09 + i * 0.045 + this.random() * 0.02 });
    this.mixer.duck(0.6);
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

  /** My coin lands on the paper (join / respawn). */
  drop(): void {
    this.tone(140, 0.12, { type: 'sine', slideTo: 80, gain: 0.12 });
    this.tone(1320, 0.18, { type: 'triangle', gain: 0.025, delay: 0.015 });
  }

  /** A payout: a cascade of coins settling into a pile. */
  coinCascade(n = 14): void {
    for (let i = 0; i < n; i++) {
      const at = i * 0.045 + this.random() * 0.03;
      this.tone(1500 + this.random() * 1100, 0.07, { type: 'triangle', gain: 0.03 * (1 - i / (n * 1.6)), delay: at });
    }
    this.mixer.duck(1);
  }

  /* ── game ───────────────────────────────────────────────────────── */

  /** A token gain: a small bright coin clink. */
  coin(): void {
    this.tone(1760, 0.08, { type: 'triangle', gain: 0.035 });
    this.tone(2637, 0.12, { type: 'sine', gain: 0.025, delay: 0.05 });
  }

  /** Food pellet: soft high blip (rate limited, random pitch). */
  blip(gold = false): void {
    if (!this.mixer.input('sfx') || !this.blipOk()) return;
    const base = gold ? 1320 : 880 + this.random() * 520;
    this.tone(base, 0.06, { type: 'triangle', slideTo: base * 1.5, gain: gold ? 0.07 : 0.025 });
    if (gold) this.tone(base * 1.5, 0.1, { type: 'sine', gain: 0.05, delay: 0.05 });
  }

  chomp(): void {
    this.tone(220, 0.12, { type: 'triangle', slideTo: 110, gain: 0.1 });
    this.noise(0.1, 1800, 600, { gain: 0.09 });
    this.tone(1046, 0.12, { type: 'triangle', gain: 0.05, delay: 0.06 });
    this.tone(1568, 0.16, { type: 'triangle', gain: 0.04, delay: 0.11 });
  }

  ouch(): void {
    this.tone(500, 0.25, { type: 'triangle', slideTo: 120, gain: 0.08 });
  }

  split(): void {
    this.noise(0.18, 400, 3200, { gain: 0.07 });
  }

  eject(): void {
    this.tone(700, 0.06, { type: 'sine', slideTo: 300, gain: 0.05 });
  }

  boing(): void {
    this.tone(180, 0.35, { type: 'sine', slideTo: 520, gain: 0.12 });
    this.noise(0.25, 2500, 300, { gain: 0.06 });
  }

  powerup(): void {
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', gain: 0.045, delay: i * 0.06 }));
  }

  death(): void {
    [523, 440, 349, 262].forEach((f, i) => this.tone(f, 0.24, { type: 'triangle', gain: 0.06, delay: i * 0.13 }));
    this.mixer.duck(1.4);
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

  coinRain(): void {
    for (let i = 0; i < 6; i++) this.tone(1568 + i * 120, 0.09, { type: 'triangle', gain: 0.035, delay: i * 0.07 });
    this.mixer.duck(0.8);
  }
}

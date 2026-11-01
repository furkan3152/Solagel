/**
 * The mixer: one AudioContext, three buses (music, sfx, voice) into a master
 * gain and a soft limiter that keeps every peak under −12 dBFS.
 *
 *   music loops   → [music bus] → [duck] ┐
 *   sfx voices    → [sfx bus]            ├→ [master] → [limiter] → speakers
 *   announcer     → [voice bus]          ┘                       └→ dev tap
 *
 * The context is created on the first user gesture (`unlock`), so nothing can
 * sound before the player has touched the page. Levels come from the persisted
 * settings (`prefsFromSettings`); the store does the persisting.
 */

export type Bus = 'music' | 'sfx' | 'voice';

export interface AudioPrefs {
  /** Master volume 0..1 (header mute is `muted`). */
  master: number;
  muted: boolean;
  music: number;
  musicOn: boolean;
  sfx: number;
  sfxOn: boolean;
  voice: number;
  /** The announcer. */
  voiceOn: boolean;
}

/** Quiet by default. */
export const AUDIO_DEFAULTS = { master: 0.6, music: 0.25, sfx: 0.7, voice: 0.5 } as const;

/** The settings fields the mixer reads (a subset of the store's `Settings`). */
export interface AudioSettingsLike {
  sound: boolean;
  volume: number;
  music?: number;
  musicOn?: boolean;
  sfx?: number;
  sfxOn?: boolean;
  voice?: number;
  announcer?: boolean;
}

const unit = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

export function prefsFromSettings(s: AudioSettingsLike): AudioPrefs {
  return {
    master: unit(s.volume, AUDIO_DEFAULTS.master),
    muted: !s.sound,
    music: unit(s.music, AUDIO_DEFAULTS.music),
    musicOn: s.musicOn !== false,
    sfx: unit(s.sfx, AUDIO_DEFAULTS.sfx),
    sfxOn: s.sfxOn !== false,
    voice: unit(s.voice, AUDIO_DEFAULTS.voice),
    voiceOn: s.announcer !== false,
  };
}

/** Peak ceiling of the limiter: −12 dBFS. */
export const CEILING = 10 ** (-12 / 20);
/** Music under announcer lines and big stingers: −6 dB. */
export const DUCK_GAIN = 10 ** (-6 / 20);
const DUCK_ATTACK = 0.08;
const DUCK_RELEASE = 0.6;

/**
 * Soft-knee limiter curve: linear up to the knee, then a tanh shoulder that
 * approaches `CEILING` and never passes it.
 */
export function limiterCurve(n = 2048, ceiling = CEILING, knee = ceiling * 0.7): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

type Ctor = () => AudioContext | null;

const defaultCtor: Ctor = () => {
  if (typeof window === 'undefined') return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return C ? new C({ latencyHint: 'interactive' }) : null;
};

export class Mixer {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: WaveShaperNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private duckNode: GainNode | null = null;
  private tapNode: MediaStreamAudioDestinationNode | null = null;
  /** One second of white noise shared by every noise voice. */
  noise: AudioBuffer | null = null;
  /** A user gesture has happened: sounds may play. */
  unlocked = false;
  hidden = false;
  prefs: AudioPrefs = prefsFromSettings({ sound: true, volume: AUDIO_DEFAULTS.master });
  private duckHolds = 0;
  private duckUntil = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly create: Ctor = defaultCtor) {}

  /** Builds the graph (once). Does not make anything audible by itself. */
  ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    let ctx: AudioContext | null = null;
    try {
      ctx = this.create();
    } catch {
      ctx = null;
    }
    if (!ctx) return null;
    this.ctx = ctx;
    // resume() is asynchronous: whoever waits for a running context hears about it
    ctx.onstatechange = () => this.emit();
    const master = ctx.createGain();
    const limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    limiter.oversample = 'none';
    master.connect(limiter).connect(ctx.destination);
    const duck = ctx.createGain();
    duck.connect(master);
    const music = ctx.createGain();
    music.connect(duck);
    const sfx = ctx.createGain();
    sfx.connect(master);
    const voice = ctx.createGain();
    voice.connect(master);
    this.master = master;
    this.limiter = limiter;
    this.duckNode = duck;
    this.buses = { music, sfx, voice };
    const len = Math.floor(ctx.sampleRate);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    this.writeGains(true);
    return ctx;
  }

  /** Call from a user gesture: creates / resumes the context and lets sound through. */
  unlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended' && !this.hidden) void ctx.resume().catch(() => {});
    if (!this.unlocked) {
      this.unlocked = true;
      this.emit();
    }
  }

  /** Called when anything that decides audibility changes (unlock, prefs, visibility). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  apply(prefs: AudioPrefs): void {
    this.prefs = prefs;
    this.writeGains(false);
    this.emit();
  }

  /** Tab hidden: the whole context sleeps (music pauses, nothing runs). */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    const ctx = this.ctx;
    if (ctx) {
      if (hidden && ctx.state === 'running') void ctx.suspend().catch(() => {});
      else if (!hidden && this.unlocked && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    }
    this.emit();
  }

  /** Linear gain a bus reaches the speakers with (master and mutes included). */
  level(bus: Bus): number {
    const p = this.prefs;
    if (p.muted) return 0;
    const on = bus === 'music' ? p.musicOn : bus === 'sfx' ? p.sfxOn : p.voiceOn;
    return on ? p[bus] * p.master : 0;
  }

  /** The node a bus's sources connect to, or null when that bus cannot sound now. */
  input(bus: Bus): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || this.hidden || ctx.state !== 'running' || this.level(bus) <= 0) return null;
    return this.buses[bus] ?? null;
  }

  /** The bus node itself (music keeps its own graph connected across mutes). */
  busNode(bus: Bus): GainNode | null {
    return this.buses[bus] ?? null;
  }

  private writeGains(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const p = this.prefs;
    const set = (node: GainNode | undefined | null, v: number) => {
      if (!node) return;
      const g = node.gain;
      if (immediate) {
        g.value = v;
        return;
      }
      g.cancelScheduledValues(ctx.currentTime);
      g.setTargetAtTime(v, ctx.currentTime, 0.03);
    };
    set(this.master, p.muted ? 0 : p.master);
    set(this.buses.music, p.musicOn ? p.music : 0);
    set(this.buses.sfx, p.sfxOn ? p.sfx : 0);
    set(this.buses.voice, p.voiceOn ? p.voice : 0);
  }

  /** Music dips by 6 dB for `hold` seconds (a big stinger). Overlapping ducks extend each other. */
  duck(hold = 1.2): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.duckUntil = Math.max(this.duckUntil, ctx.currentTime + DUCK_ATTACK + hold);
    this.writeDuck();
  }

  /** Music stays ducked while held (an announcer line is speaking). */
  holdDuck(on: boolean): void {
    this.duckHolds = Math.max(0, this.duckHolds + (on ? 1 : -1));
    if (!on && this.ctx) this.duckUntil = Math.max(this.duckUntil, this.ctx.currentTime);
    this.writeDuck();
  }

  /** Is the music ducked at context time `t` (now by default)? */
  isDucked(t = this.ctx?.currentTime ?? 0): boolean {
    return this.duckHolds > 0 || t < this.duckUntil;
  }

  private writeDuck(): void {
    const ctx = this.ctx;
    const node = this.duckNode;
    if (!ctx || !node) return;
    const now = ctx.currentTime;
    const g = node.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (this.duckHolds > 0 || now < this.duckUntil) {
      g.linearRampToValueAtTime(DUCK_GAIN, now + DUCK_ATTACK);
      if (this.duckHolds === 0) {
        const releaseAt = Math.max(now + DUCK_ATTACK, this.duckUntil);
        g.setValueAtTime(DUCK_GAIN, releaseAt);
        g.linearRampToValueAtTime(1, releaseAt + DUCK_RELEASE);
      }
    } else {
      g.linearRampToValueAtTime(1, now + DUCK_RELEASE);
    }
  }

  /**
   * Dev only (recording): the master output, after the limiter, as a MediaStream.
   * Resumes the context so the stream runs from the start of a capture; the
   * first-gesture rule still holds because nothing plays before `unlocked`.
   */
  tap(): MediaStream | null {
    const ctx = this.ensure();
    if (!ctx || !this.limiter) return null;
    if (!this.tapNode) {
      this.tapNode = ctx.createMediaStreamDestination();
      this.limiter.connect(this.tapNode);
    }
    if (ctx.state === 'suspended' && !this.hidden) void ctx.resume().catch(() => {});
    return this.tapNode.stream;
  }
}

import { AssetLoader } from './assets';
import manifest from './assets/music/music.json';
import type { Mixer } from './mixer';

/**
 * The soundtrack: three seamless loops rendered at build time (scripts/audio/music.py):
 * - lobby: F major, 96 BPM, swung marimba, glockenspiel and toy whistle (60 s);
 * - game: G major, 128 BPM, a soft electronic kit, plucked bass and a square lead (60 s);
 * - tension: a tick-tock and pulse layer sample-locked to `game` (30 s, half of it), cross-faded
 *   in for the last minute of an arena round.
 * Each file holds its loop with `pad` seconds of the neighbouring loops on both sides; the
 * source loops [pad, pad + loop), so an encoder delay never reaches the seam. A mood change
 * cross-fades over 1.5 s; the tension layer comes in over 2.5 s, phase-aligned to the game loop.
 * Nothing loads or plays before the first gesture; the music bus carries the music slider, the
 * music switch and the master mute (switched off: the sources stop; on again: a fade-in).
 * Decoded loops are big (~23 MB a stereo minute): a loop not heard for a while is let go.
 */

export type Mood = 'lobby' | 'game';
type TrackName = keyof typeof manifest;

export const CROSSFADE = 1.5;
export const TENSION_FADE = 2.5;
/** Fade in when the music starts (after the gesture, unmute, back from silence). */
export const START_FADE = 1.2;
/** A decoded loop that has been silent this long is released (ms). */
export const RELEASE_AFTER_MS = 30_000;
/** Level of each layer (the files are mastered at -17 / -19 LUFS). */
const LEVEL: Record<TrackName, number> = { lobby: 1, game: 1, tension: 0.85 };

export const TRACKS = manifest;

interface Voice {
  name: TrackName;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Context time at which the loop's phase was 0. */
  t0: number;
  /** Fading out: stops at this context time. */
  ending: number | null;
}

export interface MusicDeps {
  loader?: AssetLoader;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export class Music {
  mood: Mood = 'lobby';
  tension = false;
  playing = false;
  private voices: Voice[] = [];
  private readonly buffers = new Map<TrackName, AudioBuffer>();
  private readonly pending = new Map<TrackName, Promise<AudioBuffer | null>>();
  private readonly lastHeard = new Map<TrackName, number>();
  private readonly loader: AssetLoader;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  /** Bumps on every start / stop: a buffer that decodes after a stop does not start anything. */
  private epoch = 0;

  constructor(
    private readonly mixer: Mixer,
    deps: MusicDeps = {},
  ) {
    this.loader = deps.loader ?? new AssetLoader();
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    mixer.onChange(() => this.update());
  }

  /** Lobby or game: cross-fades when the music is playing. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood !== 'game') this.tension = false;
    if (this.playing) this.sync(CROSSFADE);
  }

  /** The last-minute layer over the game loop (ignored outside the game mood). */
  setTension(on: boolean): void {
    if (on === this.tension) return;
    this.tension = on;
    if (this.playing) this.sync(TENSION_FADE);
  }

  private wanted(): boolean {
    const ctx = this.mixer.ctx;
    return !!ctx && this.mixer.unlocked && ctx.state !== 'closed' && this.mixer.level('music') > 0;
  }

  /** Starts or stops to match the mixer (unlocked, audible). A hidden tab just suspends the context. */
  update(): void {
    const want = this.wanted();
    if (want && !this.playing) {
      this.playing = true;
      this.epoch++;
      this.sync(START_FADE);
    } else if (!want && this.playing) this.stop();
  }

  /** The layers that should sound now. */
  private targets(): TrackName[] {
    const out: TrackName[] = [this.mood];
    if (this.mood === 'game' && this.tension) out.push('tension');
    return out;
  }

  /** Fades every voice toward the targets (starting the missing ones as their buffers arrive). */
  private sync(fade: number): void {
    const ctx = this.mixer.ctx;
    if (!ctx) return;
    const targets = this.targets();
    for (const v of this.voices) if (v.ending === null && !targets.includes(v.name)) this.fadeOut(v, fade);
    for (const name of targets) {
      if (this.voices.some((v) => v.name === name && v.ending === null)) continue;
      const epoch = this.epoch;
      void this.buffer(name).then((buf) => {
        if (!buf || epoch !== this.epoch || !this.playing || !this.targets().includes(name)) return;
        if (this.voices.some((v) => v.name === name && v.ending === null)) return;
        this.begin(name, buf, fade);
      });
    }
    // the game loop is playing: have the tension layer's file at hand
    if (this.mood === 'game') void this.loader.bytes('music/tension');
  }

  private buffer(name: TrackName): Promise<AudioBuffer | null> {
    const have = this.buffers.get(name);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(name);
    const ctx = this.mixer.ctx;
    if (!p && ctx) {
      p = this.loader.decode(ctx, `music/${name}`).then((b) => {
        this.pending.delete(name);
        if (b) this.buffers.set(name, b);
        return b;
      });
      this.pending.set(name, p);
    }
    return p ?? Promise.resolve(null);
  }

  private begin(name: TrackName, buf: AudioBuffer, fade: number): void {
    const ctx = this.mixer.ctx;
    const bus = this.mixer.busNode('music');
    if (!ctx || !bus) return;
    const { loop, pad } = TRACKS[name];
    const at = ctx.currentTime + 0.05;
    // the tension layer joins the game loop in phase (its loop is exactly half the game's)
    let phase = 0;
    const game = this.voices.find((v) => v.name === 'game' && v.ending === null);
    if (name === 'tension' && game) phase = (((at - game.t0) % loop) + loop) % loop;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = pad;
    src.loopEnd = pad + loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(LEVEL[name], at + fade);
    src.connect(gain).connect(bus);
    src.start(at, pad + phase);
    this.voices.push({ name, src, gain, t0: at - phase, ending: null });
  }

  private fadeOut(v: Voice, fade: number): void {
    const ctx = this.mixer.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    v.ending = now + fade;
    try {
      v.src.stop(now + fade + 0.05);
    } catch {
      /* already stopped */
    }
    const done = () => {
      v.gain.disconnect();
      this.voices = this.voices.filter((x) => x !== v);
      this.lastHeard.set(v.name, Date.now());
      this.setTimer(() => this.release(v.name), RELEASE_AFTER_MS);
    };
    v.src.onended = done;
  }

  /** Drops a decoded loop nobody has played for a while (it decodes again from the kept bytes). */
  private release(name: TrackName): void {
    if (this.voices.some((v) => v.name === name)) return;
    if (this.targets().includes(name) && this.playing) return;
    if (Date.now() - (this.lastHeard.get(name) ?? 0) < RELEASE_AFTER_MS - 50) return;
    this.buffers.delete(name);
  }

  private stop(): void {
    this.playing = false;
    this.epoch++;
    for (const v of this.voices) if (v.ending === null) this.fadeOut(v, 0.3);
  }

  /** The layers sounding now, for tests and the dev panel. */
  layers(): { name: TrackName; ending: boolean }[] {
    return this.voices.map((v) => ({ name: v.name, ending: v.ending !== null }));
  }

  /** Is a decoded loop held? */
  holds(name: TrackName): boolean {
    return this.buffers.has(name);
  }
}

import type { Mixer } from './mixer';

/**
 * Procedural lo-fi: a small sequencer that writes notes onto the AudioContext
 * clock a little ahead of time (a 25 ms wake-up, 0.2 s lookahead), so timer
 * jitter never reaches the beat.
 *
 * One generator, two moods:
 * - lobby: F major pentatonic, I – vi – ii – V (two bars each), warm pad,
 *   Rhodes-like melody, bass, soft kick, brushes on 2 and 4, brushed hats;
 * - game: the same key and clock, I – vi (four bars each), darker pad,
 *   sparse chord stabs, half-time brush, no melody.
 * A mood change cross-fades the two layers over 1.5 s on the shared clock.
 * Everything runs through gentle tape: slow wow + flutter on every pitch,
 * soft saturation, a 7 kHz roll-off and a breath of hiss.
 */

export type Mood = 'lobby' | 'game';

export const BPM = 82;
/** One eighth note, seconds. */
export const EIGHTH = 60 / BPM / 2;
export const LOOKAHEAD = 0.2;
export const WAKE_MS = 25;
export const CROSSFADE = 1.5;
const SWING = 0.16;

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Chord {
  bass: number;
  pad: readonly number[];
  /** Chord tones for the melody (C4..D5). */
  tones: readonly number[];
}

// F major pentatonic (F G A C D): every chord uses only these notes
const I: Chord = { bass: 41, pad: [53, 57, 60, 67], tones: [60, 65, 67, 69, 72] }; // Fadd9
const VI: Chord = { bass: 38, pad: [53, 57, 60, 62], tones: [60, 62, 65, 69, 72, 74] }; // Dm7
const II: Chord = { bass: 43, pad: [53, 55, 60, 62], tones: [60, 62, 65, 67, 72, 74] }; // G9sus4
const V: Chord = { bass: 36, pad: [55, 57, 60, 62], tones: [60, 62, 67, 69, 72, 74] }; // C6sus2
const SCALE = [60, 62, 65, 67, 69, 72, 74];

interface MoodSpec {
  chords: readonly Chord[];
  barsPerChord: number;
  padCutoff: number;
  padLevel: number;
  melody: boolean;
  kick: readonly number[];
  kickVel: number;
  brush: readonly number[];
  hats: readonly number[];
  hatVel: number;
  bassVel: number;
}

const MOODS: Record<Mood, MoodSpec> = {
  lobby: {
    chords: [I, VI, II, V],
    barsPerChord: 2,
    padCutoff: 950,
    padLevel: 1,
    melody: true,
    kick: [0, 5],
    kickVel: 0.85,
    brush: [2, 6],
    hats: [0, 1, 2, 3, 4, 5, 6, 7],
    hatVel: 1,
    bassVel: 1,
  },
  game: {
    chords: [I, VI],
    barsPerChord: 4,
    padCutoff: 640,
    padLevel: 0.85,
    melody: false,
    kick: [0],
    kickVel: 0.55,
    brush: [4],
    hats: [1, 3, 5, 7],
    hatVel: 0.6,
    bassVel: 0.8,
  },
};

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A two-bar phrase over `chord`: [step 0..15, midi, velocity]. Same seed, same rhythm. */
export function phrase(seed: number, chord: Chord): [number, number, number][] {
  const r = rng(seed);
  const out: [number, number, number][] = [];
  let idx = 2 + Math.floor(r() * 3);
  for (let s = 0; s < 16; s++) {
    const p = s % 8 === 0 ? 0.7 : s % 4 === 0 ? 0.5 : s >= 14 ? 0.08 : 0.28;
    if (r() >= p) continue;
    idx = Math.max(0, Math.min(SCALE.length - 1, idx + Math.round((r() - 0.5) * 3.2)));
    let note = SCALE[idx];
    // strong beats land on a chord tone
    if (s % 4 === 0 && !chord.tones.includes(note)) {
      note = chord.tones.reduce((b, n) => (Math.abs(n - note) < Math.abs(b - note) ? n : b), chord.tones[0]);
      idx = SCALE.indexOf(note) >= 0 ? SCALE.indexOf(note) : idx;
    }
    out.push([s, note, 0.55 + r() * 0.35]);
  }
  return out;
}

/** The tape saturation curve: tanh with unity slope at zero, ceiling 1/k. */
function tapeCurve(k = 1.5, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / k;
  }
  return c;
}

class Layer {
  readonly gain: GainNode;
  readonly pad: BiquadFilterNode;
  /** Context time after which this layer stops writing notes (faded out). */
  until = Infinity;
  /** Context time the current pad chord rings until (a layer that starts mid-chord pads at once). */
  padUntil = -Infinity;

  constructor(
    readonly mood: Mood,
    ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
    this.pad = ctx.createBiquadFilter();
    this.pad.type = 'lowpass';
    this.pad.frequency.value = MOODS[mood].padCutoff;
    this.pad.Q.value = 0.6;
    this.pad.connect(this.gain);
  }

  fade(ctx: AudioContext, to: number, secs: number): void {
    const g = this.gain.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + secs);
    if (to === 0) this.until = now + secs + 0.05;
  }
}

export class Music {
  mood: Mood = 'lobby';
  playing = false;
  /** Next eighth to write and its context time. */
  step = 0;
  nextTime = 0;
  private layers: Layer[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private input: GainNode | null = null;
  private wow: GainNode | null = null;
  private hiss: AudioBufferSourceNode | null = null;
  private hissGain: GainNode | null = null;
  private loopSeed = Math.floor(Math.random() * 1e6);

  constructor(private readonly mixer: Mixer) {
    mixer.onChange(() => this.update());
  }

  /** Lobby or game: cross-fades when the music is playing. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    const ctx = this.mixer.ctx;
    if (!this.playing || !ctx) return;
    for (const l of this.layers) if (l.until === Infinity) l.fade(ctx, 0, CROSSFADE);
    this.addLayer(ctx, CROSSFADE);
  }

  /** Starts or stops to match the mixer (unlocked, audible, tab visible). */
  update(): void {
    const ctx = this.mixer.ctx;
    const want = !!ctx && this.mixer.unlocked && !this.mixer.hidden && ctx.state === 'running' && this.mixer.level('music') > 0;
    if (want && !this.playing) this.start();
    else if (!want && this.playing) this.stop();
  }

  private build(ctx: AudioContext): void {
    if (this.input) return;
    const bus = this.mixer.busNode('music');
    if (!bus) return;
    // tape: saturation → 7 kHz roll-off → music bus
    const sat = ctx.createWaveShaper();
    sat.curve = tapeCurve();
    sat.oversample = 'none';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 7000;
    tone.Q.value = 0.5;
    const input = ctx.createGain();
    input.gain.value = 1;
    // make-up after the tape (+4 dB): the bed sits around −35 dBFS mean at the default levels
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;
    input.connect(sat).connect(tone).connect(makeup).connect(bus);
    // wow (0.55 Hz, ±7 cents) and flutter (5.3 Hz, ±1.5 cents) summed into every pitch's detune
    const wow = ctx.createGain();
    wow.gain.value = 1;
    for (const [rate, cents] of [
      [0.55, 7],
      [5.3, 1.5],
    ] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = cents;
      lfo.connect(depth).connect(wow);
      lfo.start();
    }
    this.input = input;
    this.wow = wow;
  }

  private start(): void {
    const ctx = this.mixer.ctx;
    if (!ctx) return;
    this.build(ctx);
    if (!this.input) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.loopSeed = (this.loopSeed + 7919) % 1e6;
    this.addLayer(ctx, CROSSFADE);
    this.startHiss(ctx);
    this.tick();
  }

  private stop(): void {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ctx = this.mixer.ctx;
    if (!ctx) return;
    for (const l of this.layers) l.fade(ctx, 0, 0.3);
    if (this.hiss && this.hissGain) {
      this.hissGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      try {
        this.hiss.stop(ctx.currentTime + 0.5);
      } catch {
        /* already stopped */
      }
      this.hiss = null;
    }
  }

  private addLayer(ctx: AudioContext, fadeIn: number): void {
    const layer = new Layer(this.mood, ctx, this.input!);
    layer.fade(ctx, 1, fadeIn);
    this.layers.push(layer);
  }

  private startHiss(ctx: AudioContext): void {
    const buf = this.mixer.noise;
    if (!buf || !this.input) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.006, ctx.currentTime, 0.5);
    src.connect(band).connect(g).connect(this.input);
    src.start();
    this.hiss = src;
    this.hissGain = g;
  }

  /** The scheduler: write every eighth that falls inside the lookahead window. */
  tick = (): void => {
    this.timer = null;
    const ctx = this.mixer.ctx;
    if (!this.playing || !ctx) return;
    const now = ctx.currentTime;
    // woke up late (a long stall): skip ahead instead of a burst of old notes
    if (this.nextTime < now - 0.1) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      const t = this.nextTime + (this.step % 2 === 1 ? EIGHTH * SWING : 0);
      for (const l of this.layers) if (t < l.until) this.writeStep(ctx, l, this.step, t);
      this.step++;
      this.nextTime += EIGHTH;
    }
    // drop faded layers once their last notes are written
    this.layers = this.layers.filter((l) => {
      if (l.until > now) return true;
      l.gain.disconnect();
      return false;
    });
    this.timer = setTimeout(this.tick, WAKE_MS);
  };

  private writeStep(ctx: AudioContext, layer: Layer, step: number, t: number): void {
    const m = MOODS[layer.mood];
    const pos = step % 8;
    const bar = Math.floor(step / 8);
    const loopBars = m.chords.length * m.barsPerChord;
    const ci = Math.floor((bar % loopBars) / m.barsPerChord);
    const chord = m.chords[ci];
    const barInChord = bar % m.barsPerChord;
    const out = layer.gain;
    const r = rng(this.loopSeed * 131 + step * 7 + (layer.mood === 'game' ? 3 : 0));

    // pad: a new chord every `barsPerChord` bars, overlapping the last one's release; a layer
    // that fades in mid-chord starts its pad on its first step instead of waiting for the next chord
    if ((pos === 0 && barInChord === 0) || layer.padUntil < t) {
      const left = m.barsPerChord * 8 - (barInChord * 8 + pos);
      const end = this.nextTime + left * EIGHTH;
      for (const n of chord.pad) this.padNote(ctx, layer.pad, n, t, end, m.padLevel);
      layer.padUntil = end;
    }
    // bass
    if (pos === 0) this.bass(ctx, out, chord.bass, t, layer.mood === 'game' ? EIGHTH * 7 : EIGHTH * 3.5, m.bassVel);
    if (layer.mood === 'lobby' && pos === 3 && r() < 0.7) this.bass(ctx, out, chord.bass + (r() < 0.3 ? 12 : 0), t, EIGHTH * 1.2, 0.6);

    // keys
    if (m.melody) {
      const loop = Math.floor(bar / loopBars);
      // A B A B: chords 0 and 2 share a rhythm, so do 1 and 3; the motif changes every two loops
      const seed = this.loopSeed + (loop >> 1) * 977 + (ci % 2) * 31;
      const local = barInChord * 8 + pos;
      for (const [s, note, vel] of phrase(seed, chord)) if (s === local) this.rhodes(ctx, out, note, t, vel, EIGHTH * 5);
    } else {
      if (pos === 0 && barInChord % 2 === 0) {
        this.rhodes(ctx, out, chord.pad[1] + 12, t, 0.45, EIGHTH * 8);
        this.rhodes(ctx, out, chord.pad[3] + 12, t + 0.02, 0.38, EIGHTH * 8);
      } else if (pos === 5 && r() < 0.2) {
        this.rhodes(ctx, out, chord.tones[Math.floor(r() * chord.tones.length)], t, 0.35, EIGHTH * 6);
      }
    }

    // brushed kit
    if (m.kick.includes(pos)) this.kick(ctx, out, t, m.kickVel * (pos === 0 ? 1 : 0.7));
    if (m.brush.includes(pos)) this.brush(ctx, out, t, 0.85 + r() * 0.15, r());
    if (m.hats.includes(pos)) this.hat(ctx, out, t, m.hatVel * (pos % 2 === 0 ? 0.8 : 1) * (0.7 + r() * 0.3), r());
  }

  /* ── voices ─────────────────────────────────────────────────────── */

  private detune(osc: OscillatorNode): void {
    const wow = this.wow;
    if (!wow) return;
    wow.connect(osc.detune);
    osc.onended = () => {
      try {
        wow.disconnect(osc.detune);
      } catch {
        /* gone */
      }
    };
  }

  /** Two detuned saws per note, slow attack and release, through the layer's low-pass. */
  private padNote(ctx: AudioContext, dest: AudioNode, midi: number, t0: number, t1: number, level: number): void {
    const g = ctx.createGain();
    const peak = 0.05 * level;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 1.1);
    g.gain.setValueAtTime(peak, t1);
    g.gain.linearRampToValueAtTime(0.0001, t1 + 1.6);
    g.connect(dest);
    for (const cents of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(midi);
      o.detune.value = cents;
      this.detune(o);
      o.connect(g);
      o.start(t0);
      o.stop(t1 + 1.7);
    }
  }

  /** FM electric piano: a sine carrier whose 1:1 modulator fades out (bright bark → round tone). */
  private rhodes(ctx: AudioContext, dest: AudioNode, midi: number, t: number, vel: number, dur: number): void {
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 1.6 * vel, t);
    depth.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.35);
    mod.connect(depth).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.detune(car);
    car.connect(g).connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private bass(ctx: AudioContext, dest: AudioNode, midi: number, t: number, dur: number, vel: number): void {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.detune(o);
    o.connect(lp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(ctx: AudioContext, dest: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, at: number): void {
    const buf = this.mixer.noise;
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, at * (buf.duration - 0.4), attack + decay + 0.02);
  }

  /** A brush across the snare: a soft-attack swish of band-passed noise. */
  private brush(ctx: AudioContext, dest: AudioNode, t: number, vel: number, at: number): void {
    this.noiseHit(ctx, dest, t, 'bandpass', 2300, 0.7, 0.1 * vel, 0.022, 0.2, at);
  }

  private hat(ctx: AudioContext, dest: AudioNode, t: number, vel: number, at: number): void {
    this.noiseHit(ctx, dest, t, 'highpass', 7200, 0.7, 0.03 * vel, 0.003, 0.045, at);
  }
}

/**
 * Tiny synthesized sound kit (WebAudio, no assets): blips, chomps, whooshes,
 * boings and coin cascades. Created lazily on the first user gesture.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastBlip = 0;
  enabled = true;
  volume = 0.6;

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; slideTo?: number; gain?: number; delay?: number } = {}): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, from: number, to: number, gain = 0.15, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur);
  }

  /** Food pellet: soft high blip (rate limited, random pitch). */
  blip(gold = false): void {
    const now = performance.now();
    if (now - this.lastBlip < 55) return;
    this.lastBlip = now;
    const base = gold ? 1320 : 880 + Math.random() * 520;
    this.tone(base, 0.07, { type: 'triangle', slideTo: base * 1.5, gain: gold ? 0.12 : 0.05 });
    if (gold) this.tone(base * 1.5, 0.1, { type: 'sine', gain: 0.08, delay: 0.05 });
  }

  chomp(): void {
    this.tone(220, 0.12, { type: 'square', slideTo: 110, gain: 0.07 });
    this.noise(0.1, 1800, 600, 0.12);
    this.tone(1046, 0.12, { type: 'triangle', gain: 0.08, delay: 0.06 });
    this.tone(1568, 0.16, { type: 'triangle', gain: 0.06, delay: 0.11 });
  }

  ouch(): void {
    this.tone(500, 0.25, { type: 'sawtooth', slideTo: 120, gain: 0.06 });
  }

  split(): void {
    this.noise(0.18, 400, 3200, 0.1);
  }

  eject(): void {
    this.tone(700, 0.06, { type: 'sine', slideTo: 300, gain: 0.07 });
  }

  boing(): void {
    this.tone(180, 0.35, { type: 'sine', slideTo: 520, gain: 0.14 });
    this.noise(0.25, 2500, 300, 0.08);
  }

  powerup(): void {
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', gain: 0.07, delay: i * 0.06 }));
  }

  death(): void {
    [523, 440, 349, 262].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.08, delay: i * 0.13 }));
  }

  cashout(): void {
    for (let i = 0; i < 10; i++) this.tone(1200 + Math.random() * 900, 0.08, { type: 'triangle', gain: 0.05, delay: i * 0.05 });
    this.tone(784, 0.4, { type: 'sine', gain: 0.08, delay: 0.5 });
    this.tone(1046, 0.5, { type: 'sine', gain: 0.08, delay: 0.62 });
  }

  click(): void {
    this.tone(1500, 0.04, { type: 'sine', gain: 0.04 });
  }

  coinRain(): void {
    for (let i = 0; i < 6; i++) this.tone(1568 + i * 120, 0.09, { type: 'triangle', gain: 0.05, delay: i * 0.07 });
  }
}

export const sound = new Sound();

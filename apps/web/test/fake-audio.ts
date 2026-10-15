/**
 * A minimal WebAudio stand-in for jsdom: nodes record their connections and
 * AudioParams record their automation, so tests can check routing, levels and
 * scheduling without a real audio device.
 */

export type ParamEvent = [kind: string, value: number, time: number];

export class FakeParam {
  events: ParamEvent[] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['linear', v, t]);
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, _tc: number) {
    this.events.push(['target', v, t]);
    this.value = v;
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push(['cancel', 0, t]);
    return this;
  }
  /** Last value aimed at (the end of the automation). */
  get target(): number {
    return this.events.length ? this.events[this.events.length - 1][1] : this.value;
  }
}

export class FakeNode {
  outputs: (FakeNode | FakeParam)[] = [];
  constructor(
    public ctx: FakeAudioContext,
    public kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    this.outputs.push(dest);
    return dest;
  }
  disconnect(dest?: FakeNode | FakeParam) {
    this.outputs = dest ? this.outputs.filter((d) => d !== dest) : [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  start(t = 0) {
    this.startedAt = t;
  }
  stop(t = 0) {
    this.stoppedAt = t;
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

export class FakeStreamDest extends FakeNode {
  stream = { id: 'fake-stream' } as unknown as MediaStream;
}

export class FakeAudioContext {
  nodes: FakeNode[] = [];
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  onstatechange: (() => void) | null = null;
  destination = new FakeNode(this, 'destination');
  async resume() {
    this.state = 'running';
    this.onstatechange?.();
  }
  async suspend() {
    this.state = 'suspended';
    this.onstatechange?.();
  }
  createGain() {
    return new FakeGain(this, 'gain');
  }
  createWaveShaper() {
    return new FakeShaper(this, 'shaper');
  }
  createBiquadFilter() {
    return new FakeFilter(this, 'filter');
  }
  createOscillator() {
    return new FakeSource(this, 'osc');
  }
  createBufferSource() {
    return new FakeSource(this, 'buffer');
  }
  createMediaStreamDestination() {
    return new FakeStreamDest(this, 'stream');
  }
  createBuffer(_ch: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, length, sampleRate, getChannelData: () => data };
  }
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
}

/** Runs a mixer factory against a fresh fake context; returns both. */
export function fakeCtor(): { ctx: FakeAudioContext; create: () => AudioContext } {
  const ctx = new FakeAudioContext();
  return { ctx, create: () => ctx as unknown as AudioContext };
}

/** Lets pending promise callbacks (resume / suspend) run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));

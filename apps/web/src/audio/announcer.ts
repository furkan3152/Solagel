import { AssetLoader, BufferCache } from './assets';
import spec from './lines.json';
import type { Mixer } from './mixer';

/**
 * The announcer: pre-recorded lines read like an excited caster (Kokoro TTS, voice in
 * lines.json, made by scripts/audio/voice.py), the same voice on every device. 2-4 variants a line,
 * drawn from a shuffled bag so one never comes twice in a row. A global cooldown (4 s) and
 * per-line cooldowns keep it from chattering; the round lines (countdown, bell, payout) are
 * `priority`: they skip the global cooldown and cut a line that is still talking.
 *
 * Lines play on the voice bus (voice slider × master, announcer switch, master mute) and the
 * music ducks under them. The files are fetched after the first gesture, in the background; a
 * line whose file has not arrived yet is skipped (and keeps its cooldowns). No line at a join or
 * a death (turned off on purpose).
 */

export type LineId = keyof typeof spec.lines;

interface LineRule {
  /** Minimum time between two of this line, ms. */
  cooldown: number;
  /** Skips the global cooldown and cuts a line that is talking. */
  priority?: boolean;
}

export const GLOBAL_COOLDOWN_MS = 4000;

export const LINES: Record<LineId, LineRule> = {
  firstBite: { cooldown: 30_000 },
  double: { cooldown: 10_000 },
  triple: { cooldown: 12_000 },
  multi: { cooldown: 15_000 },
  bigEat: { cooldown: 15_000 },
  whale: { cooldown: 60_000 },
  comeback: { cooldown: 45_000 },
  leader: { cooldown: 30_000 },
  chased: { cooldown: 25_000 },
  escape: { cooldown: 20_000 },
  coinRain: { cooldown: 20_000 },
  powerUp: { cooldown: 12_000 },
  magnet: { cooldown: 12_000 },
  push: { cooldown: 12_000 },
  // the round clock: at most once a round each (rounds are 5 minutes; demos run shorter ones)
  oneMinute: { cooldown: 20_000 },
  tenSeconds: { cooldown: 20_000 },
  countdown: { cooldown: 20_000, priority: true },
  roundOver: { cooldown: 20_000, priority: true },
  paid: { cooldown: 10_000, priority: true },
};

export const LINE_IDS = Object.keys(spec.lines) as LineId[];

/** The words of each variant (for the settings preview, tests and the demo list). */
export function lineText(id: LineId): string[] {
  return spec.lines[id].variants.map((v) => v.replace(/\s*\|\s*/g, ' '));
}

/** Asset key of variant `i` (0-based) of `id`. */
export const lineKey = (id: LineId, i: number) => `voice/${id}-${i + 1}`;

/**
 * Shuffled-bag variant picker: every variant once per round of the bag, in a random order,
 * and a new bag never starts with the variant the last one ended on.
 */
export class VariantBag {
  private bag: number[] = [];
  private last = -1;

  constructor(
    readonly n: number,
    private readonly random: () => number = Math.random,
  ) {}

  next(): number {
    if (this.n <= 1) return 0;
    if (this.bag.length === 0) {
      const b = Array.from({ length: this.n }, (_, i) => i);
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      // popped from the end: the first pick must not repeat the last one
      if (b[b.length - 1] === this.last) [b[0], b[b.length - 1]] = [b[b.length - 1], b[0]];
      this.bag = b;
    }
    this.last = this.bag.pop()!;
    return this.last;
  }
}

export interface AnnouncerDeps {
  now?: () => number;
  random?: () => number;
  loader?: AssetLoader;
  /** Schedules the background fetch of every line after the first gesture (tests: immediate). */
  idle?: (fn: () => void) => void;
}

const defaultIdle = (fn: () => void) => {
  const w = typeof window !== 'undefined' ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : undefined;
  if (w?.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 1200);
};

/** A decoded line that arrives later than this after its cue is dropped (it would be late). */
const LATE_MS = 450;
/** Safety release of the music duck if a line's `ended` never comes. */
const MAX_LINE_S = 6;

export class Announcer {
  private readonly now: () => number;
  private readonly random: () => number;
  readonly loader: AssetLoader;
  private readonly idle: (fn: () => void) => void;
  private lastAny = -Infinity;
  private last = new Map<LineId, number>();
  private bags = new Map<LineId, VariantBag>();
  private readonly decoded = new BufferCache(18);
  private current: { src: AudioBufferSourceNode; gain: GainNode; release: () => void } | null = null;
  private preloading = false;
  /** Lines spoken (id and variant), newest last: the dev panel and tests read it. */
  readonly log: { id: LineId; variant: number }[] = [];

  constructor(
    private readonly mixer: Mixer,
    deps: AnnouncerDeps = {},
  ) {
    this.now = deps.now ?? (() => performance.now());
    this.random = deps.random ?? Math.random;
    this.loader = deps.loader ?? new AssetLoader();
    this.idle = deps.idle ?? defaultIdle;
    mixer.onChange(() => {
      // muted, announcer off or the tab hidden: stop talking
      if (this.current && (mixer.hidden || mixer.level('voice') <= 0)) this.stop(0.05);
      if (mixer.unlocked && !this.preloading && mixer.prefs.voiceOn && !mixer.prefs.muted) {
        this.preloading = true;
        this.idle(() => void this.loader.prefetch(LINE_IDS.flatMap((id) => spec.lines[id].variants.map((_, i) => lineKey(id, i)))));
      }
    });
  }

  private bag(id: LineId): VariantBag {
    let b = this.bags.get(id);
    if (!b) {
      b = new VariantBag(spec.lines[id].variants.length, this.random);
      this.bags.set(id, b);
    }
    return b;
  }

  /** Plays a line if every rule allows it. Returns whether it was taken (it will sound). */
  say(id: LineId): boolean {
    const line = LINES[id];
    const ctx = this.mixer.ctx;
    if (!line || !ctx || !this.mixer.input('voice')) return false;
    const now = this.now();
    if (!line.priority && now - this.lastAny < GLOBAL_COOLDOWN_MS) return false;
    if (now - (this.last.get(id) ?? -Infinity) < line.cooldown) return false;
    const bag = this.bag(id);
    // the variant the bag offers, or (its file not here yet) any variant of this line that is
    let variant = bag.next();
    if (!this.decoded.get(lineKey(id, variant)) && !this.loader.ready(lineKey(id, variant))) {
      const n = spec.lines[id].variants.length;
      const alt = Array.from({ length: n }, (_, i) => i).find((i) => this.decoded.get(lineKey(id, i)) || this.loader.ready(lineKey(id, i)));
      if (alt === undefined) {
        // nothing has arrived: fetch it for next time, say nothing now (cooldowns untouched)
        void this.loader.bytes(lineKey(id, variant));
        return false;
      }
      variant = alt;
    }
    this.lastAny = now;
    this.last.set(id, now);
    this.log.push({ id, variant });
    if (this.log.length > 50) this.log.shift();
    const key = lineKey(id, variant);
    const buf = this.decoded.get(key);
    if (buf) this.play(buf, !!line.priority);
    else {
      void this.loader.decode(ctx, key).then((b) => {
        if (!b) return;
        this.decoded.set(key, b);
        if (this.now() - now <= LATE_MS) this.play(b, !!line.priority);
      });
    }
    return true;
  }

  /** Is a line talking? */
  get speaking(): boolean {
    return this.current !== null;
  }

  private play(buf: AudioBuffer, cut: boolean): void {
    const ctx = this.mixer.ctx;
    const bus = this.mixer.input('voice');
    if (!ctx || !bus) return;
    // one line at a time: a priority line cuts the one talking quickly, others fade it
    if (this.current) this.stop(cut ? 0.04 : 0.08);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(bus);
    let held = true;
    this.mixer.holdDuck(true);
    const timer = setTimeout(() => release(), (Math.min(buf.duration, MAX_LINE_S) + 0.2) * 1000);
    const release = () => {
      clearTimeout(timer);
      if (held) this.mixer.holdDuck(false);
      held = false;
      if (this.current?.src === src) this.current = null;
    };
    src.onended = release;
    src.start(ctx.currentTime + 0.01);
    this.current = { src, gain, release };
  }

  /** Fades the talking line out (tab hidden, muted, a priority line). */
  stop(fade = 0.06): void {
    const cur = this.current;
    const ctx = this.mixer.ctx;
    if (!cur || !ctx) return;
    this.current = null;
    const g = cur.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + fade);
    try {
      cur.src.stop(ctx.currentTime + fade + 0.01);
    } catch {
      /* already stopped */
    }
    cur.release();
  }
}

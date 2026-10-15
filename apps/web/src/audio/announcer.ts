import { translate, type TKey } from '../i18n';
import type { Mixer } from './mixer';

/**
 * Short English announcer lines through the browser's Speech Synthesis (no
 * recorded files). A calm English voice when one exists, rate 1.0; the line's
 * volume is the voice bus level (voice × master), so the sliders and the master
 * mute apply. A global cooldown (4 s) and per-line cooldowns keep it from
 * chattering. No voices, no gesture yet, a hidden tab or the announcer off:
 * nothing happens. Music ducks while a line speaks.
 */

export type LineId =
  | 'joined'
  | 'punched'
  | 'firstBite'
  | 'double'
  | 'triple'
  | 'whale'
  | 'cashingOut'
  | 'paid'
  | 'eaten'
  | 'minted'
  | 'revealed';

interface Line {
  key: TKey;
  /** Minimum time between two of this line, ms. */
  cooldown: number;
}

export const GLOBAL_COOLDOWN_MS = 4000;

export const LINES: Record<LineId, Line> = {
  joined: { key: 'an.joined', cooldown: 20_000 },
  punched: { key: 'an.punched', cooldown: 15_000 },
  firstBite: { key: 'an.firstBite', cooldown: 30_000 },
  double: { key: 'an.double', cooldown: 12_000 },
  triple: { key: 'an.triple', cooldown: 12_000 },
  whale: { key: 'an.whale', cooldown: 60_000 },
  cashingOut: { key: 'an.cashingOut', cooldown: 10_000 },
  paid: { key: 'an.paid', cooldown: 10_000 },
  eaten: { key: 'an.eaten', cooldown: 10_000 },
  minted: { key: 'an.minted', cooldown: 15_000 },
  revealed: { key: 'an.revealed', cooldown: 60_000 },
};

/** Voices that are calm and clear, best first (macOS, Chrome, Windows, Android names). */
const CALM = [
  'samantha',
  'google us english',
  'google uk english female',
  'microsoft aria',
  'microsoft jenny',
  'microsoft sonia',
  'microsoft libby',
  'serena',
  'karen',
  'moira',
  'daniel',
  'google uk english male',
  'microsoft guy',
  'alex',
];
/** Novelty voices that should never read a line. */
const NOVELTY =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;

/** Picks the announcer voice: English only, calm names first, local voices preferred. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    if (!/^en([-_]|$)/i.test(v.lang) || NOVELTY.test(v.name)) continue;
    const name = v.name.toLowerCase();
    const calm = CALM.findIndex((c) => name.includes(c));
    let score = calm >= 0 ? 100 - calm * 3 : 0;
    if (/^en[-_](us|gb)$/i.test(v.lang)) score += 5;
    if (v.localService) score += 3;
    if (v.default) score += 1;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

export interface AnnouncerDeps {
  synth?: SpeechSynthesis | null;
  Utterance?: typeof SpeechSynthesisUtterance | null;
  now?: () => number;
}

export class Announcer {
  private readonly synth: SpeechSynthesis | null;
  private readonly Utterance: typeof SpeechSynthesisUtterance | null;
  private readonly now: () => number;
  private lastAny = -Infinity;
  private last = new Map<LineId, number>();
  private voice: SpeechSynthesisVoice | null = null;
  private voicesSeen = 0;
  private release: (() => void) | null = null;

  constructor(
    private readonly mixer: Mixer,
    deps: AnnouncerDeps = {},
  ) {
    const w = typeof window !== 'undefined' ? window : undefined;
    this.synth = deps.synth !== undefined ? deps.synth : (w?.speechSynthesis ?? null);
    this.Utterance = deps.Utterance !== undefined ? deps.Utterance : ((w as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance } | undefined)?.SpeechSynthesisUtterance ?? null);
    this.now = deps.now ?? (() => performance.now());
    // tab hidden or muted: stop talking
    mixer.onChange(() => {
      if ((mixer.hidden || mixer.level('voice') <= 0) && this.synth?.speaking) this.synth.cancel();
    });
  }

  private pick(): SpeechSynthesisVoice | null {
    const voices = this.synth?.getVoices() ?? [];
    if (voices.length !== this.voicesSeen) {
      this.voicesSeen = voices.length;
      this.voice = pickVoice(voices);
    }
    return this.voice;
  }

  /** Speaks a line if every rule allows it. Returns whether it spoke. */
  say(id: LineId, vars?: Record<string, string>): boolean {
    const synth = this.synth;
    const U = this.Utterance;
    const level = this.mixer.level('voice');
    if (!synth || !U || !this.mixer.unlocked || this.mixer.hidden || level <= 0) return false;
    const now = this.now();
    const line = LINES[id];
    if (now - this.lastAny < GLOBAL_COOLDOWN_MS) return false;
    if (now - (this.last.get(id) ?? -Infinity) < line.cooldown) return false;
    const voice = this.pick();
    if (!voice) return false;
    this.lastAny = now;
    this.last.set(id, now);
    const u = new U(translate(line.key, vars));
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 1;
    u.pitch = 1;
    u.volume = Math.min(1, level);
    this.duck(u);
    try {
      if (synth.speaking || synth.pending) synth.cancel();
      synth.speak(u);
    } catch {
      this.release?.();
      return false;
    }
    return true;
  }

  /** Music ducks from the start of the line to its end (with a safety release). */
  private duck(u: SpeechSynthesisUtterance): void {
    this.release?.();
    let held = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const release = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (held) this.mixer.holdDuck(false);
      held = false;
      if (this.release === release) this.release = null;
    };
    u.onstart = () => {
      if (held) return;
      held = true;
      this.mixer.holdDuck(true);
      timer = setTimeout(release, 6000);
    };
    u.onend = release;
    u.onerror = release;
    this.release = release;
  }
}

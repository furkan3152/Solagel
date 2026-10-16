import { useUi, type Screen, type UiState } from '../store';
import { Announcer, type LineId } from './announcer';
import { Mixer, prefsFromSettings } from './mixer';
import { Music, type Mood } from './music';
import { Sfx } from './sfx';

/**
 * The game's sound: one mixer, the effects kit, the music generator and the
 * announcer. `startAudio()` (once, from the app root) connects them to the
 * store: settings → levels, screens → music mood and whooshes, lobby pages →
 * page turns, toasts → pins, sheets → paper lifts, and every button, link,
 * tab, ticket and switch → a small paper sound (hover ticks rate-limited).
 */

export const mixer = new Mixer();
export const sound = new Sfx(mixer);
export const music = new Music(mixer);
export const announcer = new Announcer(mixer);

export type { LineId } from './announcer';
export type { StampKind, PinKind } from './sfx';

/** Speaks an announcer line if its cooldowns allow (see announcer.ts). */
export function announce(id: LineId, vars?: Record<string, string>): boolean {
  return announcer.say(id, vars);
}

/** From any user gesture: creates / resumes the audio context. */
export function unlockAudio(): void {
  mixer.unlock();
}

/** The sheet event the design system's `Sheet` dispatches (it does not import audio). */
export const SHEET_EVENT = 'kb:sheet';

const INTERACTIVE = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], summary, select';
/** Hover ticks: tickets and controls, not every element. */
const HOVERABLE = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], summary';

const moodFor = (screen: Screen): Mood => (screen === 'lobby' ? 'lobby' : 'game');

function interactive(target: EventTarget | null, sel: string): HTMLElement | null {
  const el = target instanceof Element ? (target.closest(sel) as HTMLElement | null) : null;
  if (!el) return null;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
  return el;
}

/** The generic sound of an activated control (a specific sound played this frame wins). */
function clickSound(el: HTMLElement): void {
  const kind = el.dataset.sfx;
  if (kind === 'none') return;
  if (sound.playedWithin(60)) return;
  const role = el.getAttribute('role');
  if (kind === 'punch') return sound.punch();
  if (role === 'switch' || el.getAttribute('aria-pressed') !== null) {
    // React writes the new state after this handler: read it a microtask later
    queueMicrotask(() => sound.toggle(el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true'));
    return;
  }
  if (role === 'radio' || role === 'option') return sound.select();
  if (role === 'tab') return sound.rustle(1);
  sound.click();
}

let started = false;

/** Wires the sound to the page. Idempotent; returns a stop function (tests, HMR). */
export function startAudio(): () => void {
  if (started) return () => {};
  started = true;
  const offs: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    window.addEventListener(type, fn, opts);
    offs.push(() => window.removeEventListener(type, fn, opts));
  };

  // levels from the persisted settings
  mixer.apply(prefsFromSettings(useUi.getState().settings));
  music.mood = moodFor(useUi.getState().screen);

  // nothing sounds before the first gesture
  const gesture = () => mixer.unlock();
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) on(type, gesture, { capture: true, passive: true });

  // the tab is hidden: everything sleeps (music pauses, the announcer stops)
  const vis = () => mixer.setHidden(document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', vis);
  offs.push(() => document.removeEventListener('visibilitychange', vis));
  vis();

  // every control: a paper tap after its own handler (bubble phase, on window)
  on('click', (e) => {
    const el = interactive(e.target, INTERACTIVE);
    if (el) clickSound(el);
  });
  // hover: a pencil tick when the pointer reaches a new control (mouse only, 8/s at most)
  let hovered: Element | null = null;
  on(
    'pointerover',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = interactive(e.target, HOVERABLE);
      if (el === hovered) return;
      hovered = el;
      if (el && el.dataset.sfx !== 'none') sound.hover();
    },
    { passive: true },
  );
  // sheets lift off the table and settle back
  on(SHEET_EVENT as keyof WindowEventMap, (e) => {
    const open = (e as CustomEvent<{ open: boolean }>).detail?.open === true;
    sound.sheet(open);
  });

  offs.push(
    useUi.subscribe((s: UiState, prev: UiState) => {
      if (s.settings !== prev.settings) mixer.apply(prefsFromSettings(s.settings));
      if (s.screen !== prev.screen) {
        music.setMood(moodFor(s.screen));
        const fromPaper = prev.screen === 'lobby';
        if (fromPaper && s.screen !== 'lobby') sound.whoosh('in');
        else if (s.screen === 'lobby') sound.whoosh('out');
      }
      if (s.page !== prev.page && s.screen === 'lobby') {
        const order = ['play', 'ranks', 'profile', 'docs'];
        sound.rustle(order.indexOf(s.page) >= order.indexOf(prev.page) ? 1 : -1);
      }
      if (s.toasts.length > 0 && s.toasts[s.toasts.length - 1] !== prev.toasts[prev.toasts.length - 1]) {
        const last = s.toasts[s.toasts.length - 1];
        if (!prev.toasts.some((x) => x.id === last.id)) sound.pin(last.kind);
      }
    }),
  );
  if (import.meta.env.DEV) {
    const w = window as unknown as { __slanaAudioTap?: () => MediaStream | null; __slanaAudio?: unknown };
    // recording (scripts/record-walkthrough.mjs): the master output, after the limiter
    w.__slanaAudioTap = () => mixer.tap();
    w.__slanaAudio = { mixer, sound, music, announcer };
  }

  return () => {
    for (const off of offs) off();
    started = false;
  };
}

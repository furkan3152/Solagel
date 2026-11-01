/**
 * Automatic quality drop. Watches the intervals between animation frames and,
 * when frames stay slow for a while, lowers the cost of a frame in this order:
 *
 * 1. the canvas resolution, in steps (its CSS size stays: the page scales the
 *    bitmap), down to 0.75 device px per CSS px; from the first step on, also
 *    the work nobody sees (`lite`: fewer jelly vertices on the same smooth
 *    outline, no groove / highlight on coins too small to show them, a slower
 *    minimap refresh);
 * 2. only as a last resort, the low look (`low`): fewer confetti per burst and
 *    fewer coins in the rain. Every animation and moment keeps playing.
 *
 * The player's settings are never touched (`qualityLevels`). When frames are
 * fast again for long enough it steps back up.
 *
 * "Slow" is relative to the display: the refresh period is the standard period
 * (144, 120, 90 or 60 Hz) that matches the fastest recent frames. A drop that
 * does not make frames faster (a 30 Hz power-saving cap, a GPU-bound page that
 * is limited elsewhere) is undone and the governor stays put for a while.
 * Pure logic (no DOM), driven by `frame()` with timestamps; it allocates
 * nothing per frame (a fixed ring of intervals, decisions four times a second).
 */

/** Resolution multipliers tried in turn (each must change the canvas size to count as a level). */
export const RES_STEPS = [1, 0.85, 0.7, 0.6, 0.5] as const;
/** The lowest canvas resolution, device px per CSS px (a little soft, never mushy). */
export const MIN_DPR = 0.75;

const PERIODS = [1000 / 144, 1000 / 120, 1000 / 90, 1000 / 60];
/** Seconds of history the decisions look at. */
const WINDOW_MS = 2000;
/**
 * Frames longer than this (tab hidden, a debugger) are ignored. A weak phone's real frames can take
 * a few hundred ms: those must count, or the device that most needs a drop never gets one.
 */
const MAX_INTERVAL_MS = 750;
/** Frames a decision needs in its window (a 5 fps phone has 10 in 2 s). */
const MIN_FRAMES = 8;
/** Slow: the median frame takes this much longer than the refresh period. */
const SLOW_RATIO = 1.35;
const SLOW_EXTRA_MS = 6;
/** Far too slow (a weak phone at full resolution): drop sooner. */
const VERY_SLOW_RATIO = 2.2;
/** Fast enough to step back up. */
const FAST_RATIO = 1.12;
/**
 * A drop must make the mean frame at least this much faster to stay (5 %: one resolution step on a
 * phone saves 7–17 %, and a strict bar undid a 7 % step that the next, bigger step stood behind).
 */
const HELPS = 0.95;
/** Time slow before dropping a level (sooner when far too slow); time fast before raising one (doubles each raise). */
const DROP_AFTER_MS = 2500;
const DROP_AFTER_VERY_SLOW_MS = 1200;
const RAISE_AFTER_MS = 12_000;
const MAX_RAISE_AFTER_MS = 120_000;
/** After a drop that did not help, no new drop for this long (then it tries again: the game changes). */
const PIN_MS = 30_000;
/** Decisions are taken this often (the window is 2 s: every frame would only sort the same data). */
const DECIDE_MS = 250;
/** Ring capacity: a full window at 144 Hz with room to spare. */
const CAP = 512;

export interface QualityLevel {
  /** Pixel ratio of the canvas at this level. */
  dpr: number;
  /** Invisible savings: jelly vertex density, fine detail on tiny coins, cache refresh rates. */
  lite: boolean;
  /** The renderer's simplified look (last resort): fewer particles per burst, a thinner coin rain. */
  low: boolean;
}

/**
 * The levels for a canvas whose full pixel ratio is `dpr`: full quality, then
 * each resolution step that still gives at least `MIN_DPR` device px per CSS
 * px and differs from the previous one (with the invisible savings on), then
 * the low look at the lowest resolution. A screen with no resolution to give
 * still gets the invisible savings as a level of their own.
 */
export function qualityLevels(dpr: number): QualityLevel[] {
  const out: QualityLevel[] = [{ dpr, lite: false, low: false }];
  for (let i = 1; i < RES_STEPS.length; i++) {
    const d = Math.max(Math.min(dpr, MIN_DPR), Math.min(dpr, Math.round(dpr * RES_STEPS[i] * 100) / 100));
    if (d < out[out.length - 1].dpr - 0.04) out.push({ dpr: d, lite: true, low: false });
  }
  if (out.length === 1) out.push({ dpr, lite: true, low: false });
  out.push({ dpr: out[out.length - 1].dpr, lite: true, low: true });
  return out;
}

export class FrameGovernor {
  /** Ring of [timestamp, interval] for the last WINDOW_MS. */
  private readonly ts = new Float64Array(CAP);
  private readonly dts = new Float64Array(CAP);
  private head = 0;
  private count = 0;
  /** Sort scratch (the live intervals, sorted). */
  private readonly scratch = new Float64Array(CAP);
  private last = 0;
  private lastDecision = 0;
  private slowSince = 0;
  private fastSince = 0;
  private raiseAfter = RAISE_AFTER_MS;
  private lastChange = -Infinity;
  /**
   * Mean interval before the last drop (to check that it helped), 0 when not pending. The mean,
   * not the median: intervals snap to whole refresh periods (66.7, 83.3 ms…), so a drop that
   * helps a lot can leave the median where it was.
   */
  private beforeDrop = 0;
  private pinnedUntil = 0;
  /** Refresh period estimate, ms. */
  refreshMs = 1000 / 60;
  level = 0;
  /** Off: the level stays 0. */
  enabled = true;
  /** Highest level (levels.length - 1 of `qualityLevels`). */
  maxLevel = 1;

  /** Forget the history (after a resize, a screen change or a hidden tab). */
  reset(now: number): void {
    this.count = 0;
    this.last = 0;
    this.slowSince = 0;
    this.fastSince = 0;
    this.beforeDrop = 0;
    this.lastChange = now;
  }

  /**
   * Records one animation frame at `now` (ms). `active` is false while nothing
   * worth measuring is drawn (lobby, hidden tab). Returns true when the level changed.
   */
  frame(now: number, active = true): boolean {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    if (!this.enabled || this.level > this.maxLevel) {
      if (this.level === 0) return false;
      this.level = this.enabled ? this.maxLevel : 0;
      this.changed(now);
      return true;
    }
    if (!active || dt <= 0 || dt > MAX_INTERVAL_MS) {
      this.slowSince = 0;
      this.fastSince = 0;
      return false;
    }
    // record (overwriting the oldest when full), then forget what left the window
    const slot = (this.head + this.count) % CAP;
    this.ts[slot] = now;
    this.dts[slot] = dt;
    if (this.count < CAP) this.count++;
    else this.head = (this.head + 1) % CAP;
    while (this.count > 0 && this.ts[this.head] < now - WINDOW_MS) {
      this.head = (this.head + 1) % CAP;
      this.count--;
    }
    // decisions need a full window after the last change, and come a few times a second
    if (now - this.lastChange < WINDOW_MS || this.count < MIN_FRAMES || now - this.lastDecision < DECIDE_MS) return false;
    this.lastDecision = now;

    const n = this.count;
    const s = this.scratch;
    // insertion sort in place (TypedArray#sort copies into a work array: garbage on every decision)
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.dts[(this.head + i) % CAP];
      sum += v;
      let j = i - 1;
      while (j >= 0 && s[j] > v) {
        s[j + 1] = s[j];
        j--;
      }
      s[j + 1] = v;
    }
    const p10 = s[Math.floor(n * 0.1)];
    const p50 = s[Math.floor(n * 0.5)];
    const mean = sum / n;
    let refresh = PERIODS[PERIODS.length - 1];
    for (const p of PERIODS) if (p <= p10 * 1.05) refresh = p;
    this.refreshMs = refresh;

    if (this.beforeDrop) {
      // the first full window after a drop: undo it if it did not help and the frames sit flat on a
      // cap (a 30 Hz power saver: lower quality cannot beat it). Uneven frames are a busy CPU, and a
      // live game is too noisy for one window to prove a drop useless: those keep it.
      const before = this.beforeDrop;
      this.beforeDrop = 0;
      const p90 = s[Math.floor(n * 0.9)];
      const capped = p90 - p10 < refresh * 0.25;
      if (mean > before * HELPS && capped) {
        this.level--;
        this.pinnedUntil = now + PIN_MS;
        this.changed(now);
        return true;
      }
    }

    const slow = p50 > Math.max(refresh * SLOW_RATIO, refresh + SLOW_EXTRA_MS);
    const fast = p50 <= refresh * FAST_RATIO;
    if (slow) {
      this.fastSince = 0;
      this.slowSince ||= now;
      const after = p50 > refresh * VERY_SLOW_RATIO ? DROP_AFTER_VERY_SLOW_MS : DROP_AFTER_MS;
      if (now - this.slowSince >= after && this.level < this.maxLevel && now >= this.pinnedUntil) {
        this.level++;
        this.changed(now);
        this.beforeDrop = mean;
        return true;
      }
    } else if (fast && this.level > 0) {
      this.slowSince = 0;
      this.fastSince ||= now;
      if (now - this.fastSince >= this.raiseAfter) {
        this.level--;
        // each raise waits longer for the next one, so a borderline device does not flip back and forth
        this.raiseAfter = Math.min(this.raiseAfter * 2, MAX_RAISE_AFTER_MS);
        this.changed(now);
        return true;
      }
    } else {
      this.slowSince = 0;
      this.fastSince = 0;
    }
    return false;
  }

  private changed(now: number): void {
    this.count = 0;
    this.slowSince = 0;
    this.fastSince = 0;
    this.beforeDrop = 0;
    this.lastChange = now;
  }
}

/**
 * Automatic quality drop. Watches the intervals between animation frames and,
 * when frames stay slow for a while, steps the canvas resolution down (on
 * high-DPI screens only: never below one device pixel per CSS pixel), then, as
 * a last step, switches the renderer to its low-quality look (no jelly, no
 * coin rain, fewer particles) without touching the player's settings
 * (`qualityLevels`). When frames are fast again for long enough it steps back up.
 *
 * "Slow" is relative to the display: the refresh period is the standard period
 * (144, 120, 90 or 60 Hz) that matches the fastest recent frames. A drop that
 * does not make frames faster (a 30 Hz power-saving cap, a GPU-bound page that
 * is limited elsewhere) is undone and the governor stays put for a while.
 * Pure logic (no DOM), driven by `frame()` with timestamps.
 */

/** Resolution multipliers tried in turn (each must change the canvas size to count as a level). */
export const RES_STEPS = [1, 0.85, 0.7] as const;

const PERIODS = [1000 / 144, 1000 / 120, 1000 / 90, 1000 / 60];
/** Seconds of history the decisions look at. */
const WINDOW_MS = 2000;
/** Frames longer than this (tab hidden, a debugger) are ignored. */
const MAX_INTERVAL_MS = 250;
/** Slow: the median frame takes this much longer than the refresh period. */
const SLOW_RATIO = 1.35;
const SLOW_EXTRA_MS = 6;
/** Fast enough to step back up. */
const FAST_RATIO = 1.12;
/** A drop must make the median frame at least this much faster to stay. */
const HELPS = 0.92;
/** Time slow before dropping a level; time fast before raising one (doubles each raise). */
const DROP_AFTER_MS = 2500;
const RAISE_AFTER_MS = 12_000;
const MAX_RAISE_AFTER_MS = 120_000;
/** After a drop that did not help, no new drop for this long. */
const PIN_MS = 60_000;

export interface QualityLevel {
  /** Pixel ratio of the canvas at this level. */
  dpr: number;
  /** The renderer uses its low-quality look. */
  low: boolean;
}

/**
 * The levels for a canvas whose full pixel ratio is `dpr`: the resolution
 * steps that still give at least one device px per CSS px and differ from
 * the previous one, then the low look at the lowest resolution.
 */
export function qualityLevels(dpr: number): QualityLevel[] {
  const out: QualityLevel[] = [];
  for (const k of RES_STEPS) {
    const d = Math.max(1, Math.min(dpr, Math.round(dpr * k * 100) / 100));
    if (!out.length || d < out[out.length - 1].dpr - 0.04) out.push({ dpr: d, low: false });
  }
  out.push({ dpr: out[out.length - 1].dpr, low: true });
  return out;
}

export class FrameGovernor {
  /** [timestamp, interval] pairs of the last WINDOW_MS. */
  private times: number[] = [];
  private last = 0;
  private slowSince = 0;
  private fastSince = 0;
  private raiseAfter = RAISE_AFTER_MS;
  private lastChange = -Infinity;
  /** Median before the last drop (to check that it helped), 0 when not pending. */
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
    this.times.length = 0;
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
    const t = this.times;
    t.push(now, dt);
    let cut = 0;
    while (cut < t.length && t[cut] < now - WINDOW_MS) cut += 2;
    if (cut > 0) t.splice(0, cut);
    // decisions need a full window after the last change
    if (now - this.lastChange < WINDOW_MS || t.length < 40) return false;

    const ds: number[] = [];
    for (let i = 1; i < t.length; i += 2) ds.push(t[i]);
    ds.sort((a, b) => a - b);
    const p10 = ds[Math.floor(ds.length * 0.1)];
    const p50 = ds[Math.floor(ds.length * 0.5)];
    let refresh = PERIODS[PERIODS.length - 1];
    for (const p of PERIODS) if (p <= p10 * 1.05) refresh = p;
    this.refreshMs = refresh;

    if (this.beforeDrop) {
      // the first full window after a drop: keep it only if it helped
      const before = this.beforeDrop;
      this.beforeDrop = 0;
      if (p50 > before * HELPS) {
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
      if (now - this.slowSince >= DROP_AFTER_MS && this.level < this.maxLevel && now >= this.pinnedUntil) {
        this.level++;
        this.changed(now);
        this.beforeDrop = p50;
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
    this.times.length = 0;
    this.slowSince = 0;
    this.fastSince = 0;
    this.beforeDrop = 0;
    this.lastChange = now;
  }
}

import { create } from 'zustand';

/** localStorage key: set once the first-play brief has been read (or waved away). */
export const BRIEF_KEY = 'elymum.brief';

interface BriefState {
  open: boolean;
  /** `first`: shown before a newcomer's first join (closing it joins); `again`: re-opened from How to play. */
  mode: 'first' | 'again';
  /** The room the held join is for (`arena:…` adds the ticket line). */
  room: string | null;
}

export const useBrief = create<BriefState>(() => ({ open: false, mode: 'first', room: null }));

/** Storage can be blocked (private mode, sandboxed frames): then the brief is remembered for this page only. */
let seenHere = false;
/** The join waiting for the brief to close. */
let pending: (() => void) | null = null;

export function briefSeen(): boolean {
  if (seenHere) return true;
  try {
    return localStorage.getItem(BRIEF_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  seenHere = true;
  try {
    localStorage.setItem(BRIEF_KEY, '1');
  } catch {
    /* storage blocked: remembered for this page */
  }
}

/**
 * A newcomer's first join waits behind the brief, so nobody is dropped into the
 * ring (and eaten) while reading it. Returns true when the join was held; `join`
 * runs once the brief is closed. A second call while it is open replaces the held join.
 */
export function holdForBrief(room: string, join: () => void): boolean {
  if (briefSeen()) return false;
  pending = join;
  useBrief.setState({ open: true, mode: 'first', room });
  return true;
}

/** Shows the brief again (How to play), or once over a game that started without it. */
export function openBrief(mode: 'first' | 'again' = 'again', room: string | null = null): void {
  useBrief.setState({ open: true, mode, room });
}

/** Closes the brief, remembers it and lets the held join go. */
export function closeBrief(): void {
  if (!useBrief.getState().open) return;
  markSeen();
  const join = pending;
  pending = null;
  useBrief.setState({ open: false });
  join?.();
}

/** Tests: forget everything. */
export function resetBrief(): void {
  seenHere = false;
  pending = null;
  useBrief.setState({ open: false, mode: 'first', room: null });
}

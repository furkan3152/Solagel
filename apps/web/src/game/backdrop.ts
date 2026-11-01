/**
 * Whether the lobby's paper covers the whole game canvas. The lobby shows the
 * live world only through its window (wide screens, the tickets page); while
 * that window is scrolled off screen, or the layout has none, nothing of the
 * world can be seen and the engine skips drawing it (the world itself keeps
 * updating, so the first frame back is current).
 */
let covered = false;

export function setWorldCovered(v: boolean): void {
  covered = v;
}

/** True while the lobby is up and none of the world shows through it. */
export function worldCovered(): boolean {
  return covered;
}

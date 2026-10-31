import { VIEW, clamp, viewSize } from '@elymum/shared';
import { zoomIn } from '../design/curves';

export class Camera {
  x = 2800;
  y = 2800;
  zoom = 0.6;
  /** User zoom (mouse wheel), limited so we never show past the server's margin. */
  userZoom = 1;
  w = 1;
  h = 1;
  private initialized = false;
  /** Zoom without the transition multipliers (the follow target). */
  private base = 0.6;
  /** Entering a room: the camera falls from far to normal (`zoomIn` curve), seconds elapsed / length. */
  private intro: { t: number; dur: number; from: number } | null = null;
  /** Death slow motion: a slight push in (multiplier, eased back by the engine). */
  push = 1;

  /** Starts the fall into the world (lobby → game). `dur` in seconds; 0 cancels. */
  zoomIntro(dur: number, from = 0.42): void {
    this.intro = dur > 0 ? { t: 0, dur, from } : null;
  }

  /** True while the entering zoom runs. */
  get introducing(): boolean {
    return this.intro !== null;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  /** Smoothly follows a target; `snap` jumps immediately (first frame / respawn). */
  follow(tx: number, ty: number, visibleShort: number, dt: number, snap = false): void {
    const shortPx = Math.min(this.w, this.h);
    const targetZoom = (shortPx / visibleShort) * this.userZoom;
    if (snap || !this.initialized) {
      this.x = tx;
      this.y = ty;
      this.base = targetZoom;
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * 9);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
      const kz = 1 - Math.exp(-dt * 4.5);
      this.base += (targetZoom - this.base) * kz;
    }
    let mul = this.push;
    if (this.intro) {
      this.intro.t += dt;
      const p = this.intro.t / this.intro.dur;
      mul *= zoomIn(p, this.intro.from);
      if (p >= 1) this.intro = null;
    }
    this.zoom = this.base * mul;
  }

  /** Visible short side (world units) for a mass, honouring the screen aspect. */
  visibleShortFor(mass: number, spectator = false): number {
    const v = viewSize(mass, this.w / Math.max(1, this.h), spectator);
    return Math.min(v.w, v.h);
  }

  wheel(deltaY: number): void {
    const f = Math.exp(-deltaY * 0.0012);
    this.userZoom = clamp(this.userZoom * f, 1 / (VIEW.serverMargin - 0.04), 1.6);
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + (sx - this.w / 2) / this.zoom, y: this.y + (sy - this.h / 2) / this.zoom };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.w / 2, y: (wy - this.y) * this.zoom + this.h / 2 };
  }

  /** World rectangle currently on screen (plus padding in world units). */
  visibleRect(pad = 0): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.w / 2 / this.zoom + pad;
    const hh = this.h / 2 / this.zoom + pad;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}

import { VIEW, clamp, viewSize } from '@solagel/shared';

export class Camera {
  x = 2800;
  y = 2800;
  zoom = 0.6;
  /** User zoom (mouse wheel), limited so we never show past the server's margin. */
  userZoom = 1;
  w = 1;
  h = 1;
  private initialized = false;

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
      this.zoom = targetZoom;
      this.initialized = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 9);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    const kz = 1 - Math.exp(-dt * 4.5);
    this.zoom += (targetZoom - this.zoom) * kz;
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

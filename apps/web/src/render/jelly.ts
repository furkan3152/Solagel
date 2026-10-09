const TAU = Math.PI * 2;

export interface Neighbour {
  /** Centre relative to this cell's centre. */
  dx: number;
  dy: number;
  r: number;
}

/**
 * Wobbly "jelly" outline for a cell: each vertex has a radial displacement
 * (fraction of r) driven by springs, neighbour smoothing, contact with other
 * cells and little bumps when the cell grows.
 */
export class JellyBody {
  private n = 0;
  private d = new Float32Array(0);
  private v = new Float32Array(0);
  private lastR = 0;

  private ensure(n: number): void {
    if (n === this.n) return;
    this.n = n;
    this.d = new Float32Array(n);
    this.v = new Float32Array(n);
  }

  /**
   * @param dt seconds
   * @param r world radius
   * @param screenR radius in pixels (sets vertex count)
   * @param moveX,moveY normalised velocity (for a subtle squash)
   */
  update(dt: number, r: number, screenR: number, moveX: number, moveY: number, neighbours: Neighbour[], rand: () => number): void {
    const n = Math.max(18, Math.min(72, Math.round(screenR / 3) & ~1));
    this.ensure(n);
    const d = this.d;
    const v = this.v;
    const step = Math.min(dt, 1 / 30);

    // growth bump (eating)
    if (this.lastR > 0 && r > this.lastR * 1.004) {
      const strength = Math.min(0.1, ((r - this.lastR) / this.lastR) * 2.5);
      for (let i = 0; i < n; i++) v[i] += (rand() - 0.5) * strength * 6;
    }
    this.lastR = r;

    const speed = Math.min(1, Math.hypot(moveX, moveY));
    const moveA = Math.atan2(moveY, moveX);

    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      let target = -0.022 * speed * Math.cos(a - moveA);
      // contact with other cells: flatten the vertex onto their boundary
      if (neighbours.length > 0) {
        const px = Math.cos(a) * r * (1 + d[i]);
        const py = Math.sin(a) * r * (1 + d[i]);
        for (const nb of neighbours) {
          const dist = Math.hypot(px - nb.dx, py - nb.dy);
          if (dist < nb.r) target = Math.min(target, d[i] - ((nb.r - dist) / r) * 0.85);
        }
        target = Math.max(target, -0.32);
      }
      const prev = d[(i + n - 1) % n];
      const next = d[(i + 1) % n];
      const acc = (target - d[i]) * 160 - v[i] * 11 + (prev + next - 2 * d[i]) * 70 + (rand() - 0.5) * 0.9;
      v[i] += acc * step;
    }
    for (let i = 0; i < n; i++) {
      d[i] += v[i] * step;
      if (d[i] > 0.12) d[i] = 0.12;
      else if (d[i] < -0.35) d[i] = -0.35;
    }
  }

  /** Adds the outline as a closed smooth path (caller begins/fills). */
  trace(ctx: CanvasRenderingContext2D, r: number): void {
    const n = this.n;
    if (n === 0) {
      ctx.arc(0, 0, r, 0, TAU);
      return;
    }
    const px = (i: number) => Math.cos(((i % n) / n) * TAU) * r * (1 + this.d[i % n]);
    const py = (i: number) => Math.sin(((i % n) / n) * TAU) * r * (1 + this.d[i % n]);
    // quadratic curves through midpoints → smooth closed blob
    let mx = (px(n - 1) + px(0)) / 2;
    let my = (py(n - 1) + py(0)) / 2;
    ctx.moveTo(mx, my);
    for (let i = 0; i < n; i++) {
      const x = px(i);
      const y = py(i);
      mx = (x + px(i + 1)) / 2;
      my = (y + py(i + 1)) / 2;
      ctx.quadraticCurveTo(x, y, mx, my);
    }
    ctx.closePath();
  }

  /** Kicks the jelly (split, pop, bounce). */
  poke(strength: number, rand: () => number): void {
    for (let i = 0; i < this.n; i++) this.v[i] += (rand() - 0.5) * strength;
  }
}

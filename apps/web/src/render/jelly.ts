const TAU = Math.PI * 2;

export interface Neighbour {
  /** Centre relative to this cell's centre. */
  dx: number;
  dy: number;
  r: number;
}

/** Unit vectors of the vertex angles per vertex count (shared by every body: no trig per frame). */
type Unit = { cos: Float64Array<ArrayBuffer>; sin: Float64Array<ArrayBuffer> };
const UNIT = new Map<number, Unit>();
function unit(n: number): Unit {
  let u = UNIT.get(n);
  if (!u) {
    u = { cos: new Float64Array(n), sin: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      u.cos[i] = Math.cos((i / n) * TAU);
      u.sin[i] = Math.sin((i / n) * TAU);
    }
    UNIT.set(n, u);
  }
  return u;
}

/**
 * Wobbly "jelly" outline for a cell: each vertex has a radial displacement
 * (fraction of r) driven by springs, neighbour smoothing, contact with other
 * cells and little bumps when the cell grows. Allocation-free per frame
 * (vertex arrays are reused; the angle tables are shared).
 */
export class JellyBody {
  private n = 0;
  private d = new Float32Array(0);
  private v = new Float32Array(0);
  /** Scratch: radii of the shade outline (`traceShade`). */
  private q = new Float64Array(0);
  private cos: Float64Array<ArrayBuffer> = new Float64Array(0);
  private sin: Float64Array<ArrayBuffer> = new Float64Array(0);
  private lastR = 0;
  /**
   * Vertices per screen px of radius are `1 / density` (3: the full look; the automatic quality
   * drop raises it, an invisible saving: the outline stays smooth). Set by the renderer.
   */
  density = 3;

  private ensure(n: number): void {
    if (n === this.n) return;
    const d = new Float32Array(n);
    const v = new Float32Array(n);
    // keep the shape across a vertex-count change (resampled), so a zoom does not flatten the wobble
    if (this.n > 0) {
      for (let i = 0; i < n; i++) {
        const j = Math.floor((i / n) * this.n);
        d[i] = this.d[j];
        v[i] = this.v[j];
      }
    }
    this.n = n;
    this.d = d;
    this.v = v;
    this.q = new Float64Array(n);
    const u = unit(n);
    this.cos = u.cos;
    this.sin = u.sin;
  }

  /**
   * @param dt seconds
   * @param r world radius
   * @param screenR radius in pixels (sets vertex count)
   * @param moveX,moveY normalised velocity (for a subtle squash)
   * @param count how many of `neighbours` are live (the renderer's scratch array never shrinks)
   */
  update(dt: number, r: number, screenR: number, moveX: number, moveY: number, neighbours: Neighbour[], rand: () => number, count = neighbours.length): void {
    const n = Math.max(18, Math.min(72, Math.round(screenR / this.density) & ~1));
    this.ensure(n);
    const d = this.d;
    const v = this.v;
    const cos = this.cos;
    const sin = this.sin;
    const step = Math.min(dt, 1 / 30);
    // one draw from `rand` seeds this update's noise (an inline integer LCG: a call per vertex
    // returned a boxed number each time, the biggest garbage of a frame); still deterministic
    let seed = (Math.floor(rand() * 2147483645) + 1) | 0;

    // growth bump (eating)
    if (this.lastR > 0 && r > this.lastR * 1.004) {
      const strength = Math.min(0.1, ((r - this.lastR) / this.lastR) * 2.5);
      for (let i = 0; i < n; i++) {
        seed = (seed * 16807) % 2147483647;
        v[i] += (seed / 2147483647 - 0.5) * strength * 6;
      }
    }
    this.lastR = r;

    // (Math.sqrt, not Math.hypot: hypot is not inlined, so every result would be a boxed number)
    const ml = Math.sqrt(moveX * moveX + moveY * moveY);
    const speed = Math.min(1, ml);
    // cos(a − moveA) = cos a · mx + sin a · my for the unit move direction
    const mx = ml > 0 ? moveX / ml : 1;
    const my = ml > 0 ? moveY / ml : 0;
    const nn = count;

    for (let i = 0; i < n; i++) {
      const c = cos[i];
      const s = sin[i];
      let target = -0.022 * speed * (c * mx + s * my);
      // contact with other cells: flatten the vertex onto their boundary
      if (nn > 0) {
        const px = c * r * (1 + d[i]);
        const py = s * r * (1 + d[i]);
        for (let k = 0; k < nn; k++) {
          const nb = neighbours[k];
          const ex = px - nb.dx;
          const ey = py - nb.dy;
          const dist = Math.sqrt(ex * ex + ey * ey);
          if (dist < nb.r) target = Math.min(target, d[i] - ((nb.r - dist) / r) * 0.85);
        }
        target = Math.max(target, -0.32);
      }
      const prev = d[i === 0 ? n - 1 : i - 1];
      const next = d[i === n - 1 ? 0 : i + 1];
      seed = (seed * 16807) % 2147483647;
      const acc = (target - d[i]) * 160 - v[i] * 11 + (prev + next - 2 * d[i]) * 70 + (seed / 2147483647 - 0.5) * 0.9;
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
    smoothClosed(ctx, this.cos, this.sin, this.d, null, n, r);
  }

  /**
   * The cel shade without a clip: adds two closed sub-paths whose even-odd fill is the jelly body
   * minus the lit disc (centre `lx, ly`, radius `lr`, both in the coin's units). Along each vertex
   * ray the first is the farther of the outline and the lit disc's edge, the second the lit disc's
   * edge on the same rays, so where the lit disc reaches past the outline both run together and
   * cancel. Same look as filling the shade crescent clipped to the outline, at a fraction of the
   * raster cost (an anti-aliased clip is the most expensive thing a coin did).
   */
  traceShade(ctx: CanvasRenderingContext2D, r: number, lx: number, ly: number, lr: number): void {
    const n = this.n;
    if (n === 0) return;
    const { cos, sin, d, q } = this;
    // the lit disc's edge along the ray (the disc holds the centre: one positive root)
    const cc = lx * lx + ly * ly - lr * lr;
    for (let i = 0; i < n; i++) {
      const b = cos[i] * lx + sin[i] * ly;
      q[i] = b + Math.sqrt(b * b - cc);
    }
    // outline ∪ lit disc
    smoothClosed(ctx, cos, sin, d, q, n, r);
    // the lit disc on the same rays
    smoothClosed(ctx, cos, sin, null, q, n, 1);
  }

  /** Smallest and largest displacement right now (fraction of r); 0/0 before the first update. */
  extent(): { min: number; max: number } {
    let min = 0;
    let max = 0;
    const d = this.d;
    for (let i = 0; i < this.n; i++) {
      const x = d[i];
      if (x < min) min = x;
      else if (x > max) max = x;
    }
    this.ext.min = min;
    this.ext.max = max;
    return this.ext;
  }

  private readonly ext = { min: 0, max: 0 };

  /** Kicks the jelly (split, pop, bounce). */
  poke(strength: number, rand: () => number): void {
    for (let i = 0; i < this.n; i++) this.v[i] += (rand() - 0.5) * strength;
  }
}

/**
 * A closed smooth curve through rays: quadratic curves through the midpoints, with the vertices as
 * control points. Vertex radius `r·(1 + d[i])`, or `max(that, q[i])` with `q`, or `q[i]·r` alone
 * (`d` null).
 */
function smoothClosed(ctx: CanvasRenderingContext2D, cos: Float64Array, sin: Float64Array, d: Float32Array | null, q: Float64Array | null, n: number, r: number): void {
  const pr = radAt(d, q, r, n - 1);
  const px = cos[n - 1] * pr;
  const py = sin[n - 1] * pr;
  const cr = radAt(d, q, r, 0);
  let cx = cos[0] * cr;
  let cy = sin[0] * cr;
  ctx.moveTo((px + cx) / 2, (py + cy) / 2);
  for (let i = 0; i < n; i++) {
    const j = i === n - 1 ? 0 : i + 1;
    const nr = radAt(d, q, r, j);
    const nx = cos[j] * nr;
    const ny = sin[j] * nr;
    ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    cx = nx;
    cy = ny;
  }
  ctx.closePath();
}

function radAt(d: Float32Array | null, q: Float64Array | null, r: number, i: number): number {
  if (!d) return q![i] * r;
  const a = r * (1 + d[i]);
  return q && q[i] > a ? q[i] : a;
}

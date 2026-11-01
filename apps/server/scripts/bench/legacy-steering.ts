/**
 * Frozen copy of the bot steering as it was before the 2026-11 rewrite (`src/bots/steering.ts`), kept only
 * as the baseline for `bot-bench.ts` (old vs new). Not used by the server.
 */
/**
 * Context steering maps: every candidate direction ("slot") accumulates
 * interest (food, prey, power-ups…) and danger (threats, walls, viruses).
 * The bot then picks the slot with the best interest-minus-danger score.
 */
export const SLOTS = 24;
export const SLOT_ANGLE = (Math.PI * 2) / SLOTS;

const DIR_X = Array.from({ length: SLOTS }, (_, k) => Math.cos(k * SLOT_ANGLE));
const DIR_Y = Array.from({ length: SLOTS }, (_, k) => Math.sin(k * SLOT_ANGLE));

export class ContextMap {
  readonly interest = new Float64Array(SLOTS);
  readonly danger = new Float64Array(SLOTS);

  reset(): void {
    this.interest.fill(0);
    this.danger.fill(0);
  }

  /** Adds `weight` toward `angle`, spread over neighbouring slots with a cosine^power kernel. */
  addInterest(angle: number, weight: number, power = 2): void {
    addKernel(this.interest, angle, weight, power);
  }

  addDanger(angle: number, weight: number, power = 1): void {
    addKernel(this.danger, angle, weight, power, 0.35);
  }

  /** Adds danger to every slot whose look-ahead point leaves the world rectangle. */
  addWalls(cx: number, cy: number, lookahead: number, width: number, height: number, margin: number, weight: number): void {
    for (let k = 0; k < SLOTS; k++) {
      const px = cx + DIR_X[k] * lookahead;
      const py = cy + DIR_Y[k] * lookahead;
      let over = 0;
      if (px < margin) over += margin - px;
      if (px > width - margin) over += px - (width - margin);
      if (py < margin) over += margin - py;
      if (py > height - margin) over += py - (height - margin);
      if (over > 0) this.danger[k] += weight * Math.min(1, over / lookahead);
    }
  }

  /**
   * Picks the best direction. Slots whose danger is far above the safest slot
   * are masked out; a small bias toward `prevAngle` prevents jitter.
   * Returns an angle interpolated between neighbouring slots.
   */
  choose(prevAngle: number | null, dangerWeight: number, continuity = 0.12): number {
    let minDanger = Infinity;
    let maxDanger = 0;
    let maxInterest = 0;
    for (let k = 0; k < SLOTS; k++) {
      if (this.danger[k] < minDanger) minDanger = this.danger[k];
      if (this.danger[k] > maxDanger) maxDanger = this.danger[k];
      if (this.interest[k] > maxInterest) maxInterest = this.interest[k];
    }
    const maskAbove = minDanger + Math.max(0.25, (maxDanger - minDanger) * 0.45);
    const scores = new Float64Array(SLOTS);
    let best = -1;
    let bestScore = -Infinity;
    const contW = continuity * Math.max(maxInterest, 0.05);
    for (let k = 0; k < SLOTS; k++) {
      let s = this.interest[k] - this.danger[k] * dangerWeight;
      if (maxDanger > 0.2 && this.danger[k] > maskAbove) s -= 1e6;
      if (prevAngle !== null) s += contW * Math.cos(k * SLOT_ANGLE - prevAngle);
      scores[k] = s;
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    // parabolic interpolation between neighbours for a smoother heading
    const l = scores[(best + SLOTS - 1) % SLOTS];
    const r = scores[(best + 1) % SLOTS];
    const c = scores[best];
    const denom = l - 2 * c + r;
    let offset = 0;
    if (Number.isFinite(denom) && denom < -1e-9 && l > -1e5 && r > -1e5) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom));
    return (best + offset) * SLOT_ANGLE;
  }
}

function addKernel(arr: Float64Array, angle: number, weight: number, power: number, floor = 0): void {
  if (!(weight > 0) || !Number.isFinite(angle)) return;
  const pos = ((angle / SLOT_ANGLE) % SLOTS + SLOTS) % SLOTS;
  const centre = Math.round(pos);
  // ±6 slots covers ±90°
  for (let o = -6; o <= 6; o++) {
    const k = (centre + o + SLOTS) % SLOTS;
    const diff = (centre + o - pos) * SLOT_ANGLE;
    const cos = Math.cos(diff);
    const v = (cos + floor) / (1 + floor);
    if (v <= 0) continue;
    arr[k] += weight * Math.pow(v, power);
  }
}

export const angleTo = (fx: number, fy: number, tx: number, ty: number): number => Math.atan2(ty - fy, tx - fx);

export const angleDiff = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

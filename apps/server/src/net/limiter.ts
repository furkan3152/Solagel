/** Tiny fixed-window limiter for REST endpoints (per key: an IP or a wallet). */
export class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    /** Keys tracked at most (expired, then oldest windows are evicted beyond it). */
    private readonly maxKeys = 10_000,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      if (h) this.hits.delete(key);
      if (this.hits.size >= this.maxKeys) this.evict(now);
      // re-inserted: Map order stays oldest window first
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }

  /** Tracked keys (tests). */
  get size(): number {
    return this.hits.size;
  }

  /**
   * Makes room without resetting every counter: drops expired windows, then (still full) the oldest
   * windows of keys still under their limit, and only when every tracked key is over its limit the
   * oldest of those. A flood of fresh keys therefore never lifts the block of a rate-limited key.
   */
  private evict(now: number): void {
    for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    if (this.hits.size < this.maxKeys) return;
    let drop = Math.max(1, Math.floor(this.maxKeys / 10));
    for (const [k, v] of this.hits) {
      if (drop <= 0) return;
      if (v.n <= this.max) {
        this.hits.delete(k);
        drop--;
      }
    }
    for (const k of this.hits.keys()) {
      if (this.hits.size < this.maxKeys) return;
      this.hits.delete(k);
    }
  }
}

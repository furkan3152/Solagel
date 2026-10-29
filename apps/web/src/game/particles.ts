import { CARD_PAPER, INK, RISO } from '@elymum/art';

type Kind = 'splat' | 'coin' | 'scrap' | 'ring' | 'text' | 'dot';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  /** Per-particle shape seed (splat droplets). */
  seed: number;
  text?: string;
  /** Overprint ink (text, coins). */
  over?: string;
  /** Gravity in units/s² (coins and scraps fall onto the paper). */
  g: number;
}

const MAX = 900;
const TAU = Math.PI * 2;
const DISPLAY_FONT = '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif';

/**
 * Pooled world-space particles in the risograph style: ink splashes, flipping
 * mustard coins, paper scraps, rings and floating ink numbers.
 *
 * `reduced` (prefers-reduced-motion): nothing flies or scales; bursts collapse
 * into a single mark that only fades.
 */
export class Particles {
  private list: Particle[] = [];
  lowQuality = false;
  reduced = false;

  private add(p: Omit<Particle, 'seed' | 'g'> & { seed?: number; g?: number }): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({ seed: Math.random(), g: 0, ...p });
  }

  /** Ink splash where food was eaten: a blot and a few droplets, stamped in. */
  splat(x: number, y: number, color: string, size = 7): void {
    this.add({ kind: 'splat', x, y, vx: 0, vy: 0, life: 0, max: this.reduced ? 0.35 : 0.42, size, color, rot: Math.random() * TAU, vr: 0 });
  }

  /** Flat riso coins bursting out (bot kills spill tokens, my kills, cash-out). */
  coinBurst(x: number, y: number, r: number, n = 14, inks: [string, string] = [RISO.mustard, RISO.orange]): void {
    if (this.reduced) {
      this.ring(x, y, r, RISO.mustard);
      return;
    }
    if (this.lowQuality) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = r * (1.4 + Math.random() * 2.6);
      this.add({
        kind: 'coin',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - r * 0.8,
        life: 0,
        max: 0.75 + Math.random() * 0.45,
        size: Math.max(6, r * 0.13) * (0.7 + Math.random() * 0.6),
        color: inks[0],
        over: inks[1],
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        g: r * 4,
      });
    }
  }

  /** Paper scraps (a cell got eaten, a cactus popped). */
  scraps(x: number, y: number, r: number, n = 18, inks: string[] = [CARD_PAPER, RISO.fluoPink, RISO.teal, RISO.mustard]): void {
    if (this.reduced) {
      this.ring(x, y, r * 0.8, INK);
      return;
    }
    if (this.lowQuality) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = r * (0.9 + Math.random() * 2.4);
      this.add({
        kind: 'scrap',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - r * 0.6,
        life: 0,
        max: 0.8 + Math.random() * 0.6,
        size: Math.max(5, r * 0.09) * (0.6 + Math.random() * 0.8),
        color: inks[i % inks.length],
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 16,
        g: r * 2.2,
      });
    }
  }

  /** Ink dots kicked off a split / eject. */
  dots(x: number, y: number, r: number, color: string, n = 6): void {
    if (this.reduced || this.lowQuality) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random();
      this.add({ kind: 'dot', x, y, vx: Math.cos(a) * r * 1.4, vy: Math.sin(a) * r * 1.4, life: 0, max: 0.4, size: r * 0.09, color, rot: 0, vr: 0 });
    }
  }

  ring(x: number, y: number, r: number, color: string): void {
    this.add({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.5, size: r, color, rot: 0, vr: 0 });
  }

  /**
   * Floating ink number ("+1.250"): printed in `color` over a misregistered
   * `over` pass, rising and fading. `size` is in screen px.
   */
  text(x: number, y: number, text: string, color: string = INK, size = 22, over: string = RISO.fluoPink): void {
    this.add({ kind: 'text', x, y, vx: 0, vy: this.reduced ? 0 : -46, life: 0, max: 1.25, size, color, over, rot: (Math.random() - 0.5) * 0.12, vr: 0, text });
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === 'text' ? 1.4 : p.kind === 'scrap' ? 2.4 : 3.2;
      p.vx *= Math.exp(-drag * dt);
      p.vy = p.vy * Math.exp(-drag * dt) + p.g * dt;
      p.rot += p.vr * dt;
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  /** Draws in world space; `zoom` keeps text a constant on-screen size. */
  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    for (const p of this.list) {
      const k = p.life / p.max;
      switch (p.kind) {
        case 'splat':
          this.drawSplat(ctx, p, k);
          break;
        case 'coin': {
          ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          ctx.save();
          ctx.translate(p.x, p.y);
          const flip = Math.abs(Math.cos(p.rot)) * 0.85 + 0.15;
          ctx.scale(flip, 1);
          ctx.fillStyle = p.over!;
          ctx.beginPath();
          ctx.arc(p.size * 0.18, p.size * 0.16, p.size, 0, TAU);
          ctx.fill();
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, TAU);
          ctx.fill();
          ctx.lineWidth = p.size * 0.22;
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.lineWidth = p.size * 0.14;
          ctx.strokeStyle = CARD_PAPER;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.5, 3.6, 4.6);
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'scrap': {
          ctx.globalAlpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.abs(Math.sin(p.rot * 0.7)) * 0.7 + 0.3);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          // torn quad: a slightly irregular paper bit
          ctx.moveTo(-p.size * 0.5, -p.size * 0.3);
          ctx.lineTo(p.size * 0.45, -p.size * 0.38);
          ctx.lineTo(p.size * 0.52, p.size * 0.3);
          ctx.lineTo(-p.size * 0.42, p.size * 0.34);
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = Math.max(p.size * 0.12, 1 / zoom);
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'dot':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, TAU);
          ctx.fill();
          break;
        case 'ring':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(2 / zoom, p.size * 0.06);
          ctx.setLineDash([p.size * 0.12, p.size * 0.1]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (this.reduced ? 1 : 1 + k * 0.6), 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        case 'text': {
          const fs = p.size / zoom;
          // pop in (a stamp), hold, then fade while rising
          const pop = this.reduced ? 1 : k < 0.12 ? 1.25 - (k / 0.12) * 0.25 : 1;
          ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(pop, pop);
          ctx.font = `800 ${fs}px ${DISPLAY_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = fs * 0.24;
          ctx.strokeStyle = CARD_PAPER;
          ctx.strokeText(p.text!, 0, 0);
          ctx.fillStyle = p.over!;
          ctx.fillText(p.text!, fs * 0.07, fs * 0.06);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text!, 0, 0);
          ctx.restore();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawSplat(ctx: CanvasRenderingContext2D, p: Particle, k: number): void {
    // stamped in fast (no growth when reduced), held, faded
    const grow = this.reduced ? 1 : Math.min(1, k / 0.18);
    const ease = 1 - (1 - grow) ** 3;
    ctx.globalAlpha = (k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55) * 0.9;
    ctx.fillStyle = p.color;
    const s = p.size;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.55 * ease, 0, TAU);
    ctx.fill();
    // droplets thrown out along a seeded fan
    let h = Math.floor(p.seed * 1e6) | 1;
    for (let i = 0; i < 5; i++) {
      h = (h * 16807) % 2147483647;
      const a = (i / 5) * TAU + (h % 100) / 60;
      const d = s * (0.85 + ((h >> 3) % 100) / 110) * ease;
      const dr = s * (0.1 + ((h >> 7) % 100) / 700);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, dr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  clear(): void {
    this.list.length = 0;
  }
}

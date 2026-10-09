import { starPath } from '../render/symbols';

type Kind = 'spark' | 'coin' | 'confetti' | 'puff' | 'text' | 'ring';

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
  text?: string;
  /** Screen-constant size (text). */
  screen?: boolean;
}

const MAX = 900;

/** Pooled world-space particles: sparkles, coin bursts, confetti, floating text. */
export class Particles {
  private list: Particle[] = [];
  lowQuality = false;

  private add(p: Particle): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push(p);
  }

  sparkle(x: number, y: number, color: string, n = 3, size = 6): void {
    if (this.lowQuality) n = Math.min(n, 1);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 90;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.35 + Math.random() * 0.2, size, color, rot: 0, vr: 0 });
    }
  }

  coinBurst(x: number, y: number, r: number, colors: string[], n = 12): void {
    if (this.lowQuality) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = r * (1.5 + Math.random() * 2.5);
      this.add({
        kind: 'coin',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.6 + Math.random() * 0.4,
        size: Math.max(6, r * 0.12) * (0.7 + Math.random() * 0.6),
        color: colors[i % colors.length],
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  confetti(x: number, y: number, r: number, n = 24): void {
    if (this.lowQuality) n = Math.ceil(n / 3);
    const colors = ['#FF8FB8', '#7CC8FF', '#4FE0A8', '#FFE873', '#C9B6FF', '#FFB38A'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = r * (1 + Math.random() * 3);
      this.add({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - r,
        life: 0,
        max: 0.9 + Math.random() * 0.6,
        size: Math.max(5, r * 0.08),
        color: colors[i % colors.length],
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 16,
      });
    }
  }

  puff(x: number, y: number, r: number, color = 'rgba(255,255,255,0.8)'): void {
    if (this.lowQuality) return;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random();
      this.add({ kind: 'puff', x, y, vx: Math.cos(a) * r * 1.2, vy: Math.sin(a) * r * 1.2, life: 0, max: 0.45, size: r * 0.35, color, rot: 0, vr: 0 });
    }
  }

  ring(x: number, y: number, r: number, color: string): void {
    this.add({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.5, size: r, color, rot: 0, vr: 0 });
  }

  text(x: number, y: number, text: string, color: string, size = 22): void {
    this.add({ kind: 'text', x, y, vx: 0, vy: -60, life: 0, max: 1.1, size, color, rot: 0, vr: 0, text, screen: true });
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === 'confetti' ? 2.2 : p.kind === 'text' ? 1.5 : 4;
      p.vx *= Math.exp(-drag * dt);
      p.vy *= Math.exp(-drag * dt);
      if (p.kind === 'confetti') p.vy += 220 * dt;
      p.rot += p.vr * dt;
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  /** Draws in world space; `zoom` keeps text a constant on-screen size. */
  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    for (const p of this.list) {
      const k = p.life / p.max;
      ctx.globalAlpha = 1 - k * k;
      switch (p.kind) {
        case 'spark':
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          starPath(ctx, p.size * (1 - k * 0.5), p.size * 0.35, 4, 0);
          ctx.fill();
          ctx.restore();
          break;
        case 'coin':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.scale(Math.abs(Math.cos(p.rot)) * 0.8 + 0.2, 1);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(120,70,0,0.45)';
          ctx.lineWidth = p.size * 0.25;
          ctx.stroke();
          ctx.restore();
          break;
        case 'confetti':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        case 'puff':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + k), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(2 / zoom, p.size * 0.06);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + k * 0.6), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'text': {
          const fs = p.size / zoom;
          ctx.font = `700 ${fs}px Fredoka, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = fs * 0.22;
          ctx.strokeStyle = '#2B1B44';
          ctx.lineJoin = 'round';
          const y = p.y - (k * 40) / zoom;
          ctx.strokeText(p.text!, p.x, y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text!, p.x, y);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.list.length = 0;
  }
}

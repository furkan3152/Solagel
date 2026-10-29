import { CARD_PAPER, ELYSIUM, INK, SHADE, TEXT_INKS } from '@elymum/art';

type Kind = 'splat' | 'coin' | 'scrap' | 'ring' | 'text' | 'dot' | 'wave';

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
  /** Gravity in units/s² (coins and scraps fall onto the floor). */
  g: number;
  /** Text advance at a 100 px font (measured once, lazily). */
  tw?: number;
}

const MAX = 900;
const TAU = Math.PI * 2;
const MONO_FONT = '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';

/** Paints that need a darker ink to read as text on cream sticker stock. */
const ON_CREAM: Record<string, string> = {
  [ELYSIUM.down]: TEXT_INKS.day.down,
  [ELYSIUM.up]: TEXT_INKS.day.up,
  [ELYSIUM.teal]: TEXT_INKS.day.teal,
  [ELYSIUM.cyan]: TEXT_INKS.day.cyan,
  [ELYSIUM.sun]: TEXT_INKS.day.sun,
};

/** Light paints: on a dark floor an "ink" mark would vanish, so it is drawn in cream. */
const visible = (color: string): string => (color === INK ? CARD_PAPER : color);

/**
 * Pooled world-space particles in the Storybook style: eat pops (a flat
 * flash and comic pop lines), flipping gold coins, die-cut confetti with ink
 * edges, single expanding rings (the bell wave) and "+value" stickers.
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

  /** Eat pop where food was eaten: a flat flash of the food's colour and five pop lines. */
  splat(x: number, y: number, color: string, size = 7): void {
    this.add({ kind: 'splat', x, y, vx: 0, vy: 0, life: 0, max: this.reduced ? 0.35 : 0.42, size, color, rot: Math.random() * TAU, vr: 0 });
  }

  /** Gold coins bursting out (bot kills spill tokens, my kills, cash-out); `inks` = [fill, shade]. */
  coinBurst(x: number, y: number, r: number, n = 14, inks: [string, string] = [ELYSIUM.sun, SHADE.sun]): void {
    if (this.reduced) {
      this.ring(x, y, r, ELYSIUM.sun);
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

  /** Die-cut confetti (a cell got eaten, a thorn bush popped). */
  scraps(x: number, y: number, r: number, n = 18, inks: string[] = [CARD_PAPER, ELYSIUM.blush, ELYSIUM.cyan, ELYSIUM.sun]): void {
    if (this.reduced) {
      this.ring(x, y, r * 0.8, CARD_PAPER);
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

  /** Little paint dots kicked off a split / eject. */
  dots(x: number, y: number, r: number, color: string, n = 6): void {
    if (this.reduced || this.lowQuality) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random();
      this.add({ kind: 'dot', x, y, vx: Math.cos(a) * r * 1.4, vy: Math.sin(a) * r * 1.4, life: 0, max: 0.4, size: r * 0.09, color, rot: 0, vr: 0 });
    }
  }

  /** A single ring expanding from r and fading (an ink edge around a paint line). */
  ring(x: number, y: number, r: number, color: string): void {
    this.add({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.5, size: r, color, rot: 0, vr: 0 });
  }

  /** The bell wave: one big ring rolling out over the floor (sun by default), slower than `ring`. */
  wave(x: number, y: number, r: number, color: string = ELYSIUM.sun): void {
    this.add({ kind: 'wave', x, y, vx: 0, vy: 0, life: 0, max: this.reduced ? 0.6 : 1.1, size: r, color, rot: 0, vr: 0 });
  }

  /**
   * A "+value" sticker: mono text in `color` on a die-cut sticker of `over`
   * stock (cream unless a sun/mist/foam stock is asked for), ink edge and a
   * hard shadow; it pops in tilted, rises and fades. `size` is in screen px.
   */
  text(x: number, y: number, text: string, color: string = INK, size = 22, over: string = CARD_PAPER): void {
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

  /** Draws in world space; `zoom` keeps lines and text a constant on-screen size. */
  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    const ink = 1 / zoom;
    for (const p of this.list) {
      const k = p.life / p.max;
      switch (p.kind) {
        case 'splat':
          this.drawPop(ctx, p, k, ink);
          break;
        case 'coin': {
          ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          ctx.save();
          ctx.translate(p.x, p.y);
          const flip = Math.abs(Math.cos(p.rot)) * 0.85 + 0.15;
          ctx.scale(flip, 1);
          ctx.fillStyle = p.over!;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, TAU);
          ctx.fill();
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(-p.size * 0.14, -p.size * 0.18, p.size * 0.84, 0, TAU);
          ctx.fill();
          ctx.lineWidth = Math.min(p.size * 0.24, 2.5 * ink);
          ctx.strokeStyle = INK;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, TAU);
          ctx.stroke();
          ctx.lineWidth = p.size * 0.16;
          ctx.lineCap = 'round';
          ctx.strokeStyle = ELYSIUM.white;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.6, 3.5, 4.3);
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
          // a die-cut bit: a slightly irregular quad with soft corners
          ctx.moveTo(-p.size * 0.5, -p.size * 0.3);
          ctx.lineTo(p.size * 0.45, -p.size * 0.38);
          ctx.lineTo(p.size * 0.52, p.size * 0.3);
          ctx.lineTo(-p.size * 0.42, p.size * 0.34);
          ctx.closePath();
          ctx.fill();
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.min(p.size * 0.16, 2 * ink);
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'dot':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = visible(p.color);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, TAU);
          ctx.fill();
          break;
        case 'ring':
        case 'wave': {
          // one ring: ease-out growth, an ink edge around a paint line
          const e = this.reduced ? 1 : 1 - (1 - k) ** 3;
          const R = p.size * (this.reduced ? 1 : p.kind === 'wave' ? 1 + e * 2.2 : 1 + e * 0.6);
          ctx.globalAlpha = p.kind === 'wave' ? (1 - k) ** 1.5 : 1 - k;
          const w = (p.kind === 'wave' ? 4 : 3) * ink;
          ctx.beginPath();
          ctx.arc(p.x, p.y, R, 0, TAU);
          ctx.lineWidth = w + 3 * ink;
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.lineWidth = w;
          ctx.strokeStyle = visible(p.color);
          ctx.stroke();
          break;
        }
        case 'text':
          this.drawSticker(ctx, p, k, zoom);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** "+value" sticker: rounded die-cut stock, ink edge, 2 px hard shadow, mono text. */
  private drawSticker(ctx: CanvasRenderingContext2D, p: Particle, k: number, zoom: number): void {
    const fs = (p.size * 0.78) / zoom;
    const stock = p.over === ELYSIUM.sun || p.over === ELYSIUM.mist || p.over === ELYSIUM.foam ? p.over : CARD_PAPER;
    const color = p.color === CARD_PAPER || p.color === ELYSIUM.white ? INK : (ON_CREAM[p.color] ?? p.color);
    ctx.font = `700 100px ${MONO_FONT}`;
    p.tw ??= ctx.measureText(p.text!).width;
    const tw = (p.tw * fs) / 100;
    const padX = fs * 0.55;
    const w = tw + padX * 2;
    const h = fs * 1.6;
    // pop in (a sticker slapped on), hold, then fade while rising
    const pop = this.reduced ? 1 : k < 0.1 ? 0.6 + (k / 0.1) * 0.55 : k < 0.18 ? 1.15 - ((k - 0.1) / 0.08) * 0.15 : 1;
    ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(pop, pop);
    const sh = 2 / zoom;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(-w / 2 + sh, -h / 2 + sh, w, h, h * 0.32);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.32);
    ctx.fillStyle = stock;
    ctx.fill();
    ctx.lineWidth = 2.5 / zoom;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.font = `700 ${fs}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(p.text!, 0, fs * 0.05);
    ctx.restore();
  }

  /** Eat pop: a flat flash that grows and fades, ringed by five short pop lines. */
  private drawPop(ctx: CanvasRenderingContext2D, p: Particle, k: number, ink: number): void {
    const grow = this.reduced ? 1 : Math.min(1, k / 0.35);
    const ease = 1 - (1 - grow) ** 3;
    const s = p.size;
    const color = visible(p.color);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    // the flash
    ctx.globalAlpha = (1 - k) * 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, s * (0.5 + 0.5 * ease), 0, TAU);
    ctx.fill();
    // pop lines thrown out (paint dashes, like a comic "pop")
    ctx.globalAlpha = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
    const r0 = s * (0.65 + 0.55 * ease);
    const r1 = r0 + s * 0.45 * (1 - k * 0.6);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + p.seed * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ctx.moveTo(c * r0, sn * r0);
      ctx.lineTo(c * r1, sn * r1);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(Math.min(s * 0.2, 3.5 * ink), 2 * ink);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  clear(): void {
    this.list.length = 0;
  }
}

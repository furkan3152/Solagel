import { CellFlag, EMOTES, EntityKind, PlayerFlag, getSkin } from '@solagel/shared';
import type { Camera } from '../game/camera';
import type { Particles } from '../game/particles';
import type { CEntity, ClientWorld } from '../game/state';
import type { Settings } from '../store';
import { drawCoin } from './coin';
import type { Neighbour } from './jelly';
import { SpriteCache, drawSprite } from './sprites';

const TAU = Math.PI * 2;

export interface Theme {
  bg: string;
  grid: string;
  outside: string;
  borderA: string;
  borderB: string;
  text: string;
  textStroke: string;
}

export const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    bg: '#FFF6E9',
    grid: 'rgba(150,120,210,0.20)',
    outside: 'rgba(214,190,255,0.45)',
    borderA: '#FF8FB8',
    borderB: '#FFFFFF',
    text: '#FFFFFF',
    textStroke: '#2B1B44',
  },
  dark: {
    bg: '#1A1330',
    grid: 'rgba(150,130,240,0.16)',
    outside: 'rgba(5,2,15,0.55)',
    borderA: '#14F195',
    borderB: '#9945FF',
    text: '#FFFFFF',
    textStroke: '#120B24',
  },
};

export interface FrameInput {
  now: number;
  dt: number;
  world: ClientWorld;
  camera: Camera;
  particles: Particles;
  settings: Settings;
  /** Mouse target in world coordinates (for own eyes). */
  aim: { x: number; y: number } | null;
  cashout: { until: number; total: number } | null;
  coinRain: boolean;
  rand: () => number;
}

interface RainCoin {
  x: number;
  y: number;
  v: number;
  r: number;
  rot: number;
  vr: number;
  hue: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  readonly sprites = new SpriteCache();
  private dpr = 1;
  private rain: RainCoin[] = [];
  private stars: { x: number; y: number; s: number }[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  private ensureStars(world: ClientWorld): void {
    if (this.stars.length > 0) return;
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) this.stars.push({ x: rnd() * world.width, y: rnd() * world.height, s: 6 + rnd() * 10 });
  }

  draw(f: FrameInput): void {
    const { ctx } = this;
    const cam = f.camera;
    const theme = THEMES[f.settings.theme];
    const z = cam.zoom;
    const low = f.settings.quality === 'low';

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cam.w, cam.h);

    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cam.w / 2 - cam.x * z), this.dpr * (cam.h / 2 - cam.y * z));
    const view = cam.visibleRect(60);
    this.drawGrid(view, f, theme);

    // collect visible entities
    const food: CEntity[] = [];
    const ejects: CEntity[] = [];
    const powerUps: CEntity[] = [];
    const bodies: CEntity[] = [];
    for (const e of f.world.entities.values()) {
      if (e.x + e.r < view.x0 || e.x - e.r > view.x1 || e.y + e.r < view.y0 || e.y - e.r > view.y1) continue;
      switch (e.kind) {
        case EntityKind.Food:
          food.push(e);
          break;
        case EntityKind.Eject:
          ejects.push(e);
          break;
        case EntityKind.PowerUp:
          powerUps.push(e);
          break;
        default:
          bodies.push(e);
      }
    }

    // food (tiny pastel coins, twinkling)
    for (const e of food) {
      const sprite = this.sprites.foodSprite(e.variant);
      const pop = Math.min(1, (f.now - e.born) / 220);
      const tw = low ? 1 : 1 + Math.sin(f.now / 260 + e.seed * 40) * 0.08;
      if (e.variant === 7 && !low) {
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(f.now / 200 + e.seed * 10);
        ctx.fillStyle = '#FFE873';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 1.9, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawSprite(ctx, sprite, e.x, e.y, e.r * tw * (0.4 + 0.6 * pop));
    }

    for (const e of ejects) drawSprite(ctx, this.sprites.ejectSprite(e.variant), e.x, e.y, e.r);

    for (const e of powerUps) this.drawPowerUp(e, f);

    // cells and viruses: small first so bigger ones cover them
    bodies.sort((a, b) => a.r - b.r);
    const cells = bodies.filter((b) => b.kind === EntityKind.Cell);
    for (const e of bodies) {
      if (e.kind === EntityKind.Virus) {
        const wob = low ? 0 : Math.sin(f.now / 700 + e.seed * 10) * 0.04;
        drawSprite(ctx, this.sprites.cactusSprite(), e.x, e.y, e.r * 1.0, wob);
        continue;
      }
      this.drawCell(e, f, cells, theme);
    }

    if (f.cashout) this.drawCashoutRings(f);

    // emote bubbles on top of everything
    this.drawEmotes(f, cells);

    f.particles.draw(ctx, z);

    // screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCoinRain(f);
  }

  private drawGrid(view: { x0: number; y0: number; x1: number; y1: number }, f: FrameInput, theme: Theme): void {
    const { ctx } = this;
    const w = f.world;
    const z = f.camera.zoom;
    let step = 70;
    while (step * z < 22) step *= 2;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.4 / z;
    ctx.beginPath();
    const gx0 = Math.max(0, Math.floor(view.x0 / step) * step);
    const gx1 = Math.min(w.width, view.x1);
    const gy0 = Math.max(0, Math.floor(view.y0 / step) * step);
    const gy1 = Math.min(w.height, view.y1);
    for (let x = gx0; x <= gx1; x += step) {
      ctx.moveTo(x, Math.max(0, view.y0));
      ctx.lineTo(x, Math.min(w.height, view.y1));
    }
    for (let y = gy0; y <= gy1; y += step) {
      ctx.moveTo(Math.max(0, view.x0), y);
      ctx.lineTo(Math.min(w.width, view.x1), y);
    }
    ctx.stroke();

    // faint decorative sparkles
    if (f.settings.quality === 'high') {
      this.ensureStars(w);
      ctx.fillStyle = theme.grid;
      for (const s of this.stars) {
        if (s.x < view.x0 || s.x > view.x1 || s.y < view.y0 || s.y > view.y1) continue;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s.s / 2, -s.s / 8, s.s, s.s / 4);
        ctx.fillRect(-s.s / 8, -s.s / 2, s.s / 4, s.s);
        ctx.restore();
      }
    }

    // outside the world
    ctx.fillStyle = theme.outside;
    ctx.beginPath();
    ctx.rect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
    ctx.rect(0, 0, w.width, w.height);
    ctx.fill('evenodd');

    // candy-striped border
    const bw = Math.max(10, 7 / z);
    ctx.lineWidth = bw;
    ctx.strokeStyle = theme.borderB;
    ctx.strokeRect(-bw / 2, -bw / 2, w.width + bw, w.height + bw);
    ctx.strokeStyle = theme.borderA;
    ctx.setLineDash([bw * 2, bw * 2]);
    ctx.lineDashOffset = -f.now / 40;
    ctx.strokeRect(-bw / 2, -bw / 2, w.width + bw, w.height + bw);
    ctx.setLineDash([]);
  }

  private drawPowerUp(e: CEntity, f: FrameInput): void {
    const { ctx } = this;
    const age = f.now - e.born;
    const sprite = this.sprites.powerUpSprite(e.variant);
    const landing = Math.min(1, age / 900);
    const drop = (1 - landing) * (1 - landing) * 260;
    const bob = Math.sin(f.now / 300 + e.seed * 8) * e.r * 0.08;
    // glow
    ctx.globalAlpha = 0.25 + 0.12 * Math.sin(f.now / 250);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 1.45, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    // parachute while landing
    if (landing < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - landing * 0.6;
      ctx.translate(e.x, e.y - drop - e.r * 1.6);
      ctx.fillStyle = '#FF8FB8';
      ctx.strokeStyle = '#B83D6A';
      ctx.lineWidth = e.r * 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 1.1, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (const sx of [-1, -0.35, 0.35, 1]) {
        ctx.moveTo(sx * e.r * 1.05, 0);
        ctx.lineTo(sx * e.r * 0.3, e.r * 1.0);
      }
      ctx.stroke();
      ctx.restore();
    }
    drawSprite(ctx, sprite, e.x, e.y - drop + bob, e.r);
  }

  private drawCell(e: CEntity, f: FrameInput, cells: CEntity[], theme: Theme): void {
    const { ctx } = this;
    const z = f.camera.zoom;
    const player = f.world.players.get(e.playerId);
    const skin = getSkin(player?.skin ?? 0);
    const mine = e.playerId === f.world.myPid;
    const screenR = e.r * z;

    // eyes: own cells look at the cursor, others along their velocity
    let lx = 0;
    let ly = 0;
    if (mine && f.aim) {
      const dx = f.aim.x - e.x;
      const dy = f.aim.y - e.y;
      const d = Math.hypot(dx, dy);
      const k = Math.min(1, d / (e.r * 2 + 1));
      if (d > 0.01) {
        lx = (dx / d) * k;
        ly = (dy / d) * k;
      }
    } else {
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 5) {
        const k = Math.min(1, sp / 160);
        lx = (e.vx / sp) * k;
        ly = (e.vy / sp) * k;
      }
    }

    // jelly simulation (neighbours = overlapping cells)
    if (f.settings.quality === 'high' && e.jelly && screenR > 14) {
      const nbs: Neighbour[] = [];
      for (const o of cells) {
        if (o === e) continue;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        if (Math.abs(dx) > e.r + o.r || Math.abs(dy) > e.r + o.r) continue;
        if (Math.hypot(dx, dy) < e.r + o.r) nbs.push({ dx, dy, r: o.r });
      }
      const sp = Math.hypot(e.vx, e.vy);
      e.jelly.update(f.dt, e.r, screenR, sp > 1 ? (e.vx / sp) * Math.min(1, sp / 300) : 0, sp > 1 ? (e.vy / sp) * Math.min(1, sp / 300) : 0, nbs, f.rand);
    }

    const spawnPop = Math.min(1, (f.now - e.born) / 180);
    const r = e.r * (0.6 + 0.4 * spawnPop);
    drawCoin(ctx, e.x, e.y, r, skin, {
      time: f.now,
      lookX: lx,
      lookY: ly,
      expression: e.expression,
      pxPerUnit: z,
      jelly: f.settings.quality === 'high' ? e.jelly : null,
      flags: e.flags,
      seed: e.seed * 10 + e.playerId,
    });

    // labels
    if (!player || screenR < 20) return;
    const showName = f.settings.showNames;
    const showMass = f.settings.showMass && (mine || screenR > 34);
    if (!showName && !showMass) return;
    const fs = Math.max(r * 0.23, 11 / z);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let y = e.y + r * 0.56;
    if (showName) {
      ctx.font = `700 ${fs}px Fredoka, system-ui, sans-serif`;
      ctx.lineWidth = fs * 0.2;
      ctx.strokeStyle = theme.textStroke;
      const name = player.name;
      ctx.strokeText(name, e.x, y);
      ctx.fillStyle = theme.text;
      ctx.fillText(name, e.x, y);
      if (player.flags & PlayerFlag.Verified) {
        const w = ctx.measureText(name).width;
        const bx = e.x + w / 2 + fs * 0.45;
        ctx.fillStyle = '#14C98A';
        ctx.strokeStyle = theme.textStroke;
        ctx.lineWidth = fs * 0.08;
        ctx.beginPath();
        ctx.arc(bx, y, fs * 0.32, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = fs * 0.09;
        ctx.beginPath();
        ctx.moveTo(bx - fs * 0.14, y);
        ctx.lineTo(bx - fs * 0.03, y + fs * 0.11);
        ctx.lineTo(bx + fs * 0.16, y - fs * 0.12);
        ctx.stroke();
      }
      y += fs * 0.95;
    }
    if (showMass) {
      const mfs = fs * 0.72;
      ctx.font = `600 ${mfs}px Fredoka, system-ui, sans-serif`;
      ctx.lineWidth = mfs * 0.2;
      ctx.strokeStyle = theme.textStroke;
      const label = String(Math.floor((e.nr * e.nr) / 100));
      ctx.strokeText(label, e.x, y);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(label, e.x, y);
    }
  }

  private drawCashoutRings(f: FrameInput): void {
    const { ctx } = this;
    const c = f.cashout!;
    const p = Math.max(0, Math.min(1, 1 - (c.until - f.now) / c.total));
    for (const cell of f.world.myCells()) {
      if (!(cell.flags & CellFlag.CashingOut)) continue;
      const R = cell.r * 1.18;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(cell.r * 0.08, 4 / f.camera.zoom);
      ctx.strokeStyle = 'rgba(255,201,60,0.3)';
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, R, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#FFC93C';
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, R, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
    }
  }

  private drawEmotes(f: FrameInput, cells: CEntity[]): void {
    const { ctx } = this;
    const z = f.camera.zoom;
    const best = new Map<number, CEntity>();
    for (const c of cells) {
      const p = f.world.players.get(c.playerId);
      if (!p?.emote) continue;
      const cur = best.get(c.playerId);
      if (!cur || c.r > cur.r) best.set(c.playerId, c);
    }
    for (const [pid, c] of best) {
      const emote = f.world.players.get(pid)!.emote!;
      const def = EMOTES[emote.id];
      if (!def) continue;
      const age = f.now - emote.at;
      const pop = Math.min(1, age / 160);
      const fade = age > 2200 ? 1 - (age - 2200) / 400 : 1;
      const fs = 22 / z;
      ctx.font = `700 ${fs}px Fredoka, "Noto Color Emoji", system-ui, sans-serif`;
      const tw = ctx.measureText(def.text).width;
      const w = tw + fs * 1.0;
      const h = fs * 1.55;
      const x = c.x;
      const y = c.y - c.r - h * 0.9 - 6 / z;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(x, y);
      ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#2B1B44';
      ctx.lineWidth = 2.5 / z;
      const rr = h / 2;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + rr, -h / 2);
      ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, rr);
      ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, rr);
      ctx.lineTo(fs * 0.25, h / 2);
      ctx.lineTo(0, h / 2 + fs * 0.4);
      ctx.lineTo(-fs * 0.25, h / 2);
      ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, rr);
      ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, rr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2B1B44';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.text, 0, fs * 0.05);
      ctx.restore();
    }
  }

  private drawCoinRain(f: FrameInput): void {
    const { ctx } = this;
    const cam = f.camera;
    if (f.coinRain && f.settings.quality === 'high' && this.rain.length < 70) {
      for (let i = 0; i < 2; i++) {
        this.rain.push({
          x: f.rand() * cam.w,
          y: -30,
          v: 160 + f.rand() * 220,
          r: 6 + f.rand() * 9,
          rot: f.rand() * 6,
          vr: (f.rand() - 0.5) * 8,
          hue: f.rand() < 0.7 ? 45 : 320,
        });
      }
    }
    if (this.rain.length === 0) return;
    let w = 0;
    for (const c of this.rain) {
      c.y += c.v * f.dt;
      c.rot += c.vr * f.dt;
      if (c.y > cam.h + 30) continue;
      this.rain[w++] = c;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(Math.abs(Math.cos(c.rot)) * 0.85 + 0.15, 1);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = `hsl(${c.hue} 95% 62%)`;
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `hsl(${c.hue} 80% 38%)`;
      ctx.lineWidth = c.r * 0.22;
      ctx.stroke();
      ctx.restore();
    }
    this.rain.length = w;
  }

  /** Minimap: world outline, sectors, leaders (crowns) and you. */
  drawMinimap(mm: HTMLCanvasElement, f: { world: ClientWorld; camera: Camera; leaders: { x: number; y: number }[]; dark: boolean; now: number }): void {
    const ctx = mm.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = mm.clientWidth || 150;
    if (mm.width !== Math.round(size * dpr) || mm.height !== Math.round(size * dpr)) {
      mm.width = Math.round(size * dpr);
      mm.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const s = size / Math.max(f.world.width, f.world.height);
    ctx.fillStyle = f.dark ? 'rgba(20,12,40,0.75)' : 'rgba(255,255,255,0.75)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = f.dark ? 'rgba(150,130,240,0.25)' : 'rgba(110,86,196,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      ctx.moveTo((size * i) / 5, 0);
      ctx.lineTo((size * i) / 5, size);
      ctx.moveTo(0, (size * i) / 5);
      ctx.lineTo(size, (size * i) / 5);
    }
    ctx.stroke();
    ctx.fillStyle = f.dark ? 'rgba(200,190,255,0.35)' : 'rgba(110,86,196,0.35)';
    ctx.font = '600 9px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let cx = 0; cx < 5; cx++) for (let cy = 0; cy < 5; cy++) ctx.fillText(`${'ABCDE'[cy]}${cx + 1}`, (cx + 0.5) * (size / 5), (cy + 0.5) * (size / 5));

    // camera view
    const v = f.camera.visibleRect();
    ctx.strokeStyle = f.dark ? 'rgba(255,255,255,0.5)' : 'rgba(61,44,94,0.45)';
    ctx.strokeRect(v.x0 * s, v.y0 * s, (v.x1 - v.x0) * s, (v.y1 - v.y0) * s);

    // leaders
    f.leaders.forEach((l, i) => {
      ctx.fillStyle = ['#FFC93C', '#C9CDD9', '#E8875A'][i] ?? '#FFC93C';
      ctx.strokeStyle = '#2B1B44';
      ctx.lineWidth = 1.2;
      const x = l.x * s;
      const y = l.y * s;
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 3);
      ctx.lineTo(x - 5, y - 3);
      ctx.lineTo(x - 2.5, y);
      ctx.lineTo(x, y - 4.5);
      ctx.lineTo(x + 2.5, y);
      ctx.lineTo(x + 5, y - 3);
      ctx.lineTo(x + 5, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // me
    const me = f.world.myStats();
    if (me) {
      const pulse = 4 + Math.sin(f.now / 200) * 1.2;
      ctx.fillStyle = '#FF5C93';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(me.x * s, me.y * s, pulse, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
}

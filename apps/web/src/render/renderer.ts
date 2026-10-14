import { CARD_PAPER, INK, RISO, type CoinLook } from '@slana/art';
import { CellFlag, EntityKind, PlayerFlag, type PassStatus } from '@slana/shared';
import type { Camera } from '../game/camera';
import type { Particles } from '../game/particles';
import type { CEntity, ClientWorld } from '../game/state';
import type { Settings } from '../store';
import { stickerImage } from '../ui/game/stickers';
import { drawCoinLook } from './coin';
import type { Neighbour } from './jelly';
import { LookCache } from './looks';
import { SpriteCache, drawGlint, drawSprite } from './sprites';

const TAU = Math.PI * 2;
const DISPLAY_FONT = '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif';
const MONO_FONT = '"DM Mono", ui-monospace, monospace';

/** World print stock per theme (Kâğıt Bilet tokens; "Gece baskısı" for night). */
export interface WorldTheme {
  paper: string;
  /** Outside the map: a darker sheet with hatching. */
  outside: string;
  hatch: string;
  gridMinor: string;
  gridMajor: string;
  /** Map edge cut line. */
  edge: string;
  edgeOver: string;
  label: string;
  labelHalo: string;
  labelSub: string;
}

export const WORLD_THEMES: Record<'light' | 'dark', WorldTheme> = {
  light: {
    paper: '#F1EADB',
    outside: '#E4DCCB',
    hatch: 'rgba(30,27,46,0.11)',
    // light-blue millimetre paper
    gridMinor: 'rgba(60,140,220,0.16)',
    gridMajor: 'rgba(60,140,220,0.34)',
    edge: INK,
    edgeOver: RISO.fluoPink,
    label: INK,
    labelHalo: CARD_PAPER,
    labelSub: '#5D5870',
  },
  dark: {
    paper: '#1B1924',
    outside: '#131119',
    hatch: 'rgba(241,234,219,0.07)',
    gridMinor: 'rgba(110,170,255,0.08)',
    gridMajor: 'rgba(110,170,255,0.19)',
    edge: '#F1EADB',
    edgeOver: RISO.fluoPink,
    label: '#F1EADB',
    labelHalo: '#1B1924',
    labelSub: '#B3ADC2',
  },
};

/** Loot is drawn bigger by size tier (0 crumb … 3 jackpot). */
const LOOT_SCALE = [0.8, 1, 1.3, 1.75];

export interface FrameInput {
  now: number;
  dt: number;
  world: ClientWorld;
  camera: Camera;
  particles: Particles;
  settings: Settings;
  /** Slana Pass collection status (seed once revealed) for Pass looks. */
  pass: PassStatus | null;
  /** prefers-reduced-motion: idle loops stop. */
  reduced: boolean;
  /** Mouse target in world coordinates (for own eyes). */
  aim: { x: number; y: number } | null;
  /** Own cash-out channel (performance.now() end time and length). */
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
  ink: string;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  readonly sprites = new SpriteCache();
  private dpr = 1;
  private rain: RainCoin[] = [];
  private hatch: CanvasPattern | null = null;
  private hatchNight: boolean | null = null;
  private readonly looks = new LookCache();

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

  /** Coin look of a player (Pass / sealed / basic skin), cached. */
  lookFor(skin: number, pass: number, status: PassStatus | null): CoinLook {
    return this.looks.lookFor(skin, pass, status);
  }

  draw(f: FrameInput): void {
    const { ctx } = this;
    const cam = f.camera;
    const theme = WORLD_THEMES[f.settings.theme];
    const night = f.settings.theme === 'dark';
    const z = cam.zoom;
    const low = f.settings.quality === 'low';
    const still = low || f.reduced;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, cam.w, cam.h);

    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cam.w / 2 - cam.x * z), this.dpr * (cam.h / 2 - cam.y * z));
    const view = cam.visibleRect(60);
    this.drawPaper(view, f, theme, night);

    // collect visible entities
    const food: CEntity[] = [];
    const ejects: CEntity[] = [];
    const loot: CEntity[] = [];
    const powerUps: CEntity[] = [];
    const bodies: CEntity[] = [];
    for (const e of f.world.entities.values()) {
      const pad = e.r * 1.8;
      if (e.x + pad < view.x0 || e.x - pad > view.x1 || e.y + pad < view.y0 || e.y - pad > view.y1) continue;
      switch (e.kind) {
        case EntityKind.Food:
          food.push(e);
          break;
        case EntityKind.Eject:
          ejects.push(e);
          break;
        case EntityKind.Loot:
          loot.push(e);
          break;
        case EntityKind.PowerUp:
          powerUps.push(e);
          break;
        default:
          bodies.push(e);
      }
    }

    // food: riso confetti (pops in, golden coins get a dashed mustard halo)
    for (const e of food) {
      const pop = Math.min(1, (f.now - e.born) / 220);
      const sz = e.r * (0.4 + 0.6 * (1 - (1 - pop) ** 3));
      if (e.variant === 7) {
        ctx.save();
        ctx.strokeStyle = RISO.mustard;
        ctx.lineWidth = Math.max(e.r * 0.14, 1.5 / z);
        ctx.setLineDash([e.r * 0.3, e.r * 0.24]);
        ctx.lineDashOffset = still ? 0 : -f.now / 120;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 1.55, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      drawSprite(ctx, this.sprites.foodSprite(e.variant, e.seed), e.x, e.y, sz);
    }

    for (const e of ejects) drawSprite(ctx, this.sprites.ejectSprite(e.variant), e.x, e.y, e.r);

    for (const e of loot) this.drawLoot(e, f, still);

    for (const e of powerUps) this.drawPowerUp(e, f, still);

    // cells and cacti: small first so bigger ones cover them
    bodies.sort((a, b) => a.r - b.r);
    const cells = bodies.filter((b) => b.kind === EntityKind.Cell);
    const halftone = (r: number, sp: number) => this.sprites.halftone(r, sp, z * this.dpr);
    const cashP = f.cashout ? Math.max(0, Math.min(1, 1 - (f.cashout.until - f.now) / f.cashout.total)) : undefined;
    for (const e of bodies) {
      if (e.kind === EntityKind.Virus) {
        const wob = still ? 0 : Math.sin(f.now / 700 + e.seed * 10) * 0.04;
        drawSprite(ctx, this.sprites.cactusSprite(), e.x, e.y, e.r, wob);
        continue;
      }
      this.drawCell(e, f, cells, halftone, cashP);
    }

    // emote stickers on top of everything
    this.drawEmotes(f, cells);

    f.particles.draw(ctx, z);

    // screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCoinRain(f);
  }

  /** Paper stock: millimetre grid inside the map, hatched margin outside, grain, cut-line edge. */
  private drawPaper(view: { x0: number; y0: number; x1: number; y1: number }, f: FrameInput, theme: WorldTheme, night: boolean): void {
    const { ctx } = this;
    const w = f.world;
    const z = f.camera.zoom;

    // outside the map: a darker sheet with diagonal hatching
    if (view.x0 < 0 || view.y0 < 0 || view.x1 > w.width || view.y1 > w.height) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
      ctx.rect(0, 0, w.width, w.height);
      ctx.clip('evenodd');
      ctx.fillStyle = theme.outside;
      ctx.fillRect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
      const hatch = this.hatchPattern(theme, night);
      if (hatch) {
        // anchored to the world, constant on-screen spacing
        hatch.setTransform(new DOMMatrix().scaleSelf(1 / z, 1 / z));
        ctx.fillStyle = hatch;
        ctx.fillRect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
      }
      ctx.restore();
    }

    // millimetre grid: minor 20 u, major every 5th; minor fades out when zoomed out.
    // Axis-aligned hairlines are filled as thin rects (cheaper than stroking a path).
    const gx0 = Math.max(0, view.x0);
    const gx1 = Math.min(w.width, view.x1);
    const gy0 = Math.max(0, view.y0);
    const gy1 = Math.min(w.height, view.y1);
    let minor = 20;
    while (minor * z < 6) minor *= 5;
    const major = minor * 5;
    const minorPx = minor * z;
    if (minorPx < 40) {
      const t = 1 / z;
      ctx.globalAlpha = Math.min(1, (minorPx - 6) / 6 + 0.25);
      ctx.fillStyle = theme.gridMinor;
      for (let x = Math.ceil(gx0 / minor) * minor; x <= gx1; x += minor) if (x % major !== 0) ctx.fillRect(x - t / 2, gy0, t, gy1 - gy0);
      for (let y = Math.ceil(gy0 / minor) * minor; y <= gy1; y += minor) if (y % major !== 0) ctx.fillRect(gx0, y - t / 2, gx1 - gx0, t);
      ctx.globalAlpha = 1;
    }
    const tm = 1.25 / z;
    ctx.fillStyle = theme.gridMajor;
    for (let x = Math.ceil(gx0 / major) * major; x <= gx1; x += major) ctx.fillRect(x - tm / 2, gy0, tm, gy1 - gy0);
    for (let y = Math.ceil(gy0 / major) * major; y <= gy1; y += major) ctx.fillRect(gx0, y - tm / 2, gx1 - gx0, tm);

    // the map edge: a dashed cut line printed twice (pink pass misregistered).
    // Only the stretches on screen are stroked; the dash phase is anchored to the map.
    const lw = 2.6 / z;
    const dash = [15 / z, 9 / z];
    const off = 2.2 / z;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    const edge = (dx: number, color: string) => {
      ctx.strokeStyle = color;
      const side = (horizontal: boolean, at: number, from: number, to: number) => {
        const a = Math.max(from, horizontal ? view.x0 : view.y0);
        const b = Math.min(to, horizontal ? view.x1 : view.y1);
        if (b <= a || at < (horizontal ? view.y0 : view.x0) - lw || at > (horizontal ? view.y1 : view.x1) + lw) return;
        ctx.lineDashOffset = a - from;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(a, at);
          ctx.lineTo(b, at);
        } else {
          ctx.moveTo(at, a);
          ctx.lineTo(at, b);
        }
        ctx.stroke();
      };
      side(true, dx, dx, w.width + dx);
      side(true, w.height + dx, dx, w.width + dx);
      side(false, dx, dx, w.height + dx);
      side(false, w.width + dx, dx, w.height + dx);
    };
    edge(off, theme.edgeOver);
    edge(0, theme.edge);
    ctx.restore();
  }

  private hatchPattern(theme: WorldTheme, night: boolean): CanvasPattern | null {
    if (this.hatchNight !== night || !this.hatch) {
      const c = document.createElement('canvas');
      c.width = c.height = 14;
      const h = c.getContext('2d')!;
      h.strokeStyle = theme.hatch;
      h.lineWidth = 1.4;
      h.beginPath();
      for (let k = -14; k <= 28; k += 7) {
        h.moveTo(k, 14);
        h.lineTo(k + 14, 0);
      }
      h.stroke();
      this.hatch = this.ctx.createPattern(c, 'repeat');
      this.hatchNight = night;
    }
    return this.hatch;
  }

  /** Loot: a mustard "$" coin sized by tier, flipping while it slides, with a periodic glint. */
  private drawLoot(e: CEntity, f: FrameInput, still: boolean): void {
    const { ctx } = this;
    const tier = Math.max(0, Math.min(3, e.variant));
    const pop = Math.min(1, (f.now - e.born) / 260);
    const popE = 1 + 0.25 * Math.sin(Math.min(1, pop) * Math.PI) * (1 - pop * 0.4);
    const r = e.r * LOOT_SCALE[tier] * (e.dying ? 1 : Math.min(1, pop * 1.6)) * (still ? 1 : popE);
    const sp = still ? 0 : Math.hypot(e.nx - e.ox, e.ny - e.oy);
    // drop shadow: a halftone-ish ink offset under the coin
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(e.x + r * 0.16, e.y + r * 0.22, r * 0.98, r * 0.9, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    const sprite = this.sprites.lootSprite();
    if (sp > 4) {
      // still sliding from the spill: the coin flips
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(Math.abs(Math.cos(f.now / 70 + e.seed * 9)) * 0.75 + 0.25, 1);
      drawSprite(ctx, sprite, 0, 0, r);
      ctx.restore();
    } else drawSprite(ctx, sprite, e.x, e.y, r, still ? 0 : Math.sin(f.now / 900 + e.seed * 20) * 0.08);
    if (still) return;
    // glint: every ~2.6 s per coin, a twinkle that grows and shrinks over 380 ms
    const period = 2600;
    const t = (f.now + e.seed * period) % period;
    if (t < 380) {
      const k = Math.sin((t / 380) * Math.PI);
      drawGlint(ctx, e.x - r * 0.52, e.y - r * 0.55, r * 0.5 * k + 0.01);
    }
  }

  private drawPowerUp(e: CEntity, f: FrameInput, still: boolean): void {
    const { ctx } = this;
    const age = f.now - e.born;
    const sprite = this.sprites.powerUpSprite(e.variant);
    const landing = still ? 1 : Math.min(1, age / 900);
    const drop = (1 - landing) * (1 - landing) * 260;
    const bob = still ? 0 : Math.sin(f.now / 300 + e.seed * 8) * e.r * 0.08;
    // dashed ink halo
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(e.r * 0.06, 1.2 / f.camera.zoom);
    ctx.setLineDash([e.r * 0.2, e.r * 0.16]);
    ctx.lineDashOffset = still ? 0 : -f.now / 60;
    ctx.beginPath();
    ctx.arc(e.x, e.y + bob, e.r * 1.32, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // parachute while landing
    if (landing < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - landing * 0.6;
      ctx.translate(e.x, e.y - drop - e.r * 1.6);
      ctx.lineJoin = 'round';
      ctx.lineWidth = e.r * 0.07;
      ctx.strokeStyle = INK;
      ctx.fillStyle = RISO.mustard;
      ctx.beginPath();
      ctx.arc(e.r * 0.1, e.r * 0.08, e.r * 1.1, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = RISO.fluoPink;
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

  private drawCell(
    e: CEntity,
    f: FrameInput,
    cells: CEntity[],
    halftone: (r: number, sp: number) => CanvasImageSource | null,
    cashP: number | undefined,
  ): void {
    const { ctx } = this;
    const z = f.camera.zoom;
    const player = f.world.players.get(e.playerId);
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
    const jellyOn = f.settings.quality === 'high' && !f.reduced;
    if (jellyOn && e.jelly && screenR > 14) {
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
    const look = this.lookFor(player?.skin ?? 0, player?.pass ?? 0, f.pass);
    drawCoinLook(ctx, e.x, e.y, r, look, {
      time: f.reduced ? 0 : f.now,
      lookX: lx,
      lookY: ly,
      expression: e.expression,
      pxPerUnit: z,
      jelly: jellyOn ? e.jelly : null,
      flags: e.flags,
      seed: e.seed * 10 + e.playerId,
      cashout: mine && cashP !== undefined && e.flags & CellFlag.CashingOut ? cashP : undefined,
      halftone,
    });

    // labels: ink on a card halo (name in the display face, mass in mono)
    if (!player || screenR < 20) return;
    const showName = f.settings.showNames;
    const showMass = f.settings.showMass && (mine || screenR > 34);
    if (!showName && !showMass) return;
    const fs = Math.max(r * 0.22, 12 / z);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let y = e.y + r * 0.58;
    if (showName) {
      ctx.font = `800 ${fs}px ${DISPLAY_FONT}`;
      ctx.lineWidth = fs * 0.26;
      ctx.strokeStyle = CARD_PAPER;
      const name = player.name;
      ctx.strokeText(name, e.x, y);
      ctx.fillStyle = INK;
      ctx.fillText(name, e.x, y);
      if (player.flags & PlayerFlag.Verified) {
        const w = ctx.measureText(name).width;
        const bx = e.x + w / 2 + fs * 0.5;
        ctx.fillStyle = RISO.teal;
        ctx.strokeStyle = INK;
        ctx.lineWidth = fs * 0.08;
        ctx.beginPath();
        ctx.arc(bx, y, fs * 0.33, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = CARD_PAPER;
        ctx.lineWidth = fs * 0.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx - fs * 0.14, y);
        ctx.lineTo(bx - fs * 0.03, y + fs * 0.11);
        ctx.lineTo(bx + fs * 0.16, y - fs * 0.12);
        ctx.stroke();
      }
      y += fs * 0.98;
    }
    if (showMass) {
      const mfs = fs * 0.7;
      ctx.font = `500 ${mfs}px ${MONO_FONT}`;
      ctx.lineWidth = mfs * 0.28;
      ctx.strokeStyle = CARD_PAPER;
      const label = String(Math.floor((e.nr * e.nr) / 100));
      ctx.strokeText(label, e.x, y);
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.85;
      ctx.fillText(label, e.x, y);
      ctx.globalAlpha = 1;
    }
  }

  /** Emote stickers: pop in with an overshoot, tilt, bob, then peel away. */
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
      const img = stickerImage(emote.id);
      if (!img) continue;
      const age = f.now - emote.at;
      const t = Math.min(1, age / 260);
      // spring-ish overshoot: 0.4 → 1.12 → 1
      const pop = f.reduced ? 1 : t < 1 ? 0.4 + 0.72 * Math.sin((t * Math.PI) / 2) ** 2 + 0.12 * Math.sin(t * Math.PI) - 0.12 * t : 1;
      const fade = age > 2200 ? Math.max(0, 1 - (age - 2200) / 400) : f.reduced ? Math.min(1, age / 120) : 1;
      const size = Math.max(46, Math.min(80, c.r * z * 0.85)) / z;
      const bob = f.reduced ? 0 : Math.sin(age / 260) * size * 0.03;
      const tilt = ((emote.id % 3) - 1) * 0.1 + (f.reduced ? 0 : Math.sin(age / 400) * 0.03);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(c.x + c.r * 0.45, c.y - c.r - size * 0.42 + bob);
      ctx.rotate(tilt);
      ctx.scale(pop, pop);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  /** Coin rain (screen space): flat mustard riso coins tumbling down. */
  private drawCoinRain(f: FrameInput): void {
    const { ctx } = this;
    const cam = f.camera;
    if (f.coinRain && f.settings.quality === 'high' && !f.reduced && this.rain.length < 70) {
      for (let i = 0; i < 2; i++) {
        this.rain.push({
          x: f.rand() * cam.w,
          y: -30,
          v: 160 + f.rand() * 220,
          r: 6 + f.rand() * 9,
          rot: f.rand() * 6,
          vr: (f.rand() - 0.5) * 8,
          ink: f.rand() < 0.75 ? RISO.mustard : RISO.fluoPink,
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
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = RISO.orange;
      ctx.beginPath();
      ctx.arc(c.r * 0.15, c.r * 0.15, c.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = c.r * 0.2;
      ctx.stroke();
      ctx.restore();
    }
    this.rain.length = w;
  }

  /**
   * Minimap as a map sheet ("pafta"): card stock, blue sector grid with mono
   * sector labels, dashed view frame, mustard crowns for the leaders and a
   * pink pin for me.
   */
  drawMinimap(
    mm: HTMLCanvasElement,
    f: { world: ClientWorld; camera: Camera; leaders: { x: number; y: number }[]; dark: boolean; now: number; reduced: boolean },
  ): void {
    const ctx = mm.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = mm.clientWidth || 150;
    if (mm.width !== Math.round(size * dpr) || mm.height !== Math.round(size * dpr)) {
      mm.width = Math.round(size * dpr);
      mm.height = Math.round(size * dpr);
    }
    const ink = f.dark ? '#F1EADB' : INK;
    const ink2 = f.dark ? '#B3ADC2' : '#5D5870';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const s = size / Math.max(f.world.width, f.world.height);
    // sector grid
    ctx.strokeStyle = f.dark ? 'rgba(110,170,255,0.22)' : 'rgba(60,140,220,0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const p = Math.round((size * i) / 5) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
    ctx.fillStyle = ink2;
    ctx.globalAlpha = 0.7;
    ctx.font = `500 8.5px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let cx = 0; cx < 5; cx++) for (let cy = 0; cy < 5; cy++) ctx.fillText(`${'ABCDE'[cy]}${cx + 1}`, cx * (size / 5) + 3, cy * (size / 5) + 3);
    ctx.globalAlpha = 1;

    // camera view: dashed frame
    const v = f.camera.visibleRect();
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 2.5]);
    ctx.strokeRect(Math.max(0, v.x0 * s), Math.max(0, v.y0 * s), Math.min(size, (v.x1 - v.x0) * s), Math.min(size, (v.y1 - v.y0) * s));
    ctx.restore();

    // leaders: little mustard crowns
    f.leaders.forEach((l) => {
      const x = l.x * s;
      const y = l.y * s;
      ctx.fillStyle = RISO.mustard;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      ctx.lineJoin = 'round';
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

    // me: a pink pin with a ring that pulses outward
    const me = f.world.myStats();
    if (me) {
      const x = me.x * s;
      const y = me.y * s;
      if (!f.reduced) {
        const p = (f.now / 1400) % 1;
        ctx.strokeStyle = RISO.fluoPink;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4 + p * 9, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = RISO.fluoPink;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
}

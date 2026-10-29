import { ELYSIUM, INK, SHADE, type CoinInterior, type CoinLook, type Expression } from '@elymum/art';
import { EntityKind, PlayerFlag } from '@elymum/shared';
import { DROP_LAND, dropScale } from '../design/curves';
import type { Camera } from '../game/camera';
import type { Particles } from '../game/particles';
import type { CEntity, ClientWorld } from '../game/state';
import type { Quality, Settings } from '../store';
import { qualityLevels, type QualityLevel } from './governor';
import { stickerImage } from '../ui/game/stickers';
import { drawCoinLook } from './coin';
import type { Neighbour } from './jelly';
import { LabelCache } from './labels';
import { LookCache } from './looks';
import { SpriteCache, drawGlint, drawSprite } from './sprites';

const TAU = Math.PI * 2;

/**
 * The arena floor per theme ("Ring Storybook", spec §6.9: the floor of the ring
 * at feeding time). Both settings are night: `light` is the reference plate
 * (trench floor), `dark` the deeper abyss floor.
 */
export interface WorldTheme {
  /** The habitat floor inside the map. */
  floor: string;
  /** Beyond the map edge: the ring's wall. */
  outside: string;
  /** Solid contour arcs (every third) and the dotted ones between. */
  contour: string;
  contourDot: string;
  /** Grass tufts and pebbles. */
  tuft: string;
  pebble: string;
  /** Map edge line and the dotted lights just outside it. */
  edge: string;
  lights: string;
  /** Coin shadows on the floor: ink and its alpha. */
  shadow: string;
  shadowAlpha: number;
  /** Minimap disc and its rings. */
  mapDisc: string;
  mapRing: string;
}

export const WORLD_THEMES: Record<'light' | 'dark', WorldTheme> = {
  light: {
    floor: ELYSIUM.trench,
    outside: ELYSIUM.deep,
    contour: ELYSIUM.current,
    contourDot: ELYSIUM.current,
    tuft: ELYSIUM.current,
    pebble: ELYSIUM.reef,
    edge: ELYSIUM.current,
    lights: ELYSIUM.teal,
    shadow: INK,
    shadowAlpha: 0.45,
    mapDisc: INK,
    mapRing: ELYSIUM.current,
  },
  dark: {
    floor: ELYSIUM.abyss,
    outside: SHADE.abyss,
    contour: ELYSIUM.reef,
    contourDot: ELYSIUM.reef,
    tuft: SHADE.current,
    pebble: SHADE.reef,
    edge: ELYSIUM.reef,
    lights: SHADE.teal,
    shadow: '#000507',
    shadowAlpha: 0.8,
    mapDisc: SHADE.abyss,
    mapRing: ELYSIUM.reef,
  },
};

/** Contour arcs: concentric circles around a point below the map (the floor curving up like the ring). */
const CONTOUR_STEP = 250;
/** Grass tuft / pebble grid cell (world units); about a third of the cells get one. */
const TUFT_CELL = 210;
/** Map edge corner radius (world units): the floor curves up into the wall. */
const EDGE_RADIUS = 220;

/** Cheap integer hash of a grid cell (stable decorations, no storage). */
function cellHash(i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Canvas pixel ratio: capped at 2, and at 1.5 on coarse pointers (phones),
 * where fill rate is the limit and 1.5× still looks sharp at arm's length.
 * The low-quality setting caps it lower (1.5, and 1.25 on phones).
 */
export function canvasDpr(quality: Quality = 'high'): number {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const cap = quality === 'low' ? (coarse ? 1.25 : 1.5) : coarse ? 1.5 : 2;
  return Math.min(window.devicePixelRatio || 1, cap);
}

const byRadius = (a: CEntity, b: CEntity): number => a.r - b.r;

/** Loot is drawn bigger by size tier (0 crumb … 3 jackpot). */
const LOOT_SCALE = [0.8, 1, 1.3, 1.75];

/** Coins at least this big (world radius, mass 256) wear the smug face at rest. */
const SMUG_R = 160;

export interface FrameInput {
  now: number;
  dt: number;
  world: ClientWorld;
  camera: Camera;
  particles: Particles;
  settings: Settings;
  /** prefers-reduced-motion: idle loops stop. */
  reduced: boolean;
  /** Mouse target in world coordinates (for own eyes). */
  aim: { x: number; y: number } | null;
  coinRain: boolean;
  rand: () => number;
  /** My coin dropping onto the paper (join / respawn): progress 0…1, null when landed. */
  drop?: number | null;
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
  private cssW = 1;
  private cssH = 1;
  private quality: Quality = 'high';
  /** Automatic quality levels for this screen and setting (see `FrameGovernor`); 0 = full. */
  levels: QualityLevel[] = qualityLevels(1);
  private level = 0;
  private rain: RainCoin[] = [];
  private readonly looks = new LookCache();
  private readonly labels = new LabelCache();
  // per-frame scratch (reused, so drawing allocates nothing in the steady state)
  private readonly food: CEntity[] = [];
  private readonly ejects: CEntity[] = [];
  private readonly loot: CEntity[] = [];
  private readonly powerUps: CEntity[] = [];
  private readonly bodies: CEntity[] = [];
  private readonly cells: CEntity[] = [];
  private readonly nbs: Neighbour[] = [];
  private readonly emoteBest = new Map<number, CEntity>();
  /** Device px per world unit of the frame being drawn. */
  private ppu = 1;
  /** When each coin last grew (its laugh is held for a moment). */
  private readonly grewAt = new WeakMap<CEntity, number>();
  private readonly interior = (look: CoinLook, r: number) => this.sprites.coinInterior(look, r, this.ppu);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(w: number, h: number, quality: Quality = this.quality): void {
    this.cssW = w;
    this.cssH = h;
    this.quality = quality;
    this.levels = qualityLevels(canvasDpr(quality));
    this.level = Math.min(this.level, this.levels.length - 1);
    this.applySize();
  }

  /** Automatic quality level (index into `levels`); resizes the canvas when its pixel ratio changes. */
  setLevel(level: number): void {
    const next = Math.max(0, Math.min(level, this.levels.length - 1));
    if (next === this.level) return;
    this.level = next;
    this.applySize();
  }

  /** The automatic drop asks for the low look (no jelly, no coin rain). */
  get autoLow(): boolean {
    return this.levels[this.level].low;
  }

  private applySize(): void {
    this.dpr = this.levels[this.level].dpr;
    const cw = Math.round(this.cssW * this.dpr);
    const ch = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
  }

  /** Coin look of a player (its basic skin), cached. */
  lookFor(skin: number): CoinLook {
    return this.looks.lookFor(skin);
  }

  draw(f: FrameInput): void {
    const { ctx } = this;
    const cam = f.camera;
    const theme = WORLD_THEMES[f.settings.theme] ?? WORLD_THEMES.light;
    const z = cam.zoom;
    const low = f.settings.quality === 'low' || this.autoLow;
    const still = low || f.reduced;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.floor;
    ctx.fillRect(0, 0, cam.w, cam.h);

    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cam.w / 2 - cam.x * z), this.dpr * (cam.h / 2 - cam.y * z));
    const view = cam.visibleRect(60);
    this.drawFloor(view, f, theme);

    // collect visible entities (into arrays reused across frames: no per-frame garbage)
    const { food, ejects, loot, powerUps, bodies, cells } = this;
    food.length = ejects.length = loot.length = powerUps.length = bodies.length = cells.length = 0;
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

    // food: seeds, grapes and pears over their own glow (pops in); the golden drachma breathes
    for (const e of food) {
      const pop = Math.min(1, (f.now - e.born) / 220);
      let sz = e.r * (0.4 + 0.6 * (1 - (1 - pop) ** 3));
      if (e.variant === 7 && !still) sz *= 1 + Math.sin(f.now / 420 + e.seed * 20) * 0.05;
      drawSprite(ctx, this.sprites.foodSprite(e.variant, e.seed), e.x, e.y, sz);
    }

    for (const e of ejects) drawSprite(ctx, this.sprites.ejectSprite(e.variant), e.x, e.y, e.r);

    for (const e of loot) this.drawLoot(e, f, still);

    for (const e of powerUps) this.drawPowerUp(e, f, still);

    // cells and thorn bushes: small first so bigger ones cover them
    bodies.sort(byRadius);
    for (const b of bodies) if (b.kind === EntityKind.Cell) cells.push(b);

    // shadows on the floor, all before any body (one path, one fill)
    ctx.beginPath();
    let shadows = 0;
    for (const e of bodies) {
      if (e.r * z < 6) continue;
      const r = e.kind === EntityKind.Virus ? e.r * 0.95 : e.r;
      ctx.moveTo(e.x + r * 0.76, e.y + r * 1.06);
      ctx.ellipse(e.x, e.y + r * 1.06, r * 0.76, r * 0.12, 0, 0, TAU);
      shadows++;
    }
    if (shadows) {
      ctx.globalAlpha = theme.shadowAlpha;
      ctx.fillStyle = theme.shadow;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.ppu = z * this.dpr;
    const { interior } = this;
    for (const e of bodies) {
      if (e.kind === EntityKind.Virus) {
        const wob = still ? 0 : Math.sin(f.now / 700 + e.seed * 10) * 0.04;
        drawSprite(ctx, this.sprites.cactusSprite(), e.x, e.y, e.r, wob);
        continue;
      }
      this.drawCell(e, f, cells, interior, still);
      // its name sticker (bigger coins drawn later cover the stickers of smaller ones)
      this.drawLabel(e, f, view);
    }

    // emote stickers on top of everything
    this.drawEmotes(f, cells);

    f.particles.draw(ctx, z);

    // screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCoinRain(f);
  }

  /**
   * The floor: flat night paint, contour arcs (solid every third, dotted between),
   * sparse grass tufts and pebbles, and beyond the edge the ring's wall with a
   * row of dotted lights. Line widths are constant on screen; decorations are
   * anchored to the world (hashed grid, nothing stored).
   */
  private drawFloor(view: { x0: number; y0: number; x1: number; y1: number }, f: FrameInput, theme: WorldTheme): void {
    const { ctx } = this;
    const w = f.world;
    const z = f.camera.zoom;
    const W = w.width;
    const H = w.height;
    const er = Math.min(EDGE_RADIUS, W / 4, H / 4);

    // beyond the edge: the wall (only when the view reaches it)
    const nearEdge = view.x0 < er || view.y0 < er || view.x1 > W - er || view.y1 > H - er;
    if (nearEdge) {
      ctx.beginPath();
      ctx.rect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
      ctx.roundRect(0, 0, W, H, er);
      ctx.fillStyle = theme.outside;
      ctx.fill('evenodd');
    }

    ctx.save();
    if (nearEdge) {
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, er);
      ctx.clip();
    }
    // contour arcs, centred below the map; only the visible stretch of each is stroked
    const cx = W / 2;
    const cy = H * 1.3;
    let dMax = 0;
    let aMin = Infinity;
    let aMax = -Infinity;
    for (let c = 0; c < 4; c++) {
      const x = c & 1 ? view.x1 : view.x0;
      const y = c & 2 ? view.y1 : view.y0;
      dMax = Math.max(dMax, Math.hypot(x - cx, y - cy));
      const a = Math.atan2(y - cy, x - cx);
      aMin = Math.min(aMin, a);
      aMax = Math.max(aMax, a);
    }
    const inside = cx >= view.x0 && cx <= view.x1 && cy >= view.y0 && cy <= view.y1;
    const dMin = inside ? 0 : Math.hypot(Math.max(view.x0 - cx, 0, cx - view.x1), Math.max(view.y0 - cy, 0, cy - view.y1));
    if (inside || aMax - aMin > Math.PI) {
      aMin = 0;
      aMax = Math.PI * 2;
    }
    const k0 = Math.max(1, Math.ceil(dMin / CONTOUR_STEP));
    const k1 = Math.floor(dMax / CONTOUR_STEP);
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      const solid = pass === 0;
      ctx.strokeStyle = solid ? theme.contour : theme.contourDot;
      ctx.lineWidth = (solid ? 3 : 2.4) / z;
      ctx.setLineDash(solid ? [] : [0.01, 12 / z]);
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        if ((k % 3 === 0) !== solid) continue;
        const R = k * CONTOUR_STEP;
        ctx.moveTo(cx + Math.cos(aMin) * R, cy + Math.sin(aMin) * R);
        ctx.arc(cx, cy, R, aMin, aMax);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // grass tufts and pebbles: one path each (skipped when they would be specks)
    if (TUFT_CELL * z > 26) {
      const i0 = Math.max(0, Math.floor(view.x0 / TUFT_CELL));
      const i1 = Math.min(Math.ceil(W / TUFT_CELL), Math.ceil(view.x1 / TUFT_CELL));
      const j0 = Math.max(0, Math.floor(view.y0 / TUFT_CELL));
      const j1 = Math.min(Math.ceil(H / TUFT_CELL), Math.ceil(view.y1 / TUFT_CELL));
      ctx.beginPath();
      let pebbles = 0;
      for (let pass = 0; pass < 2; pass++) {
        if (pass === 1) {
          if (pebbles) {
            ctx.fillStyle = theme.pebble;
            ctx.fill();
          }
          ctx.beginPath();
        }
        for (let i = i0; i < i1; i++) {
          for (let j = j0; j < j1; j++) {
            const h = cellHash(i, j);
            const kind = h % 9;
            if (kind > 2 || (kind === 2) !== (pass === 0)) continue;
            const x = (i + 0.15 + ((h >>> 4) % 70) / 100) * TUFT_CELL;
            const y = (j + 0.15 + ((h >>> 11) % 70) / 100) * TUFT_CELL;
            if (pass === 0) {
              const rx = 7 + ((h >>> 18) % 8);
              ctx.moveTo(x + rx, y);
              ctx.ellipse(x, y, rx, rx * 0.45, 0, 0, Math.PI * 2);
              pebbles++;
            } else {
              const u = 1.7 + ((h >>> 18) % 5) * 0.12;
              ctx.moveTo(x - 4 * u, y - 9 * u);
              ctx.lineTo(x, y);
              ctx.lineTo(x, y - 11 * u);
              ctx.moveTo(x, y);
              ctx.lineTo(x + 4 * u, y - 9 * u);
            }
          }
        }
      }
      ctx.strokeStyle = theme.tuft;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.min(2.5 / z, 5);
      ctx.stroke();
    }
    ctx.restore();

    // the edge: a line where the floor meets the wall, and the wall's dotted lights
    if (nearEdge) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, er);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8 / z;
      ctx.stroke();
      ctx.strokeStyle = theme.edge;
      ctx.lineWidth = 3 / z;
      ctx.stroke();
      const off = 18 / z;
      ctx.beginPath();
      ctx.roundRect(-off, -off, W + off * 2, H + off * 2, er + off);
      ctx.strokeStyle = theme.lights;
      ctx.lineWidth = 3.4 / z;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.01, 16 / z]);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Loot: a gold "$" coin sized by tier over a breathing sun glow, flipping while it slides, with a periodic glint. */
  private drawLoot(e: CEntity, f: FrameInput, still: boolean): void {
    const { ctx } = this;
    const tier = Math.max(0, Math.min(3, e.variant));
    const pop = Math.min(1, (f.now - e.born) / 260);
    const popE = 1 + 0.25 * Math.sin(Math.min(1, pop) * Math.PI) * (1 - pop * 0.4);
    const r = e.r * LOOT_SCALE[tier] * (e.dying ? 1 : Math.min(1, pop * 1.6)) * (still ? 1 : popE);
    const sp = still ? 0 : Math.hypot(e.nx - e.ox, e.ny - e.oy);
    // sun glow: two flat discs (no blur), breathing
    const breathe = still ? 1 : 1 + Math.sin(f.now / 500 + e.seed * 30) * 0.08;
    ctx.fillStyle = ELYSIUM.sun;
    ctx.globalAlpha = 0.13;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 1.75 * breathe, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 1.3 * breathe, 0, TAU);
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

  /** Power-up: a sticker disc bobbing over a cream glow; it parachutes in when it lands. */
  private drawPowerUp(e: CEntity, f: FrameInput, still: boolean): void {
    const { ctx } = this;
    const age = f.now - e.born;
    const sprite = this.sprites.powerUpSprite(e.variant);
    const landing = still ? 1 : Math.min(1, age / 900);
    const drop = (1 - landing) * (1 - landing) * 260;
    const bob = still ? 0 : Math.sin(f.now / 300 + e.seed * 8) * e.r * 0.08;
    // glow and a dotted cream ring turning slowly
    ctx.save();
    ctx.fillStyle = ELYSIUM.cream;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(e.x, e.y + bob, e.r * 1.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = ELYSIUM.cream;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(e.r * 0.07, 2.4 / f.camera.zoom);
    ctx.setLineDash([0.01, Math.max(e.r * 0.24, 9 / f.camera.zoom)]);
    ctx.lineDashOffset = still ? 0 : -f.now / 60;
    ctx.beginPath();
    ctx.arc(e.x, e.y + bob, e.r * 1.36, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // parachute while landing
    if (landing < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - landing * 0.6;
      ctx.translate(e.x, e.y - drop - e.r * 1.6);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = e.r * 0.07;
      ctx.strokeStyle = INK;
      ctx.fillStyle = ELYSIUM.cream;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 1.1, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ELYSIUM.coral;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, e.r * 1.1, Math.PI * 1.36, Math.PI * 1.64);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 1.1, Math.PI, 0);
      ctx.closePath();
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

  /**
   * The coin's mood from its state: scared near a bigger coin, chomping at prey,
   * laughing while it grows (held 650 ms), smug when big (or in its proud moment).
   */
  private mood(e: CEntity, now: number): Expression {
    const x = e.expression;
    if (x === 'scared' || x === 'love' || x === 'sleep' || x === 'dead') return x;
    if (x === 'hungry') return 'chomp';
    if (e.or > 0 && e.nr > e.or * 1.001) this.grewAt.set(e, now);
    const g = this.grewAt.get(e);
    if (g !== undefined && now - g < 650 && now >= g) return 'proud';
    if (x === 'proud' || e.r >= SMUG_R) return 'smug';
    return x;
  }

  private drawCell(e: CEntity, f: FrameInput, cells: CEntity[], interior: (look: CoinLook, r: number) => CoinInterior | null, still: boolean): void {
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
    const jellyOn = f.settings.quality === 'high' && !this.autoLow && !f.reduced;
    if (jellyOn && e.jelly && screenR > 14) {
      const nbs = this.nbs;
      let n = 0;
      for (const o of cells) {
        if (o === e) continue;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        if (Math.abs(dx) > e.r + o.r || Math.abs(dy) > e.r + o.r) continue;
        if (Math.hypot(dx, dy) < e.r + o.r) {
          const nb = (nbs[n++] ??= { dx: 0, dy: 0, r: 0 });
          nb.dx = dx;
          nb.dy = dy;
          nb.r = o.r;
        }
      }
      nbs.length = n;
      const sp = Math.hypot(e.vx, e.vy);
      e.jelly.update(f.dt, e.r, screenR, sp > 1 ? (e.vx / sp) * Math.min(1, sp / 300) : 0, sp > 1 ? (e.vy / sp) * Math.min(1, sp / 300) : 0, nbs, f.rand);
    }

    const spawnPop = Math.min(1, (f.now - e.born) / 180);
    const dropping = mine && f.drop != null;
    const r = e.r * (dropping ? dropScale(f.drop!) : 0.6 + 0.4 * spawnPop);
    if (dropping && f.drop! < DROP_LAND) {
      // its shadow on the floor: small and soft while high, gathering under it as it lands
      const h = 1 - f.drop! / DROP_LAND;
      ctx.save();
      ctx.globalAlpha = 0.3 * (1 - h * 0.6);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(e.x + e.r * 0.5 * h, e.y + e.r * 0.7 * h, e.r * (1 - 0.15 * h), e.r * (0.92 - 0.2 * h), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // "you": a dotted sun ring turning slowly around my coins
    if (mine && screenR > 8) {
      ctx.save();
      ctx.strokeStyle = ELYSIUM.sun;
      ctx.lineCap = 'round';
      ctx.lineWidth = 3 / z;
      ctx.setLineDash([0.01, 10 / z]);
      ctx.lineDashOffset = still ? 0 : -f.now / 90 / z;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r + Math.min(16, Math.max(8, screenR * 0.2)) / z, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    const look = this.lookFor(player?.skin ?? 0);
    drawCoinLook(ctx, e.x, e.y, r, look, {
      time: f.reduced ? 0 : f.now,
      lookX: lx,
      lookY: ly,
      expression: this.mood(e, f.now),
      pxPerUnit: z,
      jelly: jellyOn ? e.jelly : null,
      flags: e.flags,
      seed: e.seed * 10 + e.playerId,
      interior,
      // small coins skip the fine interior details (groove, highlight)
      minPrintPx: 14,
    });
  }

  /**
   * Name tag: a small mono sticker above the coin (name in ink, mass in teal;
   * sun stock for me). Above a coin taller than the view it stays at the top
   * of the screen, never lower than the coin's forehead.
   */
  private drawLabel(e: CEntity, f: FrameInput, view: { y0: number }): void {
    const showName = f.settings.showNames;
    if (!showName && !f.settings.showMass) return;
    const z = f.camera.zoom;
    const screenR = e.r * z;
    if (screenR < 14) return;
    const player = f.world.players.get(e.playerId);
    if (!player) return;
    const mine = e.playerId === f.world.myPid;
    const showMass = f.settings.showMass && (mine || screenR > 24);
    if (!showName && !showMass) return;
    const fs = Math.min(15, Math.max(11, screenR * 0.11)) / z;
    const h = fs * 1.78;
    const ring = mine ? Math.min(16, Math.max(8, screenR * 0.2)) / z : 0;
    let y = e.y - e.r - ring - h / 2 - 7 / z;
    const top = view.y0 + 60 + h / 2 + 8 / z;
    if (y < top) y = Math.min(top, e.y - e.r * 0.5);
    this.labels.drawSticker(this.ctx, {
      name: showName ? player.name : null,
      value: showMass ? String(Math.floor((e.nr * e.nr) / 100)) : null,
      verified: (player.flags & PlayerFlag.Verified) !== 0,
      mine,
      x: e.x,
      y,
      fs,
      devicePx: z * this.dpr,
      zoom: z,
      alpha: e.dying ? 0.6 : 1,
    });
  }

  /** Emote stickers: pop in with an overshoot, tilt, bob, then peel away. */
  private drawEmotes(f: FrameInput, cells: CEntity[]): void {
    const { ctx } = this;
    const z = f.camera.zoom;
    const best = this.emoteBest;
    best.clear();
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

  /** Coin rain (screen space): gold coins (ink edge, one shade tone) tumbling down. */
  private drawCoinRain(f: FrameInput): void {
    const { ctx } = this;
    const cam = f.camera;
    if (f.coinRain && f.settings.quality === 'high' && !this.autoLow && !f.reduced && this.rain.length < 70) {
      for (let i = 0; i < 2; i++) {
        this.rain.push({
          x: f.rand() * cam.w,
          y: -30,
          v: 160 + f.rand() * 220,
          r: 6 + f.rand() * 9,
          rot: f.rand() * 6,
          vr: (f.rand() - 0.5) * 8,
          ink: f.rand() < 0.8 ? ELYSIUM.sun : ELYSIUM.cream,
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
      ctx.fillStyle = c.ink === ELYSIUM.sun ? SHADE.sun : SHADE.cream;
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.arc(-c.r * 0.12, -c.r * 0.16, c.r * 0.86, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.min(2.5, c.r * 0.22);
      ctx.beginPath();
      ctx.arc(0, 0, c.r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    this.rain.length = w;
  }

  private sheet: { canvas: HTMLCanvasElement; key: string } | null = null;

  /**
   * The minimap's static layer: a night porthole (the arena seen from above)
   * with an ink edge, the floor's contour rings and the dotted wall lights.
   */
  private minimapSheet(px: number, size: number, dpr: number, wt: WorldTheme): HTMLCanvasElement {
    const key = `${px}|${size}|${dpr}|${wt.mapDisc}|${wt.mapRing}`;
    if (this.sheet?.key === key) return this.sheet.canvas;
    const canvas = this.sheet?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const R = size / 2 - 2;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.fillStyle = wt.mapDisc;
    ctx.fill();
    ctx.strokeStyle = wt.mapRing;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.8, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([0.01, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.53, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.stroke();
    this.sheet = { canvas, key };
    return canvas;
  }

  /**
   * Minimap as the round porthole of the reference plate: the night disc with
   * its contour rings, the arena square inside it, a cream frame for the view,
   * sun dots for the leaders and a cyan dot (with a pulsing ring) for me.
   */
  drawMinimap(
    mm: HTMLCanvasElement,
    f: { world: ClientWorld; camera: Camera; leaders: { x: number; y: number }[]; dark: boolean; now: number; reduced: boolean },
  ): void {
    const ctx = mm.getContext('2d');
    if (!ctx) return;
    const dpr = canvasDpr();
    const size = mm.clientWidth || 150;
    if (mm.width !== Math.round(size * dpr) || mm.height !== Math.round(size * dpr)) {
      mm.width = Math.round(size * dpr);
      mm.height = Math.round(size * dpr);
    }
    const wt = WORLD_THEMES[f.dark ? 'dark' : 'light'];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mm.width, mm.height);
    // the disc never changes: drawn once per size and theme, then copied
    ctx.drawImage(this.minimapSheet(mm.width, size, dpr, wt), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the arena square inscribed in the disc
    const inner = (size / 2 - 2) * Math.SQRT2 * 0.9;
    const o = (size - inner) / 2;
    const s = inner / Math.max(f.world.width, f.world.height);
    const px = (x: number) => o + x * s;
    const py = (y: number) => o + y * s;

    // the arena's edge
    ctx.strokeStyle = wt.mapRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(o, o, inner, inner, inner * 0.04);
    ctx.stroke();

    // camera view: a cream frame (clamped to the arena)
    const v = f.camera.visibleRect();
    const x0 = px(Math.max(0, v.x0));
    const y0 = py(Math.max(0, v.y0));
    const x1 = px(Math.min(f.world.width, v.x1));
    const y1 = py(Math.min(f.world.height, v.y1));
    ctx.strokeStyle = ELYSIUM.cream;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0), 3);
    ctx.stroke();

    // leaders: sun dots with ink edges
    ctx.fillStyle = ELYSIUM.sun;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    for (const l of f.leaders) {
      ctx.beginPath();
      ctx.arc(px(l.x), py(l.y), 3.6, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

    // me: a cyan dot with a ring that pulses outward
    const me = f.world.myStats();
    if (me) {
      const x = px(me.x);
      const y = py(me.y);
      if (!f.reduced) {
        const p = (f.now / 1400) % 1;
        ctx.strokeStyle = ELYSIUM.cyan;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4 + p * 9, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = ELYSIUM.cyan;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
}

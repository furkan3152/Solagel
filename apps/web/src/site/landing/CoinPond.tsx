import { lookForBasicSkin, type CoinLook, type Expression } from '@slana/art';
import { useEffect, useRef } from 'react';
import { drawCoinLook } from '../../render/coin';
import { JellyBody } from '../../render/jelly';
import { SpriteCache, drawSprite } from '../../render/sprites';
import { lookForHandle } from '../coinLook';

/**
 * The hero's pond: a handful of riso coins on paper that drift, chase, flee and eat each other
 * (and the confetti), all on one small 2D canvas. Pure decoration: no game engine, no server.
 *
 * - Bigger coins chase smaller ones nearby; a coin about 12 % bigger swallows a smaller one it
 *   covers, grows, and the eaten coin comes back later from an edge.
 * - A coin that grows too big splits in two, like in the game.
 * - Coins steer around `avoid` (the headline block) so the copy stays readable.
 * - A tap or click on the pond drops confetti; the eyes follow the pointer.
 * - `still` (reduced motion): one composed frame, no loop.
 * - The loop sleeps while the pond is off screen or the tab is hidden.
 */

export interface PondEvents {
  /** A coin ate another coin (for the optional sound). */
  onEat?: (big: number) => void;
}

interface Coin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  target: number;
  look: CoinLook;
  jelly: JellyBody;
  seed: number;
  wander: number;
  mood: Expression;
  moodUntil: number;
  /** Being eaten: 0..1 progress, the eater's id. */
  eaten: { by: number; t: number } | null;
  /** Hidden until this time (respawn). */
  away: number;
}

interface Dot {
  x: number;
  y: number;
  r: number;
  variant: number;
  rot: number;
  seed: number;
  born: number;
}

const TAU = Math.PI * 2;
const NAMES = ['moon', 'pond', 'gulp', 'nom', 'snack', 'bite', 'munch', 'chomp', 'yum', 'crumb', 'gobble', 'slurp'];

let rngState = 20261017;
const rand = () => ((rngState = (rngState * 16807) % 2147483647) / 2147483647);

function makeLook(i: number): CoinLook {
  // the eight basic skins first, then handle-made coins for variety
  return i < 8 ? lookForBasicSkin(i) : lookForHandle(NAMES[i % NAMES.length] + i);
}

export interface PondOptions {
  still: boolean;
  /** The element whose box the coins steer around (page coordinates of the canvas). */
  avoid?: () => DOMRect | null;
  events?: PondEvents;
}

/** Runs the pond on `canvas`; returns a stop function. Exported for tests. */
export function startPond(canvas: HTMLCanvasElement, opts: PondOptions): { stop: () => void; drop: (x: number, y: number) => void; look: (x: number, y: number) => void } {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop: () => {}, drop: () => {}, look: () => {} };
  const sprites = new SpriteCache();
  const dprCap = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  let w = 0;
  let h = 0;
  let scale = 1;
  let coins: Coin[] = [];
  let dots: Dot[] = [];
  let nextId = 1;
  let now = 0;
  let pointer: { x: number; y: number; at: number } | null = null;
  let raf = 0;
  let visible = true;
  let last = performance.now();

  const minR = () => 16 * scale;
  const maxR = () => 78 * scale;

  function resize(): boolean {
    const rect = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(rect.width));
    const nh = Math.max(1, Math.round(rect.height));
    if (nw === w && nh === h) return false;
    w = nw;
    h = nh;
    scale = Math.max(0.62, Math.min(1.25, Math.min(w, h * 1.4) / 900));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    return true;
  }

  function spawnCoin(i: number, edge: boolean): Coin {
    const r = (edge ? 18 + rand() * 14 : 18 + Math.pow(rand(), 1.6) * 46) * scale;
    let x = rand() * w;
    let y = rand() * h;
    let vx = (rand() - 0.5) * 30;
    let vy = (rand() - 0.5) * 30;
    if (edge) {
      const side = Math.floor(rand() * 4);
      if (side === 0) x = -r;
      else if (side === 1) x = w + r;
      else if (side === 2) y = -r;
      else y = h + r;
      vx = (w / 2 - x) * 0.12;
      vy = (h / 2 - y) * 0.12;
    }
    return { id: nextId++, x, y, vx, vy, r, target: r, look: makeLook(i), jelly: new JellyBody(), seed: rand() * 1000, wander: rand() * TAU, mood: 'happy', moodUntil: 0, eaten: null, away: 0 };
  }

  function spawnDot(x = rand() * w, y = rand() * h): Dot {
    return { x, y, r: (5 + rand() * 4) * scale, variant: Math.floor(rand() * 6), rot: rand() * TAU, seed: rand(), born: now };
  }

  function populate(): void {
    const n = w < 520 ? 7 : w < 1000 ? 10 : 13;
    coins = Array.from({ length: n }, (_, i) => spawnCoin(i, false));
    // composed frame: a big coin about to eat a small one, low on the right
    if (coins.length >= 2) {
      const big = coins[0];
      const small = coins[1];
      big.r = big.target = 64 * scale;
      big.x = w * 0.78;
      big.y = h * 0.72;
      small.r = small.target = 24 * scale;
      small.x = big.x - big.r * 1.55;
      small.y = big.y - big.r * 0.35;
      small.mood = 'scared';
      big.mood = 'hungry';
      big.moodUntil = small.moodUntil = Infinity;
    }
    const nd = w < 520 ? 22 : 42;
    dots = Array.from({ length: nd }, () => spawnDot());
    pushOutOfAvoid(true);
  }

  function avoidRect(): { x0: number; y0: number; x1: number; y1: number } | null {
    const r = opts.avoid?.();
    if (!r) return null;
    const c = canvas.getBoundingClientRect();
    const pad = 18 * scale;
    return { x0: r.left - c.left - pad, y0: r.top - c.top - pad, x1: r.right - c.left + pad, y1: r.bottom - c.top + pad };
  }

  function pushOutOfAvoid(hard: boolean): void {
    const a = avoidRect();
    if (!a) return;
    for (const c of coins) {
      if (c.x + c.r < a.x0 || c.x - c.r > a.x1 || c.y + c.r < a.y0 || c.y - c.r > a.y1) continue;
      // nearest side out of the box
      const opts2 = [
        { d: c.x + c.r - a.x0, x: a.x0 - c.r, y: c.y },
        { d: a.x1 - (c.x - c.r), x: a.x1 + c.r, y: c.y },
        { d: c.y + c.r - a.y0, x: c.x, y: a.y0 - c.r },
        { d: a.y1 - (c.y - c.r), x: c.x, y: a.y1 + c.r },
      ].filter((o) => o.x > -c.r && o.x < w + c.r && o.y > -c.r && o.y < h + c.r);
      const best = opts2.sort((p, q) => p.d - q.d)[0];
      if (!best) continue;
      if (hard) {
        c.x = best.x;
        c.y = best.y;
      } else {
        c.vx += Math.sign(best.x - c.x) * 40;
        c.vy += Math.sign(best.y - c.y) * 40;
      }
    }
  }

  function step(dt: number): void {
    const a = avoidRect();
    const live = coins.filter((c) => !c.eaten && c.away <= now);
    for (const c of coins) {
      if (c.away > now) continue;
      if (c.eaten) {
        const by = coins.find((o) => o.id === c.eaten!.by);
        c.eaten.t += dt / 0.32;
        if (by) {
          c.x += (by.x - c.x) * Math.min(1, dt * 14);
          c.y += (by.y - c.y) * Math.min(1, dt * 14);
        }
        if (c.eaten.t >= 1) {
          c.eaten = null;
          c.away = now + 1400 + rand() * 2600;
          Object.assign(c, spawnCoin(coins.indexOf(c), true), { id: c.id, away: c.away, look: c.look });
        }
        continue;
      }
      let ax = 0;
      let ay = 0;
      // wander
      c.wander += (rand() - 0.5) * dt * 2.2;
      ax += Math.cos(c.wander) * 16;
      ay += Math.sin(c.wander) * 16;
      let chase: Coin | null = null;
      let flee: Coin | null = null;
      let chaseD = 230 * scale;
      let fleeD = 170 * scale;
      for (const o of live) {
        if (o === c) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y) - o.r - c.r;
        if (c.r > o.r * 1.12 && d < chaseD) {
          chaseD = d;
          chase = o;
        } else if (o.r > c.r * 1.12 && d < fleeD) {
          fleeD = d;
          flee = o;
        }
      }
      let mood: Expression = 'happy';
      if (flee) {
        const dx = c.x - flee.x;
        const dy = c.y - flee.y;
        const l = Math.hypot(dx, dy) || 1;
        ax += (dx / l) * 120;
        ay += (dy / l) * 120;
        mood = 'scared';
      } else if (chase) {
        const dx = chase.x - c.x;
        const dy = chase.y - c.y;
        const l = Math.hypot(dx, dy) || 1;
        ax += (dx / l) * 95;
        ay += (dy / l) * 95;
        mood = 'hungry';
      } else {
        // nearest confetti
        let best: Dot | null = null;
        let bd = 160 * scale;
        for (const d of dots) {
          const dd = Math.hypot(d.x - c.x, d.y - c.y);
          if (dd < bd) {
            bd = dd;
            best = d;
          }
        }
        if (best) {
          ax += ((best.x - c.x) / (bd || 1)) * 45;
          ay += ((best.y - c.y) / (bd || 1)) * 45;
        }
      }
      if (c.moodUntil < now) c.mood = mood;
      // walls: soft push back in
      const m = c.r * 0.4;
      if (c.x < m) ax += (m - c.x) * 2.2;
      if (c.x > w - m) ax -= (c.x - (w - m)) * 2.2;
      if (c.y < m) ay += (m - c.y) * 2.2;
      if (c.y > h - m) ay -= (c.y - (h - m)) * 2.2;
      // the headline block: steer around it
      if (a && c.x + c.r > a.x0 && c.x - c.r < a.x1 && c.y + c.r > a.y0 && c.y - c.r < a.y1) {
        const cx = (a.x0 + a.x1) / 2;
        const cy = (a.y0 + a.y1) / 2;
        const hw = (a.x1 - a.x0) / 2 || 1;
        const hh = (a.y1 - a.y0) / 2 || 1;
        const nx = (c.x - cx) / hw;
        const ny = (c.y - cy) / hh;
        if (Math.abs(nx) > Math.abs(ny)) ax += Math.sign(nx || 1) * 260;
        else ay += Math.sign(ny || 1) * 260;
      }
      // the pointer: curious coins drift a little towards it
      if (pointer && now - pointer.at < 2500) {
        const dx = pointer.x - c.x;
        const dy = pointer.y - c.y;
        const l = Math.hypot(dx, dy);
        if (l < 220 * scale && l > c.r) {
          ax += (dx / l) * 18;
          ay += (dy / l) * 18;
        }
      }
      const vmax = 74 * Math.pow((30 * scale) / c.r, 0.45) * Math.max(0.8, scale);
      c.vx = (c.vx + ax * dt) * Math.pow(0.55, dt);
      c.vy = (c.vy + ay * dt) * Math.pow(0.55, dt);
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > vmax) {
        c.vx *= vmax / sp;
        c.vy *= vmax / sp;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.r += (c.target - c.r) * Math.min(1, dt * 5);
    }
    // eat
    for (const big of live) {
      if (big.eaten) continue;
      for (const small of live) {
        if (small === big || small.eaten || big.eaten) continue;
        if (big.r <= small.r * 1.12) continue;
        const d = Math.hypot(big.x - small.x, big.y - small.y);
        if (d < big.r - small.r * 0.35) {
          small.eaten = { by: big.id, t: 0 };
          big.target = Math.min(maxR() * 1.05, Math.sqrt(big.target * big.target + small.r * small.r * 0.7));
          big.mood = 'love';
          big.moodUntil = now + 900;
          opts.events?.onEat?.(big.r);
        }
      }
      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i];
        if (Math.hypot(big.x - d.x, big.y - d.y) < big.r * 0.9) {
          dots.splice(i, 1);
          big.target = Math.min(maxR() * 1.05, Math.sqrt(big.target * big.target + d.r * d.r * 1.4));
        }
      }
    }
    // too big: split in two, flying apart
    for (const c of [...live]) {
      if (c.eaten || c.r < maxR()) continue;
      const half = c.r / Math.SQRT2;
      const ang = rand() * TAU;
      c.r = c.target = half;
      const twin: Coin = { ...spawnCoin(coins.indexOf(c), false), x: c.x, y: c.y, r: half, target: half, look: c.look, vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260 };
      c.vx = -Math.cos(ang) * 120;
      c.vy = -Math.sin(ang) * 120;
      // keep the count steady: the smallest hidden coin is replaced by the twin
      const spare = coins.find((o) => o.away > now) ?? coins.reduce((p, q) => (q !== c && q.r < p.r ? q : p), coins[0] === c ? coins[1] : coins[0]);
      if (spare && spare !== c) Object.assign(spare, twin, { id: spare.id });
    }
    // slow mass loss keeps the pond moving
    for (const c of coins) if (c.target > minR() * 2) c.target -= dt * 0.9 * scale;
    // confetti comes back
    const want = w < 520 ? 22 : 42;
    if (dots.length < want && rand() < dt * 3) dots.push(spawnDot());
  }

  function draw(): void {
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of dots) {
      const pop = Math.min(1, (now - d.born) / 300);
      drawSprite(ctx!, sprites.foodSprite(d.variant, d.seed), d.x, d.y, d.r * (opts.still ? 1 : pop), d.rot);
    }
    const order = coins.filter((c) => c.away <= now).sort((p, q) => p.r - q.r);
    const halftone = (r: number, sp: number) => sprites.halftone(r, sp, dpr);
    for (const c of order) {
      const k = c.eaten ? Math.max(0, 1 - c.eaten.t) : 1;
      if (k <= 0.02) continue;
      const sp = Math.hypot(c.vx, c.vy);
      let lx = sp > 4 ? c.vx / sp : 0;
      let ly = sp > 4 ? c.vy / sp : 0.2;
      if (pointer && now - pointer.at < 2500) {
        const dx = pointer.x - c.x;
        const dy = pointer.y - c.y;
        const l = Math.hypot(dx, dy) || 1;
        if (l < 320 * scale) {
          lx = dx / l;
          ly = dy / l;
        }
      }
      if (!opts.still) c.jelly.update(1 / 60, c.r * k, c.r * k * dpr, (c.vx / 200) * 0.5, (c.vy / 200) * 0.5, [], rand);
      drawCoinLook(ctx!, c.x, c.y, c.r * k, c.look, {
        time: opts.still ? 0 : now,
        lookX: lx * 0.8,
        lookY: ly * 0.8,
        expression: c.mood,
        pxPerUnit: dpr,
        jelly: opts.still ? null : c.jelly,
        seed: c.seed,
        halftone,
        minPrintPx: 14,
      });
    }
  }

  function frame(t: number): void {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    now = t;
    if (resize()) populate();
    step(dt);
    draw();
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  resize();
  now = performance.now();
  populate();
  draw();

  const wake = () => {
    if (opts.still || raf || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          visible = entries.some((e) => e.isIntersecting);
          wake();
        })
      : null;
  io?.observe(canvas);
  const onVis = () => wake();
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => {
    if (resize()) {
      populate();
      draw();
    }
  };
  window.addEventListener('resize', onResize);
  wake();

  return {
    stop: () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
    },
    drop: (x, y) => {
      if (opts.still) return;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + rand();
        const d = (14 + rand() * 30) * scale;
        dots.push(spawnDot(x + Math.cos(a) * d, y + Math.sin(a) * d));
      }
      pointer = { x, y, at: now };
    },
    look: (x, y) => {
      pointer = { x, y, at: now };
    },
  };
}

/** The pond canvas. `still` draws one frame (reduced motion). */
export function CoinPond({ still, avoid, events }: { still: boolean; avoid?: () => DOMRect | null; events?: PondEvents }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const pond = startPond(canvas, {
      still,
      avoid: () => avoidRef.current?.() ?? null,
      events: { onEat: (r) => eventsRef.current?.onEat?.(r) },
    });
    // the pond sits under the hero copy: listen on the hero section itself
    const host = canvas.parentElement;
    const at = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('a,button,input,textarea,select,label')) return;
      const p = at(e);
      pond.drop(p.x, p.y);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const p = at(e);
      pond.look(p.x, p.y);
    };
    host?.addEventListener('pointerdown', onDown);
    host?.addEventListener('pointermove', onMove);
    return () => {
      pond.stop();
      host?.removeEventListener('pointerdown', onDown);
      host?.removeEventListener('pointermove', onMove);
    };
  }, [still]);

  return <canvas ref={ref} className="ld-pond" data-still={still ? 'true' : 'false'} aria-hidden="true" />;
}

import { EntityKind, encodeSnapshot, type SnapshotData } from '@elymum/shared';
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Camera } from '../src/game/camera';
import { Particles } from '../src/game/particles';
import { ClientWorld } from '../src/game/state';
import { FrameGovernor } from '../src/render/governor';
import { JellyBody } from '../src/render/jelly';
import { Renderer, type FrameInput } from '../src/render/renderer';
import type { Settings } from '../src/store';

/**
 * Performance regressions that are cheap to catch in a unit test: the steady-state frame (world
 * interpolation, particles, the whole renderer with jelly, labels and the floor), the snapshot
 * decoder and the quality governor must not allocate per frame. Garbage on a weak phone is GC
 * pauses in the middle of the game. Counted with V8's sampling heap profiler (every allocation,
 * collected or not, attributed to the function that made it): the bytes allocated by the game's
 * own sources per call, after a warm-up (so the code is optimised, as in a running game), against
 * a no-op 2D context (jsdom has no canvas; drawing cost is perf-scene.mjs's job).
 */

/**
 * A 2D context that records nothing: plain fields and no-op methods on a class (so calls inline
 * like the browser's fast paths; a Proxy would box every numeric argument and drown the signal).
 */
const METRICS = { width: 40, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
class FakeContext {
  globalAlpha = 1;
  lineWidth = 1;
  lineDashOffset = 0;
  font = '10px sans-serif';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineCap = 'butt';
  lineJoin = 'miter';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  globalCompositeOperation = 'source-over';
  constructor(readonly canvas: HTMLCanvasElement) {}
  measureText() {
    return METRICS;
  }
  getContextAttributes() {
    return null;
  }
  arc() {}
  arcTo() {}
  beginPath() {}
  bezierCurveTo() {}
  clearRect() {}
  clip() {}
  closePath() {}
  drawImage() {}
  ellipse() {}
  fill() {}
  fillRect() {}
  fillText() {}
  lineTo() {}
  moveTo() {}
  quadraticCurveTo() {}
  rect() {}
  resetTransform() {}
  restore() {}
  rotate() {}
  roundRect() {}
  save() {}
  scale() {}
  setLineDash() {}
  setTransform() {}
  stroke() {}
  strokeRect() {}
  strokeText() {}
  transform() {}
  translate() {}
}
/** The fake's method names (their frames are the fake's boxing, not the game's). */
const FAKE = new Set(Object.getOwnPropertyNames(FakeContext.prototype));
const fakeContext = (canvas: HTMLCanvasElement) => new FakeContext(canvas) as unknown as CanvasRenderingContext2D;

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
let restore: (() => void) | null = null;
beforeAll(() => {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const orig = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement) {
    let c = contexts.get(this);
    if (!c) contexts.set(this, (c = fakeContext(this)));
    return c;
  };
  restore = () => (proto.getContext = orig);
});
afterAll(() => restore?.());

interface ProfileNode {
  callFrame: { url: string; functionName: string };
  selfSize: number;
  children: ProfileNode[];
}

/** Allocations of the profiler's own plumbing (the awaits around the sampled window). */
const NOT_OURS = new Set(['(root)', '(program)', '(idle)', '(garbage collector)', 'next', 'Promise', 'post', '#onMessage', 'fn']);

/** Bytes the game's sources (`/src/` of the app and the packages) allocate per call of `fn`. */
async function bytesPerCall(fn: (i: number) => void, n = 300, warm = 1500): Promise<number> {
  // warm up until the code is optimised (the browser's steady state, a few seconds into a game)
  for (let i = 0; i < warm; i++) fn(i);
  const session = new Session();
  session.connect();
  try {
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
    for (let i = 0; i < n; i++) fn(warm + i);
    const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: ProfileNode } };
    let bytes = 0;
    const seen: string[] = [];
    const walk = (node: ProfileNode) => {
      const { url, functionName } = node.callFrame;
      // the game's sources and the builtins they call (not the profiler's own plumbing, and not
      // this file: its no-op context boxes numbers like any canvas call does, which is not ours)
      if (node.selfSize && !url.startsWith('node:') && !(url.includes('/test/') && FAKE.has(functionName)) && !NOT_OURS.has(functionName)) {
        bytes += node.selfSize;
        if (process.env.ALLOC_DEBUG) seen.push(`${node.selfSize} ${functionName} ${url.slice(-40)}:${(node as unknown as { callFrame: { lineNumber: number } }).callFrame.lineNumber + 1}`);
      }
      for (const c of node.children) walk(c);
    };
    walk(profile.head);
    if (process.env.ALLOC_DEBUG) process.stderr.write(`alloc ${(bytes / n).toFixed(1)} B/call\n  ${seen.sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 14).join('\n  ')}\n`);
    return bytes / n;
  } finally {
    await session.post('HeapProfiler.disable');
    session.disconnect();
  }
}

const SETTINGS: Settings = {
  name: 'x',
  skin: 0,
  theme: 'light',
  quality: 'high',
  showNames: true,
  showMass: true,
  showFps: false,
  showMinimap: true,
  showChat: true,
} as Settings;

/** A busy arena: 40 coins (names, BOT chips, holders, flags), food, loot, power-ups, thorn bushes. */
function busyWorld(): { world: ClientWorld; camera: Camera } {
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const world = new ClientWorld();
  world.width = world.height = 5600;
  const camera = new Camera();
  camera.resize(390, 844);
  camera.x = camera.y = 2800;
  camera.zoom = 0.42;
  const span = 844 / 0.42;
  const at = () => 2800 + (rnd() - 0.5) * span;
  let id = 1;
  const add = (kind: EntityKind, r: number, extra: Partial<SnapshotData['upserts'][number]> = {}) =>
    ({ id: id++, kind, x: at(), y: at(), r, ...extra }) as SnapshotData['upserts'][number];
  const upserts: SnapshotData['upserts'] = [];
  const players: SnapshotData['players'] = [];
  for (let i = 0; i < 40; i++) {
    players.push({ id: i + 1, skin: i % 12, flags: i % 3 === 0 ? 1 : i % 5 === 0 ? 4 : 0, name: `coin_${i}` });
    upserts.push(add(EntityKind.Cell, 18 + rnd() ** 2 * 230, { playerId: i + 1, flags: i === 3 ? 1 : i === 5 ? 4 : 0 }));
  }
  for (let i = 0; i < 300; i++) upserts.push(add(EntityKind.Food, 10, { variant: i % 8 }));
  for (let i = 0; i < 6; i++) upserts.push(add(EntityKind.Loot, 16, { variant: i % 4 }));
  for (let i = 0; i < 3; i++) upserts.push(add(EntityKind.PowerUp, 34, { variant: i + 1 }));
  for (let i = 0; i < 4; i++) upserts.push(add(EntityKind.Virus, 100));
  world.apply({ tick: 1, view: { x: 2800, y: 2800, h: 2000 }, players, upserts, removals: [] }, -10_000);
  world.myPid = 1;
  for (const e of world.entities.values()) if (e.kind === EntityKind.Cell) e.jelly ??= new JellyBody();
  return { world, camera };
}

describe('frame budget: no garbage per frame', () => {
  it('the steady-state frame (world update, particles, renderer) allocates nothing measurable', async () => {
    const { world, camera } = busyWorld();
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.resize(390, 844);
    const particles = new Particles();
    let rs = 42;
    const rand = () => ((rs = (rs * 16807) % 2147483647), rs / 2147483647);
    const input: FrameInput = { now: 0, dt: 1 / 60, world, camera, particles, settings: SETTINGS, reduced: false, aim: { x: 2900, y: 2700 }, coinRain: true, rand, drop: null };
    const frame = (i: number) => {
      const now = 1000 + i * 16.7;
      input.now = now;
      world.update(now, 1 / 60);
      particles.update(1 / 60);
      renderer.draw(input);
    };
    const perFrame = await bytesPerCall(frame);
    // ~10 KB is left: the numbers boxed to pass into canvas calls (a real canvas costs the same). The
    // frame before this work made ~150 KB here (literals per coin, per label, per dash pattern, per
    // Map step, and per-frame arrays regrown from empty).
    expect(perFrame).toBeLessThan(20_000);
  });

  it('a busy moment (particles in the air, coin rain) still draws without per-frame garbage', async () => {
    const { world, camera } = busyWorld();
    const renderer = new Renderer(document.createElement('canvas'));
    renderer.resize(390, 844);
    const particles = new Particles();
    // particle pools: spawning reuses retired particles once the pool is warm
    for (let i = 0; i < 30; i++) {
      particles.scraps(2800, 2800, 40, 16);
      particles.splat(2800, 2800, '#F2B8C6', 7);
      particles.coinBurst(2800, 2800, 40, 14);
      particles.ring(2800, 2800, 50, '#F7C948');
      particles.text(2800, 2800, '+37', undefined, 24);
    }
    const input: FrameInput = { now: 0, dt: 1 / 60, world, camera, particles, settings: SETTINGS, reduced: false, aim: null, coinRain: true, rand: Math.random, drop: null };
    const perFrame = await bytesPerCall((i) => {
      input.now = 1000 + i * 16.7;
      // the particles stay alive (no time passes for them), so every frame draws all of them
      renderer.draw(input);
    });
    // before: ~165 KB per frame
    expect(perFrame).toBeLessThan(20_000);
  });

  it('applying a binary snapshot does not build garbage records', async () => {
    const { world } = busyWorld();
    const ids = [...world.entities.values()].filter((e) => e.kind === EntityKind.Cell || e.kind === EntityKind.Food);
    const players = [...world.players.values()].map(({ emote: _e, ...p }) => p);
    const buf = encodeSnapshot({
      tick: 2,
      view: { x: 2800, y: 2800, h: 2000 },
      players,
      upserts: ids.map((e) => ({ id: e.id, kind: e.kind, x: e.nx + 3, y: e.ny - 2, r: e.nr, playerId: e.playerId || undefined, flags: e.kind === EntityKind.Cell ? e.flags : undefined, variant: e.kind === EntityKind.Food ? e.variant : undefined })),
      removals: [],
    });
    const perSnapshot = await bytesPerCall((i) => world.applyBinary(buf, 2000 + i * 33), 200, 5000);
    // ~380 records and 40 players: decodeSnapshot + apply made ~79 KB per snapshot (30 a second)
    expect(perSnapshot).toBeLessThan(4096);
  });

  it('the quality governor measures frames without garbage', async () => {
    const g = new FrameGovernor();
    g.maxLevel = 4;
    const clock = { t: 0 };
    // before: ~6 KB per frame (a fresh sorted copy of the window every frame)
    expect(await bytesPerCall(() => g.frame((clock.t += 16.7)), 2000, 20_000)).toBeLessThan(256);
  });
});


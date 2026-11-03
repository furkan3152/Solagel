/**
 * Soak: the real app in this process (DEV_FAKE_CHAIN, bots in every room) with churning WebSocket
 * clients (connect, hello, join practice / an arena, steer, chat, leave, reconnect, disconnect) for
 * SOAK_MINUTES (default 5). Every 15 s it prints the heap after a GC, RSS, the active handles, the
 * connections and rooms, and the slowest room tick of the window.
 *
 *   node --expose-gc --import tsx scripts/bench/soak.ts
 *   SOAK_MINUTES=10 SOAK_CLIENTS=60 node --expose-gc --import tsx scripts/bench/soak.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, encodeTarget } from '@elymum/shared';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';

const minutes = Number(process.env.SOAK_MINUTES ?? 5);
const clients = Number(process.env.SOAK_CLIENTS ?? 40);
const dir = mkdtempSync(join(tmpdir(), 'elymum-soak-'));
const cfg = loadConfig({
  NODE_ENV: 'development',
  DEV_FAKE_CHAIN: '1',
  PORT: '0',
  HOST: '127.0.0.1',
  DATA_DIR: dir,
  GAME_ACCESS: 'public',
  BOT_TARGET: '20',
  BOT_MAX: '20',
  ARENA_BOT_TARGET: '12',
  ROUND_SECONDS: '30',
  ROUND_JOIN_CLOSE_SECONDS: '5',
  MAX_CONNECTIONS_PER_IP: '1000',
} as unknown as NodeJS.ProcessEnv);
const logs: string[] = [];
const app = await createApp(cfg, { log: (m) => logs.push(m) });
const port = await app.listen();
const url = `ws://127.0.0.1:${port}/ws`;

// slowest tick per window: wrap every room's tick
let worstTickMs = 0;
let ticks = 0;
const wrapped = new WeakSet<object>();
function wrapRooms(): void {
  for (const r of app.rooms.rooms.values()) {
    const room = r as unknown as { tick?: (...a: unknown[]) => unknown };
    if (wrapped.has(r) || typeof room.tick !== 'function') continue;
    wrapped.add(r);
    const orig = room.tick.bind(r);
    room.tick = (...a: unknown[]) => {
      const t = performance.now();
      const out = orig(...a);
      const ms = performance.now() - t;
      ticks++;
      if (ms > worstTickMs) worstTickMs = ms;
      return out;
    };
  }
}

const rnd = (n: number) => Math.floor(Math.random() * n);
let opened = 0;
let errors = 0;

function client(): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    opened++;
    const life = 2_000 + rnd(20_000);
    let steer: NodeJS.Timeout | null = null;
    const done = () => {
      if (steer) clearInterval(steer);
      resolve();
    };
    ws.on('error', () => {
      errors++;
      done();
    });
    ws.on('close', done);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
      const room = Math.random() < 0.15 ? 'arena:1' : 'practice';
      ws.send(JSON.stringify({ t: 'join', room, name: `soak${rnd(1000)}`, skin: rnd(4), country: Math.random() < 0.5 ? 'TR' : undefined }));
      steer = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(encodeTarget(rnd(12_000), rnd(12_000)));
        if (Math.random() < 0.02) ws.send(JSON.stringify({ t: 'chat', text: 'hello there' }));
        if (Math.random() < 0.01) ws.send(JSON.stringify({ t: 'spectate' }));
        if (Math.random() < 0.01) ws.send(JSON.stringify({ t: 'join', room: 'practice', name: 'again', skin: 1 }));
        if (Math.random() < 0.005) ws.send(Buffer.from([0xff, 1, 2]));
      }, 100);
      setTimeout(() => {
        if (Math.random() < 0.5) ws.send(JSON.stringify({ t: 'leave' }));
        // half close cleanly, half just drop
        if (Math.random() < 0.5) ws.close();
        else ws.terminate();
      }, life);
    });
  });
}

async function worker(until: number): Promise<void> {
  while (Date.now() < until) await client();
}

const until = Date.now() + minutes * 60_000;
const t0 = Date.now();
const sample = () => {
  wrapRooms();
  (globalThis as { gc?: () => void }).gc?.();
  const m = process.memoryUsage();
  const handles = (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo();
  const kinds: Record<string, number> = {};
  for (const h of handles) kinds[h] = (kinds[h] ?? 0) + 1;
  console.log(
    `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s heap ${(m.heapUsed / 1e6).toFixed(1)} MB rss ${(m.rss / 1e6).toFixed(0)} MB · handles ${handles.length} ${JSON.stringify(kinds)} · conns ${app.rooms.conns.size} rooms ${app.rooms.rooms.size} · opened ${opened} errors ${errors} · worst tick ${worstTickMs.toFixed(1)} ms over ${ticks}`,
  );
  worstTickMs = 0;
  ticks = 0;
};
const timer = setInterval(sample, 15_000);
sample();
await Promise.all(Array.from({ length: clients }, () => worker(until)));
await new Promise((r) => setTimeout(r, 3_000));
sample();
clearInterval(timer);
const bad = logs.filter((l) => /!!!|failed|Error/.test(l));
console.log(`log lines ${logs.length}; alarms/errors ${bad.length}`);
for (const l of bad.slice(0, 20)) console.log(`  ${l}`);
await app.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);

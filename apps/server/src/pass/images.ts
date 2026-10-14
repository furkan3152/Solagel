import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawPassCard, passTraits } from '@slana/art';
import type { PassStatus } from '@slana/shared';
import { passInRange, revealedSeed } from './metadata';

/** Edge of every Pass image, px. */
export const PASS_IMAGE_SIZE = 1024;
/** Cache folder of the pre-reveal images (never a 16-hex seed prefix). */
export const SEALED_KEY = 'sealed';
const MEMORY_ENTRIES = 32;

type Target = number | 'collection';

/**
 * Renders Pass cards with `@napi-rs/canvas` on first request and caches them
 * in `<dir>/<key>/<n>.png`, where `key` is the first 16 hex chars of the
 * revealed seed (a new seed never reuses old files) or `sealed` before the
 * reveal. A small in-memory LRU and per-file in-flight sharing keep repeated
 * requests cheap.
 */
export class PassImages {
  /** Number of images drawn (tests). */
  renders = 0;
  private readonly memory = new Map<string, Buffer>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();

  constructor(private readonly dir: string) {}

  /** Cache folder name for the current reveal state. */
  cacheKey(pass: PassStatus): string {
    const seed = revealedSeed(pass);
    return seed ? seed.slice(0, 16).toLowerCase() : SEALED_KEY;
  }

  /** PNG of Pass `n` (or the collection image); null when `n` is outside `1..supply`. */
  async png(n: Target, pass: PassStatus): Promise<Buffer | null> {
    if (n !== 'collection' && !passInRange(n, pass)) return null;
    // the collection image is the sealed card in every state
    const key = n === 'collection' ? SEALED_KEY : this.cacheKey(pass);
    const file = join(this.dir, key, `${n}.png`);
    const hit = this.memory.get(file);
    if (hit) {
      this.memory.delete(file);
      this.memory.set(file, hit);
      return hit;
    }
    let running = this.inFlight.get(file);
    if (!running) {
      running = this.load(file, n, n === 'collection' ? null : revealedSeed(pass), pass.supply).finally(() => this.inFlight.delete(file));
      this.inFlight.set(file, running);
    }
    const buf = await running;
    this.remember(file, buf);
    return buf;
  }

  private async load(file: string, n: Target, seed: string | null, supply: number): Promise<Buffer> {
    if (existsSync(file)) {
      try {
        return await readFile(file);
      } catch {
        /* re-render below */
      }
    }
    const buf = await this.render(n === 'collection' ? 0 : n, seed, supply);
    try {
      mkdirSync(join(file, '..'), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    } catch {
      /* serving still works without the disk cache */
    }
    return buf;
  }

  private async render(n: number, seed: string | null, supply: number): Promise<Buffer> {
    // loaded lazily: the native module is only needed once an image is requested
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(PASS_IMAGE_SIZE, PASS_IMAGE_SIZE);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    drawPassCard(ctx, seed ? passTraits(seed, n, supply) : null, n, PASS_IMAGE_SIZE);
    this.renders++;
    return canvas.encode('png');
  }

  private remember(file: string, buf: Buffer): void {
    this.memory.delete(file);
    this.memory.set(file, buf);
    while (this.memory.size > MEMORY_ENTRIES) this.memory.delete(this.memory.keys().next().value!);
  }
}


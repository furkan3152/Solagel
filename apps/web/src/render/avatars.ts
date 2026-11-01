import { avatarPath, isAvatarId } from '@elymum/shared';
import { SERVER } from '../config';

/** Disc sizes (device px) a picture is pre-rendered at; a coin uses the smallest one at least its size. */
const BUCKETS = [16, 24, 32, 48, 64, 96, 128] as const;
/** Pictures kept decoded at once (least recently drawn ones go first). */
const MAX_ENTRIES = 80;
/** Downloads at once (the rest wait their turn). */
const MAX_LOADING = 4;
/** A failed download is tried again after this long, at most `MAX_TRIES` times. */
const RETRY_MS = 30_000;
const MAX_TRIES = 3;

type State = 'queued' | 'loading' | 'ready' | 'error';

interface Entry {
  id: string;
  state: State;
  img: HTMLImageElement | null;
  /** Pre-rendered discs by bucket index (filled on first use of a size). */
  discs: (HTMLCanvasElement | null)[];
  tries: number;
  failedAt: number;
  /** `clock` of the last `disc` call (LRU). */
  used: number;
}

/** The smallest bucket index whose size covers `px` (the largest one past it). */
export function bucketFor(px: number): number {
  for (let i = 0; i < BUCKETS.length; i++) if (BUCKETS[i] >= px) return i;
  return BUCKETS.length - 1;
}

export const AVATAR_BUCKETS = BUCKETS;

/**
 * Profile pictures of the players in view. Each picture is downloaded once (`/api/avatar/<id>`, an
 * immutable URL), decoded once, and cut to a disc per size bucket on first use (like the name-tag
 * cache): drawing a coin then costs one `drawImage` and allocates nothing. While a picture loads, or
 * when it fails, `disc` answers null and the coin is drawn as its basic skin.
 */
export class AvatarCache {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: Entry[] = [];
  private readonly listeners = new Set<(id: string) => void>();
  private loading = 0;
  private clock = 0;

  constructor(
    private readonly urlOf: (id: string) => string = (id) => `${SERVER.http}${avatarPath(id)}`,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Called with the id whenever a picture finished loading (portraits redraw). Returns an unsubscribe. */
  subscribe(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Loading state of a picture (`undefined`: never asked for). */
  state(id: string): State | undefined {
    return this.entries.get(id)?.state;
  }

  /** Starts loading a picture (no-op when known). */
  request(id: string): void {
    this.entry(id);
  }

  /**
   * The picture `id` cut to a disc of about `px` device px (a square canvas, transparent outside the
   * circle), or null while it loads / after it failed.
   */
  disc(id: string, px: number): HTMLCanvasElement | null {
    const e = this.entry(id);
    if (!e) return null;
    e.used = ++this.clock;
    if (e.state !== 'ready') {
      if (e.state === 'error' && e.tries < MAX_TRIES && this.now() - e.failedAt > RETRY_MS) this.enqueue(e);
      return null;
    }
    const b = bucketFor(px);
    return e.discs[b] ?? this.render(e, b);
  }

  private entry(id: string): Entry | null {
    let e = this.entries.get(id);
    if (e) return e;
    if (!isAvatarId(id)) return null;
    e = { id, state: 'queued', img: null, discs: [], tries: 0, failedAt: 0, used: ++this.clock };
    this.entries.set(id, e);
    if (this.entries.size > MAX_ENTRIES) this.evict();
    this.enqueue(e);
    return e;
  }

  private enqueue(e: Entry): void {
    e.state = 'queued';
    this.queue.push(e);
    this.pump();
  }

  private pump(): void {
    while (this.loading < MAX_LOADING && this.queue.length > 0) {
      const e = this.queue.shift()!;
      if (this.entries.get(e.id) !== e || e.state !== 'queued') continue;
      this.load(e);
    }
  }

  private load(e: Entry): void {
    e.state = 'loading';
    e.tries++;
    this.loading++;
    const img = new Image();
    img.decoding = 'async';
    const done = (ok: boolean) => {
      this.loading--;
      if (this.entries.get(e.id) === e) {
        if (ok && img.naturalWidth > 0) {
          e.img = img;
          e.state = 'ready';
          for (const fn of this.listeners) fn(e.id);
        } else {
          e.state = 'error';
          e.failedAt = this.now();
        }
      }
      this.pump();
    };
    img.onload = () => {
      // decode before the first draw, so a coin never stalls a frame on it
      if (typeof img.decode === 'function') img.decode().then(() => done(true), () => done(img.complete));
      else done(true);
    };
    img.onerror = () => done(false);
    img.src = this.urlOf(e.id);
  }

  private render(e: Entry, b: number): HTMLCanvasElement | null {
    const size = BUCKETS[b];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx || !e.img) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    // a larger disc already cut is a better source than the full picture for a big step down
    const from = e.discs.findIndex((d, i) => !!d && i > b && BUCKETS[i] <= size * 2);
    ctx.drawImage(from >= 0 ? e.discs[from]! : e.img, 0, 0, size, size);
    e.discs[b] = c;
    return c;
  }

  private evict(): void {
    let oldest: Entry | null = null;
    for (const e of this.entries.values()) if (e.state !== 'loading' && (!oldest || e.used < oldest.used)) oldest = e;
    if (oldest) this.entries.delete(oldest.id);
  }

  /** Forgets a picture (it was removed: the next request loads it again). */
  forget(id: string): void {
    this.entries.delete(id);
  }
}

/** One cache for the game canvas and every portrait. */
export const avatars = new AvatarCache();

/**
 * The audio files (announcer lines and music loops) and how they reach an AudioBuffer.
 *
 * Every file ships twice: Ogg Opus (smaller; Chrome, Firefox, Edge, newer Safari) and AAC in
 * .m4a (every Safari). The format the browser says it plays goes first; if fetching or decoding
 * it fails anyway, the other format is tried, then the asset is given up (silence, no retries
 * loop). Nothing is fetched before the first user gesture: the announcer and the music ask for
 * their files once the mixer is unlocked. The compressed bytes are kept (small); decoded buffers
 * are the callers' business (they are large: ~190 kB per second of 48 kHz mono).
 */

export type Format = 'ogg' | 'm4a';

/** Asset key ("voice/firstBite-1", "music/lobby") → URL per format. */
export type AssetUrls = Record<string, Partial<Record<Format, string>>>;

/** URLs of the bundled files (hashed by Vite at build time; nothing is loaded by this). */
const BUNDLED = import.meta.glob('./assets/**/*.{ogg,m4a}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Glob result → asset keys. `./assets/voice/paid-2.ogg` → `voice/paid-2` (ogg). */
export function assetUrls(globbed: Record<string, string> = BUNDLED): AssetUrls {
  const out: AssetUrls = {};
  for (const [path, url] of Object.entries(globbed)) {
    const m = /assets\/(.+)\.(ogg|m4a)$/.exec(path);
    if (!m) continue;
    (out[m[1]] ??= {})[m[2] as Format] = url;
  }
  return out;
}

/** Formats to try, best first: Ogg Opus where the browser claims it, else AAC first. */
export function preferredFormats(canPlay?: ((mime: string) => string) | null): Format[] {
  let ogg = '';
  try {
    const probe = canPlay ?? (typeof document !== 'undefined' ? (m: string) => document.createElement('audio').canPlayType(m) : null);
    ogg = probe ? probe('audio/ogg; codecs="opus"') : '';
  } catch {
    ogg = '';
  }
  return ogg ? ['ogg', 'm4a'] : ['m4a', 'ogg'];
}

export type Fetcher = (url: string) => Promise<ArrayBuffer>;

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`audio ${r.status}`);
  return r.arrayBuffer();
};

/** decodeAudioData in both its promise and its old callback form (older Safari). */
export function decodeBuffer(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

export class AssetLoader {
  private readonly bytesCache = new Map<string, Promise<{ fmt: Format; data: ArrayBuffer } | null>>();
  /** Formats that failed to decode for a key (the next try skips them). */
  private readonly bad = new Map<string, Set<Format>>();

  constructor(
    readonly urls: AssetUrls = assetUrls(),
    readonly formats: Format[] = preferredFormats(),
    private readonly fetcher: Fetcher = defaultFetch,
  ) {}

  has(key: string): boolean {
    return !!this.urls[key];
  }

  /** Has `key`'s compressed data arrived (it decodes without a network wait)? */
  ready(key: string): boolean {
    return this.settled.has(key);
  }

  private readonly settled = new Set<string>();

  /** The compressed file, first format that fetches (cached; null when none does). */
  bytes(key: string): Promise<{ fmt: Format; data: ArrayBuffer } | null> {
    let p = this.bytesCache.get(key);
    if (!p) {
      p = this.fetchFirst(key);
      this.bytesCache.set(key, p);
      void p.then((v) => {
        if (v) this.settled.add(key);
      });
    }
    return p;
  }

  private async fetchFirst(key: string, skip?: Set<Format>): Promise<{ fmt: Format; data: ArrayBuffer } | null> {
    const urls = this.urls[key];
    if (!urls) return null;
    for (const fmt of this.formats) {
      const url = urls[fmt];
      if (!url || skip?.has(fmt)) continue;
      try {
        return { fmt, data: await this.fetcher(url) };
      } catch {
        /* the next format */
      }
    }
    return null;
  }

  /** Fetches and decodes `key`; a format that will not decode falls back to the next one. */
  async decode(ctx: BaseAudioContext, key: string): Promise<AudioBuffer | null> {
    for (let i = 0; i < this.formats.length; i++) {
      const got = await this.bytes(key);
      if (!got) return null;
      try {
        // decodeAudioData detaches its input: decode a copy, keep the bytes
        return await decodeBuffer(ctx, got.data.slice(0));
      } catch {
        const bad = this.bad.get(key) ?? new Set<Format>();
        bad.add(got.fmt);
        this.bad.set(key, bad);
        this.settled.delete(key);
        const next = this.fetchFirst(key, bad);
        this.bytesCache.set(key, next);
        void next.then((v) => {
          if (v) this.settled.add(key);
        });
      }
    }
    return null;
  }

  /** Fetches the compressed files of `keys`, a few at a time (idle preloading). */
  async prefetch(keys: readonly string[], parallel = 3): Promise<void> {
    let i = 0;
    const worker = async () => {
      while (i < keys.length) {
        const k = keys[i++];
        await this.bytes(k);
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, keys.length) }, worker));
  }
}

/** A small LRU of decoded buffers (decoded audio is big; compressed bytes stay in the loader). */
export class BufferCache {
  private readonly map = new Map<string, AudioBuffer>();
  constructor(readonly max: number) {}

  get(key: string): AudioBuffer | undefined {
    const b = this.map.get(key);
    if (b) {
      this.map.delete(key);
      this.map.set(key, b);
    }
    return b;
  }

  set(key: string, b: AudioBuffer): void {
    this.map.delete(key);
    this.map.set(key, b);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number {
    return this.map.size;
  }
}

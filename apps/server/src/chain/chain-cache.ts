import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Last good chain reads, kept on disk (`DATA_DIR/chains/<id>/<name>`) so a restart while the RPC is
 * rate-limiting us still knows the arenas, the arena config, the mint state and the holder index:
 * the server serves them (stale) instead of failing and refreshes them in the background. Nothing in
 * here is money state (that is the journal); a lost or corrupt file only costs a few reads.
 */
export class ChainCache {
  private data: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | null = null;
  /** Something changed since the last write. */
  private dirty = false;

  constructor(
    private readonly path: string | null,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.load();
  }

  /** `<dir>/<name>`, or memory only when `dir` is null. */
  static in(dir: string | null, name: string, log?: (m: string) => void): ChainCache {
    return new ChainCache(dir ? join(dir, name) : null, log);
  }

  private load(): void {
    const p = this.path;
    if (!p || !existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'), revive) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.data = raw as Record<string, unknown>;
    } catch (err) {
      this.log(`chain: cache ${p} is unreadable (${(err as Error).message}); starting empty`);
      this.data = {};
    }
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  /** Stores `value` under `key` (written to disk within a second, batched). */
  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.dirty = true;
    this.scheduleSave();
  }

  delete(key: string): void {
    if (!(key in this.data)) return;
    delete this.data[key];
    this.dirty = true;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 1_000);
    this.timer.unref();
  }

  /** Writes the file now when something changed (atomic rename). Never throws. */
  flush(): void {
    const p = this.path;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!p || !this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(`${p}.tmp`, JSON.stringify(this.data, replace));
      renameSync(`${p}.tmp`, p);
    } catch (err) {
      this.log(`chain: cache ${p} could not be written (${(err as Error).message})`);
    }
  }
}

/** JSON with bigints: `{"$big":"123"}`. */
function replace(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { $big: value.toString() } : value;
}

function revive(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o.$big === 'string' && Object.keys(o).length === 1 && /^-?\d+$/.test(o.$big)) return BigInt(o.$big);
  }
  return value;
}

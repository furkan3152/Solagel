import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INTEGRITY_FLAG_KINDS,
  INTEGRITY_SETTINGS_DEFAULT,
  type IntegrityBan,
  type IntegrityFlag,
  type IntegritySettings,
  type IntegrityTransfer,
} from '@elymum/shared';
import { sanitizeSettings } from './settings';
import type { SessionSummary } from './types';

/** Files under `DATA_DIR/integrity/` (written with write-to-temp + rename). */
export const INTEGRITY_FILES = { state: 'state.json', secret: 'secret.key', log: 'log' } as const;

export interface IntegrityState {
  settings: IntegritySettings;
  bans: IntegrityBan[];
  flags: IntegrityFlag[];
  scannedAt: number | null;
}

interface StateFile extends IntegrityState {
  version: 1;
}

export interface LogChunk {
  sessions: SessionSummary[];
  transfers: IntegrityTransfer[];
}

export interface IntegrityStoreOptions {
  log?: (m: string) => void;
  now?: () => number;
  /** Log chunks older than this are deleted (default 30 days). */
  retentionDays?: number;
  /** At most this many log chunks are kept, newest first (default 3000). */
  maxFiles?: number;
}

function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

const DAY = 86_400_000;
const CHUNK_RE = /^(\d{8}T\d{6})-(\d{6})\.json$/;

/**
 * Integrity persistence. `state.json` holds the settings, bans and flags; the session summaries and
 * value transfers are appended as small immutable chunks under `log/` (one per flush, named by time
 * so they sort), pruned by age and count. Without a directory (tests) nothing is written.
 */
export class IntegrityStore {
  readonly secret: Buffer;
  private seq = Math.floor(Math.random() * 1_000_000);
  private readonly log: (m: string) => void;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxFiles: number;

  constructor(
    private readonly dir: string | null,
    opts: IntegrityStoreOptions = {},
  ) {
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.retentionMs = (opts.retentionDays ?? 30) * DAY;
    this.maxFiles = opts.maxFiles ?? 3000;
    if (dir) mkdirSync(join(dir, INTEGRITY_FILES.log), { recursive: true });
    this.secret = this.loadSecret();
  }

  /** The keyed-hash secret for IP and fingerprint hashes; created once and kept, so hashes match across restarts. */
  private loadSecret(): Buffer {
    if (!this.dir) return randomBytes(32);
    const p = join(this.dir, INTEGRITY_FILES.secret);
    try {
      const hex = readFileSync(p, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    } catch {
      /* first start */
    }
    const key = randomBytes(32);
    writeAtomic(p, key.toString('hex'));
    try {
      chmodSync(p, 0o600);
    } catch {
      /* best effort */
    }
    return key;
  }

  loadState(): IntegrityState {
    const empty: IntegrityState = { settings: structuredClone(INTEGRITY_SETTINGS_DEFAULT), bans: [], flags: [], scannedAt: null };
    if (!this.dir) return empty;
    const p = join(this.dir, INTEGRITY_FILES.state);
    if (!existsSync(p)) return empty;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<StateFile>;
      if (raw.version !== 1) throw new Error('unknown version');
      return {
        settings: sanitizeSettings(raw.settings),
        bans: Array.isArray(raw.bans) ? raw.bans.filter((b) => typeof b?.wallet === 'string' && typeof b.at === 'number') : [],
        flags: Array.isArray(raw.flags) ? raw.flags.filter((f) => typeof f?.id === 'string' && INTEGRITY_FLAG_KINDS.includes(f.kind)) : [],
        scannedAt: typeof raw.scannedAt === 'number' ? raw.scannedAt : null,
      };
    } catch (err) {
      const backup = `${p}.corrupt-${this.now()}`;
      this.log(`!!! integrity: ${p} is unreadable (${(err as Error).message}); moved to ${backup}. Bans and flags start empty; auto-hold is off.`);
      try {
        renameSync(p, backup);
      } catch {
        /* ignore */
      }
      return empty;
    }
  }

  saveState(state: IntegrityState): void {
    if (!this.dir) return;
    const file: StateFile = { version: 1, ...state };
    writeAtomic(join(this.dir, INTEGRITY_FILES.state), JSON.stringify(file));
  }

  /** Writes one immutable log chunk (nothing when empty) and applies the retention cap. */
  appendLog(chunk: LogChunk): void {
    if (!this.dir || (chunk.sessions.length === 0 && chunk.transfers.length === 0)) return;
    const stamp = new Date(this.now()).toISOString().replace(/[-:]/g, '').slice(0, 15);
    const name = `${stamp}-${String(this.seq++ % 1_000_000).padStart(6, '0')}.json`;
    writeAtomic(join(this.dir, INTEGRITY_FILES.log, name), JSON.stringify(chunk));
    this.prune();
  }

  private chunks(): string[] {
    if (!this.dir) return [];
    try {
      return readdirSync(join(this.dir, INTEGRITY_FILES.log))
        .filter((f) => CHUNK_RE.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  private static chunkTime(name: string): number {
    const m = CHUNK_RE.exec(name);
    if (!m) return 0;
    const s = m[1];
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
  }

  /** Deletes chunks older than the retention or beyond the count cap (oldest first). Returns how many. */
  prune(): number {
    if (!this.dir) return 0;
    const files = this.chunks();
    const cutoff = this.now() - this.retentionMs;
    let removed = 0;
    files.forEach((f, i) => {
      if (IntegrityStore.chunkTime(f) >= cutoff && files.length - i <= this.maxFiles) return;
      try {
        unlinkSync(join(this.dir!, INTEGRITY_FILES.log, f));
        removed++;
      } catch {
        /* ignore */
      }
    });
    return removed;
  }

  /** Reads the newest chunks back (for the detection window), newest first, until the caps are reached. */
  loadRecent(sinceMs: number, maxSessions: number, maxTransfers: number): LogChunk {
    const out: LogChunk = { sessions: [], transfers: [] };
    if (!this.dir) return out;
    const files = this.chunks().reverse();
    for (const f of files) {
      if (IntegrityStore.chunkTime(f) < sinceMs - DAY) break;
      if (out.sessions.length >= maxSessions && out.transfers.length >= maxTransfers) break;
      try {
        const c = JSON.parse(readFileSync(join(this.dir, INTEGRITY_FILES.log, f), 'utf8')) as LogChunk;
        if (Array.isArray(c.sessions)) for (const s of c.sessions) if (typeof s?.key === 'string' && (s.endedAt ?? 0) >= sinceMs) out.sessions.push(s);
        if (Array.isArray(c.transfers)) for (const t of c.transfers) if (typeof t?.from === 'string' && t.at >= sinceMs) out.transfers.push(t);
      } catch (err) {
        this.log(`integrity: skipped unreadable log chunk ${f} (${(err as Error).message})`);
      }
    }
    // oldest first, as they happened
    out.sessions.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    out.transfers.sort((a, b) => a.at - b.at);
    if (out.sessions.length > maxSessions) out.sessions.splice(0, out.sessions.length - maxSessions);
    if (out.transfers.length > maxTransfers) out.transfers.splice(0, out.transfers.length - maxTransfers);
    return out;
  }
}

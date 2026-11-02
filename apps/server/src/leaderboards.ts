import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEADERBOARD_SIZE } from '@elymum/shared';

export interface LbRecord {
  name: string;
  score: number;
  skin: number;
  wallet: string | null;
  kills: number;
  at: number;
}

interface LbFile {
  /** The leaderboard epoch the records belong to (absent in files written before epochs existed: 1). */
  epoch?: number;
  day: string;
  daily: LbRecord[];
  allTime: LbRecord[];
  /** When the boards were last reset (Unix ms) and by whom (`epoch` for the automatic reset of a deploy). */
  resetAt?: number;
  resetBy?: string;
}

/**
 * Bump this to clear the daily and all-time leaderboards once on the next deploy: a file written under a lower
 * epoch is backed up next to itself (`<file>.epoch-<old>-<ts>.bak`) and the boards start empty. Profiles (XP,
 * levels, games, kills, best score) are never touched by a leaderboard reset.
 *
 * 2: the reset the owner asked for with the move to the fee-on-entry arena (November 2026).
 */
export const LEADERBOARD_EPOCH = 2;

const KEEP = 50;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Wallet players are unique by wallet, guests by name. */
const identity = (r: LbRecord) => (r.wallet ? `w:${r.wallet}` : `n:${r.name.toLowerCase()}`);

/** What the admin panel shows about the boards. */
export interface LeaderboardInfo {
  epoch: number;
  day: string;
  daily: number;
  allTime: number;
  resetAt: number | null;
  resetBy: string | null;
}

/** Off-chain daily / all-time best scores of human players (bots excluded). */
export class Leaderboards {
  private day: string;
  private daily: LbRecord[] = [];
  private allTime: LbRecord[] = [];
  private dirty = false;
  private epoch = LEADERBOARD_EPOCH;
  private resetAt: number | null = null;
  private resetBy: string | null = null;

  constructor(
    private readonly path: string | null,
    now = Date.now(),
    opts: { epoch?: number; log?: (m: string) => void } = {},
  ) {
    const epoch = opts.epoch ?? LEADERBOARD_EPOCH;
    this.epoch = epoch;
    this.day = dayOf(now);
    if (path && existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as LbFile;
        const fileEpoch = Number.isInteger(data.epoch) ? (data.epoch as number) : 1;
        if (fileEpoch < epoch) {
          // a deploy that bumps the epoch starts the boards fresh, once; the old file is kept next to it
          const backup = this.backup(`epoch-${fileEpoch}`, now);
          this.resetAt = now;
          this.resetBy = 'epoch';
          this.dirty = true;
          opts.log?.(`leaderboards: epoch ${fileEpoch} → ${epoch}: daily and all-time boards reset${backup ? ` (old file kept as ${backup})` : ''}`);
          this.flush();
          return;
        }
        this.allTime = Array.isArray(data.allTime) ? data.allTime : [];
        this.daily = data.day === this.day && Array.isArray(data.daily) ? data.daily : [];
        this.resetAt = typeof data.resetAt === 'number' ? data.resetAt : null;
        this.resetBy = typeof data.resetBy === 'string' ? data.resetBy : null;
        if (fileEpoch > epoch) this.epoch = fileEpoch;
      } catch {
        /* start fresh */
      }
    }
  }

  private insert(list: LbRecord[], rec: LbRecord): LbRecord[] {
    const id = identity(rec);
    const existing = list.find((r) => identity(r) === id);
    if (existing) {
      if (existing.score >= rec.score) return list;
      list = list.filter((r) => r !== existing);
    } else if (list.length >= KEEP && list[list.length - 1].score >= rec.score) {
      return list;
    }
    list.push(rec);
    list.sort((a, b) => b.score - a.score);
    return list.slice(0, KEEP);
  }

  submit(rec: LbRecord): void {
    if (!(rec.score > 0)) return;
    this.rollover(rec.at);
    this.daily = this.insert(this.daily, rec);
    this.allTime = this.insert(this.allTime, rec);
    this.dirty = true;
  }

  private rollover(now: number): void {
    const d = dayOf(now);
    if (d !== this.day) {
      this.day = d;
      this.daily = [];
      this.dirty = true;
    }
  }

  snapshot(limit = LEADERBOARD_SIZE, now = Date.now()): { day: string; daily: LbRecord[]; allTime: LbRecord[] } {
    this.rollover(now);
    return { day: this.day, daily: this.daily.slice(0, limit), allTime: this.allTime.slice(0, limit) };
  }

  info(now = Date.now()): LeaderboardInfo {
    this.rollover(now);
    return { epoch: this.epoch, day: this.day, daily: this.daily.length, allTime: this.allTime.length, resetAt: this.resetAt, resetBy: this.resetBy };
  }

  /**
   * Clears the daily and the all-time board now (an admin action) and writes the empty boards at once. The
   * file as it was is copied next to it first (`<file>.reset-<ts>.bak`). Profiles are not touched.
   * Returns how many records each board held and the backup's path (null in memory or when there was no file).
   */
  reset(by: string, now = Date.now()): { daily: number; allTime: number; backup: string | null } {
    this.rollover(now);
    const cleared = { daily: this.daily.length, allTime: this.allTime.length };
    // the in-memory boards may be newer than the file (flushed every 30 s): write them first so the backup has them
    this.flush();
    const backup = this.backup('reset', now);
    this.daily = [];
    this.allTime = [];
    this.resetAt = now;
    this.resetBy = by;
    this.dirty = true;
    this.flush();
    return { ...cleared, backup };
  }

  private backup(tag: string, now: number): string | null {
    if (!this.path || !existsSync(this.path)) return null;
    const to = `${this.path}.${tag}-${now}.bak`;
    try {
      copyFileSync(this.path, to);
      return to;
    } catch {
      return null;
    }
  }

  /** Persists if anything changed (call periodically). */
  flush(): void {
    if (!this.dirty || !this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    const data: LbFile = {
      epoch: this.epoch,
      day: this.day,
      daily: this.daily,
      allTime: this.allTime,
      ...(this.resetAt !== null ? { resetAt: this.resetAt } : {}),
      ...(this.resetBy !== null ? { resetBy: this.resetBy } : {}),
    };
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}

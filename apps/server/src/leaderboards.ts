import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEADERBOARD_SIZE } from '@slana/shared';

export interface LbRecord {
  name: string;
  score: number;
  skin: number;
  wallet: string | null;
  kills: number;
  at: number;
}

interface LbFile {
  day: string;
  daily: LbRecord[];
  allTime: LbRecord[];
}

const KEEP = 50;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Wallet players are unique by wallet, guests by name. */
const identity = (r: LbRecord) => (r.wallet ? `w:${r.wallet}` : `n:${r.name.toLowerCase()}`);

/** Off-chain daily / all-time best scores of human players (bots excluded). */
export class Leaderboards {
  private day: string;
  private daily: LbRecord[] = [];
  private allTime: LbRecord[] = [];
  private dirty = false;

  constructor(private readonly path: string | null, now = Date.now()) {
    this.day = dayOf(now);
    if (path && existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as LbFile;
        this.allTime = Array.isArray(data.allTime) ? data.allTime : [];
        this.daily = data.day === this.day && Array.isArray(data.daily) ? data.daily : [];
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

  /** Persists if anything changed (call periodically). */
  flush(): void {
    if (!this.dirty || !this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ day: this.day, daily: this.daily, allTime: this.allTime } satisfies LbFile));
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}

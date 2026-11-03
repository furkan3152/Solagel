import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEADERBOARD_SIZE, isCountryCode, type CountryBoardRow } from '@elymum/shared';

export interface LbRecord {
  name: string;
  score: number;
  skin: number;
  wallet: string | null;
  kills: number;
  at: number;
  /** The country the player played for (ISO 3166-1 alpha-2); absent: none. */
  country?: string;
}

/** What one finished game adds to its country's row (`Leaderboards.countryGame`). */
export interface CountryGame {
  country: string | null | undefined;
  /** The game's best mass. */
  mass: number;
  /** Arena payout (raw token units) of a game that ended alive; 0 otherwise. */
  paid: number;
  at: number;
}

/** Most country rows a snapshot carries (there are 249 codes; the board shows the leaders). */
export const COUNTRY_ROWS = 50;

interface LbFile {
  /** The leaderboard epoch the records belong to (absent in files written before epochs existed: 1). */
  epoch?: number;
  day: string;
  daily: LbRecord[];
  allTime: LbRecord[];
  /** The countries board: per-country totals of today (same `day`) and of all time. */
  countriesDaily?: CountryBoardRow[];
  countriesAllTime?: CountryBoardRow[];
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
  private countriesDaily = new Map<string, CountryBoardRow>();
  private countriesAllTime = new Map<string, CountryBoardRow>();
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
        this.countriesAllTime = countryMap(data.countriesAllTime);
        this.countriesDaily = data.day === this.day ? countryMap(data.countriesDaily) : new Map();
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

  /**
   * One finished game of a human counts for its country (no country: nothing). Bots never get here,
   * and custom rooms keep their own rules (the caller skips them like `submit`).
   */
  countryGame(g: CountryGame): void {
    if (!isCountryCode(g.country)) return;
    const mass = nat(g.mass);
    const paid = nat(g.paid);
    if (mass <= 0 && paid <= 0) return;
    this.rollover(g.at);
    for (const board of [this.countriesDaily, this.countriesAllTime]) {
      let row = board.get(g.country);
      if (!row) {
        row = { country: g.country, mass: 0, games: 0, paid: 0 };
        board.set(g.country, row);
      }
      row.mass += mass;
      row.games += 1;
      row.paid += paid;
    }
    this.dirty = true;
  }

  private rollover(now: number): void {
    const d = dayOf(now);
    if (d !== this.day) {
      this.day = d;
      this.daily = [];
      this.countriesDaily = new Map();
      this.dirty = true;
    }
  }

  snapshot(
    limit = LEADERBOARD_SIZE,
    now = Date.now(),
  ): { day: string; daily: LbRecord[]; allTime: LbRecord[]; countries: { daily: CountryBoardRow[]; allTime: CountryBoardRow[] } } {
    this.rollover(now);
    return {
      day: this.day,
      daily: this.daily.slice(0, limit),
      allTime: this.allTime.slice(0, limit),
      countries: { daily: rankCountries(this.countriesDaily), allTime: rankCountries(this.countriesAllTime) },
    };
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
    this.countriesDaily = new Map();
    this.countriesAllTime = new Map();
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
      countriesDaily: [...this.countriesDaily.values()],
      countriesAllTime: [...this.countriesAllTime.values()],
      ...(this.resetAt !== null ? { resetAt: this.resetAt } : {}),
      ...(this.resetBy !== null ? { resetBy: this.resetBy } : {}),
    };
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}

function nat(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0;
}

/** Rows read back from the file: allowlisted codes only, one row each, whole non-negative numbers. */
function countryMap(rows: unknown): Map<string, CountryBoardRow> {
  const m = new Map<string, CountryBoardRow>();
  if (!Array.isArray(rows)) return m;
  for (const r of rows as Partial<CountryBoardRow>[]) {
    if (!r || !isCountryCode(r.country) || m.has(r.country)) continue;
    m.set(r.country, { country: r.country, mass: nat(r.mass), games: nat(r.games), paid: nat(r.paid) });
  }
  return m;
}

/** Best first: by total mass, then games, then code (stable for ties). */
function rankCountries(board: ReadonlyMap<string, CountryBoardRow>): CountryBoardRow[] {
  return [...board.values()]
    .sort((a, b) => b.mass - a.mass || b.games - a.games || (a.country < b.country ? -1 : 1))
    .slice(0, COUNTRY_ROWS)
    .map((r) => ({ ...r }));
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  EMBLEM_SKIN_ID,
  MAX_NAME_LENGTH,
  isAvatarId,
  isCountryCode,
  isBasicSkin,
  levelFromXp,
  sanitizeName,
  utf8Length,
  type ProfileStats,
  type ProfileSummary,
  type AdminAvatarEntry,
  type ProfileView,
} from '@elymum/shared';
import { getAddress } from 'viem';

/** Profile names: 1 to 16 characters and at most 32 UTF-8 bytes after `sanitizeName`. */
export const PROFILE_NAME_MAX_BYTES = 32;

/** A player's profile as stored in `DATA_DIR/profiles.json`. */
export interface ProfileRecord {
  /** EIP-55 checksummed. */
  wallet: string;
  name: string | null;
  skin: number;
  games: number;
  kills: number;
  best: number;
  xp: number;
  /** Unix ms of the last name / skin change; null when never saved. */
  updatedAt: number | null;
  /** The profile picture (`isAvatarId`, a file of the `AvatarStore`); null without one. */
  avatar?: string | null;
  /** Unix ms of the picture upload. */
  avatarAt?: number | null;
  /** The country the player plays for (ISO 3166-1 alpha-2); null: none picked; absent: never saved. */
  country?: string | null;
  /** Wear the country's flag as the coin skin (`join.flag`); absent: never saved (off). */
  flagSkin?: boolean;
}

interface ProfilesFile {
  version: 1;
  profiles: ProfileRecord[];
}

const FLUSH_MS = 10_000;

/** Why a profile update is refused. */
export class ProfileError extends Error {
  constructor(
    readonly field: 'name' | 'skin' | 'country' | 'flagSkin',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Player profiles: the name and skin a signed-in wallet picked (`PUT /api/profile`) and the stats the
 * server recorded from its own games (games, kills, best score, XP).
 * Kept in memory, written to `DATA_DIR/profiles.json` (write-to-temp + rename) on change after a short
 * delay and on `flush()`. `path` null: memory only (tests).
 */
export class ProfileStore {
  private readonly byWallet = new Map<string, ProfileRecord>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path: string | null,
    private readonly log: (m: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as ProfilesFile;
      if (!data || data.version !== 1 || !Array.isArray(data.profiles)) throw new Error('bad shape');
      for (const p of data.profiles) {
        if (typeof p?.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(p.wallet)) continue;
        const wallet = getAddress(p.wallet);
        this.byWallet.set(wallet.toLowerCase(), {
          wallet,
          name: typeof p.name === 'string' && p.name ? p.name : null,
          skin: isBasicSkin(p.skin) || p.skin === EMBLEM_SKIN_ID ? p.skin : 0,
          games: nat(p.games),
          kills: nat(p.kills),
          best: nat(p.best),
          xp: nat(p.xp),
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : null,
          avatar: isAvatarId(p.avatar) ? p.avatar : null,
          avatarAt: isAvatarId(p.avatar) && typeof p.avatarAt === 'number' ? p.avatarAt : null,
          ...(p.country === null || isCountryCode(p.country) ? { country: p.country } : {}),
          ...(typeof p.flagSkin === 'boolean' ? { flagSkin: p.flagSkin } : {}),
        });
      }
    } catch (err) {
      const backup = `${this.path}.corrupt-${Date.now()}`;
      this.log(`profiles: ${this.path} is unreadable (${(err as Error).message}); moved to ${backup}`);
      try {
        renameSync(this.path, backup);
      } catch {
        /* ignore */
      }
    }
  }

  get size(): number {
    return this.byWallet.size;
  }

  /** The stored profile of a wallet (any case), or null. */
  get(wallet: string): ProfileRecord | null {
    const p = this.byWallet.get(wallet.toLowerCase());
    return p ? { ...p } : null;
  }

  /** `GET /api/profile`: the stored profile, or an empty one. */
  view(wallet: string): ProfileView {
    const p = this.get(wallet);
    const stats: ProfileStats = { games: p?.games ?? 0, kills: p?.kills ?? 0, best: p?.best ?? 0 };
    return { wallet: getAddress(wallet), name: p?.name ?? null, skin: p?.skin ?? 0, stats, updatedAt: p?.updatedAt ?? null, avatar: p?.avatar ?? null, ...(p && p.country !== undefined ? { country: p.country } : {}), ...(p && p.flagSkin !== undefined ? { flagSkin: p.flagSkin } : {}) };
  }

  /** Whether the wallet chose to wear its country's flag as the coin skin (false: off, never saved, unknown wallet). */
  flagSkin(wallet: string | null | undefined): boolean {
    return (!!wallet && this.byWallet.get(wallet.toLowerCase())?.flagSkin) === true;
  }

  /** The wallet's saved country (ISO 3166-1 alpha-2), or null (none picked, never saved, unknown wallet). */
  country(wallet: string | null | undefined): string | null {
    return (wallet && this.byWallet.get(wallet.toLowerCase())?.country) || null;
  }

  /** The wallet's profile picture id, or null. */
  avatar(wallet: string | null | undefined): string | null {
    return (wallet && this.byWallet.get(wallet.toLowerCase())?.avatar) || null;
  }

  /** Sets (or with null clears) the wallet's picture. Returns the id it replaced (null when none). */
  setAvatar(wallet: string, id: string | null): string | null {
    if (id !== null && !isAvatarId(id)) throw new Error('bad avatar id');
    const p = this.record(wallet);
    const before = p.avatar ?? null;
    p.avatar = id;
    p.avatarAt = id ? this.now() : null;
    this.touch();
    return before;
  }

  /** How many profiles wear the picture (a file is deleted only when nobody does). */
  avatarUsers(id: string): number {
    let n = 0;
    for (const p of this.byWallet.values()) if (p.avatar === id) n++;
    return n;
  }

  /** Every profile picture, newest first (`GET /api/admin/avatars`). */
  avatars(limit = 200): { items: AdminAvatarEntry[]; total: number } {
    const all: AdminAvatarEntry[] = [];
    for (const p of this.byWallet.values()) if (p.avatar) all.push({ wallet: p.wallet, name: p.name, avatar: p.avatar, at: p.avatarAt ?? null });
    all.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return { items: all.slice(0, Math.max(1, Math.min(1000, limit))), total: all.length };
  }

  /** What the game shows after a sign-in (`authed.profile`): null until the player picked a name. */
  summary(wallet: string): ProfileSummary | null {
    const p = this.get(wallet);
    if (!p?.name) return null;
    return { name: p.name, skin: p.skin, xp: p.xp, level: levelFromXp(p.xp), premiumSkins: 0 };
  }

  /** Level from the recorded XP (0 for unknown wallets). */
  level(wallet: string | null): number {
    if (!wallet) return 0;
    return levelFromXp(this.byWallet.get(wallet.toLowerCase())?.xp ?? 0);
  }

  /**
   * `PUT /api/profile`: validates and stores the name and skin. `emblem`: the wallet holds an Elymum
   * emblem (the caller checked on chain), so `EMBLEM_SKIN_ID` may be picked too.
   */
  update(wallet: string, body: { name?: unknown; skin?: unknown; country?: unknown; flagSkin?: unknown }, opts: { emblem?: boolean } = {}): ProfileView {
    if (typeof body.name !== 'string') throw new ProfileError('name', 'name is required');
    if ([...body.name.replace(/\s+/g, ' ').trim()].length > MAX_NAME_LENGTH) throw new ProfileError('name', `name is longer than ${MAX_NAME_LENGTH} characters`);
    const name = sanitizeName(body.name, '');
    if (name.length === 0) throw new ProfileError('name', 'name is required');
    if ([...name].length > MAX_NAME_LENGTH || utf8Length(name) > PROFILE_NAME_MAX_BYTES) throw new ProfileError('name', `name is longer than ${MAX_NAME_LENGTH} characters`);
    if (body.skin === EMBLEM_SKIN_ID) {
      if (!opts.emblem) throw new ProfileError('skin', 'the emblem skin is for Elymum emblem holders');
    } else if (typeof body.skin !== 'number' || !isBasicSkin(body.skin)) throw new ProfileError('skin', 'that skin cannot be picked');
    // the country: an allowlisted ISO 3166-1 alpha-2 code exactly, or null for no flag; absent keeps the saved one
    if (body.country !== undefined && body.country !== null && !isCountryCode(body.country)) throw new ProfileError('country', 'that country cannot be picked');
    // the flag skin: true or false exactly; absent keeps the saved choice
    if (body.flagSkin !== undefined && typeof body.flagSkin !== 'boolean') throw new ProfileError('flagSkin', 'flagSkin must be true or false');
    const p = this.record(wallet);
    p.name = name;
    p.skin = body.skin;
    if (body.country !== undefined) p.country = body.country as string | null;
    if (body.flagSkin !== undefined) p.flagSkin = body.flagSkin as boolean;
    p.updatedAt = this.now();
    this.touch();
    return this.view(wallet);
  }

  /** Records one finished game of a signed-in wallet (the server's own records). Returns the new XP total. */
  recordGame(wallet: string, g: { score: number; kills: number; xp: number }): number {
    const p = this.record(wallet);
    p.games += 1;
    p.kills += nat(g.kills);
    p.best = Math.max(p.best, nat(g.score));
    p.xp += nat(g.xp);
    this.touch();
    return p.xp;
  }

  private record(wallet: string): ProfileRecord {
    const key = wallet.toLowerCase();
    let p = this.byWallet.get(key);
    if (!p) {
      p = { wallet: getAddress(wallet), name: null, skin: 0, games: 0, kills: 0, best: 0, xp: 0, updatedAt: null };
      this.byWallet.set(key, p);
    }
    return p;
  }

  private touch(): void {
    this.dirty = true;
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
    this.timer.unref();
  }

  /** Writes the file now (when anything changed). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.path || !this.dirty) return;
    const data: ProfilesFile = { version: 1, profiles: [...this.byWallet.values()] };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
    this.dirty = false;
  }
}

function nat(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0;
}

/* ------------------------------------------------------------------ */
/* Profile pictures ("Your picture" on the coin)                       */
/* ------------------------------------------------------------------ */

/**
 * Limits of an uploaded profile picture (`POST /api/profile/avatar`). The web client crops and
 * resizes to a `px` square (WebP, PNG where the browser cannot encode WebP); the server takes only
 * PNG or WebP squares of `minPx..maxPx` and at most `maxBytes`.
 */
export const AVATAR_LIMITS = {
  /** Side of the square the web client uploads. */
  px: 128,
  minPx: 32,
  maxPx: 256,
  /** Hard upload limit (bytes). */
  maxBytes: 64 * 1024,
} as const;

/** Content types the server accepts and serves. */
export const AVATAR_TYPES = ['image/webp', 'image/png'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

/** Bytes of an avatar id on the wire (`PlayerFlag.Avatar`). */
export const AVATAR_ID_BYTES = 8;

/** An avatar id: the first 16 hex digits of the SHA-256 of the stored file (lower case). */
export function isAvatarId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

/** Where an avatar is served (same origin through `/api`, also on the static host's proxy). */
export function avatarPath(id: string): string {
  return `/api/avatar/${id}`;
}

const HEX = '0123456789abcdef';

/** The 8 id bytes at `at` as the 16-digit hex id. */
export function avatarIdFromBytes(bytes: Uint8Array, at: number): string {
  let s = '';
  for (let i = 0; i < AVATAR_ID_BYTES; i++) {
    const b = bytes[at + i];
    s += HEX[b >> 4] + HEX[b & 15];
  }
  return s;
}

/** Whether the 8 id bytes at `at` spell `id` (no string built: a client compares before decoding). */
export function avatarIdEquals(id: string | undefined, bytes: Uint8Array, at: number): boolean {
  if (!id || id.length !== AVATAR_ID_BYTES * 2) return false;
  for (let i = 0; i < AVATAR_ID_BYTES; i++) {
    const b = bytes[at + i];
    if (id.charCodeAt(i * 2) !== HEX.charCodeAt(b >> 4) || id.charCodeAt(i * 2 + 1) !== HEX.charCodeAt(b & 15)) return false;
  }
  return true;
}

/** Writes a 16-digit hex id as 8 bytes at `at` (`isAvatarId` must hold). */
export function avatarIdToBytes(id: string, out: Uint8Array, at: number): void {
  for (let i = 0; i < AVATAR_ID_BYTES; i++) out[at + i] = parseInt(id.slice(i * 2, i * 2 + 2), 16);
}

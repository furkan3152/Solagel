/**
 * The stored site session, readable without the wallet code (no viem): the `/play` gate checks it
 * before anything heavy loads. `session.ts` signs in and writes it.
 */

export interface SiteSession {
  /** The signed-in wallet, EIP-55 checksummed. */
  address: string;
  token: string;
  admin: boolean;
}

export const TOKEN_KEY = 'elymum.auth.v1';
export const ADMIN_KEY = 'elymum.site.admin.v1';
/** Tokens last 24 h on the server; reuse one only while it has a margin left. */
export const TTL_MS = 23 * 3600_000;

export interface Stored {
  address: string;
  token: string;
  exp: number;
}

export const same = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function readStoredSession(): SiteSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Stored;
    if (typeof data?.token !== 'string' || typeof data.address !== 'string' || !(data.exp > Date.now() + 60_000)) return null;
    return { address: data.address, token: data.token, admin: same(localStorage.getItem(ADMIN_KEY), data.address) };
  } catch {
    return null;
  }
}

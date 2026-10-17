import bs58 from 'bs58';
import { create } from 'zustand';
import { SERVER } from '../config';
import { allowedDomains, expectedLoginMessage, type NonceResponse } from '../solana/siwsCore';
import { SiteApiError, auth } from './api';

/**
 * The site's wallet session: a SIWS sign-in over HTTP (`POST /api/auth/login`), free and with no
 * transaction. The token is the game server's 24 h session token; it is kept under the same key the
 * game engine reads (`slana.auth.v1`), so an admin who signs in on `/admin` plays on `/play` without
 * signing again.
 */
export interface SiteSession {
  pubkey: string;
  token: string;
  admin: boolean;
}

/** What a sign-in needs from a wallet (the wallet adapter's context satisfies it). */
export interface MessageSigner {
  publicKey: { toBase58(): string } | null;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}

export const TOKEN_KEY = 'slana.auth.v1';
const ADMIN_KEY = 'slana.site.admin.v1';
/** Tokens last 24 h on the server; reuse one only while it has a margin left. */
const TTL_MS = 23 * 3600_000;

interface Stored {
  pubkey: string;
  token: string;
  exp: number;
}

export function readStoredSession(): SiteSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Stored;
    if (typeof data?.token !== 'string' || typeof data.pubkey !== 'string' || !(data.exp > Date.now() + 60_000)) return null;
    return { pubkey: data.pubkey, token: data.token, admin: localStorage.getItem(ADMIN_KEY) === data.pubkey };
  } catch {
    return null;
  }
}

function store(s: SiteSession | null): void {
  try {
    if (!s) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ADMIN_KEY);
      return;
    }
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ pubkey: s.pubkey, token: s.token, exp: Date.now() + TTL_MS } satisfies Stored));
    if (s.admin) localStorage.setItem(ADMIN_KEY, s.pubkey);
    else localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* storage unavailable: the session lasts for this page only */
  }
}

interface SessionState {
  session: SiteSession | null;
  signing: boolean;
  error: string | null;
}

export const useSession = create<SessionState>(() => ({ session: readStoredSession(), signing: false, error: null }));

/** The session for `pubkey` (null when none, or when it belongs to another wallet). */
export function sessionFor(pubkey: string | null | undefined): SiteSession | null {
  const s = useSession.getState().session;
  return s && pubkey && s.pubkey === pubkey ? s : null;
}

export function signOut(): void {
  store(null);
  useSession.setState({ session: null, error: null });
}

/** A rejected wallet prompt reads as a cancel, not an error. */
export const isUserCancel = (err: unknown): boolean => /reject|cancel|denied|declined|closed/i.test((err as Error)?.message ?? String(err));

/**
 * Signs in with `wallet`: reuses a stored session for the same wallet, else fetches a nonce,
 * rebuilds and checks the SIWS message (it must name this site), asks the wallet to sign it and
 * trades the signature for a session token.
 */
export async function signIn(wallet: MessageSigner, opts: { force?: boolean } = {}): Promise<SiteSession> {
  const pubkey = wallet.publicKey?.toBase58();
  if (!pubkey) throw new Error('Connect a wallet first.');
  const existing = opts.force ? null : sessionFor(pubkey) ?? (readStoredSession()?.pubkey === pubkey ? readStoredSession() : null);
  if (existing) {
    useSession.setState({ session: existing, error: null });
    return existing;
  }
  if (!wallet.signMessage) throw new Error('This wallet cannot sign messages. Try Phantom, Solflare or Backpack.');
  useSession.setState({ signing: true, error: null });
  try {
    let nonce: NonceResponse;
    try {
      const res = await fetch(`${SERVER.http}/api/auth/nonce?pubkey=${encodeURIComponent(pubkey)}`);
      if (!res.ok) throw new SiteApiError(res.status, res.status === 429 ? 'rate_limited' : 'bad_request', res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Sign-in is unavailable right now.');
      nonce = (await res.json()) as NonceResponse;
    } catch (err) {
      if (err instanceof SiteApiError) throw err;
      throw new SiteApiError(0, 'network', 'Cannot reach slana.io right now. Check your connection and try again.');
    }
    const message = expectedLoginMessage(nonce, pubkey, allowedDomains());
    if (!message) throw new Error('The sign-in message did not match this site, so it was not signed.');
    const signature = await wallet.signMessage(new TextEncoder().encode(message));
    const res = await auth.login(pubkey, message, bs58.encode(signature));
    const session: SiteSession = { pubkey: res.pubkey, token: res.token, admin: res.admin };
    store(session);
    useSession.setState({ session, signing: false, error: null });
    return session;
  } catch (err) {
    const msg = isUserCancel(err) ? 'Signing was cancelled.' : (err as Error)?.message || 'Sign-in failed.';
    useSession.setState({ signing: false, error: msg });
    throw err;
  } finally {
    if (useSession.getState().signing) useSession.setState({ signing: false });
  }
}

/** Checks a stored session with the server (`/api/auth/me`); clears it when the server says it expired. */
export async function verifySession(s: SiteSession): Promise<SiteSession | null> {
  try {
    const me = await auth.me(s.token);
    const next = { ...s, admin: me.admin };
    store(next);
    useSession.setState({ session: next });
    return next;
  } catch (err) {
    if (err instanceof SiteApiError && err.status === 401) {
      signOut();
      return null;
    }
    return s;
  }
}

/** Called after a 401 from any site call: the token is gone, the user signs in again. */
export function dropExpired(err: unknown): boolean {
  if (err instanceof SiteApiError && err.code === 'unauthorized') {
    signOut();
    return true;
  }
  return false;
}

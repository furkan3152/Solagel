import { getAddress } from 'viem';
import { create } from 'zustand';
import { describeError } from '@elymum/sdk';
import { allowedDomains, expectedLoginMessage, fetchNonce, type MessageSigner, type NonceResponse } from '../wallet/siwe';
import { SiteApiError, auth } from './api';

/**
 * The site's wallet session: a SIWE (EIP-4361) sign-in over HTTP (`POST /api/auth/login`), free
 * and with no transaction. The token is the game server's 24 h session token; it is kept under
 * the same key the game engine reads (`elymum.auth.v1`), so an admin who signs in on `/admin`
 * plays on `/play` without signing again.
 */
export type { SiteSession } from './storedSession';
import type { SiteSession } from './storedSession';

export type { MessageSigner } from '../wallet/siwe';

import { ADMIN_KEY, TOKEN_KEY, TTL_MS, readStoredSession, same, type Stored } from './storedSession';

export { TOKEN_KEY, readStoredSession } from './storedSession';

function store(s: SiteSession | null): void {
  try {
    if (!s) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ADMIN_KEY);
      return;
    }
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ address: s.address, token: s.token, exp: Date.now() + TTL_MS } satisfies Stored));
    if (s.admin) localStorage.setItem(ADMIN_KEY, s.address);
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

/** The session for `address` (null when none, or when it belongs to another wallet). */
export function sessionFor(address: string | null | undefined): SiteSession | null {
  const s = useSession.getState().session;
  return s && same(s.address, address) ? s : null;
}

export function signOut(): void {
  store(null);
  useSession.setState({ session: null, error: null });
}

/** A rejected wallet prompt reads as a cancel, not an error. */
export const isUserCancel = (err: unknown): boolean =>
  describeError(err).kind === 'rejected' || /reject|cancel|denied|declined|closed/i.test((err as Error)?.message ?? String(err));

/**
 * Signs in with `wallet`: reuses a stored session for the same wallet, else fetches a nonce,
 * rebuilds and checks the SIWE message (it must name this site and this wallet), asks the wallet
 * to `personal_sign` it and trades the signature for a session token. `chainId`: the server's
 * chain, when the page knows it (the message must name it).
 */
export async function signIn(wallet: MessageSigner, opts: { force?: boolean; chainId?: number | null } = {}): Promise<SiteSession> {
  if (!wallet.address) throw new Error('Connect a wallet first.');
  const address = getAddress(wallet.address);
  const stored = readStoredSession();
  const existing = opts.force ? null : (sessionFor(address) ?? (stored && same(stored.address, address) ? stored : null));
  if (existing) {
    useSession.setState({ session: existing, error: null });
    return existing;
  }
  useSession.setState({ signing: true, error: null });
  try {
    let nonce: NonceResponse;
    try {
      nonce = await fetchNonce(address);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status) {
        throw new SiteApiError(status, status === 429 ? 'rate_limited' : 'bad_request', status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Sign-in is unavailable right now.');
      }
      throw new SiteApiError(0, 'network', 'Cannot reach the server right now. Check your connection and try again.');
    }
    const message = expectedLoginMessage(nonce, address, allowedDomains(), { chainId: opts.chainId ?? null });
    if (!message) throw new Error('The sign-in message did not match this site, so it was not signed.');
    const signature = await wallet.signMessage(message);
    const res = await auth.login(address, message, signature);
    const session: SiteSession = { address: res.address, token: res.token, admin: res.admin };
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

/** Called after a 401 from any site call: the token is gone, the user signs in again. */
export function dropExpired(err: unknown): boolean {
  if (err instanceof SiteApiError && err.code === 'unauthorized') {
    signOut();
    return true;
  }
  return false;
}

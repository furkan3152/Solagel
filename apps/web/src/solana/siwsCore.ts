import { siwsMessage } from '@slana/shared';
import { SERVER } from '../config';

/*
 * The SIWS checks shared by the game (WebSocket sign-in) and the site (`POST /api/auth/login`).
 * Kept free of the game engine so the site pages can sign in without loading it.
 */

export interface NonceResponse {
  message: string;
  nonce: string;
  domain: string;
  uri: string;
  chainId: string;
  issuedAt: string;
}

/** Hosts a sign-in message may name: this page and the game server it talks to. */
export function allowedDomains(): string[] {
  const out = new Set<string>();
  try {
    if (typeof window !== 'undefined') out.add(window.location.host);
  } catch {
    /* ignore */
  }
  try {
    out.add(new URL(SERVER.http, typeof window !== 'undefined' ? window.location.href : 'http://localhost').host);
  } catch {
    /* ignore */
  }
  return [...out];
}

/**
 * The message to sign: rebuilt from the server's fields (SIWS: domain, URI, chain id, nonce,
 * issued-at) for this wallet. Null when the server's text differs from what the fields say,
 * when it names another wallet, or a domain this page does not talk to.
 */
export function expectedLoginMessage(body: Partial<NonceResponse>, pubkey: string, domains: readonly string[]): string | null {
  const { message, nonce, domain, uri, chainId, issuedAt } = body;
  if (![message, nonce, domain, uri, chainId, issuedAt].every((v) => typeof v === 'string' && v.length > 0)) return null;
  if (!domains.includes(domain!)) return null;
  try {
    if (new URL(uri!).host !== domain) return null;
  } catch {
    return null;
  }
  const rebuilt = siwsMessage({ domain: domain!, address: pubkey, uri: uri!, chainId: chainId!, nonce: nonce!, issuedAt: issuedAt! });
  return rebuilt === message ? rebuilt : null;
}

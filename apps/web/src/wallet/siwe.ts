import { parseSiweMessage, siweMessage } from '@elymum/shared';
import { getAddress, isAddress, stringToHex, type Address, type Hex } from 'viem';
import { SERVER } from '../config';
import type { Eip1193Provider } from './eip6963';

/*
 * Sign-In with Ethereum (EIP-4361) checks shared by the game (WebSocket sign-in) and the site
 * (`POST /api/auth/login`). Kept free of the game engine so the site pages can sign in without
 * loading it. The wallet only ever signs a message this page rebuilt itself from the server's
 * fields: the domain must be this page or the game server it talks to, the address must be the
 * connected wallet, and the chain id must be the server's.
 */

/** `GET /api/auth/nonce?address=0x…`. */
export interface NonceResponse {
  message: string;
  nonce: string;
  domain: string;
  uri: string;
  /** The server's chain id (a number; a decimal string is accepted too). */
  chainId: number | string;
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
 * The message to sign: rebuilt from the server's fields for this wallet. Null when the server's
 * text differs from what its fields say, names another wallet, a domain this page does not talk
 * to, a URI on another host, or (when `chainId` is given) another chain.
 */
export function expectedLoginMessage(
  body: Partial<NonceResponse> | null | undefined,
  address: string,
  domains: readonly string[],
  opts: { chainId?: number | null } = {},
): string | null {
  if (!body) return null;
  const { message, nonce, domain, uri, issuedAt } = body;
  if (![message, nonce, domain, uri, issuedAt].every((v) => typeof v === 'string' && v.length > 0)) return null;
  const chainId = typeof body.chainId === 'number' ? body.chainId : typeof body.chainId === 'string' && /^\d+$/.test(body.chainId) ? Number(body.chainId) : NaN;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return null;
  if (opts.chainId != null && chainId !== opts.chainId) return null;
  if (!domains.includes(domain!)) return null;
  try {
    if (new URL(uri!).host !== domain) return null;
  } catch {
    return null;
  }
  if (!isAddress(address, { strict: false })) return null;
  const me = getAddress(address);
  const parsed = parseSiweMessage(message);
  if (!parsed || parsed.address !== me) return null;
  if (parsed.domain !== domain || parsed.uri !== uri || parsed.chainId !== chainId || parsed.nonce !== nonce || parsed.issuedAt !== issuedAt) return null;
  let rebuilt: string;
  try {
    rebuilt = siweMessage({ domain: domain!, address: me, uri: uri!, chainId, nonce: nonce!, issuedAt: issuedAt! });
  } catch {
    return null;
  }
  return rebuilt === message ? rebuilt : null;
}

/** Fetches a sign-in nonce for `address`. Throws on HTTP errors (`status` set) or a network failure. */
export async function fetchNonce(address: Address): Promise<NonceResponse> {
  const res = await fetch(`${SERVER.http}/api/auth/nonce?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw Object.assign(new Error(`nonce request failed (${res.status})`), { status: res.status });
  return (await res.json()) as NonceResponse;
}

/** `personal_sign` of a UTF-8 message (EIP-191). Returns the 0x signature. */
export async function personalSign(provider: Eip1193Provider, address: Address, message: string): Promise<Hex> {
  const sig = await provider.request({ method: 'personal_sign', params: [stringToHex(message), address] });
  if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error('The wallet returned no signature.');
  return sig as Hex;
}

/** What a sign-in needs: the account and a way to `personal_sign` a text. */
export interface MessageSigner {
  address: Address | null;
  signMessage: (message: string) => Promise<Hex>;
}

/** A `MessageSigner` over an EIP-1193 provider. */
export const providerSigner = (provider: Eip1193Provider, address: Address): MessageSigner => ({
  address,
  signMessage: (message) => personalSign(provider, address, message),
});

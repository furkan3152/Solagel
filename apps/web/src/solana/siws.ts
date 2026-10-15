import type { WalletContextState } from '@solana/wallet-adapter-react';
import { siwsMessage } from '@slana/shared';
import bs58 from 'bs58';
import { SERVER } from '../config';
import { GameEngine } from '../game/engine';
import { engine } from '../game/instance';
import { t } from '../i18n';
import { toast, useUi } from '../store';

/**
 * Proves wallet ownership to the game server: reuse a cached token when we
 * have one, otherwise sign a one-time login message (free, no transaction).
 */
export async function signInWithWallet(wallet: WalletContextState, force = false): Promise<boolean> {
  const pubkey = wallet.publicKey?.toBase58();
  if (!pubkey) return false;
  const cached = force ? null : GameEngine.storedToken(pubkey);
  if (cached) {
    engine()?.authToken(cached);
    return true;
  }
  if (!wallet.signMessage) {
    toast('error', 'This wallet cannot sign messages.');
    return false;
  }
  try {
    const res = await fetch(`${SERVER.http}/api/auth/nonce?pubkey=${pubkey}`);
    if (!res.ok) throw new Error(`nonce request failed (${res.status})`);
    const body = (await res.json()) as NonceResponse;
    // M1: rebuild the SIWS message ourselves and sign only that, for a domain we talk to
    const message = expectedLoginMessage(body, pubkey, allowedDomains());
    if (!message) throw new Error('unexpected sign-in message from the server');
    const sig = await wallet.signMessage(new TextEncoder().encode(message));
    engine()?.authSignature(pubkey, message, bs58.encode(sig));
    return true;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    toast(/reject|cancel|denied/i.test(msg) ? 'warn' : 'error', `${t('err.auth_failed')} ${/reject|cancel|denied/i.test(msg) ? '' : msg}`);
    return false;
  }
}

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

/** True when the server session belongs to the connected wallet. */
export const isVerified = (pubkey: string | undefined | null): boolean => !!pubkey && useUi.getState().auth?.pubkey === pubkey;

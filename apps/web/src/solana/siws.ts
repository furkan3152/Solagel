import type { WalletContextState } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { SERVER } from '../config';
import { allowedDomains, expectedLoginMessage, type NonceResponse } from './siwsCore';
import { GameEngine } from '../game/engine';
import { engine } from '../game/instance';
import { t } from '../i18n';
import { toast } from '../store';

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

export { allowedDomains, expectedLoginMessage, type NonceResponse } from './siwsCore';

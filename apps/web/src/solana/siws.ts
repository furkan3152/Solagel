import type { WalletContextState } from '@solana/wallet-adapter-react';
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
    const { message } = (await res.json()) as { message: string };
    const sig = await wallet.signMessage(new TextEncoder().encode(message));
    engine()?.authSignature(pubkey, message, bs58.encode(sig));
    return true;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    toast(/reject|cancel|denied/i.test(msg) ? 'warn' : 'error', `${t('err.auth_failed')} ${/reject|cancel|denied/i.test(msg) ? '' : msg}`);
    return false;
  }
}

/** True when the server session belongs to the connected wallet. */
export const isVerified = (pubkey: string | undefined | null): boolean => !!pubkey && useUi.getState().auth?.pubkey === pubkey;

import { describeError } from '@elymum/sdk';
import { GameEngine } from '../game/engine';
import { engine } from '../game/instance';
import { t } from '../i18n';
import { toast, useUi } from '../store';
import { allowedDomains, expectedLoginMessage, fetchNonce, personalSign } from './siwe';
import { connected } from './store';

/**
 * Proves wallet ownership to the game server (SIWE): reuse a cached token when we have one,
 * otherwise sign a one-time login message (free, no transaction) over the WebSocket.
 */
export async function signInWithWallet(force = false): Promise<boolean> {
  const w = connected();
  if (!w) return false;
  const cached = force ? null : GameEngine.storedToken(w.address);
  if (cached) {
    engine()?.authToken(cached);
    return true;
  }
  try {
    const body = await fetchNonce(w.address);
    // rebuild the SIWE message ourselves and sign only that, for a domain we talk to and the server's chain
    const message = expectedLoginMessage(body, w.address, allowedDomains(), { chainId: useUi.getState().chain?.chainId ?? null });
    if (!message) throw new Error('unexpected sign-in message from the server');
    const signature = await personalSign(w.provider, w.address, message);
    engine()?.authSignature(w.address, message, signature);
    return true;
  } catch (err) {
    const rejected = describeError(err).kind === 'rejected';
    toast(rejected ? 'warn' : 'error', `${t('err.auth_failed')}${rejected ? '' : ` ${(err as Error)?.message ?? String(err)}`}`);
    return false;
  }
}

export { allowedDomains, expectedLoginMessage, type NonceResponse } from './siwe';

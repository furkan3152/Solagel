import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useRef } from 'react';
import { GameEngine } from '../game/engine';
import { engine } from '../game/instance';
import { useUi } from '../store';
import { signInWithWallet } from './siws';

let userInitiated = false;
/** Called when the user explicitly picks a wallet (so we may ask for a signature). */
export const markUserConnect = () => {
  userInitiated = true;
};

/**
 * Links the connected wallet with the game server session:
 * cached token → silent login; fresh user connect → ask for a signature;
 * disconnect / account switch → logout.
 */
export function useWalletAuth(): void {
  const wallet = useWallet();
  const connected = useUi((s) => s.connected);
  const pubkey = wallet.publicKey?.toBase58() ?? null;
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    const auth = useUi.getState().auth;
    if (!pubkey) {
      if (prev.current) engine()?.logout();
      prev.current = null;
      return;
    }
    if (prev.current && prev.current !== pubkey) engine()?.logout();
    prev.current = pubkey;
    if (auth?.pubkey === pubkey) return;
    const token = GameEngine.storedToken(pubkey);
    if (token) {
      engine()?.authToken(token);
    } else if (userInitiated) {
      userInitiated = false;
      void signInWithWallet(wallet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, connected]);
}

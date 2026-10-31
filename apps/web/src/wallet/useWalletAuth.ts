import { useEffect, useRef } from 'react';
import { GameEngine } from '../game/engine';
import { engine } from '../game/instance';
import { useUi } from '../store';
import { signInWithWallet } from './signIn';
import { initWallets, takeUserConnect, useAddress } from './store';

/**
 * Links the connected wallet with the game server session:
 * cached token → silent login; fresh user connect → ask for a signature;
 * disconnect / account switch → logout.
 */
export function useWalletAuth(): void {
  const connectedToServer = useUi((s) => s.connected);
  const address = useAddress();
  const prev = useRef<string | null>(null);

  useEffect(() => initWallets(), []);

  useEffect(() => {
    if (!connectedToServer) return;
    const auth = useUi.getState().auth;
    if (!address) {
      if (prev.current) engine()?.logout();
      prev.current = null;
      return;
    }
    if (prev.current && prev.current !== address) engine()?.logout();
    prev.current = address;
    if (auth && auth.address.toLowerCase() === address.toLowerCase()) return;
    const token = GameEngine.storedToken(address);
    if (token) {
      engine()?.authToken(token);
    } else if (takeUserConnect()) {
      void signInWithWallet();
    }
  }, [address, connectedToServer]);
}

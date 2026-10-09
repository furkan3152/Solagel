import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { clusterDefaultRpc } from '@solagel/sdk';
import { useMemo, type ReactNode } from 'react';
import { CHAIN_OVERRIDES } from '../config';
import { useUi } from '../store';

/**
 * Connection + wallet context. The RPC endpoint comes from the game server's
 * advertised chain status (or VITE_RPC_URL), so the client follows whatever
 * cluster the server settles on. Wallets are discovered via Wallet Standard
 * (Phantom, Solflare, Backpack… no per-wallet adapters needed).
 */
export function SolanaProvider({ children }: { children: ReactNode }) {
  const chain = useUi((s) => s.chain);
  const endpoint = useMemo(
    () => CHAIN_OVERRIDES.rpcUrl ?? chain?.rpcUrl ?? clusterDefaultRpc(chain?.cluster ?? 'devnet'),
    [chain?.rpcUrl, chain?.cluster],
  );
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect onError={(e) => console.warn('wallet error', e)}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

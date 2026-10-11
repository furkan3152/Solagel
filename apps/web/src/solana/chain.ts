import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SolagelClient, type ArenaView, type ConfigView, type ProfileView, type SessionView } from '@solagel/sdk';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useUi } from '../store';

interface ChainData {
  deployed: boolean | null;
  config: ConfigView | null;
  profile: ProfileView | null;
  profileLoaded: boolean;
  arenas: ArenaView[];
  sessions: Record<number, SessionView | null>;
  balance: number | null;
  loading: boolean;
  /** Failed RPC reads never mean an absent ticket or profile. */
  error: string | null;
  owner: string | null;
  updatedAt: number | null;
}

const emptyData: ChainData = {
  deployed: null, config: null, profile: null, profileLoaded: false,
  arenas: [], sessions: {}, balance: null, loading: false, error: null,
  owner: null, updatedAt: null,
};

export const useChainData = create<ChainData>(() => ({ ...emptyData }));

/** Client follows the game server's program and the selected RPC. */
export function useSolagelClient(): SolagelClient | null {
  const { connection } = useConnection();
  const chain = useUi((s) => s.chain);
  return useMemo(() => chain?.enabled && chain.programId
    ? new SolagelClient(connection, chain.programId) : null,
  [connection, chain?.enabled, chain?.programId]);
}

let refreshNow: () => void = () => {};
export const refreshChain = () => refreshNow();

/** Single in-flight snapshot per wallet; results from old wallets are discarded. */
export function useChainSync(): void {
  const client = useSolagelClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const owner = publicKey?.toBase58() ?? null;
  const advertised = useUi((s) => s.chain !== null);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let queued = false;
    useChainData.setState({ ...emptyData, owner, profileLoaded: !owner, deployed: !client && advertised ? false : null });
    const refresh = async () => {
      if (!active || !client) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      useChainData.setState({ loading: true });
      try {
        if (!(await client.isDeployed())) {
          if (active) useChainData.setState({ ...emptyData, owner, deployed: false, profileLoaded: true });
          return;
        }
        const [config, arenas, profile, balance] = await Promise.all([
          client.fetchConfig(), client.fetchArenas(),
          owner ? client.fetchProfile(owner) : null,
          publicKey ? connection.getBalance(publicKey) : null,
        ]);
        const list = owner ? await Promise.all(arenas.map((a) => client.fetchSession(a.id, owner))) : [];
        const sessions: Record<number, SessionView | null> = {};
        arenas.forEach((a, i) => { sessions[a.id] = list[i] ?? null; });
        if (active) useChainData.setState({
          deployed: true, config, arenas: arenas.sort((a, b) => a.buyIn - b.buyIn),
          profile, profileLoaded: true, sessions, balance, owner,
          loading: false, error: null, updatedAt: Date.now(),
        });
      } catch (error) {
        console.warn('chain refresh failed', error);
        if (active) useChainData.setState({ loading: false, error: 'Could not refresh Solana data. Retry before buying a ticket.' });
      } finally {
        inFlight = false;
        if (active && queued) { queued = false; void refresh(); }
      }
    };
    const requestRefresh = () => { void refresh(); };
    refreshNow = requestRefresh;
    requestRefresh();
    const interval = window.setInterval(requestRefresh, 20_000);
    return () => {
      active = false;
      clearInterval(interval);
      if (refreshNow === requestRefresh) refreshNow = () => {};
    };
  }, [client, owner, connection, publicKey, advertised]);
}

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SlanaClient, type ArenaView, type ConfigView, type ProfileView, type SessionView } from '@slana/sdk';
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useUi } from '../store';

interface ChainData {
  /** null = unknown yet, false = program not deployed / chain disabled. */
  deployed: boolean | null;
  config: ConfigView | null;
  profile: ProfileView | null;
  profileLoaded: boolean;
  arenas: ArenaView[];
  sessions: Record<number, SessionView | null>;
  balance: number | null;
  loading: boolean;
}

export const useChainData = create<ChainData>(() => ({
  deployed: null,
  config: null,
  profile: null,
  profileLoaded: false,
  arenas: [],
  sessions: {},
  balance: null,
  loading: false,
}));

let clientCache: { key: string; client: SlanaClient } | null = null;

/** SlanaClient bound to the current RPC + program id (from the game server). */
export function useSlanaClient(): SlanaClient | null {
  const { connection } = useConnection();
  const chain = useUi((s) => s.chain);
  return useMemo(() => {
    if (!chain?.enabled || !chain.programId) return null;
    const key = `${connection.rpcEndpoint}|${chain.programId}`;
    if (clientCache?.key !== key) clientCache = { key, client: new SlanaClient(connection, chain.programId) };
    return clientCache.client;
  }, [connection, chain?.enabled, chain?.programId]);
}

let refreshTimer: number | null = null;

/** Keeps config / profile / arenas / my sessions / balance fresh. Mount once (App). */
export function useChainSync(): void {
  const client = useSlanaClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const owner = publicKey?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!client) {
      useChainData.setState({ deployed: useUi.getState().chain ? false : null, config: null, profile: null, arenas: [], sessions: {}, profileLoaded: true });
      return;
    }
    useChainData.setState({ loading: true });
    try {
      const deployed = await client.isDeployed();
      if (!deployed) {
        useChainData.setState({ deployed: false, loading: false, profileLoaded: true });
        return;
      }
      const [config, arenas] = await Promise.all([client.fetchConfig(), client.fetchArenas().catch(() => [] as ArenaView[])]);
      let profile: ProfileView | null = null;
      const sessions: Record<number, SessionView | null> = {};
      let balance: number | null = null;
      if (owner) {
        [profile, balance] = await Promise.all([client.fetchProfile(owner).catch(() => null), connection.getBalance(publicKey!).catch(() => null)]);
        const list = await Promise.all(arenas.map((a) => client.fetchSession(a.id, owner).catch(() => null)));
        arenas.forEach((a, i) => (sessions[a.id] = list[i]));
      }
      useChainData.setState({
        deployed: true,
        config,
        arenas: arenas.sort((a, b) => (a.entryFee < b.entryFee ? -1 : a.entryFee > b.entryFee ? 1 : a.id - b.id)),
        profile,
        profileLoaded: true,
        sessions,
        balance,
        loading: false,
      });
    } catch (err) {
      console.warn('chain refresh failed', err);
      useChainData.setState({ loading: false, profileLoaded: true });
    }
  }, [client, owner, connection, publicKey]);

  useEffect(() => {
    useChainData.setState({ profile: null, profileLoaded: !owner, sessions: {}, balance: null });
    void refresh();
    const id = window.setInterval(() => void refresh(), 20_000);
    refreshNow = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 400);
    };
    return () => clearInterval(id);
  }, [refresh, owner]);
}

let refreshNow: () => void = () => {};
/** Ask for an immediate refresh (after a transaction). */
export const refreshChain = () => refreshNow();

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SlanaClient, ata, fetchTokenBalance, isTokenSet, type ArenaView, type ConfigView, type ProfileView, type SessionView } from '@slana/sdk';
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { SERVER } from '../config';
import { useUi } from '../store';
import { isDevFake, loadDevFake } from './devFakeLoader';
import type { PendingPayout } from './ticket';

interface ChainData {
  /** null = unknown yet, false = program not deployed / chain disabled. */
  deployed: boolean | null;
  /** DEV_FAKE_CHAIN stand-in (see devFake.ts). */
  fake: boolean;
  config: ConfigView | null;
  profile: ProfileView | null;
  profileLoaded: boolean;
  arenas: ArenaView[];
  sessions: Record<number, SessionView | null>;
  /** SOL balance in lamports (fees, rent, settle deposit). */
  balance: number | null;
  /** Game-token balance of the wallet's ATA, raw units. */
  tokenBalance: bigint | null;
  /** Does the wallet's game-token ATA exist? null = unknown. */
  ataExists: boolean | null;
  /** Payouts the server still owes this wallet (`/api/pending`). */
  pending: PendingPayout[];
  loading: boolean;
}

export const useChainData = create<ChainData>(() => ({
  deployed: null,
  fake: false,
  config: null,
  profile: null,
  profileLoaded: false,
  arenas: [],
  sessions: {},
  balance: null,
  tokenBalance: null,
  ataExists: null,
  pending: [],
  loading: false,
}));

let clientCache: { key: string; client: SlanaClient } | null = null;

/** SlanaClient bound to the current RPC + program id (from the game server). Null in fake mode. */
export function useSlanaClient(): SlanaClient | null {
  const { connection } = useConnection();
  const chain = useUi((s) => s.chain);
  return useMemo(() => {
    if (!chain?.enabled || !chain.programId || isDevFake(chain)) return null;
    const key = `${connection.rpcEndpoint}|${chain.programId}`;
    if (clientCache?.key !== key) clientCache = { key, client: new SlanaClient(connection, chain.programId) };
    return clientCache.client;
  }, [connection, chain]);
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER.http}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadPending(owner: string): Promise<PendingPayout[]> {
  return (await getJson<{ pending: PendingPayout[] }>(`/api/pending?wallet=${owner}`))?.pending ?? [];
}

let refreshTimer: number | null = null;
/**
 * Bumped whenever the wallet changes. A refresh captures it when it starts and
 * drops its result if it changed meanwhile, so a slow read for wallet A can
 * never overwrite wallet B's balances or tickets.
 */
let generation = 0;
/** The wallet the store currently describes. */
let currentOwner: string | null = null;

/**
 * Keeps config / profile / arenas / my sessions / balances / payouts fresh. Mount once (App).
 * While the game token is not set on chain (`set_token_mint` still to come) there are no
 * token balances and no arenas to read: the profile and SOL balance still load. The hook
 * re-keys on the chain status, so the server's `chain` push (the token was set) re-reads at once.
 */
export function useChainSync(): void {
  const client = useSlanaClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const chain = useUi((s) => s.chain);
  const owner = publicKey?.toBase58() ?? null;
  const fake = isDevFake(chain);

  const refresh = useCallback(async () => {
    const gen = generation;
    const stale = () => gen !== generation || currentOwner !== owner;
    const set = (patch: Partial<ChainData>) => {
      if (!stale()) useChainData.setState(patch);
    };
    if (fake && chain) {
      const dev = await loadDevFake();
      if (!dev) return;
      const { fakeConfig, fakeWallet } = dev;
      const pending = owner ? await loadPending(owner) : [];
      const ready = chain.tokenReady;
      set({
        deployed: true,
        fake: true,
        config: fakeConfig(chain),
        arenas: [],
        profile: owner ? fakeWallet.profile : null,
        profileLoaded: true,
        sessions: owner && ready ? { ...fakeWallet.sessions } : {},
        balance: owner ? fakeWallet.lamports : null,
        tokenBalance: owner && ready ? fakeWallet.tokenBalance : null,
        ataExists: owner && ready ? fakeWallet.ataExists : null,
        pending,
        loading: false,
      });
      return;
    }
    if (!client) {
      set({
        deployed: useUi.getState().chain ? false : null,
        fake: false,
        config: null,
        profile: null,
        arenas: [],
        sessions: {},
        profileLoaded: true,
      });
      return;
    }
    set({ loading: true, fake: false });
    try {
      const deployed = await client.isDeployed();
      if (!deployed) {
        set({ deployed: false, loading: false, profileLoaded: true });
        return;
      }
      const config = await client.fetchConfig();
      const token = config && isTokenSet(config) ? { mint: config.tokenMint!, program: config.tokenProgram! } : null;
      // no token yet: no arena can exist (create_arena needs it)
      const arenas = token ? await client.fetchArenas().catch(() => [] as ArenaView[]) : [];
      let profile: ProfileView | null = null;
      const sessions: Record<number, SessionView | null> = {};
      let balance: number | null = null;
      let tokenBalance: bigint | null = null;
      let ataExists: boolean | null = null;
      let pending: PendingPayout[] = [];
      if (owner && publicKey) {
        const tokenInfo = token
          ? connection.getAccountInfo(ata(owner, token.mint, token.program), 'confirmed').then(
              (info) => ({ exists: info !== null }),
              () => ({ exists: null }),
            )
          : Promise.resolve({ exists: null });
        const [p, lamports, tokens, account, pend] = await Promise.all([
          client.fetchProfile(owner).catch(() => null),
          connection.getBalance(publicKey).catch(() => null),
          token ? fetchTokenBalance(connection, owner, token.mint, token.program).catch(() => null) : Promise.resolve(null),
          tokenInfo,
          loadPending(owner),
        ]);
        profile = p;
        balance = lamports;
        tokenBalance = tokens;
        ataExists = account.exists;
        pending = pend;
        const list = await Promise.all(arenas.map((a) => client.fetchSession(a.id, owner).catch(() => null)));
        arenas.forEach((a, i) => (sessions[a.id] = list[i]));
      }
      set({
        deployed: true,
        config,
        arenas: arenas.sort((a, b) => (a.entryFee < b.entryFee ? -1 : a.entryFee > b.entryFee ? 1 : a.id - b.id)),
        profile,
        profileLoaded: true,
        sessions,
        balance,
        tokenBalance,
        ataExists,
        pending,
        loading: false,
      });
    } catch (err) {
      console.warn('chain refresh failed', err);
      set({ loading: false, profileLoaded: true });
    }
  }, [client, owner, connection, publicKey, fake, chain]);

  useEffect(() => {
    generation++;
    currentOwner = owner;
    useChainData.setState({
      profile: null,
      profileLoaded: !owner,
      sessions: {},
      balance: null,
      tokenBalance: null,
      ataExists: null,
      pending: [],
    });
    void refresh();
    const id = window.setInterval(() => void refresh(), 20_000);
    refreshNow = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 400);
    };
    return () => {
      clearInterval(id);
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
    };
  }, [refresh, owner]);

  // fake mode: a settled game closes the local stand-in ticket and pays the net out
  useEffect(() => {
    if (!fake) return;
    return useUi.subscribe((s, prev) => {
      const st = s.lastSettlement;
      if (!st || st === prev.lastSettlement || st.arenaId === null) return;
      const arenaId = st.arenaId;
      void loadDevFake().then((dev) => {
        if (!dev) return;
        const net = BigInt(Math.max(0, Math.round(st.net ?? st.payout - (st.fee ?? 0))));
        const open = dev.fakeWallet.sessions[arenaId];
        // R24 stand-in: without a token account the game is finalized and the payout waits to be collected
        if (open && net > 0n && !dev.fakeWallet.ataExists) {
          dev.fakeWallet.sessions[arenaId] = { ...open, finalized: true, owed: net };
        } else {
          dev.fakeWallet.sessions[arenaId] = null;
          dev.fakeWallet.tokenBalance += net;
        }
        refreshNow();
      });
    });
  }, [fake]);
}

let refreshNow: () => void = () => {};
/** Ask for an immediate refresh (after a transaction). */
export const refreshChain = () => refreshNow();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  void loadDevFake().then((dev) => {
    const w = window as unknown as { __slanaChain?: unknown };
    w.__slanaChain = { useChainData, fakeWallet: dev?.fakeWallet, refresh: () => refreshNow() };
  });
}

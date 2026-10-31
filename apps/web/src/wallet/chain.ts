import {
  getAllowance,
  getArenaConfig,
  getSession,
  getTokenBalance,
  listArenas,
  type ArenaConfig,
  type ArenaInfo,
  type SessionInfo,
} from '@elymum/sdk';
import type { ChainStatus, ProfileView } from '@elymum/shared';
import type { Address, PublicClient } from 'viem';
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { SERVER } from '../config';
import { useUi } from '../store';
import { isDevFake, loadDevFake } from './devFakeLoader';
import { publicClientFor } from './network';
import { useAddress, useWallet } from './store';
import { sessionKey, type OpenSession, type PendingPayout } from './ticket';

export interface ChainData {
  /** null = unknown yet, false = no arena contract registered / readable or chain disabled. */
  deployed: boolean | null;
  /** DEV_FAKE_CHAIN stand-in (see devFake.ts). */
  fake: boolean;
  /** `ElymumArena.config()`. */
  config: ArenaConfig | null;
  /** Arenas on chain (only once the token is set). */
  arenas: ArenaInfo[];
  /** The wallet's session per arena (`id: 0n` sessions are stored as null). */
  sessions: Record<number, SessionInfo | null>;
  /** HYPE balance, wei (gas). */
  balance: bigint | null;
  /** Game-token balance, base units. */
  tokenBalance: bigint | null;
  /** Game-token allowance granted to the arena contract, base units. */
  allowance: bigint | null;
  /** The signed-in player's server profile (`GET /api/profile`). */
  profile: ProfileView | null;
  profileLoaded: boolean;
  /** Payouts the server still owes this wallet (`/api/pending`). */
  pending: PendingPayout[];
  loading: boolean;
}

export const useChainData = create<ChainData>(() => ({
  deployed: null,
  fake: false,
  config: null,
  arenas: [],
  sessions: {},
  balance: null,
  tokenBalance: null,
  allowance: null,
  profile: null,
  profileLoaded: false,
  pending: [],
  loading: false,
}));

/** A session as the lobby's ticket logic sees it (null when there is none). */
export function openSessionOf(s: SessionInfo | null | undefined): OpenSession | null {
  if (!s || s.id === 0n) return null;
  return { key: sessionKey(s.arenaId, s.player, s.id), id: s.id, openedAt: s.openedAt, entryFee: s.entryFee, finalized: s.finalized, owed: s.owed };
}

/** The read client for the server's chain (null in fake mode or while the chain is off). */
export function useReadClient(): PublicClient | null {
  const chain = useUi((s) => s.chain);
  const provider = useWallet((s) => s.current?.provider ?? null);
  return useMemo(() => {
    if (!chain?.enabled || !chain.arenaAddress || isDevFake(chain)) return null;
    return publicClientFor(chain, provider);
  }, [chain, provider]);
}

async function getJson<T>(path: string, token?: string | null): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER.http}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadPending(owner: string): Promise<PendingPayout[]> {
  return (await getJson<{ pending: PendingPayout[] }>(`/api/pending?wallet=${encodeURIComponent(owner)}`))?.pending ?? [];
}

/** `GET /api/profile` with the session token (null when signed out or unreachable). */
export async function loadProfile(token: string | null | undefined): Promise<ProfileView | null> {
  if (!token) return null;
  const body = await getJson<{ profile: ProfileView } | ProfileView>('/api/profile', token);
  if (!body) return null;
  return 'profile' in body ? body.profile : body;
}

let refreshTimer: number | null = null;
/**
 * Bumped whenever the wallet changes. A refresh captures it when it starts and drops its result
 * if it changed meanwhile, so a slow read for wallet A can never overwrite wallet B's balances.
 */
let generation = 0;
let currentOwner: string | null = null;

/** Chain reads of one refresh (exported for tests). */
export async function readChain(
  client: PublicClient,
  chain: ChainStatus,
  owner: Address | null,
): Promise<Pick<ChainData, 'deployed' | 'config' | 'arenas' | 'sessions' | 'balance' | 'tokenBalance' | 'allowance'>> {
  const arena = chain.arenaAddress as Address;
  let config: ArenaConfig;
  try {
    config = await getArenaConfig(client, arena);
  } catch {
    return { deployed: false, config: null, arenas: [], sessions: {}, balance: null, tokenBalance: null, allowance: null };
  }
  // no token yet: no arena can exist (createArena needs it)
  const arenas = config.token ? await listArenas(client, arena).catch(() => [] as ArenaInfo[]) : [];
  const sessions: Record<number, SessionInfo | null> = {};
  let balance: bigint | null = null;
  let tokenBalance: bigint | null = null;
  let allowance: bigint | null = null;
  if (owner) {
    const token = config.token;
    const [wei, tokens, allowed, list] = await Promise.all([
      client.getBalance({ address: owner }).catch(() => null),
      token ? getTokenBalance(client, token, owner).catch(() => null) : Promise.resolve(null),
      token ? getAllowance(client, token, owner, arena).catch(() => null) : Promise.resolve(null),
      Promise.all(arenas.map((a) => getSession(client, arena, a.id, owner).catch(() => null))),
    ]);
    balance = wei;
    tokenBalance = tokens;
    allowance = allowed;
    arenas.forEach((a, i) => (sessions[a.id] = list[i] && list[i]!.id !== 0n ? list[i] : null));
  }
  arenas.sort((a, b) => (a.entryFee < b.entryFee ? -1 : a.entryFee > b.entryFee ? 1 : a.id - b.id));
  return { deployed: true, config, arenas, sessions, balance, tokenBalance, allowance };
}

/**
 * Keeps config / arenas / my sessions / balances / allowance / payouts / profile fresh. Mount
 * once (App). While the game token is not set on chain there are no token balances and no
 * arenas to read: the HYPE balance still loads. The hook re-keys on the chain status, so the
 * server's `chain` push (the token was set) re-reads at once.
 */
export function useChainSync(): void {
  const client = useReadClient();
  const owner = useAddress();
  const chain = useUi((s) => s.chain);
  const token = useUi((s) => (s.auth && owner && s.auth.address.toLowerCase() === owner.toLowerCase() ? s.auth.token : null));
  const fake = isDevFake(chain);

  const refresh = useCallback(async () => {
    const gen = generation;
    const stale = () => gen !== generation || currentOwner !== owner;
    const set = (patch: Partial<ChainData>) => {
      if (!stale()) useChainData.setState(patch);
    };
    const [pending, profile] = owner ? await Promise.all([loadPending(owner), loadProfile(token)]) : [[] as PendingPayout[], null];
    if (fake && chain) {
      const dev = await loadDevFake();
      if (!dev) return;
      const { fakeConfig, fakeWallet } = dev;
      const ready = chain.tokenReady;
      set({
        deployed: true,
        fake: true,
        config: fakeConfig(chain),
        arenas: [],
        sessions: owner && ready ? { ...fakeWallet.sessions } : {},
        balance: owner ? fakeWallet.wei : null,
        tokenBalance: owner && ready ? fakeWallet.tokenBalance : null,
        allowance: owner && ready ? fakeWallet.allowance : null,
        profile,
        profileLoaded: true,
        pending,
        loading: false,
      });
      return;
    }
    if (!client || !chain) {
      set({ deployed: chain ? false : null, fake: false, config: null, arenas: [], sessions: {}, profile, profileLoaded: true, pending });
      return;
    }
    set({ loading: true, fake: false });
    try {
      const data = await readChain(client, chain, owner);
      set({ ...data, profile, profileLoaded: true, pending, loading: false });
    } catch (err) {
      console.warn('chain refresh failed', err);
      set({ loading: false, profileLoaded: true, profile, pending });
    }
  }, [client, owner, fake, chain, token]);

  useEffect(() => {
    generation++;
    currentOwner = owner;
    useChainData.setState({ profileLoaded: !owner, sessions: {}, balance: null, tokenBalance: null, allowance: null, pending: [], ...(owner ? {} : { profile: null }) });
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
        const decimals = useUi.getState().chain?.token?.decimals ?? 18;
        const ledgerNet = Math.max(0, Math.round(st.net ?? st.payout - (st.fee ?? 0)));
        const net = BigInt(ledgerNet) * 10n ** BigInt(Math.max(0, decimals - 6));
        const open = dev.fakeWallet.sessions[arenaId];
        // the collect stand-in: the payout is finalized and waits to be collected
        if (open && net > 0n && (st.collect || dev.fakeWallet.failPayouts)) {
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
    const w = window as unknown as { __elymumChain?: unknown };
    w.__elymumChain = { useChainData, fakeWallet: dev?.fakeWallet, refresh: () => refreshNow() };
  });
}

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SlanaClient, ata, fetchTokenBalance, pdas, type ArenaView, type ConfigView, type OwnedPass, type ProfileView, type SessionView } from '@slana/sdk';
import type { ChainStatus, PassStatus } from '@slana/shared';
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { SERVER } from '../config';
import { useUi } from '../store';
import { isDevFake, loadDevFake } from './devFakeLoader';
import { passStatusOf } from './pass';
import { passPowerOf, type PassPowerText, type PendingPayout } from './ticket';

export interface SeasonEntryInfo {
  player: string;
  name: string;
  skin: number;
  points: number;
  bestScore: number;
}

/** `/api/season` (the server's cache of the on-chain season). */
export interface SeasonInfo {
  id: number;
  /** Unix seconds. */
  startedAt: number;
  finalized: boolean;
  /** Running pool (raw token units). */
  prizePool: number;
  entries: SeasonEntryInfo[];
  /** The previous season once finalized: its winners claim from here. */
  previous: PreviousSeasonInfo | null;
}

export interface PreviousSeasonInfo {
  id: number;
  /** Frozen prize pool, raw token units. */
  prizePool: number;
  /** Unix seconds. */
  endedAt: number;
  entries: SeasonEntryInfo[];
  /** Bit `rank` set ⇔ that prize was claimed. */
  claimedMask: number;
}

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
  /** Slana Passes in the wallet (server `/api/pass/owned`). */
  passes: OwnedPass[];
  /** Pass assets currently locked in a session (`pass_lock` exists). */
  lockedPasses: string[];
  /** Payouts the server still owes this wallet (`/api/pending`). */
  pending: PendingPayout[];
  /** Passes this wallet minted (its on-chain `MintCounter`); null = unknown. */
  mintedByMe: number | null;
  /** Slana Pass collection state: the chain config when loaded, else the server's status. */
  passStatus: PassStatus | null;
  season: SeasonInfo | null;
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
  passes: [],
  lockedPasses: [],
  pending: [],
  mintedByMe: null,
  passStatus: null,
  season: null,
  loading: false,
}));

/** The Pass collection state every screen should use (chain config first, server status as the fallback). */
export function usePassStatus(): PassStatus | null {
  const fromChain = useChainData((s) => s.passStatus);
  const fromServer = useUi((s) => s.chain?.pass ?? null);
  return fromChain ?? fromServer;
}

/** I3: the Pass power the server applies (its `passPower`), `RULES` as the fallback. */
export function usePassPower(): PassPowerText {
  const power = useUi((s) => s.chain?.passPower ?? null);
  return useMemo(() => passPowerOf(power), [power]);
}

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

/** Passes minted from this page: shown at once, before the server's owned-Pass cache (30 s) catches up. */
const recentMints: { owner: string; pass: OwnedPass; at: number }[] = [];
const RECENT_MINT_MS = 3 * 60_000;

/** Remember a Pass this wallet just minted and show it right away. */
export function rememberMint(owner: string, pass: OwnedPass): void {
  recentMints.push({ owner, pass, at: Date.now() });
  const d = useChainData.getState();
  if (!d.passes.some((p) => p.asset === pass.asset)) useChainData.setState({ passes: [...d.passes, pass].sort((a, b) => a.number - b.number) });
}

function withRecentMints(owner: string, passes: OwnedPass[]): OwnedPass[] {
  const now = Date.now();
  const extra = recentMints.filter((m) => m.owner === owner && now - m.at < RECENT_MINT_MS && !passes.some((p) => p.asset === m.pass.asset)).map((m) => m.pass);
  return extra.length ? [...passes, ...extra].sort((a, b) => a.number - b.number) : passes;
}

async function serverWalletData(owner: string): Promise<{ passes: OwnedPass[]; pending: PendingPayout[] }> {
  const [owned, pend] = await Promise.all([
    getJson<{ passes: OwnedPass[] }>(`/api/pass/owned?wallet=${owner}`),
    getJson<{ pending: PendingPayout[] }>(`/api/pending?wallet=${owner}`),
  ]);
  return { passes: withRecentMints(owner, owned?.passes ?? []), pending: pend?.pending ?? [] };
}

async function loadSeason(): Promise<SeasonInfo | null> {
  const s = await getJson<SeasonInfo & { enabled?: false }>('/api/season');
  return s && s.enabled !== false && typeof s.id === 'number' ? s : null;
}

let refreshTimer: number | null = null;
/**
 * Bumped whenever the wallet changes. A refresh captures it when it starts and
 * drops its result if it changed meanwhile, so a slow read for wallet A can
 * never overwrite wallet B's balances, Passes or tickets.
 */
let generation = 0;
/** The wallet the store currently describes. */
let currentOwner: string | null = null;

/** Keeps config / profile / arenas / my sessions / balances / Passes / payouts fresh. Mount once (App). */
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
    const season = await loadSeason();
    if (fake && chain) {
      const dev = await loadDevFake();
      if (!dev) return;
      const { fakeConfig, fakeWallet, fakePassStatus, fakeSeason } = dev;
      const wallet = owner ? await serverWalletData(owner) : { passes: [], pending: [] };
      if (owner && fakeWallet.passes) wallet.passes = [...fakeWallet.passes];
      // the fake collection changes under us (mints, the dev reveal): its state comes with every refresh
      const fresh = (await getJson<{ chain?: ChainStatus }>('/api/config'))?.chain?.pass;
      // (read locally: writing it to the store would re-key this hook and reset the wallet data)
      const live = fresh ? { ...chain, pass: fresh } : chain;
      const passStatus = fakePassStatus(live);
      set({
        deployed: true,
        fake: true,
        config: fakeConfig(live, passStatus),
        passStatus,
        mintedByMe: owner ? fakeWallet.minted : null,
        arenas: [],
        profile: owner ? fakeWallet.profile : null,
        profileLoaded: true,
        sessions: owner ? { ...fakeWallet.sessions } : {},
        balance: owner ? fakeWallet.lamports : null,
        tokenBalance: owner ? fakeWallet.tokenBalance : null,
        ataExists: owner ? fakeWallet.ataExists : null,
        lockedPasses: [],
        ...wallet,
        season: fakeSeason(season, owner),
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
        passStatus: null,
        mintedByMe: null,
        season,
      });
      return;
    }
    set({ loading: true, fake: false });
    try {
      const deployed = await client.isDeployed();
      if (!deployed) {
        set({ deployed: false, loading: false, profileLoaded: true, season });
        return;
      }
      const [config, arenas] = await Promise.all([client.fetchConfig(), client.fetchArenas().catch(() => [] as ArenaView[])]);
      let profile: ProfileView | null = null;
      const sessions: Record<number, SessionView | null> = {};
      let balance: number | null = null;
      let tokenBalance: bigint | null = null;
      let ataExists: boolean | null = null;
      let wallet: { passes: OwnedPass[]; pending: PendingPayout[] } = { passes: [], pending: [] };
      let lockedPasses: string[] = [];
      let mintedByMe: number | null = null;
      if (owner && publicKey) {
        const tokenInfo = config
          ? connection.getAccountInfo(ata(owner, config.tokenMint, config.tokenProgram), 'confirmed').then(
              (info) => ({ exists: info !== null }),
              () => ({ exists: null }),
            )
          : Promise.resolve({ exists: null });
        const [p, lamports, tokens, account, w, minted] = await Promise.all([
          client.fetchProfile(owner).catch(() => null),
          connection.getBalance(publicKey).catch(() => null),
          config ? fetchTokenBalance(connection, owner, config.tokenMint, config.tokenProgram).catch(() => null) : Promise.resolve(null),
          tokenInfo,
          serverWalletData(owner),
          config?.passCollection ? client.fetchMintedCount(owner).catch(() => null) : Promise.resolve(0),
        ]);
        mintedByMe = minted;
        profile = p;
        balance = lamports;
        tokenBalance = tokens;
        ataExists = account.exists;
        wallet = w;
        const list = await Promise.all(arenas.map((a) => client.fetchSession(a.id, owner).catch(() => null)));
        arenas.forEach((a, i) => (sessions[a.id] = list[i]));
        // a Pass with a lock is busy in a session (ours or, after a transfer, the old owner's)
        if (wallet.passes.length > 0) {
          const keys = wallet.passes.map((p) => pdas.passLock(p.asset, client.programId));
          const locks = await connection.getMultipleAccountsInfo(keys, 'confirmed').catch(() => null);
          // unknown (RPC failure): assume free; the chain still refuses a busy Pass (PassInUse is explained)
          lockedPasses = locks ? wallet.passes.filter((_, i) => locks[i] !== null).map((p) => p.asset) : [];
        }
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
        lockedPasses,
        mintedByMe,
        passStatus: passStatusOf(config, useUi.getState().chain?.pass ?? null),
        ...wallet,
        season,
        loading: false,
      });
    } catch (err) {
      console.warn('chain refresh failed', err);
      set({ loading: false, profileLoaded: true, season });
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
      passes: [],
      lockedPasses: [],
      pending: [],
      mintedByMe: null,
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

/** Pass assets that can back a new ticket (owned and not locked). */
export function freePasses(d: Pick<ChainData, 'passes' | 'lockedPasses'>): OwnedPass[] {
  return d.passes.filter((p) => !d.lockedPasses.includes(p.asset));
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  void loadDevFake().then((dev) => {
    const w = window as unknown as { __slanaChain?: unknown };
    w.__slanaChain = { useChainData, fakeWallet: dev?.fakeWallet, refresh: () => refreshNow(), revealPasses: dev?.fakeRevealPasses };
  });
}

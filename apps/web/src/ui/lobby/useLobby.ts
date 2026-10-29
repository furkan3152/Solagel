import { useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_SYMBOL_DEFAULT, arenaMeta, formatToken } from '@elymum/shared';
import { useEffect, useMemo, useState } from 'react';
import { useChainData } from '../../solana/chain';
import { buildTickets, quickPlayTarget, ticketGate, type OpenSession, type TicketGate, type TicketKey, type TicketModel } from '../../solana/ticket';
import { useUi } from '../../store';

export interface TokenText {
  symbol: string;
  decimals: number;
  /** Exact amount with grouping (`12,450`), compact (K/M/B) from one million up. */
  fee: (raw: bigint | number) => string;
  /** Always compact (`310K`). */
  compact: (raw: bigint | number) => string;
  /** Every decimal the token has (confirm sheet: what you sign). */
  exact: (raw: bigint | number) => string;
}

export function tokenText(decimals: number, symbol: string): TokenText {
  const million = 10n ** BigInt(decimals + 6);
  return {
    symbol,
    decimals,
    fee: (raw) => formatToken(raw, decimals, { compact: BigInt(raw) >= million }),
    compact: (raw) => formatToken(raw, decimals, { compact: true, maxFrac: 1 }),
    exact: (raw) => formatToken(raw, decimals, { maxFrac: decimals }),
  };
}

/**
 * The game token's display: symbol and decimals from the server's config (`ChainStatus.token`),
 * the on-chain decimals once the config is read. Until the token is set (no symbol yet) the
 * symbol shows as `$SLANA` and amounts use 6 decimals.
 */
export function useTokenText(): TokenText {
  const token = useUi((s) => s.chain?.token ?? null);
  const chainDecimals = useChainData((s) => (s.config?.tokenMint ? s.config.tokenDecimals : undefined));
  const decimals = chainDecimals ?? token?.decimals ?? 6;
  return useMemo(() => tokenText(decimals, token?.symbol || TOKEN_SYMBOL_DEFAULT), [decimals, token?.symbol]);
}

export const ticketName = (t: Pick<TicketModel, 'arenaId'>, practice: string): string =>
  t.arenaId === null ? practice : arenaMeta(t.arenaId).name;

export interface LobbyModel {
  tickets: TicketModel[];
  gates: Record<string, TicketGate>;
  sessions: Record<number, OpenSession | null>;
  quick: TicketKey;
  walletConnected: boolean;
  verified: boolean;
  owner: string | null;
}

/** Tickets, what each one's button does, and Quick Play's pick. */
export function useLobbyModel(): LobbyModel {
  const wallet = useWallet();
  const rooms = useUi((s) => s.rooms);
  const blocked = useUi((s) => s.blockedArenas);
  const chain = useUi((s) => s.chain);
  const auth = useUi((s) => s.auth);
  const lastArena = useUi((s) => s.settings.lastArena);
  const data = useChainData();
  const owner = wallet.publicKey?.toBase58() ?? null;
  const connected = wallet.connected && owner !== null;
  const verified = connected && auth?.pubkey === owner;
  const [nowS, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const token = {
      enabled: !!chain?.enabled,
      tokenReady: chain?.tokenReady === true,
      decimals: chain?.token?.decimals ?? 6,
    };
    const tickets = buildTickets(rooms, data.arenas, blocked, token);
    const sessions: Record<number, OpenSession | null> = {};
    for (const [id, s] of Object.entries(data.sessions)) {
      sessions[Number(id)] = s ? { address: s.address, openedAt: s.openedAt, finalized: s.finalized, owed: s.owed } : null;
    }
    const arenasEnabled = !!chain?.arenasEnabled && data.deployed !== false;
    const gates: Record<string, TicketGate> = {};
    for (const t of tickets) {
      gates[t.key] = ticketGate({
        ticket: t,
        arenasEnabled,
        walletConnected: connected,
        verified,
        balance: data.tokenBalance,
        session: t.arenaId !== null ? (sessions[t.arenaId] ?? null) : null,
        pending: data.pending,
        nowS,
      });
    }
    const openSessions = Object.entries(sessions)
      .filter(([, s]) => s !== null)
      .map(([id]) => Number(id));
    const quick = quickPlayTarget({
      walletConnected: connected,
      balance: arenasEnabled ? data.tokenBalance : null,
      tickets: tickets.filter((t) => t.arenaId === null || (gates[t.key].kind !== 'offline' && gates[t.key].kind !== 'maintenance' && gates[t.key].kind !== 'soon')),
      lastArena,
      openSessions,
    });
    return { tickets, gates, sessions, quick, walletConnected: connected, verified, owner };
  }, [rooms, blocked, data, chain, connected, verified, nowS, lastArena, owner]);
}

/** `(max-width: …)` as React state. */
export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setM(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return m;
}

import { getAddress, isAddress, type Address } from 'viem';
import { create } from 'zustand';
import { describeError } from '@elymum/sdk';
import { discoverProviders, type Eip1193Provider, type ProviderDetail } from './eip6963';

/**
 * The browser wallet (EIP-1193 via EIP-6963): which wallets this browser has, which one is
 * connected, its account (EIP-55 checksummed) and the chain it is on. One store for the game,
 * the site pages and the admin panel. Nothing here signs; see `siwe.ts` and `tx.ts`.
 */
export type WalletStatus = 'disconnected' | 'connecting' | 'connected';

export interface WalletState {
  /** Wallets found in this browser (announced + the `window.ethereum` fallback). */
  providers: ProviderDetail[];
  /** The connected (or connecting) wallet. */
  current: ProviderDetail | null;
  /** Connected account, checksummed. */
  address: Address | null;
  /** Chain id the wallet is on (`eth_chainId`), null while unknown. */
  chainId: number | null;
  status: WalletStatus;
  error: string | null;
}

export const useWallet = create<WalletState>(() => ({
  providers: [],
  current: null,
  address: null,
  chainId: null,
  status: 'disconnected',
  error: null,
}));

/** localStorage key of the last wallet's rdns (silent reconnect on the next visit). */
export const LAST_WALLET_KEY = 'elymum.wallet.v1';

const remember = (rdns: string | null) => {
  try {
    if (rdns) localStorage.setItem(LAST_WALLET_KEY, rdns);
    else localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    /* storage unavailable */
  }
};
const remembered = (): string | null => {
  try {
    return localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
};

/** `0x…` hex or a decimal number/string → a chain id; null when it is not one. */
export function parseChainId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const n = /^0x[0-9a-f]+$/i.test(v) ? Number.parseInt(v, 16) : /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The first account of an `eth_accounts` answer, checksummed (null when none). */
export function firstAccount(v: unknown): Address | null {
  const a = Array.isArray(v) ? v[0] : null;
  return typeof a === 'string' && isAddress(a, { strict: false }) ? getAddress(a) : null;
}

/* ── events of the connected wallet ─────────────────────────────────── */

let detach: (() => void) | null = null;

function attach(detail: ProviderDetail): void {
  detach?.();
  const p = detail.provider;
  const onAccounts = (accounts: unknown) => {
    if (useWallet.getState().current?.provider !== p) return;
    const address = firstAccount(accounts);
    if (!address) {
      // the user disconnected this site in the wallet
      disconnectWallet();
      return;
    }
    useWallet.setState({ address, status: 'connected' });
  };
  const onChain = (id: unknown) => {
    if (useWallet.getState().current?.provider !== p) return;
    useWallet.setState({ chainId: parseChainId(id) });
  };
  p.on?.('accountsChanged', onAccounts as (...a: never[]) => void);
  p.on?.('chainChanged', onChain as (...a: never[]) => void);
  detach = () => {
    p.removeListener?.('accountsChanged', onAccounts as (...a: never[]) => void);
    p.removeListener?.('chainChanged', onChain as (...a: never[]) => void);
    detach = null;
  };
}

async function readChainId(p: Eip1193Provider): Promise<number | null> {
  try {
    return parseChainId(await p.request({ method: 'eth_chainId' }));
  } catch {
    return null;
  }
}

/* ── discovery ──────────────────────────────────────────────────────── */

let stopDiscovery: (() => void) | null = null;
let triedSilent = false;

/**
 * Starts EIP-6963 discovery once per page and reconnects silently (`eth_accounts`, no prompt)
 * to the wallet used last time. Safe to call from every entry point.
 */
export function initWallets(win: Window = window): void {
  if (stopDiscovery || typeof win === 'undefined') return;
  stopDiscovery = discoverProviders((providers) => {
    useWallet.setState({ providers });
    const last = remembered();
    if (!triedSilent && last && useWallet.getState().status === 'disconnected') {
      const found = providers.find((d) => d.info.rdns === last);
      if (found) {
        triedSilent = true;
        void connectWallet(found, { silent: true });
      }
    }
  }, win);
}

/** For tests: forget discovery and the connection. */
export function resetWallets(): void {
  stopDiscovery?.();
  stopDiscovery = null;
  triedSilent = false;
  detach?.();
  useWallet.setState({ providers: [], current: null, address: null, chainId: null, status: 'disconnected', error: null });
}

/* ── connect / disconnect ───────────────────────────────────────────── */

let userInitiated = false;
/** True once after the user picked a wallet themselves (the game may then ask for the sign-in signature). */
export function takeUserConnect(): boolean {
  const v = userInitiated;
  userInitiated = false;
  return v;
}

/**
 * Connects `detail` (`eth_requestAccounts`, the wallet's prompt). With `silent`, only
 * `eth_accounts` is asked (a site the wallet already trusts reconnects without a prompt).
 * Resolves to the account, or null when the user declined or the wallet has none.
 */
export async function connectWallet(detail: ProviderDetail | string, opts: { silent?: boolean } = {}): Promise<Address | null> {
  const d = typeof detail === 'string' ? useWallet.getState().providers.find((x) => x.info.uuid === detail || x.info.rdns === detail) : detail;
  if (!d) {
    useWallet.setState({ error: 'That wallet is not available in this browser.' });
    return null;
  }
  if (!opts.silent) userInitiated = true;
  useWallet.setState({ current: d, status: 'connecting', error: null });
  try {
    const accounts = await d.provider.request({ method: opts.silent ? 'eth_accounts' : 'eth_requestAccounts' });
    const address = firstAccount(accounts);
    if (useWallet.getState().current !== d) return null;
    if (!address) {
      useWallet.setState({ current: null, address: null, chainId: null, status: 'disconnected' });
      if (!opts.silent) userInitiated = false;
      return null;
    }
    const chainId = await readChainId(d.provider);
    attach(d);
    remember(d.info.rdns);
    useWallet.setState({ address, chainId, status: 'connected', error: null });
    return address;
  } catch (err) {
    if (useWallet.getState().current === d) {
      const e = describeError(err);
      useWallet.setState({ current: null, address: null, chainId: null, status: 'disconnected', error: opts.silent || e.kind === 'rejected' ? null : e.message });
    }
    userInitiated = false;
    return null;
  }
}

/**
 * Forgets the connection on this site. EIP-1193 has no standard disconnect; wallets that know
 * `wallet_revokePermissions` (MetaMask, Rabby) are asked to drop the permission too.
 */
export function disconnectWallet(): void {
  const cur = useWallet.getState().current;
  detach?.();
  remember(null);
  useWallet.setState({ current: null, address: null, chainId: null, status: 'disconnected', error: null });
  if (cur) void cur.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
}

/** The connected provider and account, or null. */
export function connected(): { provider: Eip1193Provider; address: Address; info: ProviderDetail['info'] } | null {
  const s = useWallet.getState();
  return s.current && s.address && s.status === 'connected' ? { provider: s.current.provider, address: s.address, info: s.current.info } : null;
}

/** React: the connected account (checksummed) or null. */
export const useAddress = (): Address | null => useWallet((s) => (s.status === 'connected' ? s.address : null));

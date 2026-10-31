import { isMainnet, type ChainStatus } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { SERVER } from '../config';

/**
 * The game server's chain (`GET /api/config` → `chain`), without viem: the site header reads it
 * to know whether it is on a testnet (the Faucet link) before any wallet code has loaded.
 */
let cache: Promise<ChainStatus | null> | null = null;
let last: ChainStatus | null | undefined;

/** `GET /api/config` → `chain` (null when the server cannot be reached). Cached per page unless `fresh`. */
export function fetchServerChain(opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<ChainStatus | null> {
  if (cache && !opts.fresh) return cache;
  const run = async (): Promise<ChainStatus | null> => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 6000) : null;
    try {
      const res = await fetch(`${SERVER.http}/api/config`, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      return ((await res.json()) as { chain?: ChainStatus }).chain ?? null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const p = run();
  cache = p;
  void p.then((c) => {
    if (cache === p) last = c;
    if (c === null && cache === p) cache = null;
  });
  return p;
}

/** For tests. */
export function resetServerChain(): void {
  cache = null;
  last = undefined;
}

/**
 * The faucet's network rule: any chain that is not mainnet (Elysium Testnet, a localnet) has
 * test tokens. null while unknown (no chain, or the server is not answering).
 */
export function isTestnetChain(chain: Pick<ChainStatus, 'enabled' | 'chainId'> | null | undefined): boolean | null {
  if (!chain || !chain.enabled || chain.chainId === null || chain.chainId === undefined) return null;
  return !isMainnet(chain.chainId);
}

/** The server's chain status, loaded once per page (undefined while loading). */
export function useServerChain(): ChainStatus | null | undefined {
  const [chain, setChain] = useState<ChainStatus | null | undefined>(last);
  useEffect(() => {
    let live = true;
    void fetchServerChain().then((c) => live && setChain(c));
    return () => {
      live = false;
    };
  }, []);
  return chain;
}

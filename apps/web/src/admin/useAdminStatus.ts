import { fetchStatus, type StatusSnapshot } from '@elymum/sdk/ops';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, PublicClient } from 'viem';
import type { AdminNetwork } from './net';

export interface AdminStatus {
  status: StatusSnapshot | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** The contracts' status (`fetchStatus`, the same read as `pnpm admin status`), re-read on demand. */
export function useAdminStatus(client: PublicClient | null, net: AdminNetwork, account: Address | null): AdminStatus {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!client);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!client) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchStatus(client, {
        arena: net.arenaAddress,
        nft: net.nftAddress,
        account,
        chainOverrides: net.info ? { name: net.info.name, rpcUrl: net.info.rpcUrl, explorerUrl: net.info.explorerUrl } : undefined,
      });
      if (mine !== seq.current) return;
      setStatus(s);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(`Cannot read the chain: ${(err as Error).message?.split('\n')[0] ?? String(err)}`);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [client, net.arenaAddress, net.nftAddress, net.info, account]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, error, loading, refresh };
}

import type { SlanaClient } from '@slana/sdk';
import { fetchStatus, type StatusSnapshot } from '@slana/sdk/ops';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminNetwork } from './net';

export interface AdminStatus {
  status: StatusSnapshot | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** The program's admin status (`fetchStatus`, the same read as `pnpm admin status`), re-read on demand. */
export function useAdminStatus(client: SlanaClient, net: AdminNetwork): AdminStatus {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const s = await fetchStatus(client, { url: net.rpcUrl, cluster: net.cluster });
      if (mine !== seq.current) return;
      setStatus(s);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(`Cannot read the chain at ${net.rpcUrl}: ${(err as Error).message ?? String(err)}`);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [client, net.rpcUrl, net.cluster]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, error, loading, refresh };
}

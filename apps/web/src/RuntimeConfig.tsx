import { useEffect } from 'react';
import { PROTOCOL_VERSION, type ChainStatus, type ReleaseStatus } from '@solagel/shared';
import { SERVER } from './config';
import { useUi } from './store';

/** Public release announcements refresh without replacing an active game's socket state. */
export function RuntimeConfig({ admin = false }: { admin?: boolean }) {
  useEffect(() => {
    let active = true;
    let running = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (!active || running) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(`${SERVER.http}/api/config`, { signal: controller.signal });
        if (!response.ok) throw new Error('Configuration unavailable');
        const data = await response.json() as { protocol: number; chain: ChainStatus; release?: ReleaseStatus; admissionsPaused?: boolean };
        if (!active || data.protocol !== PROTOCOL_VERSION) return;
        useUi.setState({ admissionsPaused: data.admissionsPaused ?? data.chain.admissionsPaused ?? false,
          ...(data.release ? { release: data.release } : {}), ...(admin ? { chain: data.chain } : {}) });
      } catch {
        // The last public announcement remains visible; admin requests have their own errors.
      } finally {
        clearTimeout(timeout);
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; clearInterval(timer); controller?.abort(); };
  }, [admin]);
  return null;
}

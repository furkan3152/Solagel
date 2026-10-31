import { StatusPill } from '../design';
import type { AdminNetwork } from './net';

/** The network as a pill: MAINNET red, TESTNET sun, LOCALNET and no chain idle. */
export function NetPill({ net }: { net: AdminNetwork }) {
  if (!net.info)
    return (
      <StatusPill tone="danger" data-testid="net-pill">
        No chain
      </StatusPill>
    );
  const local = net.info.id === 31337 || /local/i.test(net.info.name);
  const tone = net.mainnet ? 'mainnet' : local ? 'idle' : 'testnet';
  const word = net.mainnet ? 'Mainnet' : local ? 'Localnet' : 'Testnet';
  return (
    <StatusPill tone={tone} data-testid="net-pill" title={`${net.info.name} (${net.info.id})`}>
      {word} · {net.info.id}
    </StatusPill>
  );
}

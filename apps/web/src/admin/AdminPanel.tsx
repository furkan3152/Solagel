import { checkDeployedCode } from '@elymum/sdk/ops';
import { useEffect, useMemo, useState } from 'react';
import type { PublicClient } from 'viem';
import type { AdminApi } from '../site/api';
import { publicClientFor } from '../wallet/network';
import { connectWallet, disconnectWallet, initWallets, useWallet } from '../wallet/store';
import { ArenaTab } from './ArenaTab';
import { DeployTab } from './DeployTab';
import { LaunchTab, type ChecklistTab } from './LaunchTab';
import { MintTab } from './MintTab';
import { chainBlockers, walletChainNote, type AdminNetwork } from './net';
import type { Plan } from './plan';
import { TxPreview, type SignedEntry } from './TxPreview';
import { Addr, type ChainCtx } from './ui';
import { useAdminStatus } from './useAdminStatus';
import './admin.css';

export type ChainTab = 'launch' | 'deploy' | 'mint' | 'arena';

/** Connect / disconnect the owner wallet (EIP-6963: MetaMask, Rabby or any browser wallet). */
export function WalletBox() {
  const providers = useWallet((s) => s.providers);
  const status = useWallet((s) => s.status);
  const current = useWallet((s) => s.current);
  const error = useWallet((s) => s.error);
  const address = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const chainId = useWallet((s) => s.chainId);
  useEffect(() => initWallets(), []);
  if (address) {
    return (
      <div className="ad-wallet">
        <span className="mono ad-cap">
          Connected · {current?.info.name ?? 'wallet'} · chain {chainId ?? '?'}
        </span>
        <code className="ad-wallet__addr">{address}</code>
        <button type="button" className="ad-btn" onClick={() => disconnectWallet()}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div className="ad-wallet">
      <span className="mono ad-cap">{status === 'connecting' ? 'Connecting…' : 'Connect a wallet'}</span>
      {providers.length === 0 ? (
        <p className="ad-note">No browser wallet found. Install MetaMask, Rabby or any browser wallet (a Ledger works through them).</p>
      ) : (
        <div className="ad-chips">
          {providers.map((d) => (
            <button key={d.info.uuid} type="button" className="ad-btn" disabled={status === 'connecting'} onClick={() => void connectWallet(d)}>
              {d.info.icon && <img src={d.info.icon} alt="" width={16} height={16} />} {d.info.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="ad-bad">{error}</p>}
    </div>
  );
}

/**
 * The chain tabs of `/admin` (Launch, Deploy, Mint, Arena): the contracts' status for
 * everyone, and every owner operation, signed by the connected browser wallet. Every write
 * opens the transaction preview first; the contracts check every signer themselves.
 */
export function AdminPanel({ net, api, tab, go, reloadNet }: { net: AdminNetwork; api: AdminApi | null; tab: ChainTab; go: (t: ChecklistTab) => void; reloadNet: () => Promise<void> }) {
  const me = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const provider = useWallet((s) => s.current?.provider ?? null);
  const walletChainId = useWallet((s) => s.chainId);
  const client = useMemo<PublicClient | null>(() => (net.chain ? publicClientFor(net.chain, provider) : null), [net.chain, provider]);
  const { status, error, loading, refresh } = useAdminStatus(client, net, me);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [log, setLog] = useState<SignedEntry[]>([]);
  const [codes, setCodes] = useState<{ arena: string | null; nft: string | null }>({ arena: null, nft: null });
  const blockers = chainBlockers(net, status?.chain.id);
  const note = walletChainNote(net, walletChainId);

  // the runtime code hash check of the registered contracts (the server checked it when they were registered)
  useEffect(() => {
    if (!client) return;
    let live = true;
    void Promise.all([
      net.arenaAddress ? checkDeployedCode(client, net.arenaAddress, 'arena').catch(() => null) : null,
      net.nftAddress ? checkDeployedCode(client, net.nftAddress, 'nft').catch(() => null) : null,
    ]).then(([arena, nft]) => live && setCodes({ arena, nft }));
    return () => {
      live = false;
    };
  }, [client, net.arenaAddress, net.nftAddress]);

  const ctx: ChainCtx = { net, status, refresh, reloadNet, me, walletChainId, client, api, open: setPlan };

  return (
    <div className="ad-chain" aria-busy={loading}>
      {blockers.length > 0 && (
        <div className="ad-blocked" role="alert">
          <strong>SIGNING BLOCKED.</strong>
          {blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </div>
      )}
      {net.mainnet && (
        <div className="ad-mainnet" role="alert" data-testid="mainnet-banner">
          <strong>MAINNET.</strong> Every transaction signed here is final and moves real funds.
        </div>
      )}
      {note && <p className="ad-warn">{note}</p>}
      {error && (
        <p className="ad-err" role="alert">
          {error}
        </p>
      )}
      <dl className="ad-kv ad-chainbar">
        <div>
          <dt className="mono">Chain</dt>
          <dd>{net.info ? `${net.info.name} (${net.info.id})` : 'none'}</dd>
        </div>
        <div>
          <dt className="mono">Server key</dt>
          <dd>
            <Addr value={net.serverKey} net={net} />
          </dd>
        </div>
        <div>
          <dt className="mono">Arena</dt>
          <dd>
            <Addr value={net.arenaAddress} net={net} /> {codes.arena && <span className={codes.arena === 'ok' ? 'ad-note' : 'ad-bad'}>code {codes.arena}</span>}
          </dd>
        </div>
        <div>
          <dt className="mono">NFT</dt>
          <dd>
            <Addr value={net.nftAddress} net={net} /> {codes.nft && <span className={codes.nft === 'ok' ? 'ad-note' : 'ad-bad'}>code {codes.nft}</span>}
          </dd>
        </div>
        <div>
          <dt className="mono">Read</dt>
          <dd>
            <button type="button" className="ad-btn" disabled={loading} onClick={() => void refresh()}>
              {loading ? 'Reading…' : 'Refresh'}
            </button>
          </dd>
        </div>
      </dl>

      {tab === 'launch' && <LaunchTab ctx={ctx} go={go} />}
      {tab === 'deploy' && <DeployTab ctx={ctx} />}
      {tab === 'mint' && <MintTab ctx={ctx} />}
      {tab === 'arena' && <ArenaTab ctx={ctx} />}

      {log.length > 0 && (
        <section className="ad-card" aria-labelledby="ad-log-h">
          <h2 className="ad-card__title" id="ad-log-h">
            Signed in this session
          </h2>
          <ol className="ad-log">
            {log.map((e) => (
              <li key={e.hash}>
                <span className="mono">{new Date(e.at).toLocaleTimeString('en-US')}</span> {e.label} ·{' '}
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    <code>{e.hash}</code>
                  </a>
                ) : (
                  <code>{e.hash}</code>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {plan && (
        <TxPreview
          plan={plan}
          net={net}
          me={me}
          client={client}
          blockers={blockers}
          onClose={() => setPlan(null)}
          onSigned={(entry) => {
            setLog((l) => [entry, ...l]);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

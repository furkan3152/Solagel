import { sameAddress } from '@elymum/sdk';
import { checkDeployedCode } from '@elymum/sdk/ops';
import { useEffect, useMemo, useState } from 'react';
import type { Address, PublicClient } from 'viem';
import { Button } from '../design';
import type { AdminApi } from '../site/api';
import { publicClientFor } from '../wallet/network';
import { useWallet } from '../wallet/store';
import type { ContractsRegistry, GameAccess, SiteSettings } from '@elymum/shared';
import { site } from '../site/api';
import { GameTab } from './GameTab';
import { groupSummary, type AdminGroup } from './groups';
import { LaunchTab, type ChecklistTab } from './LaunchTab';
import { MintTab } from './MintTab';
import { NetworkTab } from './NetworkTab';
import { SetupTab } from './SetupTab';
import { SummaryBar } from './SummaryBar';
import { chainBlockers, walletChainNote, type AdminNetwork } from './net';
import { readOwner, type Plan } from './plan';
import { TxPreview, type SignedEntry } from './TxPreview';
import { Addr, type ChainCtx } from './ui';
import { useAdminStatus } from './useAdminStatus';
import './admin.css';

export type ChainTab = Extract<AdminGroup, 'network' | 'setup' | 'mint' | 'game'>;

/** The runtime code hash check as a tiny verdict tag. */
function CodeTag({ code }: { code: string | null }) {
  if (!code) return null;
  const ok = code === 'ok';
  return (
    <span className={`ad-code mono${ok ? ' is-ok' : ' is-bad'}`} title={ok ? 'The runtime code hash matches the bundled contract' : `Code check: ${code}`}>
      {ok ? 'code hash ok' : `code ${code}`}
    </span>
  );
}

/**
 * The chain drawers of `/admin` (Launch, Deploy, Mint, Arena): the contracts' status for
 * everyone, and every owner operation, signed by the connected browser wallet. Every write
 * opens the transaction preview first; the contracts check every signer themselves.
 */
export function AdminPanel({
  net,
  api,
  tab,
  go,
  reloadNet,
  onRole,
}: {
  net: AdminNetwork;
  api: AdminApi | null;
  tab: ChainTab;
  go: (t: ChecklistTab | 'wl') => void;
  reloadNet: () => Promise<void>;
  /** Reports whether the connected wallet owns the registered contracts (the top bar's OWNER badge). */
  onRole?: (r: { arena: boolean | null; nft: boolean | null }) => void;
}) {
  const me = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const provider = useWallet((s) => s.current?.provider ?? null);
  const walletChainId = useWallet((s) => s.chainId);
  const client = useMemo<PublicClient | null>(() => (net.chain ? publicClientFor(net.chain, provider) : null), [net.chain, provider]);
  // the registered contracts (the TestToken is kind `token`: its faucet and minters are read too)
  const [registry, setRegistry] = useState<ContractsRegistry | null>(null);
  useEffect(() => {
    let live = true;
    site.contracts().then(
      (r) => live && setRegistry(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [net]);
  const testToken = !net.mainnet ? ((registry?.token?.address as Address | undefined) ?? null) : null;
  const { status, error, loading, refresh } = useAdminStatus(client, net, me, testToken);
  // the server's game switches, for the drawer's opening lines
  const [access, setAccess] = useState<{ settings: SiteSettings; env: GameAccess | null } | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    api.settings().then(
      (r) => live && setAccess({ settings: r.settings, env: r.gameAccessEnv ?? null }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, tab]);
  const summary = groupSummary(tab, { net, status, registry, settings: access?.settings ?? null, gameAccessEnv: access?.env ?? null });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [log, setLog] = useState<SignedEntry[]>([]);
  const [codes, setCodes] = useState<{ arena: string | null; nft: string | null }>({ arena: null, nft: null });
  const [nftOwner, setNftOwner] = useState<Address | null>(null);
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
    if (net.nftAddress) readOwner(client, net.nftAddress).then((o) => live && setNftOwner(o), () => {});
    return () => {
      live = false;
    };
  }, [client, net.arenaAddress, net.nftAddress, status]);

  const arenaAdmin = status?.arena?.config?.admin ?? null;
  const arenaRole = !me || !net.arenaAddress || !arenaAdmin ? null : sameAddress(arenaAdmin, me);
  const nftRole = !me || !net.nftAddress || !nftOwner ? null : sameAddress(nftOwner, me);
  useEffect(() => onRole?.({ arena: arenaRole, nft: nftRole }), [onRole, arenaRole, nftRole]);

  const ctx: ChainCtx = { net, status, refresh, reloadNet, me, walletChainId, client, api, open: setPlan, registry };

  return (
    <div className="ad-chain" aria-busy={loading}>
      <SummaryBar summary={summary} />
      {net.mainnet && (
        <div className="ad-mainnet" role="alert" data-testid="mainnet-banner">
          <strong>MAINNET.</strong> Every transaction signed here is final and moves real funds.
        </div>
      )}
      {blockers.length > 0 && (
        <div className="ad-blocked" role="alert">
          <strong>SIGNING BLOCKED.</strong>
          {blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </div>
      )}
      {note && <p className="ad-warn">{note}</p>}
      {error && !net.fake && (
        <p className="ad-err" role="alert">
          {error}
        </p>
      )}
      <section className="ad-chainbar" aria-label="Registered contracts">
        <dl className="ad-chainbar__list">
          <div>
            <dt className="mono">Chain</dt>
            <dd className="ad-chainbar__chain">{net.info ? `${net.info.name} (${net.info.id})` : 'none'}</dd>
          </div>
          <div>
            <dt className="mono">ElymumArena</dt>
            <dd>
              <Addr value={net.arenaAddress} net={net} /> <CodeTag code={codes.arena} />
            </dd>
          </div>
          <div>
            <dt className="mono">ElymumNFT</dt>
            <dd>
              <Addr value={net.nftAddress} net={net} /> <CodeTag code={codes.nft} />
            </dd>
          </div>
          <div>
            <dt className="mono">Server key</dt>
            <dd>
              <Addr value={net.serverKey} net={net} />
            </dd>
          </div>
        </dl>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()} className="ad-chainbar__refresh">
          {loading ? 'Reading…' : 'Re-read the chain'}
        </Button>
      </section>

      {tab === 'network' && (
        <>
          <NetworkTab ctx={ctx} registry={registry} />
          <LaunchTab ctx={ctx} go={go} />
        </>
      )}
      {tab === 'setup' && <SetupTab ctx={ctx} />}
      {tab === 'mint' && <MintTab ctx={ctx} />}
      {tab === 'game' && <GameTab ctx={ctx} />}

      {log.length > 0 && (
        <section className="ad-card ad-logcard" aria-labelledby="ad-log-h">
          <header className="ad-card__head">
            <h2 className="ad-card__title" id="ad-log-h">
              Signed in this session
            </h2>
          </header>
          <ol className="ad-log">
            {log.map((e) => (
              <li key={e.hash}>
                <span className="ad-log__time num">{new Date(e.at).toLocaleTimeString('en-US', { hour12: false })}</span>
                <span className="ad-log__label">{e.label}</span>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="ad-log__hash">
                    <code>{e.hash}</code>
                  </a>
                ) : (
                  <code className="ad-log__hash">{e.hash}</code>
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

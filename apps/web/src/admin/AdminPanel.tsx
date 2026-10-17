import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SlanaClient, explorerAddressUrl, type ConfigView } from '@slana/sdk';
import { arenaName, fmtPct, fmtSol, fmtTok, tokenProgramName, type StatusSnapshot } from '@slana/sdk/ops';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Chip, InkButton, Rule, Stamp } from '../design';
import { CreateArenas, InitForm, PauseControl, RecreateFeeAta, SetTokenForm, SweepArena, UpdateArena, UpdateConfig, type ActionCtx } from './actions';
import { isMainnet, verifyNetwork, type AdminNetwork, type NetworkCheck } from './net';
import { Review, type LogEntry, type Plan } from './Review';
import { useAdminStatus } from './useAdminStatus';
import './admin.css';

export type Role = 'admin' | 'upgrade-authority' | 'read-only' | 'disconnected';

/** Who the connected wallet is to the program. UX only: the program checks every signer itself. */
export function roleOf(wallet: string | null, status: StatusSnapshot | null): Role {
  if (!wallet) return 'disconnected';
  if (!status?.deployed) return 'read-only';
  if (status.config) return status.config.admin === wallet ? 'admin' : 'read-only';
  return status.upgradeAuthority === wallet ? 'upgrade-authority' : 'read-only';
}

function Addr({ value, net }: { value: string; net: AdminNetwork }) {
  return (
    <a className="ad-addr" href={explorerAddressUrl(value, net.cluster, net.rpcUrl)} target="_blank" rel="noreferrer">
      <code>{value}</code>
    </a>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mono">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function WalletBox() {
  const { wallets, select, publicKey, connected, connecting, disconnect, wallet } = useWallet();
  if (connected && publicKey) {
    return (
      <div className="ad-wallet">
        <span className="mono ad-cap">Connected · {wallet?.adapter.name ?? 'wallet'}</span>
        <code className="ad-wallet__addr">{publicKey.toBase58()}</code>
        <InkButton variant="paper" size="sm" onClick={() => void disconnect()}>
          Disconnect
        </InkButton>
      </div>
    );
  }
  const listed = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  return (
    <div className="ad-wallet">
      <span className="mono ad-cap">{connecting ? 'Connecting…' : 'Connect a wallet'}</span>
      {listed.length === 0 ? (
        <p className="ad-note">No wallet found. Install Phantom or Solflare (a Ledger works through either).</p>
      ) : (
        <div className="ad-chips">
          {listed.map((w) => (
            <InkButton key={w.adapter.name} variant="ink" size="sm" lead="wallet" disabled={connecting} onClick={() => select(w.adapter.name)}>
              {w.adapter.name}
            </InkButton>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusCard({
  status,
  check,
  genesis,
  loading,
  error,
  onRefresh,
}: {
  status: StatusSnapshot | null;
  check: NetworkCheck;
  genesis: string | null | undefined;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const net = check.net;
  const c = status?.config ?? null;
  const d = c?.tokenDecimals ?? 0;
  const sym = status?.mint?.symbol ? ` ${status.mint.symbol}` : '';
  return (
    <section className="ad-card ad-status-card" aria-labelledby="ad-status-h" aria-busy={loading}>
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-status-h">
          Status
        </h2>
        <InkButton variant="paper" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? 'Reading…' : 'Refresh'}
        </InkButton>
      </div>
      {error && (
        <p className="ad-err" role="alert">
          {error}
        </p>
      )}
      {net.fake && <p className="ad-warn">The game server runs the DEV_FAKE_CHAIN stand-in: there is no real program to administer.</p>}
      <dl className="ad-kv">
        <Row label="Pinned program id">
          <strong className="ad-pinned">
            <Addr value={net.programId} net={net} />
          </strong>{' '}
          <span className="ad-note">compiled into this build</span>
        </Row>
        <Row label="Server reports">
          {net.serverProgramId === null ? (
            <span className="ad-note">no program id (game server unreachable or chain off)</span>
          ) : net.serverProgramId === net.programId ? (
            <Chip tone="teal">same program id</Chip>
          ) : (
            <span className="ad-bad">MISMATCH: {net.serverProgramId}</span>
          )}
        </Row>
        <Row label="Cluster">
          {check.verified ? (
            <>
              {net.cluster} <span className="ad-note">(from the genesis hash{genesis ? ` ${genesis}` : ''})</span>
            </>
          ) : genesis === undefined ? (
            'checking…'
          ) : (
            <span className="ad-bad">unverified</span>
          )}
          {net.claimedCluster && <span className="ad-note"> · claimed: {net.claimedCluster}</span>}
        </Row>
        <Row label="RPC">
          <code>{net.rpcUrl}</code> <span className="ad-note">({net.source === 'env' ? 'build settings' : net.source === 'server' ? 'from the game server' : 'default'})</span>
        </Row>
        <Row label="Program">{status ? status.deployed ? <Chip tone="teal">deployed</Chip> : <Chip tone="pink">not deployed</Chip> : '…'}</Row>
        {status?.deployed && <Row label="Upgrade authority">{status.upgradeAuthority ? <Addr value={status.upgradeAuthority} net={net} /> : 'none (immutable or unreadable)'}</Row>}
        {status?.deployed && <Row label="Config">{c ? <><Chip tone="teal">initialized</Chip> <Addr value={status.configAddress} net={net} /></> : <Chip tone="mustard">not initialized</Chip>}</Row>}
        {c && (
          <>
            <Row label="Admin">
              <Addr value={c.admin} net={net} />
            </Row>
            <Row label="Server authority">
              <Addr value={c.serverAuthority} net={net} />
              {status?.serverBalance !== undefined && <span className="ad-note"> balance {fmtSol(status.serverBalance)}</span>}
              {net.serverKey && net.serverKey !== c.serverAuthority && <span className="ad-bad"> not this server's key ({net.serverKey})</span>}
            </Row>
            <Row label="Fee wallet">
              <Addr value={c.feeWallet} net={net} />
            </Row>
            <Row label="Fee">
              {c.feeBps} bps ({fmtPct(c.feeBps)} of profit)
            </Row>
            <Row label="Settle fee">
              {c.settleFeeLamports.toLocaleString('en-US')} lamports ({fmtSol(c.settleFeeLamports)}) per session
            </Row>
            <Row label="Paused">{c.paused ? <Chip tone="pink">PAUSED: arena joins blocked</Chip> : 'no'}</Row>
            <Row label="Token">
              {c.tokenMint === null ? (
                <Chip tone="mustard">not set</Chip>
              ) : (
                <>
                  <Addr value={c.tokenMint} net={net} /> · {tokenProgramName(c.tokenProgram)} · {d} decimals{sym ? ` ·${sym}` : ''}
                </>
              )}
            </Row>
            {c.tokenMint !== null && (
              <Row label="Supply">{status?.mint ? `${fmtTok(status.mint.supply, d)}${sym} (${status.mint.supply} base units)` : <span className="ad-bad">mint account not readable</span>}</Row>
            )}
            {status?.feeWalletToken && (
              <Row label="Fee wallet token account">
                <Addr value={status.feeWalletToken} net={net} />{' '}
                {status.feeWalletBalance === null || status.feeWalletBalance === undefined ? (
                  <span className="ad-bad">missing: settlements are held</span>
                ) : (
                  <span>
                    exists · {fmtTok(status.feeWalletBalance, d)}
                    {sym}
                  </span>
                )}
              </Row>
            )}
          </>
        )}
      </dl>
      {c && <ArenaTable arenas={status?.arenas ?? []} decimals={d} sym={sym} tokenSet={c.tokenMint !== null} />}
    </section>
  );
}

function ArenaTable({ arenas, decimals, sym, tokenSet }: { arenas: NonNullable<StatusSnapshot['arenas']>; decimals: number; sym: string; tokenSet: boolean }) {
  if (arenas.length === 0) return <p className="ad-note">Arenas: none{tokenSet ? '' : ' (set the token first)'}.</p>;
  return (
    <div className="ad-tablewrap">
      <table className="ad-table">
        <caption className="mono">Arenas</caption>
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Entry fee</th>
            <th scope="col">Enabled</th>
            <th scope="col">Open sessions</th>
            <th scope="col">Vault</th>
          </tr>
        </thead>
        <tbody>
          {arenas.map((a) => (
            <tr key={a.id}>
              <td>
                #{a.id} {arenaName(a.id)}
              </td>
              <td>
                {fmtTok(a.entryFee, decimals)}
                {sym}
              </td>
              <td>{a.enabled ? 'yes' : <strong>DISABLED</strong>}</td>
              <td>
                {a.openSessions} / {a.maxSessions}
              </td>
              <td>
                {fmtTok(a.pot, decimals)}
                {sym}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gate({ role, status }: { role: Role; status: StatusSnapshot | null }) {
  if (role === 'admin' || role === 'upgrade-authority') return null;
  const expected = status?.config ? status.config.admin : (status?.upgradeAuthority ?? null);
  return (
    <section className="ad-gate" role="status" aria-labelledby="ad-gate-h">
      <h2 id="ad-gate-h" className="ad-gate__title">
        Connect the admin wallet
      </h2>
      <p>
        {role === 'disconnected' ? 'No wallet is connected. ' : 'The connected wallet is not '}
        {role === 'disconnected' ? 'The status below is read-only.' : status?.config ? 'the config admin, so the panel is read-only.' : "the program's upgrade authority, which alone can initialize it, so the panel is read-only."}
      </p>
      {expected && (
        <p>
          Expected: <code>{expected}</code>
        </p>
      )}
      {status && !status.deployed && <p>The program is not deployed on this cluster; deploy it first (docs/DEPLOY.md, section 3).</p>}
      {status?.deployed && !status.config && !status.upgradeAuthority && <p>The program has no upgrade authority, so nobody can initialize it.</p>}
    </section>
  );
}

/**
 * The admin panel at `/admin`: the program's status for everyone, and every admin operation of
 * `pnpm admin` for the config admin (or, before `initialize`, the upgrade authority), signed by
 * the connected browser wallet. Each action shows the decoded instructions before the wallet prompt.
 */
export function AdminPanel({ net: claimed, embedded = false }: { net: AdminNetwork; embedded?: boolean }) {
  const { connection } = useConnection();
  const [genesis, setGenesis] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setGenesis(undefined);
    connection.getGenesisHash().then(
      (g) => live && setGenesis(g),
      () => live && setGenesis(null),
    );
    return () => {
      live = false;
    };
  }, [connection]);
  const check = useMemo(() => verifyNetwork(claimed, genesis), [claimed, genesis]);
  const net = check.net;
  const hardBlockers = check.blockers.filter((b) => !b.startsWith('Checking'));
  const wallet = useWallet();
  const client = useMemo(() => new SlanaClient(connection, net.programId), [connection, net.programId]);
  const { status, error, loading, refresh } = useAdminStatus(client, net);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const me = wallet.connected && wallet.publicKey ? wallet.publicKey.toBase58() : null;
  const role = roleOf(me, status);

  const ctx: ActionCtx | null = status && wallet.publicKey && (role === 'admin' || role === 'upgrade-authority') ? { client, connection, signer: wallet.publicKey, status, net, open: setPlan } : null;
  const config: ConfigView | null = status?.config ?? null;

  return (
    <div className={embedded ? 'ad-embedded' : 'ad-page'}>
      {hardBlockers.length > 0 && (
        <div className="ad-blocked" role="alert">
          <strong>SIGNING BLOCKED.</strong>
          {hardBlockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </div>
      )}
      {check.verified && isMainnet(net) && (
        <div className="ad-mainnet" role="alert">
          <strong>MAINNET.</strong> Every transaction signed here is final and moves real funds.
        </div>
      )}
      <header className="ad-head">
        <div>
          <span className="mono ad-kicker">Slana · operator copy</span>
          {embedded ? <h2 className="ad-title">Chain</h2> : <h1 className="ad-title">Admin panel</h1>}
          <p className="ad-deck">The operations of the admin CLI (pnpm admin), signed by your browser wallet (Phantom, Solflare, or a Ledger through either). The program checks every signer itself.</p>
        </div>
        <Stamp text={check.verified ? net.cluster : 'unverified'} sub="cluster" tone={check.verified && isMainnet(net) ? 'red' : check.verified ? 'teal' : 'mustard'} round size="md" rotate={-6} />
      </header>
      <Rule variant="double" />
      {!embedded && <WalletBox />}
      <Gate role={role} status={status} />
      <StatusCard status={status} check={check} genesis={genesis} loading={loading} error={error} onRefresh={() => void refresh()} />

      {ctx && (
        <div className="ad-grid">
          {!config && <InitForm ctx={ctx} />}
          {config && config.tokenMint === null && <SetTokenForm ctx={ctx} config={config} />}
          {config && config.tokenMint !== null && <CreateArenas ctx={ctx} config={config} />}
          {config && config.tokenMint !== null && <UpdateArena ctx={ctx} config={config} />}
          {config && <UpdateConfig key={JSON.stringify([config.feeBps, config.settleFeeLamports, config.serverAuthority, config.feeWallet, config.admin])} ctx={ctx} config={config} />}
          {config && <PauseControl ctx={ctx} config={config} />}
          {config && config.tokenMint !== null && <RecreateFeeAta ctx={ctx} config={config} />}
          {config && config.tokenMint !== null && <SweepArena ctx={ctx} config={config} />}
        </div>
      )}

      {log.length > 0 && (
        <section className="ad-card" aria-labelledby="ad-log-h">
          <h2 className="ad-card__title" id="ad-log-h">
            Signed in this session
          </h2>
          <ol className="ad-log">
            {log.map((e) => (
              <li key={e.signature}>
                <span className="mono">{new Date(e.at).toLocaleTimeString('en-US')}</span> {e.label} ·{' '}
                <a href={e.url} target="_blank" rel="noreferrer">
                  <code>{e.signature}</code>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {plan && wallet.publicKey && (
        <Review
          plan={plan}
          client={client}
          connection={connection}
          wallet={wallet}
          net={net}
          blockers={check.blockers}
          onClose={() => setPlan(null)}
          onDone={(entry) => {
            setLog((l) => [entry, ...l]);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Address, Hash, PublicClient, TransactionReceipt } from 'viem';
import { explorerAddressUrl, explorerTxUrl } from '@elymum/shared';
import { Button, Stamp, StatusPill } from '../design';
import { sendWithWallet, txErrorText, type TxPhase } from '../wallet/tx';
import type { AdminNetwork } from './net';
import { planRefusals, previewOf, readOwner, sendPlan, type Plan, type PlanResult } from './plan';
import { CopyButton } from './ui';

export interface SignedEntry {
  at: number;
  label: string;
  hash: Hash;
  url: string | null;
}

/**
 * `error.unsettled`: a transaction WAS broadcast (`hash`) but its outcome is unknown (no receipt yet, the
 * RPC timed out): it may still land, so the only action is "Check status" on that hash, never a resend.
 */
type State =
  | { kind: 'review' }
  | { kind: 'busy'; phase: 'checking' | TxPhase; hash?: Hash }
  | { kind: 'done'; result: PlanResult; afterError: string | null }
  | { kind: 'error'; message: string; hash: Hash | null; unsettled?: boolean };

/** How long one "Check status" waits for the receipt of an already broadcast transaction. */
const STATUS_TIMEOUT_MS = 60_000;

/** The four stations a send passes, drawn as a dotted track. */
const STATIONS = [
  { id: 'checking', label: 'Owner check' },
  { id: 'switching', label: 'Chain' },
  { id: 'signing', label: 'Your wallet' },
  { id: 'confirming', label: 'Receipt' },
] as const;

function stationIndex(s: State): number {
  if (s.kind === 'done') return STATIONS.length;
  if (s.kind !== 'busy') return -1;
  return STATIONS.findIndex((x) => x.id === s.phase);
}

/** A hash or an address, in full, linked to the explorer when there is one. */
function Hex({ value, href }: { value: string; href: string | null }) {
  return (
    <span className="ad-addr">
      {href ? (
        <a className="ad-addr__link" href={href} target="_blank" rel="noreferrer">
          <code className="ad-addr__v">{value}</code>
        </a>
      ) : (
        <code className="ad-addr__v">{value}</code>
      )}
      <CopyButton value={value} label="Copy" />
    </span>
  );
}

/**
 * The step before every wallet prompt of the admin panel: the call (function, arguments with
 * names, types and values, the HYPE value), the network and the signer. The wallet only opens
 * from here, after the chain check (the server's chain is known and the RPC agrees; the wallet is
 * switched to it) and the owner check (the contract's `owner()` re-read right now). A ref guard
 * makes a double click (or a held Enter) send once. Drawn as the design system's `kb-tx`
 * sticker (see `design/components/TxPreview`), with the admin's refusals, typed confirmation
 * and send stations on top.
 */
export function TxPreview({
  plan,
  net,
  me,
  client,
  blockers,
  onClose,
  onSigned,
}: {
  plan: Plan;
  net: AdminNetwork;
  me: Address | null;
  client: PublicClient | null;
  blockers: readonly string[];
  onClose: () => void;
  onSigned?: (e: SignedEntry) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'review' });
  const [typed, setTyped] = useState('');
  const inFlight = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    inFlight.current = false;
    setState({ kind: 'review' });
    setTyped('');
  }, [plan]);

  const p = previewOf(plan);
  const refusals = planRefusals(plan, { me, blockers });
  const needsText = !!plan.confirmText && typed.trim() !== plan.confirmText;
  const busy = state.kind === 'busy';
  const explorer = net.info?.explorerUrl ?? null;
  const at = stationIndex(state);

  // focus the dialog on open; Esc closes it unless a send is under way
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight.current) onClose();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const confirm = async () => {
    if (inFlight.current || refusals.length > 0 || needsText || !net.chain || !me) return;
    inFlight.current = true;
    setState({ kind: 'busy', phase: 'checking' });
    // the owner as it is right now, not as the status card read it
    if (plan.ownerOf) {
      if (!client) {
        inFlight.current = false;
        return setState({ kind: 'error', message: 'Cannot read the contract owner: no RPC.', hash: null });
      }
      try {
        const owner = await readOwner(client, plan.ownerOf);
        const again = planRefusals({ ...plan, owner }, { me, blockers });
        if (again.length > 0) {
          inFlight.current = false;
          return setState({ kind: 'error', message: again.join(' '), hash: null });
        }
      } catch (err) {
        inFlight.current = false;
        return setState({ kind: 'error', message: `Cannot read the contract owner: ${(err as Error).message.split('\n')[0]}`, hash: null });
      }
    }
    const res = await sendWithWallet((wallet, from) => sendPlan(plan, wallet, from), {
      chain: net.chain,
      publicClient: client,
      onPhase: (phase, hash) => setState({ kind: 'busy', phase, hash }),
    });
    if (!res.ok) {
      inFlight.current = false;
      // broadcast but no final receipt (a reverted receipt is final): never offer a resend for it
      const unsettled = res.hash !== null && res.error.kind !== 'revert';
      return setState({ kind: 'error', message: txErrorText(res.error), hash: res.hash, unsettled });
    }
    await finish(res.hash, res.receipt);
  };

  /** Polls the receipt of the transaction already broadcast (`state.hash`); nothing is sent again. */
  const checkStatus = async () => {
    if (inFlight.current || state.kind !== 'error' || !state.hash || !state.unsettled) return;
    const hash = state.hash;
    if (!client) return setState({ kind: 'error', message: 'Cannot check the transaction: no RPC.', hash, unsettled: true });
    inFlight.current = true;
    setState({ kind: 'busy', phase: 'confirming', hash });
    let receipt: TransactionReceipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: STATUS_TIMEOUT_MS });
    } catch (err) {
      inFlight.current = false;
      const why = (err as Error).message?.split('\n')[0] ?? String(err);
      return setState({ kind: 'error', message: `Still no receipt for this transaction (${why}). It may still land: check again, or look it up in the explorer.`, hash, unsettled: true });
    }
    if (receipt.status !== 'success') {
      inFlight.current = false;
      return setState({ kind: 'error', message: 'The transaction was refused by the contract.', hash, unsettled: false });
    }
    await finish(hash, receipt);
  };

  const finish = async (hash: Hash, receipt: TransactionReceipt) => {
    const result: PlanResult = { hash, receipt, address: receipt.contractAddress ?? null };
    onSigned?.({ at: Date.now(), label: plan.title, hash, url: explorerTxUrl(explorer, hash) });
    let afterError: string | null = null;
    try {
      await plan.onDone?.(result);
    } catch (err) {
      afterError = (err as Error).message || String(err);
    }
    setState({ kind: 'done', result, afterError });
  };

  const sigName = p.signature.replace(/\(.*$/, '');
  const sigArgs = p.signature.slice(sigName.length);

  return (
    <div className="kb-sheet-layer ad-txp" role="presentation">
      <div className="kb-sheet-scrim" aria-hidden="true" onClick={() => !inFlight.current && onClose()} />
      <div
        ref={box}
        tabIndex={-1}
        className={`kb-tx ad-txp__box${net.mainnet ? ' is-mainnet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-txp-h"
        data-testid="tx-preview"
      >
        <header className="kb-tx__head">
          <div>
            <div className="kb-tx__kicker">
              {plan.deploy ? 'Deploy preview' : 'Transaction preview'} · {state.kind === 'done' ? 'signed and confirmed' : state.kind === 'busy' ? 'on its way' : 'nothing is sent yet'}
            </div>
            <h2 className="kb-tx__title" id="ad-txp-h">
              {plan.title}
            </h2>
          </div>
          <StatusPill tone={net.mainnet ? 'mainnet' : 'testnet'} size="sm">
            {net.mainnet ? 'Mainnet' : net.info?.name ?? 'No chain'}
          </StatusPill>
        </header>
        {net.mainnet && (
          <p className="ad-mainnet ad-mainnet--inline" role="alert">
            <strong>MAINNET.</strong> This transaction is final and moves real funds.
          </p>
        )}
        <div className="kb-tx__sig">
          {p.to ? (
            <>
              <span className="kb-tx__contract">{plan.contract}.</span>
              <span className="kb-tx__fn">{sigName}</span>
              <span className="ad-txp__params">{sigArgs}</span>
            </>
          ) : (
            <>
              <span className="kb-tx__contract">new {plan.deploy?.name} · </span>
              <span className="kb-tx__fn">{sigName}</span>
              <span className="ad-txp__params">{sigArgs}</span>
            </>
          )}
        </div>
        <div className="ad-txp__scroll">
          <table className="kb-tx__args">
            <thead>
              <tr>
                <th scope="col">Argument</th>
                <th scope="col">Type</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {p.args.length === 0 && (
                <tr>
                  <td colSpan={3} className="kb-tx__none">
                    No arguments. The name says it all.
                  </td>
                </tr>
              )}
              {p.args.map((a) => (
                <tr key={a.name}>
                  <th scope="row">{a.name}</th>
                  <td className="kb-tx__type">{a.type}</td>
                  <td className="kb-tx__val">
                    <code className="ad-txp__val">{a.value}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="kb-tx__meta ad-txp__meta">
          <div>
            <dt>Value</dt>
            <dd className="num">{p.valueText ?? '0 HYPE'}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{net.info ? `${net.info.name} (${net.info.id})` : 'unknown'}</dd>
          </div>
          <div>
            <dt>{p.to ? 'To' : 'Creates'}</dt>
            <dd>{p.to ? <code className="ad-txp__mono">{p.to}</code> : <span>a new contract, owned by you</span>}</dd>
          </div>
          <div className="ad-txp__from">
            <dt>From</dt>
            <dd>{me ? <code className="ad-txp__mono">{me}</code> : 'no wallet'}</dd>
          </div>
        </dl>
        {plan.note && <div className="kb-tx__note">{plan.note}</div>}
        {refusals.length > 0 && (
          <ul className="ad-txp__refusals" role="alert" data-testid="tx-refusals">
            {refusals.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {plan.confirmText && state.kind === 'review' && (
          <div className="ad-field ad-txp__confirm">
            <label className="ad-field__label mono" htmlFor="ad-txp-typed">
              Type {plan.confirmText} to confirm
            </label>
            <span className="ad-field__box">
              <input id="ad-txp-typed" className="ad-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </span>
          </div>
        )}

        {state.kind !== 'review' && state.kind !== 'error' && (
          <ol className="ad-stations" aria-label="Sending">
            {STATIONS.map((s, i) => (
              <li key={s.id} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
                <span className="ad-stations__dot" aria-hidden="true" />
                <span className="mono">{s.label}</span>
              </li>
            ))}
          </ol>
        )}
        {state.kind === 'busy' && (
          <p className="ad-txp__status" role="status" aria-live="polite">
            {state.phase === 'checking'
              ? 'Checking the owner on chain…'
              : state.phase === 'switching'
                ? `Switching your wallet to ${net.info?.name ?? 'the server’s chain'}…`
                : state.phase === 'signing'
                  ? 'Confirm in your wallet…'
                  : 'Sent. Waiting for the receipt…'}
            {state.hash && explorerTxUrl(explorer, state.hash) && (
              <>
                {' '}
                <a href={explorerTxUrl(explorer, state.hash)!} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </>
            )}
          </p>
        )}
        {state.kind === 'error' && (
          <p className="ad-bad ad-txp__error" role="alert" data-testid="tx-error">
            {state.message}
            {state.hash && (
              <>
                {' '}
                {state.unsettled ? 'It was sent: ' : ''}
                {explorerTxUrl(explorer, state.hash) ? (
                  <a href={explorerTxUrl(explorer, state.hash)!} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                ) : (
                  <code className="ad-txp__mono">{state.hash}</code>
                )}
              </>
            )}
          </p>
        )}
        {state.kind === 'done' && (
          <div className="ad-txp__done" role="status" data-testid="tx-done">
            <Stamp text="Signed" tone="up" animateIn rotate={-6} className="ad-txp__stamp" />
            <dl className="ad-txp__result">
              <div>
                <dt className="mono">Transaction</dt>
                <dd>
                  <Hex value={state.result.hash} href={explorerTxUrl(explorer, state.result.hash)} />
                </dd>
              </div>
              {state.result.address && (
                <div>
                  <dt className="mono">New contract</dt>
                  <dd>
                    <Hex value={state.result.address} href={explorerAddressUrl(explorer, state.result.address)} />
                  </dd>
                </div>
              )}
            </dl>
            {state.afterError && <p className="ad-bad">{state.afterError}</p>}
          </div>
        )}

        <div className="kb-tx__actions">
          {state.kind === 'done' ? (
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              {state.kind === 'error' && state.unsettled ? (
                // broadcast already: only look the hash up again (a resend could execute twice)
                <Button variant="primary" disabled={busy} loading={busy} onClick={() => void checkStatus()} data-testid="tx-check">
                  Check status
                </Button>
              ) : (
                <Button
                  variant={net.mainnet || plan.confirmText ? 'danger' : 'primary'}
                  lead="wallet"
                  disabled={busy || refusals.length > 0 || needsText}
                  loading={busy}
                  onClick={() => void confirm()}
                  data-testid="tx-confirm"
                >
                  {state.kind === 'error' ? 'Try again' : 'Open wallet'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

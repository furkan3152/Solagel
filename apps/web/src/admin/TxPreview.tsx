import { useEffect, useRef, useState } from 'react';
import type { Address, Hash, PublicClient } from 'viem';
import { explorerAddressUrl, explorerTxUrl } from '@elymum/shared';
import { sendWithWallet, txErrorText, type TxPhase } from '../wallet/tx';
import type { AdminNetwork } from './net';
import { planRefusals, previewOf, readOwner, sendPlan, type Plan, type PlanResult } from './plan';

export interface SignedEntry {
  at: number;
  label: string;
  hash: Hash;
  url: string | null;
}

type State = { kind: 'review' } | { kind: 'busy'; phase: 'checking' | TxPhase; hash?: Hash } | { kind: 'done'; result: PlanResult; afterError: string | null } | { kind: 'error'; message: string; hash: Hash | null };

/**
 * The step before every wallet prompt of the admin panel: the call (function, arguments with
 * names, types and values, the HYPE value), the network and the signer. The wallet only opens
 * from here, after the chain check (the server's chain is known and the RPC agrees; the wallet is
 * switched to it) and the owner check (the contract's `owner()` re-read right now). A ref guard
 * makes a double click (or a held Enter) send once. Markup is plain (`ad-txp*`); restyled later.
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
      return setState({ kind: 'error', message: txErrorText(res.error), hash: res.hash });
    }
    const result: PlanResult = { hash: res.hash, receipt: res.receipt, address: res.receipt.contractAddress ?? null };
    onSigned?.({ at: Date.now(), label: plan.title, hash: res.hash, url: explorerTxUrl(explorer, res.hash) });
    let afterError: string | null = null;
    try {
      await plan.onDone?.(result);
    } catch (err) {
      afterError = (err as Error).message || String(err);
    }
    setState({ kind: 'done', result, afterError });
  };

  return (
    <div className="ad-txp" role="dialog" aria-modal="true" aria-labelledby="ad-txp-h" data-testid="tx-preview">
      <div className="ad-txp__box">
        <h2 className="ad-txp__title" id="ad-txp-h">
          {plan.title}
        </h2>
        {net.mainnet && (
          <p className="ad-mainnet" role="alert">
            <strong>MAINNET.</strong> This transaction is final and moves real funds.
          </p>
        )}
        <p className="ad-txp__sig mono">
          <code>{p.signature}</code> {p.to ? <>on {plan.contract} <code>{p.to}</code></> : <>a new {plan.deploy?.name} contract</>}
        </p>
        {p.args.length > 0 ? (
          <table className="ad-table ad-txp__args">
            <thead>
              <tr>
                <th scope="col">Argument</th>
                <th scope="col">Type</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {p.args.map((a) => (
                <tr key={a.name}>
                  <td className="mono">{a.name}</td>
                  <td className="mono">{a.type}</td>
                  <td>
                    <code className="ad-txp__val">{a.value}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ad-note">No arguments.</p>
        )}
        <dl className="ad-kv ad-txp__meta">
          <div>
            <dt className="mono">Value</dt>
            <dd>{p.valueText ?? 'none'}</dd>
          </div>
          <div>
            <dt className="mono">Network</dt>
            <dd>{net.info ? `${net.info.name} (${net.info.id})` : 'unknown'}</dd>
          </div>
          <div>
            <dt className="mono">From</dt>
            <dd>{me ? <code>{me}</code> : 'no wallet'}</dd>
          </div>
        </dl>
        {plan.note && <p className="ad-warn">{plan.note}</p>}
        {refusals.length > 0 && (
          <ul className="ad-bad ad-txp__refusals" role="alert" data-testid="tx-refusals">
            {refusals.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {plan.confirmText && state.kind === 'review' && (
          <label className="ad-field">
            <span className="mono ad-cap">Type {plan.confirmText} to confirm</span>
            <input className="st-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}

        {state.kind === 'busy' && (
          <p className="ad-note" role="status" aria-live="polite">
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
          <p className="ad-bad" role="alert" data-testid="tx-error">
            {state.message}
          </p>
        )}
        {state.kind === 'done' && (
          <div className="ad-txp__done" role="status" data-testid="tx-done">
            <p>
              Confirmed.{' '}
              {explorerTxUrl(explorer, state.result.hash) ? (
                <a href={explorerTxUrl(explorer, state.result.hash)!} target="_blank" rel="noreferrer">
                  <code>{state.result.hash}</code>
                </a>
              ) : (
                <code>{state.result.hash}</code>
              )}
            </p>
            {state.result.address && (
              <p>
                New contract:{' '}
                {explorerAddressUrl(explorer, state.result.address) ? (
                  <a href={explorerAddressUrl(explorer, state.result.address)!} target="_blank" rel="noreferrer">
                    <code>{state.result.address}</code>
                  </a>
                ) : (
                  <code>{state.result.address}</code>
                )}
              </p>
            )}
            {state.afterError && <p className="ad-bad">{state.afterError}</p>}
          </div>
        )}

        <div className="ad-actions">
          {state.kind === 'done' ? (
            <button type="button" className="ad-btn ad-btn--primary" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="ad-btn ad-btn--primary" disabled={busy || refusals.length > 0 || needsText} onClick={() => void confirm()} data-testid="tx-confirm">
                {state.kind === 'error' ? 'Try again' : 'Open wallet'}
              </button>
              <button type="button" className="ad-btn" disabled={busy} onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

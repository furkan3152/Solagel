import { explorerTxUrl, type SlanaClient } from '@elymum/sdk';
import { describeInstruction } from '@elymum/sdk/ops';
import { ComputeBudgetProgram, type Connection, type TransactionInstruction } from '@solana/web3.js';
import { useRef, useState, type ReactNode } from 'react';
import { Field, InkButton, Sheet, StampSpinner } from '../design';
import { maxFeeLamports, type AdminNetwork } from './net';
import { previousOutcome, sendAdminTx, type AdminPhase, type AdminSigner, type SentTx } from './send';

/** One admin transaction, ready for the confirmation sheet. */
export interface Plan {
  /** Sheet title, e.g. "Initialize the program". */
  title: string;
  /** Human summary of the values (label, value). */
  summary: [string, ReactNode][];
  ixs: TransactionInstruction[];
  /** Shown above the instructions. */
  warning?: ReactNode;
  /** Typing this exact text is required before signing (the mint address for set-token). */
  retype?: { label: string; text: string };
  /** A checkbox the admin must tick before signing. */
  ack?: string;
  /** Line for the activity log on success. */
  done: string;
}

export interface LogEntry {
  at: number;
  label: string;
  signature: string;
  url: string;
}

type State =
  | { phase: 'review' }
  | { phase: AdminPhase | 'checking'; signature?: string }
  | { phase: 'done'; signature: string }
  | { phase: 'error'; message: string; logs: string[] };

const PHASE_TEXT: Record<AdminPhase | 'checking', string> = {
  checking: 'Checking what became of the previous transaction…',
  signing: 'Approve the transaction in your wallet…',
  sending: 'Sending (the RPC simulates it first)…',
  confirming: 'Waiting for confirmation…',
};

export function Review({
  plan,
  client,
  connection,
  wallet,
  net,
  blockers = [],
  onClose,
  onDone,
}: {
  plan: Plan;
  client: SlanaClient;
  connection: Connection;
  wallet: AdminSigner;
  net: AdminNetwork;
  /** Network problems that block signing (pinned program id, cluster check). */
  blockers?: string[];
  onClose: () => void;
  onDone: (entry: LogEntry) => void;
}) {
  const [state, setState] = useState<State>({ phase: 'review' });
  const [typed, setTyped] = useState('');
  const [acked, setAcked] = useState(false);
  // set synchronously on click, so a double click cannot start two signing flows
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  /** A signed transaction whose outcome is unknown: checked before anything is signed again. */
  const pending = useRef<SentTx | null>(null);
  const busy = submitting || state.phase === 'signing' || state.phase === 'sending' || state.phase === 'confirming' || state.phase === 'checking';
  const blocked = blockers.length > 0;
  const retypeOk = !plan.retype || typed.trim() === plan.retype.text;
  const ackOk = !plan.ack || acked;
  const preview = [
    ...(net.priorityMicroLamports > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: net.priorityMicroLamports })] : []),
    ...plan.ixs,
  ];
  const described = preview.map((ix) => describeInstruction(client, ix));

  const maxFee = maxFeeLamports(plan.ixs.length, net.priorityMicroLamports);

  const finish = (signature: string) => {
    pending.current = null;
    setState({ phase: 'done', signature });
    onDone({ at: Date.now(), label: plan.done, signature, url: explorerTxUrl(signature, net.cluster, net.rpcUrl) });
  };

  const run = async () => {
    const prev = pending.current;
    if (prev) {
      // the last attempt was signed but its outcome is unknown: never sign twice blindly
      setState({ phase: 'checking', signature: prev.signature });
      let outcome: Awaited<ReturnType<typeof previousOutcome>>;
      try {
        outcome = await previousOutcome(connection, prev);
      } catch (err) {
        setState({ phase: 'error', message: `Cannot check the previous transaction ${prev.signature}: ${(err as Error).message}. Try again in a moment.`, logs: [] });
        return;
      }
      if (outcome === 'landed') return finish(prev.signature);
      if (outcome === 'pending') {
        setState({ phase: 'error', message: `The previous transaction ${prev.signature} may still land. Wait about a minute, then check again.`, logs: [] });
        return;
      }
      pending.current = null; // failed on chain or expired: it can never land, signing again is safe
    }
    const res = await sendAdminTx(client, connection, wallet, plan.ixs, {
      priorityMicroLamports: net.priorityMicroLamports,
      onPhase: (phase, signature) => setState({ phase, signature }),
    });
    if (res.ok) return finish(res.signature);
    pending.current = res.sent;
    const text = `${res.error.message}${res.error.name ? ` [${res.error.name}${res.error.code !== null ? ` ${res.error.code}` : ''}]` : ''}`;
    setState({
      phase: 'error',
      message: res.sent ? `${text}. Outcome unknown for ${res.sent.signature}: "Check and retry" looks it up before anything is signed again.` : text,
      logs: res.logs,
    });
  };

  const sign = async () => {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const footer =
    state.phase === 'done' ? (
      <InkButton variant="ink" onClick={onClose}>
        Close
      </InkButton>
    ) : (
      <div className="ad-actions">
        <InkButton variant="paper" onClick={onClose} disabled={busy}>
          {state.phase === 'error' ? 'Close' : 'Cancel'}
        </InkButton>
        <InkButton variant="pink" lead="key" onClick={() => void sign()} disabled={busy || blocked || !retypeOk || !ackOk}>
          {state.phase === 'error' ? (pending.current ? 'Check and retry' : 'Try again') : 'Sign with wallet'}
        </InkButton>
      </div>
    );

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title={plan.title} kicker={`Review · ${net.cluster}`} closeLabel="Close" footer={footer} className="ad-sheet">
      <div className="ad-review">
        {blocked && (
          <div className="ad-err" role="alert">
            {blockers.map((b) => (
              <p key={b}>{b}</p>
            ))}
          </div>
        )}
        {plan.warning && <div className="ad-warn">{plan.warning}</div>}
        <section aria-label="Values">
          <h3 className="ad-h3">What changes</h3>
          <dl className="ad-kv">
            {plan.summary.map(([k, v]) => (
              <div key={k}>
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div>
              <dt className="mono">Fee payer and signer</dt>
              <dd>
                <code>{wallet.publicKey?.toBase58() ?? 'none'}</code>
              </dd>
            </div>
            <div>
              <dt className="mono">Priority fee</dt>
              <dd>
                {net.priorityMicroLamports.toLocaleString('en-US')} micro-lamports per compute unit · transaction fee at most {(maxFee / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 })} SOL
                ({maxFee.toLocaleString('en-US')} lamports)
              </dd>
            </div>
          </dl>
        </section>
        <section aria-label="Instructions">
          <h3 className="ad-h3">
            What will be signed: {described.length} instruction{described.length === 1 ? '' : 's'}, one transaction
          </h3>
          <ol className="ad-ixs">
            {described.map((d, i) => (
              <li key={i} className="ad-ix" data-testid="review-ix">
                <div className="ad-ix__head">
                  <span className="mono ad-ix__no">{i + 1}</span>
                  <strong>
                    {d.program} · {d.name}
                  </strong>
                  <code className="ad-ix__pid">{d.programId}</code>
                </div>
                {d.args.length > 0 && (
                  <dl className="ad-ix__args">
                    {d.args.map(([k, v]) => (
                      <div key={k}>
                        <dt className="mono">{k}</dt>
                        <dd>
                          <code>{v}</code>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {d.accounts.length > 0 && (
                  <table className="ad-ix__accts">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Address</th>
                        <th scope="col">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.accounts.map((a, j) => (
                        <tr key={j}>
                          <td className="mono">{a.name}</td>
                          <td>
                            <code>{a.address}</code>
                          </td>
                          <td className="mono">{[a.signer && 'signer', a.writable && 'writable'].filter(Boolean).join(', ') || 'read'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ol>
        </section>
        {plan.retype && state.phase !== 'done' && (
          <Field
            label={plan.retype.label}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            error={typed !== '' && !retypeOk ? 'Does not match. Type the address exactly.' : undefined}
            hint={retypeOk ? 'Matches.' : 'Signing stays blocked until it matches.'}
          />
        )}
        {plan.ack && state.phase !== 'done' && (
          <label className="ad-check">
            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
            <span>{plan.ack}</span>
          </label>
        )}
        <div aria-live="polite" className="ad-status">
          {busy && (
            <p className="ad-phase">
              <StampSpinner size="sm" /> {(PHASE_TEXT as Record<string, string>)[state.phase] ?? 'Preparing the transaction…'}
            </p>
          )}
          {state.phase === 'done' && (
            <p className="ad-ok">
              Confirmed. Signature{' '}
              <a href={explorerTxUrl(state.signature, net.cluster, net.rpcUrl)} target="_blank" rel="noreferrer">
                <code>{state.signature}</code>
              </a>
            </p>
          )}
          {state.phase === 'error' && (
            <div className="ad-err" role="alert">
              <p>Failed: {state.message}</p>
              {state.logs.length > 0 && (
                <details>
                  <summary>Program logs</summary>
                  <pre>{state.logs.join('\n')}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

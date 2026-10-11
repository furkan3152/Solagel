import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TransactionExpiredBlockheightExceededError, type Connection } from '@solana/web3.js';
import { MAX_FEE_BPS, TransactionFailedError, confirmSignature, describeError, explorerTxUrl } from '@solagel/sdk';
import bs58 from 'bs58';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { refreshChain, useChainData, useSolagelClient } from '../solana/chain';
import { SERVER } from '../config';
import { toast, useUi } from '../store';
import { formatAdminSol, prepareAdminAction, type AdminAction, type PreparedAdminAction } from './actions';
import { fetchAdminChain, verifyAdminNetwork, type AdminNetworkProof } from './network';
import { adminRecoveryKey, clearPendingAdmin, loadPendingAdmin, savePendingAdmin, type PendingAdminMetadata } from './recovery';

type ConfigDraft = Extract<AdminAction, { kind: 'config' }>;
type PendingTransaction = PendingAdminMetadata & { connection: Connection; href: string };

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return <div className="admin-field"><label htmlFor={id}>{label}</label>{children(id)}{hint && <small className="muted">{hint}</small>}</div>;
}

/** Wallet-signed program administration. Dedicated admin login is supplied by the parent panel. */
export function ChainAdmin() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSolagelClient();
  const data = useChainData();
  const chain = useUi((s) => s.chain);
  const actor = wallet.publicKey?.toBase58() ?? null;
  const clusterLabel = chain?.cluster.trim().toLowerCase() ?? '';
  const recoveryContext = { wallet: actor ?? '', programId: client?.programId.toBase58() ?? '', rpcUrl: connection.rpcEndpoint, cluster: clusterLabel === 'mainnet' ? 'mainnet-beta' : clusterLabel };
  const context = adminRecoveryKey(recoveryContext);
  const current = useRef({ context, wallet, client });
  current.current = { context, wallet, client };
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState<'review' | 'send' | 'check' | null>(null);
  const [review, setReview] = useState<{ context: string; prepared: PreparedAdminAction; network: AdminNetworkProof } | null>(null);
  const [pending, setPending] = useState<PendingTransaction | null>(null);
  const [recoveryReady, setRecoveryReady] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ message: string; href: string } | null>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);
  const [newArena, setNewArena] = useState({ id: '', buyInSol: '0.01', maxPlayers: '40' });
  const [arenaDraft, setArenaDraft] = useState({ id: '', enabled: true, maxPlayers: '40' });
  const [funding, setFunding] = useState('');
  const [oldSeason, setOldSeason] = useState('');
  const [reload, setReload] = useState(0);
  const config = data.config;
  const administrator = !!actor && config?.admin === actor;
  const locked = !!busy || !!pending || recoveryReady !== context;
  const selectedArena = data.arenas.find((a) => String(a.id) === arenaDraft.id);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setReview(null);
    setError('');
    setConfigDraft(null);
  }, [context]);

  useEffect(() => {
    setRecoveryReady('');
    try {
      const saved = actor && client && recoveryContext.cluster ? loadPendingAdmin(sessionStorage, recoveryContext) : null;
      // Connection and explorer destinations come from the current verified
      // context, never from an arbitrary URL in browser storage.
      setPending(saved ? { ...saved, connection, href: explorerTxUrl(saved.signature, recoveryContext.cluster, connection.rpcEndpoint) } : null);
      setRecoveryReady(context);
    } catch (err) {
      setError(`Transaction recovery is unavailable. ${describeError(err).message}`);
    }
  }, [context, connection, reload]);

  useEffect(() => {
    let active = true;
    if (client && actor) {
      void client.fetchConfig().then((fresh) => {
        if (!active || !fresh || current.current.context !== context) return;
        setConfigDraft({ kind: 'config', paused: fresh.paused, feeBps: String(fresh.feeBps), seasonShareBps: String(fresh.seasonShareBps), treasury: fresh.treasury, serverAuthority: fresh.serverAuthority });
      }).catch((err) => { if (active) setError(describeError(err).message); });
    }
    return () => { active = false; };
  }, [client, actor, context, reload]);

  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);

  const assertContext = (expected: string) => {
    if (!mounted.current || current.current.context !== expected || !current.current.wallet.connected || !current.current.wallet.publicKey) {
      throw new Error('The wallet, program or network changed. Review the action again with the intended administrator.');
    }
  };

  const prepare = async (action: AdminAction) => {
    if (busyRef.current || pending || recoveryReady !== context || !client || !actor) return;
    busyRef.current = true;
    setBusy('review');
    setError('');
    setResult(null);
    setReview(null);
    const expected = context;
    try {
      assertContext(expected);
      if (!current.current.wallet.signTransaction) throw new Error('This wallet cannot sign a transaction separately. Connect a wallet with transaction signing support to use on-chain controls.');
      const advertised = await fetchAdminChain(SERVER.http);
      const network = await verifyAdminNetwork(client, advertised);
      assertContext(expected);
      if (network.cluster !== recoveryContext.cluster) throw new Error('The server network changed. Refresh this page before preparing a transaction.');
      const prepared = await prepareAdminAction(client, actor, action);
      assertContext(expected);
      setReview({ context: expected, prepared, network });
    } catch (err) {
      if (mounted.current) setError(describeError(err).message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const resolveTransaction = async (transaction: PendingTransaction) => {
    const appliesHere = () => mounted.current && current.current.context === adminRecoveryKey(transaction);
    try {
      await confirmSignature(transaction.connection, transaction.signature, transaction.lastValidBlockHeight, { timeoutMs: 30_000 });
      clearPendingAdmin(sessionStorage, transaction, transaction.signature);
      if (appliesHere()) {
        setPending(null);
        setError('');
        setResult({ message: `${transaction.title} confirmed.`, href: transaction.href });
      }
      refreshChain();
    } catch (err) {
      if (err instanceof TransactionFailedError || err instanceof TransactionExpiredBlockheightExceededError) {
        try {
          clearPendingAdmin(sessionStorage, transaction, transaction.signature);
          if (appliesHere()) { setPending(null); setError(`Transaction did not complete: ${describeError(err).message}`); }
        } catch {
          if (appliesHere()) setError('The transaction is resolved, but its recovery record could not be cleared. Enable session storage and check again.');
        }
      } else if (appliesHere()) {
        setError('Transaction submitted; confirmation is not available yet. Check its status before submitting another administration transaction.');
      }
    }
  };

  const confirm = async () => {
    if (busyRef.current || pending || recoveryReady !== context || !review || !client || !actor) return;
    busyRef.current = true;
    setBusy('send');
    setError('');
    let submitted: PendingTransaction | null = null;
    try {
      assertContext(review.context);
      const advertised = await fetchAdminChain(SERVER.http);
      const network = await verifyAdminNetwork(client, advertised);
      assertContext(review.context);
      if (network.fingerprint !== review.network.fingerprint) throw new Error('The verified network changed. Cancel this review and prepare the action again.');
      // Permissions and money destinations are read again immediately before
      // building. Changed review details require another explicit confirmation.
      const fresh = await prepareAdminAction(client, actor, review.prepared.action);
      assertContext(review.context);
      if (fresh.fingerprint !== review.prepared.fingerprint) {
        setReview({ context: review.context, prepared: fresh, network });
        setError('On-chain values changed. Review the updated details before continuing.');
        return;
      }
      const signer = current.current.wallet;
      if (!signer.signTransaction) throw new Error('Connect a wallet that supports signing transactions separately.');
      const { tx, lastValidBlockHeight } = await client.buildTransaction([fresh.instruction], signer.publicKey!, { priorityMicroLamports: 20_000 });
      assertContext(review.context);
      const reviewedMessage = tx.serializeMessage();
      // Signing and broadcasting are separate so leaving the admin session or
      // changing wallets during the wallet prompt cannot submit an old action.
      const signed = await signer.signTransaction(tx);
      assertContext(review.context);
      if (!signed.signature || !signed.serializeMessage().equals(reviewedMessage)) throw new Error('The wallet changed the reviewed transaction. Nothing was submitted.');
      const afterSignature = await verifyAdminNetwork(client, await fetchAdminChain(SERVER.http));
      assertContext(review.context);
      if (afterSignature.fingerprint !== network.fingerprint) throw new Error('The verified network changed while signing. Nothing was submitted.');
      const signature = bs58.encode(signed.signature);
      const transaction: PendingTransaction = { ...recoveryContext, signature, lastValidBlockHeight, genesisHash: network.genesisHash, createdAt: Date.now(), connection, href: explorerTxUrl(signature, network.cluster, connection.rpcEndpoint), title: fresh.title };
      // Persist only after signing and all final checks, immediately before
      // broadcast. If storage is unavailable, no transaction is submitted.
      savePendingAdmin(sessionStorage, transaction);
      submitted = transaction;
      if (mounted.current) { setPending(transaction); setReview(null); }
      const sent = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed', maxRetries: 4 });
      if (sent !== signature) throw new Error('The RPC returned a different transaction signature. Verify the signed transaction before continuing.');
      toast('info', 'Administration transaction sent. Waiting for confirmation.', { href: transaction.href, label: 'View transaction' }, 15_000);
      await resolveTransaction(transaction);
    } catch (err) {
      if (mounted.current) {
        const info = describeError(err);
        setError(submitted ? 'Submission status is unresolved. Check this signed transaction before trying another action.' : info.name === 'UserRejected' ? 'Wallet request canceled. No transaction was submitted.' : info.message);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const checkPending = async () => {
    if (!pending || busyRef.current || !client) return;
    busyRef.current = true;
    setBusy('check');
    try {
      const network = await verifyAdminNetwork(client, await fetchAdminChain(SERVER.http));
      assertContext(context);
      if (network.genesisHash !== pending.genesisHash) throw new Error('The RPC ledger changed. Restore the original network before checking this transaction.');
      await resolveTransaction(pending);
    }
    catch (err) { if (mounted.current) setError(describeError(err).message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  };

  const submit = (event: FormEvent, action: AdminAction) => { event.preventDefault(); void prepare(action); };
  const refreshAccounts = () => { setReview(null); setError(''); setReload((value) => value + 1); refreshChain(); };
  const switchWallet = async () => {
    if (busyRef.current || pending) return;
    try { await wallet.disconnect(); }
    catch (err) { if (mounted.current) setError(describeError(err).message); }
  };
  const editConfig = (changes: Partial<ConfigDraft>) => { setReview(null); setConfigDraft((old) => old ? { ...old, ...changes } : old); };
  const chooseArena = (id: string) => {
    setReview(null);
    const arena = data.arenas.find((a) => String(a.id) === id);
    setArenaDraft({ id, enabled: arena?.enabled ?? true, maxPlayers: String(arena?.maxPlayers ?? 40) });
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <section className="card admin-section">
        <div className="admin-section-heading"><h2>On-chain controls</h2><button className="btn btn-sm btn-ghost" onClick={refreshAccounts} disabled={!!busy}>Refresh accounts</button></div>
        <p>These changes are reviewed here, then signed by the current program administrator’s wallet.</p>
        <div className="admin-notice">SOL beta · {chain?.cluster ?? 'Network not configured'} · Entry prices are stored in SOL. Token and NFT preparation does not change the game currency.</div>
        {client && <p className="small muted" style={{ overflowWrap: 'anywhere' }}>Program: {client.programId.toBase58()}</p>}
        {!actor && <p className="admin-notice">Use Connect wallet at the top of this page to select the program administrator.</p>}
        {actor && config && !administrator && <div className="admin-notice">This wallet can view the accounts. Connect the on-chain administrator to make changes: <span style={{ overflowWrap: 'anywhere' }}>{config.admin}</span><div className="admin-actions"><button className="btn btn-sm btn-purple" disabled={locked} onClick={() => void switchWallet()}>Switch administrator wallet</button></div></div>}
        {(!client || data.deployed === false) && <div className="admin-notice">Program deployment and initialization are required before these controls become available.</div>}
        {client && data.deployed !== false && !config && <p role="status">{data.loading ? 'Reading program configuration…' : 'Program configuration is unavailable. Refresh accounts after deployment.'}</p>}
        {data.error && <p className="admin-error" role="alert">{data.error}</p>}
      </section>

      {error && <div className="admin-error" role="alert">{error}</div>}
      {busy === 'review' && <div className="admin-notice" role="status">Reading the latest on-chain accounts and preparing your review…</div>}
      {result && <div className="admin-success" role="status">{result.message} <a href={result.href} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      {pending && <section className="card admin-section" aria-label="Transaction confirmation"><h3>Transaction awaiting confirmation</h3><p>{pending.title}. Check this signed transaction before making another change.</p><a href={pending.href} target="_blank" rel="noreferrer">View transaction ↗</a><div className="admin-actions"><button className="btn btn-purple" disabled={!!busy} onClick={() => void checkPending()}>{busy ? 'Checking confirmation…' : 'Check confirmation'}</button></div></section>}

      {review && <section className="card admin-section" aria-labelledby="chain-admin-review"><h3 id="chain-admin-review" ref={reviewHeading} tabIndex={-1}>Review: {review.prepared.title}</h3><div className="admin-notice">Verified network: {review.network.cluster} · RPC: <span style={{ overflowWrap: 'anywhere' }}>{review.network.rpcUrl}</span></div><dl className="admin-form-grid">{review.prepared.details.map((detail) => <div key={detail.label}><dt className="small muted">{detail.label}</dt><dd style={{ margin: '4px 0 12px', overflowWrap: 'anywhere' }}>{detail.value}</dd></div>)}</dl>{review.prepared.notices.map((notice) => <p className="small" key={notice}>{notice}</p>)}<div className="admin-actions"><button className="btn btn-gold" disabled={locked || review.context !== context} onClick={() => void confirm()}>{busy === 'send' ? 'Waiting for wallet / confirmation…' : 'Confirm in wallet'}</button><button className="btn btn-ghost" disabled={!!busy} onClick={() => setReview(null)}>Cancel</button></div></section>}

      {administrator && config && configDraft && <>
        <form className="card admin-section" onSubmit={(event) => submit(event, configDraft)}>
          <h3>Program settings</h3>
          <div className="admin-form-grid">
            <Field label="Profit fee (basis points)" hint={`0–${MAX_FEE_BPS}; 100 basis points = 1%. Charged on profit only.`}>{(id) => <input id={id} className="input" inputMode="numeric" required value={configDraft.feeBps} disabled={locked} onChange={(e) => editConfig({ feeBps: e.target.value })} />}</Field>
            <Field label="Season share of profit fees (basis points)" hint="0–10000. The remainder goes to the treasury.">{(id) => <input id={id} className="input" inputMode="numeric" required value={configDraft.seasonShareBps} disabled={locked} onChange={(e) => editConfig({ seasonShareBps: e.target.value })} />}</Field>
            <Field label="Treasury public address">{(id) => <input id={id} className="input" autoComplete="off" spellCheck={false} required maxLength={44} value={configDraft.treasury} disabled={locked} onChange={(e) => editConfig({ treasury: e.target.value })} />}</Field>
            <Field label="Server authority public address" hint="The public address of the server signing wallet.">{(id) => <input id={id} className="input" autoComplete="off" spellCheck={false} required maxLength={44} value={configDraft.serverAuthority} disabled={locked} onChange={(e) => editConfig({ serverAuthority: e.target.value })} />}</Field>
          </div>
          <label className="row"><input type="checkbox" checked={configDraft.paused} disabled={locked} onChange={(e) => editConfig({ paused: e.target.checked })} /> Pause new ticket admissions</label>
          <div className="admin-actions"><button className="btn btn-purple" disabled={locked}>Review settings</button></div>
        </form>

        <form className="card admin-section" onSubmit={(event) => submit(event, { kind: 'createArena', ...newArena })}>
          <h3>Create a SOL arena</h3><p className="small muted">Use a new arena ID for a different entry price. Existing tickets keep their original terms.</p>
          <div className="admin-form-grid">
            <Field label="New arena ID" hint="Whole number from 0 to 65535.">{(id) => <input id={id} className="input" required inputMode="numeric" value={newArena.id} disabled={locked} onChange={(e) => { setReview(null); setNewArena({ ...newArena, id: e.target.value }); }} />}</Field>
            <Field label="Entry price (SOL)" hint="At least 0.001 SOL. Up to 9 decimal places.">{(id) => <input id={id} className="input" required inputMode="decimal" value={newArena.buyInSol} disabled={locked} onChange={(e) => { setReview(null); setNewArena({ ...newArena, buyInSol: e.target.value }); }} />}</Field>
            <Field label="Ticket capacity" hint="2–100 open tickets.">{(id) => <input id={id} className="input" required inputMode="numeric" value={newArena.maxPlayers} disabled={locked} onChange={(e) => { setReview(null); setNewArena({ ...newArena, maxPlayers: e.target.value }); }} />}</Field>
          </div><div className="admin-actions"><button className="btn btn-gold" disabled={locked}>Review new arena</button></div>
        </form>

        <form className="card admin-section" onSubmit={(event) => submit(event, { kind: 'updateArena', ...arenaDraft })}>
          <h3>Manage an existing arena</h3>
          <div className="admin-form-grid">
            <Field label="Arena">{(id) => <select id={id} className="input" required disabled={locked} value={arenaDraft.id} onChange={(e) => chooseArena(e.target.value)}><option value="">Choose an arena</option>{data.arenas.map((arena) => <option key={arena.id} value={arena.id}>#{arena.id} · {formatAdminSol(arena.buyIn)} SOL · {arena.openSessions} open tickets</option>)}</select>}</Field>
            <Field label="Ticket capacity" hint="2–100. Existing tickets are retained.">{(id) => <input id={id} className="input" required inputMode="numeric" value={arenaDraft.maxPlayers} disabled={locked || !selectedArena} onChange={(e) => { setReview(null); setArenaDraft({ ...arenaDraft, maxPlayers: e.target.value }); }} />}</Field>
          </div>
          <label className="row"><input type="checkbox" checked={arenaDraft.enabled} disabled={locked || !selectedArena} onChange={(e) => { setReview(null); setArenaDraft({ ...arenaDraft, enabled: e.target.checked }); }} /> Accept new tickets</label>
          {selectedArena && <p className="admin-notice">Entry price: {formatAdminSol(selectedArena.buyIn)} SOL, fixed for this arena. {selectedArena.openSessions} tickets are open; their sessions remain intact. Excess arena balance: {formatAdminSol(selectedArena.pot)} SOL.</p>}
          <div className="admin-actions"><button className="btn btn-purple" disabled={locked || !selectedArena}>Review arena changes</button><button type="button" className="btn btn-pink" disabled={locked || !selectedArena || selectedArena.openSessions !== 0 || selectedArena.pot <= 0} onClick={() => void prepare({ kind: 'sweepArena', id: arenaDraft.id })}>Review sweep to treasury</button></div>
          <p className="small muted">Sweeping requires zero open tickets. Account rent stays in the arena.</p>
        </form>

        <section className="card admin-section"><h3>Season {config.currentSeason}</h3>
          <form onSubmit={(event) => submit(event, { kind: 'fundSeason', seasonId: config.currentSeason, amountSol: funding })}><Field label="Add to the prize pool (SOL)">{(id) => <input id={id} className="input" required inputMode="decimal" placeholder="0.1" disabled={locked} value={funding} onChange={(e) => { setReview(null); setFunding(e.target.value); }} />}</Field><div className="admin-actions"><button className="btn btn-gold" disabled={locked}>Review funding</button><button type="button" className="btn btn-pink" disabled={locked} onClick={() => void prepare({ kind: 'endSeason', seasonId: config.currentSeason })}>Review end of season</button></div></form>
          <p className="small muted">Ending a season freezes its leaderboard and prize pool, opens a 30-day reward claim window, and creates the next season.</p>
          <form onSubmit={(event) => submit(event, { kind: 'rolloverSeason', seasonId: oldSeason, currentSeason: config.currentSeason })}><Field label="Old season ID" hint="Unclaimed rewards can roll over only after its 30-day claim window.">{(id) => <input id={id} className="input" required inputMode="numeric" disabled={locked} value={oldSeason} onChange={(e) => { setReview(null); setOldSeason(e.target.value); }} />}</Field><div className="admin-actions"><button className="btn btn-purple" disabled={locked}>Review reward rollover</button></div></form>
        </section>
      </>}
    </div>
  );
}

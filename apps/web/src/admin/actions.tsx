import { formatToken } from '@slana/shared';
import { MAX_ARENA_SESSIONS, MAX_FEE_BPS, MAX_SETTLE_FEE_LAMPORTS, MIN_ARENA_SESSIONS, createFeeWalletAtaIx, feeWalletAta, requireToken, type ArenaView, type ConfigView, type SlanaClient, type UpdateConfigParams } from '@slana/sdk';
import {
  AdminInputError,
  CLOSE_PROGRAM_WARNING,
  adminTransferRefusal,
  SWEEP_WARNING,
  arenaName,
  buildCloseProgramIx,
  buildCreateArenasInstructions,
  buildSetTokenInstructions,
  buildSweepInstructions,
  buildUpdateConfigInstructions,
  closeProgramExposure,
  closeProgramRefusal,
  createArenaRefusal,
  fmtPct,
  fmtSol,
  fmtTok,
  initParams,
  inspectMint,
  parseIntInput,
  parsePubkeyInput,
  parseTokenInput,
  planDefaultArenas,
  sweepRefusal,
  updateArenaRefusal,
  updateConfigParams,
  type MintInspection,
  type StatusSnapshot,
} from '@slana/sdk/ops';
import { PublicKey, type Connection } from '@solana/web3.js';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Chip, Field, InkButton } from '../design';
import type { AdminNetwork } from './net';
import type { Plan } from './Review';

export interface ActionCtx {
  client: SlanaClient;
  connection: Connection;
  /** The connected (authorized) wallet. */
  signer: PublicKey;
  status: StatusSnapshot;
  net: AdminNetwork;
  open: (plan: Plan) => void;
}

/** Runs a field parser; returns [value, error]. */
function attempt<T>(f: () => T): [T | undefined, string | undefined] {
  try {
    return [f(), undefined];
  } catch (err) {
    return [undefined, err instanceof AdminInputError ? err.message : (err as Error).message];
  }
}

function Card({ title, lede, children, tone }: { title: string; lede?: ReactNode; children: ReactNode; tone?: 'danger' }) {
  const id = `ad-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className={`ad-card${tone === 'danger' ? ' is-danger' : ''}`} aria-labelledby={id}>
      <h2 className="ad-card__title" id={id}>
        {title}
      </h2>
      {lede && <p className="ad-card__lede">{lede}</p>}
      {children}
    </section>
  );
}

const code = (s: string) => <code>{s}</code>;

/* ------------------------------------------------------------------ */
/* Initialize                                                          */
/* ------------------------------------------------------------------ */

export function InitForm({ ctx }: { ctx: ActionCtx }) {
  const serverKey = ctx.net.serverKey;
  const [server, setServer] = useState(serverKey ?? '');
  const [feeWallet, setFeeWallet] = useState(ctx.signer.toBase58());
  const [feeBps, setFeeBps] = useState('500');
  const [settle, setSettle] = useState('20000');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const [s, eS] = server.trim() === '' ? [undefined, 'Server authority is required'] : attempt(() => parsePubkeyInput('Server authority', server));
    const [fw, eF] = feeWallet.trim() === '' ? [ctx.signer, undefined] : attempt(() => parsePubkeyInput('Fee wallet', feeWallet));
    const [bps, eB] = attempt(() => parseIntInput('Fee (bps)', feeBps, 0, MAX_FEE_BPS));
    const [lam, eL] = attempt(() => parseIntInput('Settle fee (lamports)', settle, 0, MAX_SETTLE_FEE_LAMPORTS));
    const next: Record<string, string | undefined> = { server: eS, feeWallet: eF, feeBps: eB, settle: eL };
    let params: ReturnType<typeof initParams> | undefined;
    if (!eS && !eF && !eB && !eL) {
      const [p, eP] = attempt(() => initParams({ serverAuthority: s!, feeWallet: fw, feeBps: bps, settleFeeLamports: lam }, ctx.signer));
      params = p;
      if (eP) next.server = eP;
    }
    setErrors(next);
    if (!params) return;
    setBusy(true);
    try {
      const ix = await ctx.client.ix.initialize(ctx.signer, params);
      ctx.open({
        title: 'Initialize the program',
        summary: [
          ['Server authority', code(params.serverAuthority.toBase58())],
          ['Fee wallet', code(params.feeWallet.toBase58())],
          ['Fee on profit', `${params.feeBps} bps (${fmtPct(params.feeBps)})`],
          ['Settle fee', `${params.settleFeeLamports.toLocaleString('en-US')} lamports (${fmtSol(params.settleFeeLamports)}) per session`],
          ['Admin', <>{code(ctx.signer.toBase58())} (this wallet; must be the upgrade authority)</>],
        ],
        ixs: [ix],
        done: 'Initialized the config (no game token yet)',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Initialize" lede="Creates the Config without a game token. Signed by the program's upgrade authority, which becomes the admin.">
      <form className="ad-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field
          label="Server authority (required)"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          error={errors.server}
          hint={serverKey ? (server.trim() === serverKey ? "Prefilled with this server's key." : `This server's key: ${serverKey}`) : 'The game server\'s signing key (the server logs it; /api/config shows it as serverKey).'}
          spellCheck={false}
          autoComplete="off"
        />
        {serverKey && server.trim() !== serverKey && (
          <Chip icon="key" onClick={() => setServer(serverKey)}>
            Use this server's key
          </Chip>
        )}
        <Field label="Fee wallet" value={feeWallet} onChange={(e) => setFeeWallet(e.target.value)} error={errors.feeWallet} hint="Defaults to the connected wallet." spellCheck={false} autoComplete="off" />
        <div className="ad-row">
          <Field label="Fee (bps)" inputMode="numeric" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} error={errors.feeBps} hint={`0 to ${MAX_FEE_BPS} (10 %). Default 500 = 5 %.`} />
          <Field label="Settle fee (lamports)" inputMode="numeric" value={settle} onChange={(e) => setSettle(e.target.value)} error={errors.settle} hint={`0 to ${MAX_SETTLE_FEE_LAMPORTS.toLocaleString('en-US')}. Default 20,000.`} />
        </div>
        <div className="ad-actions">
          <InkButton type="submit" variant="ink" icon="arrow" disabled={busy}>
            Review initialize
          </InkButton>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Set token                                                           */
/* ------------------------------------------------------------------ */

export function MintReport({ m }: { m: MintInspection }) {
  return (
    <div className="ad-mint" data-testid="mint-report">
      <dl className="ad-kv">
        <div>
          <dt className="mono">Owner program</dt>
          <dd>{m.ownerName ?? 'no account'}</dd>
        </div>
        <div>
          <dt className="mono">Decimals</dt>
          <dd>{m.decimals ?? 'n/a'}</dd>
        </div>
        <div>
          <dt className="mono">Supply</dt>
          <dd>{m.supply === null || m.decimals === null ? 'n/a' : `${fmtTok(m.supply, m.decimals)}${m.symbol ? ` ${m.symbol}` : ''} (${m.supply} base units)`}</dd>
        </div>
        <div>
          <dt className="mono">Symbol (self-declared)</dt>
          <dd>{m.symbol ?? 'unknown'}</dd>
        </div>
        <div>
          <dt className="mono">Mint authority</dt>
          <dd>{m.mintAuthority ? code(m.mintAuthority) : 'none'}</dd>
        </div>
        <div>
          <dt className="mono">Freeze authority</dt>
          <dd>{m.freezeAuthority ? code(m.freezeAuthority) : 'none'}</dd>
        </div>
        <div>
          <dt className="mono">Token-2022 extensions</dt>
          <dd>
            {m.extensions.length === 0
              ? 'none'
              : m.extensions.map((e) => (
                  <span key={e.type} className={`ad-ext${e.denied ? ' is-denied' : ''}`}>
                    {e.name}
                    {e.denied ? ' (refused)' : ''}
                  </span>
                ))}
          </dd>
        </div>
      </dl>
      {m.refusals.length > 0 ? (
        <div className="ad-err" role="alert">
          <p>
            <strong>The program would refuse this mint:</strong>
          </p>
          <ul>
            {m.refusals.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ad-ok">The program accepts this mint.</p>
      )}
    </div>
  );
}

export function SetTokenForm({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const [mint, setMint] = useState('');
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<MintInspection | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped on every check and every edit: a late result for an older input is dropped. */
  const seq = useRef(0);

  const check = async (e: FormEvent) => {
    e.preventDefault();
    const mine = ++seq.current;
    setReport(null);
    const [key, err] = attempt(() => parsePubkeyInput('Mint address', mint));
    setError(mint.trim() === '' ? 'Mint address is required' : err);
    if (!key) return;
    setBusy(true);
    try {
      const r = await inspectMint(ctx.connection, key);
      if (mine === seq.current) setReport(r);
    } catch (err2) {
      if (mine === seq.current) setError(`Cannot read the mint: ${(err2 as Error).message}`);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  const review = async () => {
    if (!report || report.refusals.length > 0 || !report.owner) return;
    const key = new PublicKey(report.address);
    const owner = new PublicKey(report.owner);
    const ixs = await buildSetTokenInstructions(ctx.client, ctx.signer, config, key, owner);
    const feeToken = feeWalletAta({ feeWallet: config.feeWallet, tokenMint: key, tokenProgram: owner });
    ctx.open({
      title: 'Set the game token (one time, irreversible)',
      warning: (
        <>
          <p className="ad-warn__big">ONE-TIME AND IRREVERSIBLE</p>
          <p>
            The program accepts the mint once and has no instruction to change it. A wrong address can only be fixed by closing the program and redeploying it under a new program id.
            Check the address against the official contract address.
          </p>
        </>
      ),
      summary: [
        ['Mint', code(report.address)],
        ['Token program', `${report.ownerName} (${report.owner})`],
        ['Decimals', String(report.decimals)],
        ['Symbol (self-declared)', report.symbol ?? 'unknown'],
        ['Fee wallet token account', <>{code(feeToken.toBase58())} (created if missing; this wallet pays the rent)</>],
      ],
      ixs,
      retype: { label: 'Type the mint address again to confirm', text: report.address },
      done: `Game token set to ${report.address}${report.symbol ? ` (${report.symbol})` : ''}`,
    });
  };

  const blocked = !!report && report.refusals.length > 0;
  return (
    <Card title="Set token" lede="Stores the game token mint, once. The same transaction creates the fee wallet's token account.">
      <form className="ad-form" onSubmit={(e) => void check(e)} noValidate>
        <Field
          label="Mint address (CA)"
          value={mint}
          onChange={(e) => {
            seq.current++;
            setMint(e.target.value);
            setReport(null);
            setBusy(false);
          }}
          error={error}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="ad-actions">
          <InkButton type="submit" variant="paper" disabled={busy}>
            {busy ? 'Reading the mint…' : 'Check mint'}
          </InkButton>
        </div>
      </form>
      {report && <MintReport m={report} />}
      {report && (
        <div className="ad-actions">
          <InkButton variant="ink" icon="arrow" disabled={blocked} onClick={() => void review()}>
            Review set token
          </InkButton>
          {blocked && <span className="ad-note">Blocked: the program would refuse this mint.</span>}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Arenas                                                              */
/* ------------------------------------------------------------------ */

export function CreateArenas({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const token = requireToken(config);
  const d = token.tokenDecimals;
  const arenas = ctx.status.arenas ?? [];
  const plan = planDefaultArenas(d, arenas);
  const [id, setId] = useState('');
  const [entry, setEntry] = useState('');
  const [max, setMax] = useState('300');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const defaults = async () => {
    const ixs = await buildCreateArenasInstructions(ctx.client, ctx.signer, token, plan.create);
    ctx.open({
      title: `Create ${plan.create.length} default arena${plan.create.length === 1 ? '' : 's'}`,
      summary: [
        ...plan.create.map((a): [string, ReactNode] => [`#${a.id} ${arenaName(a.id)}`, `entry ${fmtTok(a.entryFee, d)} (${a.entryFee} base units) · max ${a.maxSessions} sessions`]),
        ...(plan.skipped.length ? [['Skipped (exist)', plan.skipped.map((a) => `#${a.id}`).join(', ')] as [string, ReactNode]] : []),
      ],
      ixs,
      done: `Created arenas ${plan.create.map((a) => `#${a.id}`).join(', ')}`,
    });
  };

  const custom = async (e: FormEvent) => {
    e.preventDefault();
    const [i, eI] = attempt(() => parseIntInput('Arena id', id, 0, 65_535));
    const [fee, eE] = attempt(() => parseTokenInput('Entry fee', entry, d));
    const [m, eM] = attempt(() => parseIntInput('Max sessions', max, MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS));
    const next = { id: eI, entry: eE, max: eM };
    if (i !== undefined && fee !== undefined && m !== undefined) {
      const refusal = createArenaRefusal({ id: i, entryFee: fee, maxSessions: m }, arenas);
      if (refusal) next[/entry/.test(refusal) ? 'entry' : /sessions/.test(refusal) ? 'max' : 'id'] = refusal;
    }
    setErrors(next);
    if (next.id || next.entry || next.max) return;
    const ixs = await buildCreateArenasInstructions(ctx.client, ctx.signer, token, [{ id: i!, entryFee: fee!, maxSessions: m! }]);
    ctx.open({
      title: `Create arena #${i}`,
      summary: [
        ['Arena', `#${i} ${arenaName(i!)}`],
        ['Entry fee', `${fmtTok(fee!, d)} (${fee} base units)`],
        ['Max sessions', String(m)],
      ],
      ixs,
      done: `Created arena #${i}`,
    });
  };

  return (
    <Card title="Create arenas" lede="New arenas show up in the lobby within about 60 seconds.">
      <div className="ad-actions">
        <InkButton variant="ink" onClick={() => void defaults()} disabled={plan.create.length === 0}>
          Create the 4 default arenas
        </InkButton>
        <span className="ad-note">{plan.create.length === 0 ? 'All four default arenas exist.' : plan.skipped.length ? `Skips existing: ${plan.skipped.map((a) => `#${a.id}`).join(', ')}.` : 'One transaction, four arenas.'}</span>
      </div>
      <form className="ad-form" onSubmit={(e) => void custom(e)} noValidate>
        <h3 className="ad-h3">Custom arena</h3>
        <div className="ad-row">
          <Field label="Arena id" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} error={errors.id} />
          <Field label="Entry fee (tokens)" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} error={errors.entry} hint={`Whole tokens, ${d} decimals.`} />
          <Field label="Max sessions" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} error={errors.max} hint={`${MIN_ARENA_SESSIONS} to ${MAX_ARENA_SESSIONS}.`} />
        </div>
        <div className="ad-actions">
          <InkButton type="submit" variant="paper" icon="arrow">
            Review custom arena
          </InkButton>
        </div>
      </form>
    </Card>
  );
}

export function UpdateArena({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const arenas = ctx.status.arenas ?? [];
  const d = config.tokenDecimals;
  const [pick, setPick] = useState<number | null>(arenas[0]?.id ?? null);
  const arena = arenas.find((a) => a.id === pick) ?? arenas[0] ?? null;
  return (
    <Card title="Update arena" lede="Enable or disable an arena, change its entry fee (only while no session is open) or its session cap.">
      {arenas.length === 0 ? (
        <p className="ad-note">No arenas yet.</p>
      ) : (
        <>
          <div className="ad-chips" role="group" aria-label="Arena">
            {arenas.map((a) => (
              <Chip key={a.id} selected={a.id === arena?.id} onClick={() => setPick(a.id)}>
                #{a.id} {arenaName(a.id)}
              </Chip>
            ))}
          </div>
          {arena && <UpdateArenaForm key={`${arena.id}:${arena.entryFee}:${arena.maxSessions}:${arena.enabled}`} ctx={ctx} arena={arena} decimals={d} />}
        </>
      )}
    </Card>
  );
}

function UpdateArenaForm({ ctx, arena, decimals }: { ctx: ActionCtx; arena: ArenaView; decimals: number }) {
  const [enabled, setEnabled] = useState(arena.enabled);
  // full precision, no grouping: the untouched field reads back exactly as the stored fee
  const initialEntry = formatToken(arena.entryFee, decimals, { maxFrac: decimals }).replace(/,/g, '');
  const [entry, setEntry] = useState(initialEntry);
  const [max, setMax] = useState(String(arena.maxSessions));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [general, setGeneral] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const entryEdited = entry.trim() !== initialEntry;
    const [fee, eE] = entryEdited ? attempt(() => parseTokenInput('Entry fee', entry, decimals)) : [arena.entryFee, undefined];
    const [m, eM] = attempt(() => parseIntInput('Max sessions', max, MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS));
    setErrors({ entry: eE, max: eM });
    if (eE || eM) return;
    const changes = {
      enabled: enabled !== arena.enabled ? enabled : undefined,
      entryFee: entryEdited && fee !== arena.entryFee ? fee : undefined,
      maxSessions: m !== arena.maxSessions ? m : undefined,
    };
    const refusal = updateArenaRefusal(arena, changes);
    setGeneral(refusal ?? undefined);
    if (refusal) return;
    const ix = await ctx.client.ix.updateArena(ctx.signer, arena.id, changes);
    ctx.open({
      title: `Update arena #${arena.id}`,
      summary: [
        ...(changes.enabled !== undefined ? [['Enabled', `${arena.enabled ? 'yes' : 'no'} → ${changes.enabled ? 'yes' : 'no'}`] as [string, ReactNode]] : []),
        ...(changes.entryFee !== undefined ? [['Entry fee', `${fmtTok(arena.entryFee, decimals)} → ${fmtTok(changes.entryFee, decimals)} (${changes.entryFee} base units)`] as [string, ReactNode]] : []),
        ...(changes.maxSessions !== undefined ? [['Max sessions', `${arena.maxSessions} → ${changes.maxSessions}`] as [string, ReactNode]] : []),
      ],
      ixs: [ix],
      done: `Updated arena #${arena.id}`,
    });
  };

  return (
    <form className="ad-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="ad-chips" role="group" aria-label="Enabled">
        <Chip tone="teal" selected={enabled} onClick={() => setEnabled(true)}>
          Enabled
        </Chip>
        <Chip tone="pink" selected={!enabled} onClick={() => setEnabled(false)}>
          Disabled
        </Chip>
      </div>
      <div className="ad-row">
        <Field label="Entry fee (tokens)" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} error={errors.entry} hint={arena.openSessions > 0 ? `${arena.openSessions} open sessions: the entry fee cannot change now.` : undefined} />
        <Field label="Max sessions" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} error={errors.max} />
      </div>
      {general && (
        <p className="ad-err" role="alert">
          {general}
        </p>
      )}
      <div className="ad-actions">
        <InkButton type="submit" variant="ink" icon="arrow">
          Review arena update
        </InkButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export function UpdateConfig({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const serverKey = ctx.net.serverKey;
  const [feeBps, setFeeBps] = useState(String(config.feeBps));
  const [settle, setSettle] = useState(String(config.settleFeeLamports));
  const [server, setServer] = useState(config.serverAuthority);
  const [feeWallet, setFeeWallet] = useState(config.feeWallet);
  const [admin, setAdmin] = useState(config.admin);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [general, setGeneral] = useState<string>();
  const mismatch = !!serverKey && config.serverAuthority !== serverKey;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const [bps, eB] = attempt(() => parseIntInput('Fee (bps)', feeBps, 0, MAX_FEE_BPS));
    const [lam, eL] = attempt(() => parseIntInput('Settle fee (lamports)', settle, 0, MAX_SETTLE_FEE_LAMPORTS));
    const [s, eS] = attempt(() => parsePubkeyInput('Server authority', server));
    const [fw, eF] = attempt(() => parsePubkeyInput('Fee wallet', feeWallet));
    const [a, eA] = attempt(() => parsePubkeyInput('Admin', admin));
    setErrors({ feeBps: eB, settle: eL, server: eS, feeWallet: eF, admin: eA });
    if (eB || eL || eS || eF || eA) return;
    let changes: UpdateConfigParams;
    try {
      changes = updateConfigParams({
        feeBps: bps !== config.feeBps ? bps : undefined,
        settleFeeLamports: lam !== config.settleFeeLamports ? lam : undefined,
        serverAuthority: s!.toBase58() !== config.serverAuthority ? s : undefined,
        feeWallet: fw!.toBase58() !== config.feeWallet ? fw : undefined,
        admin: a!.toBase58() !== config.admin ? a : undefined,
      });
    } catch (err) {
      setGeneral((err as Error).message);
      return;
    }
    if (Object.keys(changes).length === 0) {
      setGeneral('Nothing to change: edit a value first.');
      return;
    }
    if (changes.admin !== undefined) {
      const refusal = adminTransferRefusal(new PublicKey(changes.admin as PublicKey), {
        programId: ctx.client.programId,
        currentAdmin: config.admin,
        serverKeys: [config.serverAuthority, ctx.net.serverKey, changes.serverAuthority as PublicKey | undefined],
        feeWallet: config.feeWallet,
      });
      if (refusal) {
        setErrors((e2) => ({ ...e2, admin: `Admin transfer refused: ${refusal}` }));
        return;
      }
    }
    setGeneral(undefined);
    const ixs = await buildUpdateConfigInstructions(ctx.client, ctx.signer, config, changes);
    const pk = (v: unknown) => code(new PublicKey(v as PublicKey).toBase58());
    const summary: [string, ReactNode][] = [];
    if (changes.feeBps !== undefined) summary.push(['Fee on profit', `${config.feeBps} → ${changes.feeBps} bps (${fmtPct(changes.feeBps)})`]);
    if (changes.settleFeeLamports !== undefined) summary.push(['Settle fee', `${config.settleFeeLamports} → ${changes.settleFeeLamports} lamports`]);
    if (changes.serverAuthority !== undefined) summary.push(['Server authority', pk(changes.serverAuthority)]);
    if (changes.feeWallet !== undefined) summary.push(['Fee wallet', <>{pk(changes.feeWallet)}{config.tokenMint ? ' (its token account is created first; this wallet pays)' : ''}</>]);
    if (changes.admin !== undefined) summary.push(['Admin', pk(changes.admin)]);
    ctx.open({
      title: changes.admin !== undefined ? 'Update config and TRANSFER ADMIN' : 'Update config',
      warning:
        changes.admin !== undefined ? (
          <>
            <p className="ad-warn__big">ADMIN TRANSFER</p>
            <p>
              After this transaction only {pk(changes.admin)} can run admin operations. This wallet loses every admin right at once, and only the new admin can give them back. Check that
              you control the new address (a multisig or a wallet you hold) before signing.
            </p>
          </>
        ) : undefined,
      ack: changes.admin !== undefined ? 'I control the new admin address and understand this wallet loses admin rights.' : undefined,
      retype: changes.admin !== undefined ? { label: 'Type the new admin address again to confirm', text: new PublicKey(changes.admin as PublicKey).toBase58() } : undefined,
      summary,
      ixs,
      done: `Updated config (${Object.keys(changes).join(', ')})`,
    });
  };

  return (
    <Card title="Update config" lede="Only the values you change are sent. The fee and settle fee apply to tickets bought from now on.">
      {mismatch && (
        <div className="ad-warn" role="alert">
          <p>
            The program's server authority {code(config.serverAuthority)} is not this server's key {code(serverKey!)}. The game server cannot settle or burn loot until they match.
          </p>
          <Chip icon="key" onClick={() => setServer(serverKey!)}>
            Use this server's key
          </Chip>
        </div>
      )}
      <form className="ad-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="ad-row">
          <Field label="Fee (bps)" inputMode="numeric" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} error={errors.feeBps} hint={`0 to ${MAX_FEE_BPS}.`} />
          <Field label="Settle fee (lamports)" inputMode="numeric" value={settle} onChange={(e) => setSettle(e.target.value)} error={errors.settle} />
        </div>
        <Field label="Server authority" value={server} onChange={(e) => setServer(e.target.value)} error={errors.server} spellCheck={false} autoComplete="off" />
        <Field label="Fee wallet" value={feeWallet} onChange={(e) => setFeeWallet(e.target.value)} error={errors.feeWallet} spellCheck={false} autoComplete="off" />
        <Field
          label="Admin (transfer)"
          value={admin}
          onChange={(e) => setAdmin(e.target.value)}
          error={errors.admin}
          hint={admin.trim() !== config.admin ? 'Warning: changing this hands every admin right to that address.' : 'Change only to hand the program to another wallet or a multisig.'}
          spellCheck={false}
          autoComplete="off"
        />
        {general && (
          <p className="ad-err" role="alert">
            {general}
          </p>
        )}
        <div className="ad-actions">
          <InkButton type="submit" variant="ink" icon="arrow">
            Review config update
          </InkButton>
        </div>
      </form>
    </Card>
  );
}

export function PauseControl({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const target = !config.paused;
  const go = async () => {
    const ix = await ctx.client.ix.updateConfig(ctx.signer, { paused: target });
    ctx.open({
      title: target ? 'Pause arena joins' : 'Unpause arena joins',
      summary: [['Paused', `${config.paused ? 'yes' : 'no'} → ${target ? 'yes' : 'no'}`], ['Effect', target ? 'join_arena is refused; settlements and refunds keep working.' : 'Arena joins open again.']],
      ixs: [ix],
      done: target ? 'Paused arena joins' : 'Unpaused arena joins',
    });
  };
  return (
    <Card title="Pause" lede={config.paused ? 'The program is PAUSED: arena joins are blocked.' : 'Arena joins are open. Pausing stops new tickets at once; payouts and refunds go on.'}>
      <div className="ad-actions">
        <InkButton variant={target ? 'pink' : 'ink'} onClick={() => void go()}>
          {target ? 'Pause' : 'Unpause'}
        </InkButton>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sweep and the fee wallet token account                              */
/* ------------------------------------------------------------------ */

export function SweepArena({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const token = requireToken(config);
  const arenas = ctx.status.arenas ?? [];
  const sweep = async (a: ArenaView) => {
    const ixs = await buildSweepInstructions(ctx.client, ctx.signer, config, token, a.id);
    ctx.open({
      title: `Sweep arena #${a.id}`,
      warning: <p>{SWEEP_WARNING}</p>,
      summary: [
        ['Arena', `#${a.id} ${arenaName(a.id)} (disabled, ${a.openSessions} open sessions)`],
        ['Vault', <>{code(a.vault)} · {fmtTok(a.pot, token.tokenDecimals)}</>],
        ['To', <>{code(feeWalletAta(config).toBase58())} (fee wallet {code(config.feeWallet)})</>],
      ],
      ack: 'I checked the server journal: no loot or payout of this arena is pending.',
      ixs,
      done: `Swept arena #${a.id} to the fee wallet`,
    });
  };
  return (
    <Card title="Sweep arena" tone="danger" lede="Moves a disabled, idle arena's whole vault to the fee wallet's token account. For shutting an arena down for good.">
      {arenas.length === 0 ? (
        <p className="ad-note">No arenas.</p>
      ) : (
        <ul className="ad-list">
          {arenas.map((a) => {
            const refusal = sweepRefusal(a);
            return (
              <li key={a.id}>
                <span>
                  #{a.id} {arenaName(a.id)} · vault {fmtTok(a.pot, token.tokenDecimals)}
                </span>
                {refusal ? (
                  <span className="ad-note">{refusal}</span>
                ) : (
                  <InkButton variant="pink" size="sm" onClick={() => void sweep(a)}>
                    Sweep #{a.id}
                  </InkButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function RecreateFeeAta({ ctx, config }: { ctx: ActionCtx; config: ConfigView }) {
  const address = feeWalletAta(config).toBase58();
  const exists = ctx.status.feeWalletBalance !== null && ctx.status.feeWalletBalance !== undefined;
  const go = () =>
    ctx.open({
      title: "Create the fee wallet's token account",
      summary: [
        ['Token account', code(address)],
        ['Owner (fee wallet)', code(config.feeWallet)],
        ['Mint', code(config.tokenMint!)],
        ['Effect', exists ? 'The account exists: the idempotent create does nothing but cost the fee.' : 'Creates it (this wallet pays the rent); held settlements resume by themselves.'],
      ],
      ixs: [createFeeWalletAtaIx(ctx.signer, config)],
      done: "Created the fee wallet's token account",
    });
  return (
    <Card title="Fee wallet token account" lede={exists ? 'The account exists.' : 'The account is MISSING: every settlement is held until it is recreated.'}>
      <div className="ad-actions">
        <InkButton variant={exists ? 'paper' : 'pink'} onClick={go}>
          Recreate token account
        </InkButton>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Close the program (emergency, irreversible)                         */
/* ------------------------------------------------------------------ */

export function CloseProgram({ ctx }: { ctx: ActionCtx }) {
  const programId = ctx.client.programId.toBase58();
  const config = ctx.status.config;
  const refusal = closeProgramRefusal(ctx.status, ctx.signer.toBase58());
  const exposure = closeProgramExposure(ctx.status.arenas ?? []);
  const d = config?.tokenDecimals ?? 0;
  const go = () =>
    ctx.open({
      title: 'Close the program',
      warning: <p>{CLOSE_PROGRAM_WARNING}</p>,
      summary: [
        ['Program', code(programId)],
        ['Rent to', <>{code(ctx.signer.toBase58())} (this wallet, the upgrade authority)</>],
        ['Locked forever', exposure.pot > 0n || exposure.openSessions > 0 ? `${fmtTok(exposure.pot, d)} in arena vaults · ${exposure.openSessions} open sessions` : 'no tokens in arena vaults, no open sessions'],
        ['Effect', 'Every instruction of the program fails from the next slot on: no joins, settlements, refunds or admin actions.'],
      ],
      retype: { label: 'Type the program id to confirm', text: programId },
      ack: 'I understand this cannot be undone and the program id can never be deployed again.',
      ixs: [buildCloseProgramIx(programId, ctx.signer, ctx.signer)],
      done: 'Closed the program',
    });
  return (
    <Card
      title="Close program"
      tone="danger"
      lede={<>Emergency kill switch: deletes the deployed program for good ({code('solana program close')}). Signed by the upgrade authority. Pause first if a reversible stop is enough.</>}
    >
      {(exposure.pot > 0n || exposure.openSessions > 0) && (
        <p className="ad-warn">
          The arenas still hold {fmtTok(exposure.pot, d)} and {exposure.openSessions} open sessions: closing locks them forever.
        </p>
      )}
      <div className="ad-actions">
        {refusal ? (
          <span className="ad-note">{refusal}</span>
        ) : (
          <InkButton variant="pink" onClick={go}>
            Review close program
          </InkButton>
        )}
      </div>
    </Card>
  );
}

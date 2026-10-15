import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_2022_PROGRAM_ID, pdas, type OwnedPass } from '@slana/sdk';
import { arenaMeta, formatToken, isBasicSkin, sanitizeName, truncateUtf8, utf8Length } from '@slana/shared';
import { motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Field, Icon, InkButton, Sheet, Stamp, StampSpinner, markTransitionOrigin, useReducedMotion } from '../design';
import { engine } from '../game/instance';
import { sound } from '../game/sound';
import { useT } from '../i18n';
import { toast, updateSettings, useUi } from '../store';
import { CoinPortrait } from '../ui/game/CoinPortrait';
import { ticketName, useTokenText } from '../ui/lobby/useLobby';
import { freePasses, refreshChain, useChainData, usePassPower, useSlanaClient } from './chain';
import { loadDevFake } from './devFakeLoader';
import { explorerTx } from './links';
import {
  ACCOUNT_BYTES,
  CLOSE_COMPUTE_UNITS,
  TICKET_COMPUTE_UNITS,
  bpsPercent,
  buildCloseTx,
  buildTicketTx,
  closeSolCost,
  defaultRent,
  feeBps,
  ticketSolCost,
  ticketSteps,
  type SolCost,
  type TicketModel,
  type TicketStep,
} from './ticket';
import { sendTx, txErrorText, type TxPhase } from './tx';

/** `collect`: a finalized session's payout (R24); `refund`: an unsettled ticket after 24 h. */
export type FlowMode = 'buy' | 'refund' | 'collect';

type Phase = 'review' | 'preparing' | TxPhase | 'stamped' | 'error';

const SOL_DECIMALS = 9;
/** Stamp (420 ms) → tear → into the room. */
const TEAR_AT_MS = 560;
const PLAY_AT_MS = 1_650;

const passNo = (n: number) => String(n).padStart(4, '0');
const RENT_SIZES = [ACCOUNT_BYTES.session, ACCOUNT_BYTES.passLock, ACCOUNT_BYTES.profile, ACCOUNT_BYTES.ata, ACCOUNT_BYTES.ata2022];

/**
 * Cutting a ticket (spec §7.2.2): a confirm sheet that shows exactly what is
 * signed (fee, fee policy, Pass, deposit, SOL moved, every instruction), one
 * wallet signature for `[createAta?] + [registerPlayer?] + joinArena|joinArenaWithPass`,
 * polling confirmation, then the stamp lands, the stub tears off and the player
 * enters the room. The same sheet collects a finalized game's payout (R24, any
 * time) and refunds an unsettled ticket after 24 h, each in one transaction that
 * first creates the player's token account idempotently (player-paid).
 *
 * Money safety: one in-flight guard (a ref, so a double click or a held Enter
 * cannot start a second transaction before React re-renders), focus never
 * starts on the pay button, the values are frozen at confirm, and the arena is
 * re-read from the chain right before the transaction is built.
 */
export function TicketFlow({ open, mode, ticket, onClose }: { open: boolean; mode: FlowMode; ticket: TicketModel | null; onClose: () => void }) {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const blockedArenas = useUi((s) => s.blockedArenas);
  const cluster = useUi((s) => s.chain?.cluster ?? 'devnet');
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSlanaClient();
  const data = useChainData();
  const tok = useTokenText();
  const reduced = useReducedMotion();
  const nameId = useId();
  const power = usePassPower();

  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [usePass, setUsePass] = useState(false);
  const [passAsset, setPassAsset] = useState<string | null>(null);
  const [name, setName] = useState(settings.name);
  /** What was on the sheet when the player pressed confirm: shown until the flow ends, never re-read from the chain. */
  const [frozen, setFrozen] = useState<Review | null>(null);
  const [rents, setRents] = useState<Record<number, number> | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const timers = useRef<number[]>([]);
  /** Synchronous double-submit guard: set before the first await, cleared only on failure or reopen. */
  const inFlight = useRef(false);
  const endRef = useRef<HTMLSpanElement>(null);

  const arenaId = ticket?.arenaId ?? null;
  const session = arenaId !== null ? (data.sessions[arenaId] ?? null) : null;
  const free = useMemo(() => freePasses(data), [data]);
  const owned = data.passes;
  const passRequired = ticket?.requiresPass === true;
  const passOn = passRequired || usePass;
  const chosenPass = passOn ? (free.find((p) => p.asset === passAsset) ?? free[0] ?? null) : null;

  // fresh state every time the sheet opens
  useEffect(() => {
    if (!open) return;
    inFlight.current = false;
    setPhase('review');
    setError(null);
    setSignature(null);
    setUsePass(false);
    setPassAsset(free.find((p) => p.asset === settings.passSkin)?.asset ?? free[0]?.asset ?? null);
    setName(settings.name);
    setFrozen(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket?.key, mode]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // rent-exempt minimums of the accounts a ticket can create (the RPC knows the cluster's rent)
  useEffect(() => {
    if (!open || !client) return;
    let alive = true;
    void Promise.all(RENT_SIZES.map((b) => client.rentExemptMinimum(b).catch(() => defaultRent(b)))).then((list) => {
      if (alive) setRents(Object.fromEntries(RENT_SIZES.map((b, i) => [b, list[i]])));
    });
    return () => {
      alive = false;
    };
  }, [open, client]);

  // "more below" cue while the end of the sheet is out of view
  useEffect(() => {
    const el = endRef.current;
    if (!open || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setMoreBelow(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  });

  if (!ticket || arenaId === null) return null;

  const room = ticketName(ticket, t('lo.practice'));
  const owner = wallet.publicKey?.toBase58() ?? null;
  const config = data.config;
  const register = data.profile ? null : { name: truncateUtf8(sanitizeName(name, ''), 16), skin: isBasicSkin(settings.skin) ? settings.skin : 0 };
  const nameOk = !register || (register.name.length > 0 && utf8Length(register.name) <= 16);
  const steps: TicketStep[] = ticketSteps({ ataExists: data.ataExists, register, passAsset: chosenPass?.asset ?? null });
  const bps = feeBps(config, passOn);
  const fee = mode === 'refund' ? (session?.entryFee ?? ticket.entryFee) : ticket.entryFee;
  const deposit = mode === 'refund' ? (session?.settleFee ?? 0) : (config?.settleFeeLamports ?? 0);
  const token2022 = config?.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58();
  const solCost = ticketSolCost(steps, {
    settleFeeLamports: config?.settleFeeLamports ?? 0,
    token2022,
    rent: (b) => rents?.[b] ?? defaultRent(b),
  });
  const closeCost = closeSolCost({
    ataExists: data.ataExists,
    token2022,
    finalized: mode === 'collect',
    settleFeeLamports: session?.settleFee ?? 0,
    rent: (b) => rents?.[b] ?? defaultRent(b),
  });
  const busy = phase === 'preparing' || phase === 'signing' || phase === 'confirming' || phase === 'stamped';
  const sol = (lamports: number) => formatToken(lamports, SOL_DECIMALS, { maxFrac: 6 });
  const owed = session?.finalized ? session.owed : 0n;
  const live: Review = { steps, fee, bps, deposit, balance: data.tokenBalance, register, pass: chosenPass, owed, sol: solCost, close: closeCost, sessionId: session?.id ?? null };
  const v = frozen ?? live;
  const lowSol = mode === 'buy' && data.balance !== null && data.balance < v.sol.total;
  // the transaction landed after all (e.g. confirmation timed out): never offer to pay twice
  const landed = mode === 'buy' && session !== null && (phase === 'review' || phase === 'error');

  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  const fail = (text: string) => {
    inFlight.current = false;
    setFrozen(null);
    setError(text);
    setPhase('error');
    refreshChain();
  };

  const onPhase = (p: TxPhase, sig?: string) => {
    setPhase(p);
    if (sig) setSignature(sig);
  };

  const enterRoom = (sig: string, pass: string | null) => {
    setPhase('stamped');
    if (!reduced) later(290, () => sound.stamp());
    const href = sig.startsWith('DevFake') ? undefined : { href: explorerTx(sig, cluster), label: t('tf.viewTx') };
    toast('success', t('tf.ticketOk'), href, 6000);
    updateSettings({ lastArena: arenaId, ...(register ? { name: register.name } : {}) });
    refreshChain();
    later(reduced ? 700 : PLAY_AT_MS, () => {
      // the paper opens onto the room from the VALID stamp
      markTransitionOrigin(document.querySelector('.tf-ticket__stamp') ?? document.querySelector('.tf-ticket'));
      // (fake chain: its Pass ids are not addresses the server can verify; it applies the ticket's Pass itself)
      engine()?.play(`arena:${arenaId}`, { pass: data.fake ? null : (pass ?? undefined), awaitTicket: true });
      onClose();
    });
  };

  const resume = () => {
    sound.click();
    updateSettings({ lastArena: arenaId });
    markTransitionOrigin(document.querySelector('.tf-ticket'));
    engine()?.play(`arena:${arenaId}`, session?.hasPass && session.passAsset && !data.fake ? { pass: session.passAsset } : {});
    onClose();
  };

  const buy = async () => {
    if (inFlight.current) return;
    if (!owner || !config || !nameOk || (passOn && !chosenPass)) return;
    inFlight.current = true;
    setPhase('preparing');
    sound.click();
    const review = live;
    setFrozen(review);
    const pass = review.pass?.asset ?? null;
    if (data.fake) {
      const dev = await loadDevFake();
      if (!dev) return fail(t('tf.err.NetworkError'));
      const res = await dev.fakeSendTicket(owner, arenaId, review.fee, review.steps, review.register, pass, onPhase);
      if (!res.ok) return fail(txErrorText({ code: null, name: res.name, message: res.name }));
      setSignature(res.signature);
      return enterRoom(res.signature, pass);
    }
    if (!client) return fail(t('tf.err.NetworkError'));
    // R20: the server keeps this arena closed (vault short of its journal): never sell a ticket
    if (useUi.getState().blockedArenas.includes(arenaId)) return fail(t('tf.err.Maintenance'));
    try {
      // re-read the arena and the config: the price, Pass rule, fee rate (fixed into the ticket at join)
      // and deposit signed must be the ones shown
      const [fresh, freshConfig] = await Promise.all([client.fetchArena(arenaId), client.fetchConfig()]);
      if (!fresh || !fresh.enabled || fresh.entryFee !== review.fee || fresh.requiresPass !== ticket.requiresPass) {
        return fail(t('tf.err.PriceChanged'));
      }
      if (useUi.getState().blockedArenas.includes(arenaId)) return fail(t('tf.err.Maintenance'));
      if (!freshConfig || feeBps(freshConfig, pass !== null) !== review.bps || freshConfig.settleFeeLamports !== review.deposit) {
        return fail(t('tf.err.FeeChanged'));
      }
      const { ixs } = await buildTicketTx(client.ix, {
        player: owner,
        arenaId,
        token: config,
        ataExists: review.steps.includes('ata') ? false : true,
        register: review.register,
        passAsset: pass,
        // the values on the frozen review: the program refuses the join if any is higher (M3)
        maxFeeBps: review.bps,
        maxEntryFee: review.fee,
        maxSettleFee: review.deposit,
      });
      const res = await sendTx(client, connection, wallet, ixs, {
        onPhase,
        computeUnits: TICKET_COMPUTE_UNITS,
        describe: {
          passLock: pass ? pdas.passLock(pass, client.programId) : null,
          session: client.programId ? pdas.session(pdas.arena(arenaId, client.programId), owner, client.programId) : null,
        },
      });
      if (!res.ok) return fail(txErrorText(res.error));
      enterRoom(res.signature, pass);
    } catch (err) {
      fail((err as Error).message);
    }
  };

  /** Collect a finalized payout (R24) or refund an unsettled ticket: `[createAtaIdempotent] + refundSession`. */
  const closeTx = async (kind: 'refund' | 'collect') => {
    if (inFlight.current) return;
    if (!owner || !config || !session) return;
    inFlight.current = true;
    setPhase('preparing');
    sound.click();
    const review = live;
    setFrozen(review);
    const done = () => {
      toast('success', kind === 'refund' ? t('tf.refund.done') : t('tf.collect.done'), undefined, 7000);
      refreshChain();
      onClose();
    };
    if (data.fake) {
      const dev = await loadDevFake();
      if (!dev) return fail(t('tf.err.NetworkError'));
      await dev.fakeSimpleTx(onPhase, () => {
        dev.fakeWallet.ataExists = true;
        dev.fakeWallet.tokenBalance += kind === 'collect' ? review.owed : fee;
        dev.fakeWallet.sessions[arenaId] = null;
      });
      return done();
    }
    if (!client) return fail(t('tf.err.NetworkError'));
    try {
      // fresh on-chain re-check: the same session, still in the state the sheet showed
      const fresh = await client.fetchSession(arenaId, owner);
      if (!fresh || fresh.id !== review.sessionId || fresh.finalized !== (kind === 'collect') || (kind === 'collect' && fresh.owed !== review.owed)) {
        return fail(t('tf.err.SessionChanged'));
      }
      const { ixs } = await buildCloseTx(client.ix, {
        player: owner,
        arenaId,
        token: config,
        finalized: kind === 'collect',
        passAsset: fresh.passAsset,
      });
      const res = await sendTx(client, connection, wallet, ixs, { onPhase, computeUnits: CLOSE_COMPUTE_UNITS });
      if (!res.ok) return fail(txErrorText(res.error));
      setSignature(res.signature);
      done();
    } catch (err) {
      fail((err as Error).message);
    }
  };

  const confirm = mode === 'buy' ? buy : () => closeTx(mode);
  // the price shown must be the price signed: on a real chain the arena account itself must agree (re-read again at confirm)
  const chainArena = data.arenas.find((a) => a.id === arenaId);
  const priceOk = data.fake || (chainArena !== undefined && chainArena.entryFee === ticket.entryFee && chainArena.requiresPass === ticket.requiresPass);
  const maintenance = mode === 'buy' && blockedArenas.includes(arenaId);
  const canConfirm =
    !!owner && !!config && !busy && !maintenance && (mode === 'buy' ? priceOk && nameOk && (!passOn || !!chosenPass) : session !== null && (mode !== 'collect' || !!session.finalized));
  const confirmLabel =
    mode === 'buy'
      ? t('tf.confirm', { fee: tok.exact(fee), sym: tok.symbol })
      : mode === 'refund'
        ? t('tf.refund.cta', { fee: tok.exact(fee), sym: tok.symbol })
        : t('tf.collect.cta', { amount: tok.exact(v.owed), sym: tok.symbol });

  const footer = landed ? (
    <>
      <InkButton variant="pink" size="lg" icon="play" onClick={resume}>
        {t('lo.cta.resume')}
      </InkButton>
      <InkButton variant="paper" size="lg" onClick={onClose} className="tf-cancel">
        {t('tf.close')}
      </InkButton>
    </>
  ) : phase === 'review' || phase === 'error' ? (
    <>
      {/* no autofocus here: the Enter that opened the sheet must never land on the pay button */}
      <InkButton variant="pink" size="lg" icon={mode === 'buy' ? 'ticket' : 'arrow'} disabled={!canConfirm} onClick={() => void confirm()}>
        {phase === 'error' ? t('tf.retry') : confirmLabel}
      </InkButton>
      <InkButton variant="paper" size="lg" onClick={onClose} className="tf-cancel">
        {t('tf.cancel')}
      </InkButton>
    </>
  ) : (
    <div className="tf-status" role="status" aria-live="polite">
      {phase === 'stamped' ? (
        <span className="tf-status__line">{t('tf.entering')}</span>
      ) : (
        <>
          <span className="tf-status__line">
            <StampSpinner size="sm" />
            {phase === 'preparing' ? t('tf.preparing') : phase === 'signing' ? t('tf.signing') : t('tf.confirming')}
          </span>
          <span className="tf-status__note mono">
            {phase === 'preparing'
              ? t('tf.preparingNote')
              : phase === 'signing'
                ? mode === 'buy'
                  ? t('tf.signingNote', { fee: tok.exact(v.fee), sym: tok.symbol })
                  : t('tf.signingSimple')
                : t('tf.confirmingNote')}
          </span>
          {signature && !signature.startsWith('DevFake') && (
            <a className="tf-status__tx mono" href={explorerTx(signature, cluster)} target="_blank" rel="noreferrer">
              {t('tf.viewTx')}
            </a>
          )}
        </>
      )}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      closeLabel={t('tf.close')}
      kicker={t('tf.kicker')}
      title={mode === 'buy' ? t('tf.title') : mode === 'refund' ? t('tf.refund.title') : t('tf.collect.title')}
      className="tf-sheet"
      footer={footer}
    >
      <div className="tf-body">
        {mode !== 'collect' && (
          <TicketPreview ticket={ticket} room={room} fee={tok.fee(v.fee)} sym={tok.symbol} pass={v.pass} stamped={phase === 'stamped'} reduced={reduced} />
        )}

        {landed ? (
          <p className="tf-ok" role="status">
            <Icon name="check" size={18} />
            <span>{t('tf.landed')}</span>
          </p>
        ) : (
          phase === 'error' &&
          error && (
            <p className="tf-error" role="alert">
              <Icon name="info" size={18} />
              <span>
                <b>{t('tf.failed')}.</b> {error}
              </span>
            </p>
          )
        )}

        {mode === 'collect' && (
          <>
            <p className="tf-lede">{t('tf.collect.body')}</p>
            <dl className="tf-lines">
              <Line label={t('tf.collect.owed')} value={`${tok.exact(v.owed)} ${tok.symbol}`} strong />
            </dl>
          </>
        )}
        {mode === 'refund' && <p className="tf-lede">{t('tf.refund.body')}</p>}
        {mode !== 'buy' && (
          <dl className="tf-lines">
            <Line label={t('tf.sol')} value={t('tf.close.solV', { total: sol(v.close.total), back: sol(v.close.back) })} />
          </dl>
        )}

        {mode !== 'collect' && (
          <dl className="tf-lines">
            <Line label={t('tf.entry')} value={`${tok.exact(v.fee)} ${tok.symbol}`} strong />
            {mode === 'buy' && <Line label={t('tf.fee')} value={t('tf.feeV', { n: bpsPercent(v.bps) })} />}
            {mode === 'buy' && v.pass && (
              <Line
                label={t('tf.passLine')}
                value={t('tf.passLineV', { n: passNo(v.pass.number), fee: bpsPercent(v.bps), start: power.startPct, s: power.cashoutS })}
              />
            )}
            <Line label={t('tf.deposit')} value={t('tf.depositV', { sol: sol(v.deposit) })} />
            {mode === 'buy' && <Line label={t('tf.sol')} value={t('tf.solV', { total: sol(v.sol.total), back: sol(v.sol.refundable) })} />}
            {mode === 'buy' && v.balance !== null && (
              <Line label={t('tf.balance')} value={`${tok.fee(v.balance)} → ${tok.fee(v.balance - v.fee)} ${tok.symbol}`} />
            )}
          </dl>
        )}

        {mode === 'buy' && (
          <p className="tf-note">
            {t('tf.feeNote')} {t('tf.depositNote')}
          </p>
        )}
        {maintenance && <p className="tf-warn">{t('tf.err.Maintenance')}</p>}
        {lowSol && !busy && data.balance !== null && <p className="tf-warn">{t('tf.lowSol', { sol: sol(data.balance) })}</p>}

        {mode === 'buy' && (passRequired || owned.length > 0) && (
          <PassChoice
            required={passRequired}
            on={passOn}
            setOn={setUsePass}
            owned={owned}
            free={free}
            chosen={chosenPass}
            choose={setPassAsset}
            disabled={busy}
            feeText={bpsPercent(feeBps(config, true))}
          />
        )}

        {mode === 'buy' && v.register && (
          <Field
            id={nameId}
            label={t('tf.name')}
            hint={t('tf.nameHint')}
            value={name}
            maxLength={24}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            error={!nameOk && name.length > 0 ? t('tf.err.InvalidName') : undefined}
          />
        )}

        <section className="tf-steps" aria-label={t('tf.signs')}>
          <h3 className="tf-steps__h mono">{t('tf.signs')}</h3>
          <ol>
            {(mode === 'buy' ? v.steps : mode === 'refund' ? (['ata', 'refund'] as const) : (['ata', 'collect'] as const)).map((s, i) => (
              <li key={s}>
                <span className="tf-steps__n mono" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  {s === 'ata'
                    ? mode === 'buy'
                      ? t('tf.step.ata')
                      : t('tf.step.ataIdem')
                    : s === 'collect'
                      ? t('tf.step.collect', { room })
                    : s === 'register'
                      ? t('tf.step.register', { name: v.register?.name || '—' })
                      : s === 'joinWithPass'
                        ? t('tf.step.joinWithPass', { n: passNo(v.pass?.number ?? 0), room })
                        : s === 'refund'
                          ? t('tf.step.refund', { room })
                          : t('tf.step.join', { room })}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <span ref={endRef} className="tf-end" aria-hidden="true" />
        <span className={`tf-more${moreBelow ? ' is-on' : ''}`} aria-hidden="true">
          <span className="tf-more__pill mono">
            <Icon name="chevron" size={14} />
            {t('tf.more')}
          </span>
        </span>
      </div>
    </Sheet>
  );
}

interface Review {
  sol: SolCost;
  steps: TicketStep[];
  fee: bigint;
  bps: number;
  deposit: number;
  balance: bigint | null;
  register: { name: string; skin: number } | null;
  pass: OwnedPass | null;
  /** Finalized session payout to collect (raw units). */
  owed: bigint;
  /** SOL of the collect / refund transaction. */
  close: { total: number; back: number };
  /** On-chain id of the session the sheet showed (re-checked before signing). */
  sessionId: number | null;
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`tf-line${strong ? ' is-strong' : ''}`}>
      <dt className="mono">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PassChoice({
  required,
  on,
  setOn,
  owned,
  free,
  chosen,
  choose,
  disabled,
  feeText,
}: {
  required: boolean;
  on: boolean;
  setOn: (v: boolean) => void;
  owned: OwnedPass[];
  free: OwnedPass[];
  chosen: OwnedPass | null;
  choose: (asset: string) => void;
  disabled: boolean;
  feeText: string;
}) {
  const t = useT();
  const power = usePassPower();
  const skin = useUi((s) => s.settings.skin);
  const groupId = useId();
  const allBusy = owned.length > 0 && free.length === 0;
  return (
    <section className={`tf-pass${on ? ' is-on' : ''}`}>
      {required ? (
        <div className="tf-pass__head">
          <Icon name="passport" size={20} />
          <span className="tf-pass__title">{t('tf.pass.required')}</span>
        </div>
      ) : (
        <button type="button" role="switch" aria-checked={on} className="tf-switch" onClick={() => setOn(!on)} disabled={disabled || free.length === 0}>
          <span className="tf-switch__track" aria-hidden="true">
            <span className="tf-switch__knob" />
          </span>
          <span className="tf-pass__title">{t('tf.pass.toggle')}</span>
        </button>
      )}
      <p className="tf-pass__note">
        {required ? t('tf.pass.requiredNote') : t('tf.pass.toggleNote', { fee: feeText, start: power.startPct, s: power.cashoutS })}
      </p>
      {allBusy && <p className="tf-warn">{t('tf.pass.allBusy')}</p>}
      {on && owned.length > 1 && (
        <fieldset className="tf-pick" disabled={disabled}>
          <legend className="mono">{t('tf.pass.pick')}</legend>
          {owned.map((p) => {
            const busy = !free.includes(p);
            return (
              <label key={p.asset} className={`tf-pick__item${chosen?.asset === p.asset ? ' is-on' : ''}${busy ? ' is-busy' : ''}`}>
                <input type="radio" name={groupId} value={p.asset} checked={chosen?.asset === p.asset} disabled={busy} onChange={() => choose(p.asset)} />
                <CoinPortrait skin={skin} pass={p.number} size={36} still seed={p.number} />
                <span className="mono">{t('tf.pass.no', { n: passNo(p.number) })}</span>
                {busy && <span className="tf-pick__busy mono">{t('tf.pass.busy')}</span>}
              </label>
            );
          })}
        </fieldset>
      )}
    </section>
  );
}

/** The ticket itself: stamped "VALID" on confirmation, then its stub tears off. */
function TicketPreview({
  ticket,
  room,
  fee,
  sym,
  pass,
  stamped,
  reduced,
}: {
  ticket: TicketModel;
  room: string;
  fee: string;
  sym: string;
  pass: OwnedPass | null;
  stamped: boolean;
  reduced: boolean;
}) {
  const t = useT();
  const [torn, setTorn] = useState(false);
  useEffect(() => {
    if (!stamped) {
      setTorn(false);
      return;
    }
    const id = setTimeout(() => setTorn(true), reduced ? 200 : TEAR_AT_MS);
    return () => clearTimeout(id);
  }, [stamped, reduced]);
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const serial = `${String(ticket.arenaId).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const style = { '--kl-ink': arenaMeta(ticket.arenaId ?? 0).ink } as CSSProperties;
  const tearTo = reduced ? { opacity: 0 } : { x: [0, 6, 30], y: [0, 4, 46], rotate: [0, 4, 14], opacity: [1, 1, 0] };
  return (
    <div className={`tf-ticket${torn ? ' is-torn' : ''}`} style={style} aria-hidden="true">
      <motion.div
        className="tf-ticket__half is-main"
        animate={torn && !reduced ? { x: [0, -5, 0], rotate: [0, -0.6, 0] } : { x: 0, rotate: 0 }}
        transition={{ duration: 0.34, ease: 'easeOut' }}
      >
        <div className="tf-ticket__main">
          <span className="tf-ticket__kicker mono">
            {t('tf.admit')} · {t('tf.seat')}
          </span>
          <span className="tf-ticket__room">{room}</span>
          <span className="tf-ticket__serial mono">
            {t('tf.serial', { n: serial })} · {date} {time}
          </span>
          {pass && (
            <span className="tf-ticket__pass mono">
              <Icon name="passport" size={14} /> {t('tf.pass.no', { n: passNo(pass.number) })}
            </span>
          )}
          {stamped && (
            <span className="tf-ticket__stamp">
              <Stamp text={t('tf.stamped')} tone="teal" size="lg" rotate={-9} animateIn />
            </span>
          )}
        </div>
      </motion.div>
      <motion.div
        className="tf-ticket__half is-stub"
        initial={false}
        animate={torn ? tearTo : { x: 0, y: 0, rotate: 0, opacity: 1 }}
        transition={
          reduced ? { duration: 0.2 } : { duration: 0.72, times: [0, 0.32, 1], ease: ['easeOut', 'easeIn'], opacity: { duration: 0.72, times: [0, 0.78, 1] } }
        }
      >
        <div className="tf-ticket__stub">
          <span className="tf-ticket__fee">{fee}</span>
          <span className="tf-ticket__sym mono">{sym}</span>
          {ticket.requiresPass && (
            <span className="tf-ticket__passmark">
              <Stamp text={t('lo.passStamp')} tone="pink" size="sm" rotate={-11} />
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

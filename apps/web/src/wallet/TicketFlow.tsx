import { getArenaConfig, getSession, planJoin, refundCall, sessionRefundState, formatHypeAmount } from '@elymum/sdk';
import { arenaMeta } from '@elymum/shared';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Address, Hash } from 'viem';
import { Button, CoinCharacter, Icon, Sheet, Stamp, StampSpinner, markTransitionOrigin, useReducedMotion } from '../design';
import { engine } from '../game/instance';
import { sound } from '../audio';
import { useT } from '../i18n';
import { toast, updateSettings, useUi } from '../store';
import { ticketName, useTokenText } from '../ui/lobby/useLobby';
import { refreshChain, useChainData, useReadClient } from './chain';
import { isFakeHash } from './devFake';
import { loadDevFake } from './devFakeLoader';
import { explorerTx } from './links';
import { serverChainInfo } from './network';
import { useAddress } from './store';
import { bpsPercent, feeBps, planErrorName, ticketFeeBps, ticketSteps, type TicketModel, type TicketStep } from './ticket';
import { sendWalletCall, txErrorText, type TxPhase } from './tx';

/** `collect`: a finalized session's payout; `refund`: an unsettled ticket after 24 h. */
export type FlowMode = 'buy' | 'refund' | 'collect';

type Phase = 'review' | 'preparing' | TxPhase | 'stamped' | 'error';

/**
 * Stamp (420 ms) → tear → boarding: behind the torn stub is the shuttle's hatch; my coin hops
 * off the pass, up to the door and in, the doors close with a chime → into the room.
 */
const TEAR_AT_MS = 560;
const BOARD_AT_MS = 820;
const WALK_MS = 680;
const DOORS_AT_MS = BOARD_AT_MS + WALK_MS;
const PLAY_AT_MS = 2_000;

/**
 * Cutting a ticket: a confirm sheet that shows exactly what is signed (entry fee, fee policy,
 * every call), then at most two wallet prompts, `approve` (only when the allowance is short,
 * for exactly the entry fee) and `join`, each confirmed by its receipt, then the stamp lands,
 * the stub tears off and the player enters the room. The same sheet collects a finalized game's
 * payout (any time) and refunds an unsettled ticket after 24 h, each with one `refund` call.
 *
 * Money safety: one in-flight guard (a ref, so a double click or a held Enter cannot start a
 * second transaction before React re-renders), focus never starts on the pay button, the values
 * are frozen at confirm, the arena and config are re-read from the chain right before the
 * wallet opens, and the wallet is switched to the server's chain first.
 */
export function TicketFlow({ open, mode, ticket, onClose }: { open: boolean; mode: FlowMode; ticket: TicketModel | null; onClose: () => void }) {
  const t = useT();
  const blockedArenas = useUi((s) => s.blockedArenas);
  const chain = useUi((s) => s.chain);
  const owner = useAddress();
  const client = useReadClient();
  const data = useChainData();
  const tok = useTokenText();
  const reduced = useReducedMotion();
  const serverBps = useUi((s) => s.chain?.feeBps ?? null);
  const tokenReady = useUi((s) => s.chain?.tokenReady === true);

  const [phase, setPhase] = useState<Phase>('review');
  /** The call in flight (buy: approve or join). */
  const [step, setStep] = useState<TicketStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  /** What was on the sheet when the player pressed confirm: shown until the flow ends, never re-read from the chain. */
  const [frozen, setFrozen] = useState<Review | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const timers = useRef<number[]>([]);
  /** Synchronous double-submit guard: set before the first await, cleared only on failure or reopen. */
  const inFlight = useRef(false);
  const endRef = useRef<HTMLSpanElement>(null);

  const arenaId = ticket?.arenaId ?? null;
  const session = arenaId !== null ? (data.sessions[arenaId] ?? null) : null;

  // fresh state every time the sheet opens
  useEffect(() => {
    if (!open) return;
    inFlight.current = false;
    setPhase('review');
    setStep(null);
    setError(null);
    setHash(null);
    setFrozen(null);
  }, [open, ticket?.key, mode]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

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
  const chainName = serverChainInfo(chain)?.name ?? 'Elysium';
  // the game token must be set for any ticket transaction (the lobby lists none before)
  const config = data.config?.token ? data.config : null;
  const arenaAddress = (chain?.arenaAddress ?? null) as Address | null;
  const normalBps = feeBps(serverBps, config);
  // emblem holders get the holder rate, fixed into the ticket at join (planJoin's feeBps)
  const holderRate = ticketFeeBps(normalBps, config, data.holder);
  const bps = holderRate.bps;
  const fee = mode === 'refund' ? (session?.entryFee ?? ticket.entryFee) : ticket.entryFee;
  const steps: TicketStep[] = ticketSteps(data.allowance, fee);
  const busy = phase === 'preparing' || phase === 'switching' || phase === 'signing' || phase === 'confirming' || phase === 'stamped';
  const owed = session?.finalized ? session.owed : 0n;
  const live: Review = { steps, fee, bps, balance: data.tokenBalance, wei: data.balance, owed, sessionId: session?.id ?? null };
  const v = frozen ?? live;
  const lowGas = data.balance !== null && data.balance === 0n;
  // the transaction landed after all (e.g. the receipt timed out): never offer to pay twice
  const landed = mode === 'buy' && session !== null && (phase === 'review' || phase === 'error');
  const txLink = hash && !isFakeHash(hash) ? explorerTx(hash) : null;

  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  const fail = (text: string) => {
    inFlight.current = false;
    setFrozen(null);
    setStep(null);
    setError(text);
    setPhase('error');
    refreshChain();
  };
  const failName = (name: string, fallback?: string) => fail(txErrorText({ kind: 'unknown', name, message: fallback ?? name }));

  const onPhase = (s: TicketStep | null) => (p: TxPhase, h?: Hash) => {
    setStep(s);
    setPhase(p);
    if (h) setHash(h);
  };

  const enterRoom = (h: Hash) => {
    setPhase('stamped');
    setStep(null);
    if (!reduced) later(290, () => sound.stamp('valid'));
    const href = isFakeHash(h) ? null : explorerTx(h);
    toast('success', t('tf.ticketOk'), href ? { href, label: t('tf.viewTx') } : undefined, 6000);
    updateSettings({ lastArena: arenaId });
    refreshChain();
    later(reduced ? 700 : PLAY_AT_MS, () => {
      // the page opens onto the room from the VALID stamp
      markTransitionOrigin(document.querySelector('.tf-ticket__stamp') ?? document.querySelector('.tf-ticket'));
      engine()?.play(`arena:${arenaId}`, { awaitTicket: true });
      onClose();
    });
  };

  const resume = () => {
    sound.punch();
    updateSettings({ lastArena: arenaId });
    markTransitionOrigin(document.querySelector('.tf-ticket'));
    engine()?.play(`arena:${arenaId}`);
    onClose();
  };

  const buy = async () => {
    if (inFlight.current) return;
    if (!owner || !config || !chain) return;
    inFlight.current = true;
    setPhase('preparing');
    sound.click();
    const review = live;
    setFrozen(review);
    if (data.fake) {
      const dev = await loadDevFake();
      if (!dev) return failName('NetworkError');
      const res = await dev.fakeSendTicket(owner, arenaId, review.fee, review.steps, review.bps, (s, p, h) => onPhase(s)(p, h));
      if (!res.ok) return failName(res.name);
      setHash(res.hash);
      return enterRoom(res.hash);
    }
    if (!client || !arenaAddress) return failName('NetworkError');
    // the server keeps this arena closed (vault short of its journal): never sell a ticket
    if (useUi.getState().blockedArenas.includes(arenaId)) return failName('Maintenance');
    let plan;
    try {
      // re-read the arena, the allowance and the config: the price and the fee rate (fixed into the
      // ticket at join) signed must be the ones shown
      const [p, fresh] = await Promise.all([
        planJoin(client, { arena: arenaAddress, arenaId, player: owner, token: config.token! }),
        getArenaConfig(client, arenaAddress),
      ]);
      if (p.entryFee !== review.fee) return failName('PriceChanged');
      // the rate this ticket will be fixed at: the holder rate for holders (planJoin reads it on chain)
      const rate = p.feeBps ?? ticketFeeBps(fresh.feeBps, fresh, p.holder).bps;
      if (rate !== review.bps) return failName('FeeChanged');
      if (fresh.paused) return failName('Paused');
      plan = p;
    } catch (err) {
      return err instanceof RangeError ? failName(planErrorName(err.message), err.message) : failName('NetworkError');
    }
    if (useUi.getState().blockedArenas.includes(arenaId)) return failName('Maintenance');
    if (plan.approve) {
      const ok = await sendWalletCall(plan.approve, { chain, onPhase: onPhase('approve') });
      if (!ok.ok) return fail(txErrorText(ok.error));
    }
    const res = await sendWalletCall(plan.join, { chain, onPhase: onPhase('join') });
    if (!res.ok) return fail(txErrorText(res.error));
    enterRoom(res.hash);
  };

  /** Collect a finalized payout or refund an unsettled ticket: one `refund(arenaId)` call. */
  const closeTx = async (kind: 'refund' | 'collect') => {
    if (inFlight.current) return;
    if (!owner || !config || !session || !chain) return;
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
      if (!dev) return failName('NetworkError');
      await dev.fakeSimpleTx(onPhase(null), () => {
        dev.fakeWallet.tokenBalance += kind === 'collect' ? review.owed : fee;
        dev.fakeWallet.sessions[arenaId] = null;
      });
      return done();
    }
    if (!client || !arenaAddress) return failName('NetworkError');
    try {
      // fresh on-chain re-check: the same session, still in the state the sheet showed
      const fresh = await getSession(client, arenaAddress, arenaId, owner);
      const state = sessionRefundState(fresh);
      if (fresh.id !== review.sessionId || state.kind !== kind || (kind === 'collect' && fresh.owed !== review.owed)) {
        return failName(state.kind === 'wait' ? 'RefundTooEarly' : 'SessionChanged');
      }
    } catch {
      return failName('NetworkError');
    }
    const res = await sendWalletCall(refundCall(arenaAddress, arenaId), { chain, onPhase: onPhase(null) });
    if (!res.ok) return fail(txErrorText(res.error));
    done();
  };

  const confirm = mode === 'buy' ? buy : () => closeTx(mode);
  // the price shown must be the price signed: on a real chain the arena itself must agree (re-read again at confirm)
  const chainArena = data.arenas.find((a) => a.id === arenaId);
  const priceOk = !ticket.soon && (data.fake || (chainArena !== undefined && chainArena.entryFee === ticket.entryFee));
  const maintenance = mode === 'buy' && blockedArenas.includes(arenaId);
  const canConfirm =
    !!owner && !!config && tokenReady && !busy && !maintenance && (mode === 'buy' ? priceOk : session !== null && (mode !== 'collect' || !!session.finalized));
  const confirmLabel =
    mode === 'buy'
      ? t('tf.confirm', { fee: tok.exact(fee), sym: tok.symbol })
      : mode === 'refund'
        ? t('tf.refund.cta', { fee: tok.exact(fee), sym: tok.symbol })
        : t('tf.collect.cta', { amount: tok.exact(v.owed), sym: tok.symbol });

  const stepIndex = step ? v.steps.indexOf(step) + 1 : 0;
  /** Calls already confirmed on the way (the boarding sequence ticks them off). */
  const doneCount = phase === 'stamped' ? v.steps.length : stepIndex > 0 ? stepIndex - 1 : 0;
  const stepLabel =
    step === 'approve' ? t('tf.step.approve', { fee: tok.exact(v.fee), sym: tok.symbol }) : step === 'join' ? t('tf.step.join', { room }) : null;

  const footer = landed ? (
    <>
      <Button variant="primary" size="lg" icon="play" onClick={resume}>
        {t('lo.cta.resume')}
      </Button>
      <Button variant="secondary" size="lg" onClick={onClose} className="tf-cancel">
        {t('tf.close')}
      </Button>
    </>
  ) : phase === 'review' || phase === 'error' ? (
    <>
      {/* no autofocus here: the Enter that opened the sheet must never land on the pay button */}
      <Button variant="primary" size="lg" icon={mode === 'buy' ? 'ticket' : 'arrow'} disabled={!canConfirm} onClick={() => void confirm()} className="tf-pay">
        {phase === 'error' ? t('tf.retry') : confirmLabel}
      </Button>
      <Button variant="secondary" size="lg" onClick={onClose} className="tf-cancel">
        {t('tf.cancel')}
      </Button>
    </>
  ) : (
    <div className="tf-status" role="status" aria-live="polite">
      {phase === 'stamped' ? (
        <span className="tf-status__line">{t('tf.entering')}</span>
      ) : (
        <>
          {mode === 'buy' && stepIndex > 0 && (
            <span className="tf-status__step mono" data-testid="tf-step">
              {t('tf.stepOf', { n: stepIndex, total: v.steps.length })}
              {stepLabel ? ` · ${stepLabel}` : ''}
            </span>
          )}
          <span className="tf-status__line">
            <StampSpinner size="sm" />
            {phase === 'preparing'
              ? t('tf.preparing')
              : phase === 'switching'
                ? t('tf.switching', { chain: chainName })
                : phase === 'signing'
                  ? step === 'approve'
                    ? t('tf.approving')
                    : t('tf.signing')
                  : t('tf.confirming')}
          </span>
          <span className="tf-status__note mono">
            {phase === 'preparing'
              ? t('tf.preparingNote')
              : phase === 'switching'
                ? t('tf.switchingNote')
                : phase === 'signing'
                  ? mode === 'buy'
                    ? step === 'approve'
                      ? t('tf.approvingNote', { fee: tok.exact(v.fee), sym: tok.symbol })
                      : t('tf.signingNote', { fee: tok.exact(v.fee), sym: tok.symbol })
                    : t('tf.signingSimple')
                  : t('tf.confirmingNote')}
          </span>
          {txLink && (
            <a className="tf-status__tx mono" href={txLink} target="_blank" rel="noreferrer">
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
          <TicketPreview ticket={ticket} room={room} fee={tok.fee(v.fee)} sym={tok.symbol} stamped={phase === 'stamped'} reduced={reduced} />
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

        <section className="tf-steps" aria-label={t('tf.signs')}>
          <h3 className="tf-steps__h mono">{v.steps.length > 1 && mode === 'buy' ? t('tf.signsTwo') : t('tf.signs')}</h3>
          <ol>
            {(mode === 'buy' ? v.steps : ([mode] as const)).map((s, i) => (
              <li key={s} className={mode === 'buy' && i < doneCount ? 'is-done' : step === s || (mode !== 'buy' && busy) ? 'is-active' : undefined}>
                <span className="tf-steps__n num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  {s === 'approve'
                    ? t('tf.step.approve', { fee: tok.exact(v.fee), sym: tok.symbol })
                    : s === 'collect'
                      ? t('tf.step.collect', { room })
                      : s === 'refund'
                        ? t('tf.step.refund', { room })
                        : t('tf.step.join', { room })}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {mode === 'collect' && (
          <>
            <p className="tf-lede">{t('tf.collect.body')}</p>
            <dl className="tf-lines">
              <Line label={t('tf.collect.owed')} value={`${tok.exact(v.owed)} ${tok.symbol}`} strong />
            </dl>
          </>
        )}
        {mode === 'refund' && <p className="tf-lede">{t('tf.refund.body')}</p>}

        <dl className="tf-lines">
          {mode !== 'collect' && <Line label={t('tf.entry')} value={`${tok.exact(v.fee)} ${tok.symbol}`} strong />}
          {mode === 'buy' && (
            <Line
              label={t('tf.fee')}
              value={holderRate.discount ? `${t('tf.feeV', { n: bpsPercent(v.bps) })} · ${t('tf.feeHolder', { std: bpsPercent(normalBps) })}` : t('tf.feeV', { n: bpsPercent(v.bps) })}
            />
          )}
          <Line label={t('tf.gas')} value={t('tf.gasV', { chain: chainName, hype: v.wei === null ? '…' : formatHypeAmount(v.wei, 4) })} />
          {mode === 'buy' && v.balance !== null && (
            <Line label={t('tf.balance')} value={`${tok.fee(v.balance)} → ${tok.fee(v.balance - v.fee)} ${tok.symbol}`} />
          )}
        </dl>

        {mode === 'buy' && <p className="tf-note">{t('tf.feeNote')}</p>}
        {maintenance && <p className="tf-warn">{t('tf.err.Maintenance')}</p>}
        {lowGas && !busy && <p className="tf-warn">{t('tf.lowGas', { chain: chainName })}</p>}

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
  steps: TicketStep[];
  /** Base units. */
  fee: bigint;
  bps: number;
  balance: bigint | null;
  /** HYPE, wei. */
  wei: bigint | null;
  /** Finalized session payout to collect (base units). */
  owed: bigint;
  /** On-chain id of the session the sheet showed (re-checked before signing). */
  sessionId: bigint | null;
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`tf-line${strong ? ' is-strong' : ''}`}>
      <dt className="mono">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The boarding pass itself: stamped "VALID" on confirmation, then its stub tears off. */
function TicketPreview({
  ticket,
  room,
  fee,
  sym,
  stamped,
  reduced,
}: {
  ticket: TicketModel;
  room: string;
  fee: string;
  sym: string;
  stamped: boolean;
  reduced: boolean;
}) {
  const t = useT();
  const [torn, setTorn] = useState(false);
  /** The coin's walk to the hatch (px from its seat on the pass), once boarding starts. */
  const [walk, setWalk] = useState<{ dx: number; dy: number } | null>(null);
  const [doors, setDoors] = useState(false);
  const coinRef = useRef<HTMLSpanElement>(null);
  const doorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!stamped) {
      setTorn(false);
      setWalk(null);
      setDoors(false);
      return;
    }
    const ids = [
      setTimeout(
        () => {
          setTorn(true);
          if (!reduced) sound.tear();
        },
        reduced ? 200 : TEAR_AT_MS,
      ),
      setTimeout(
        () => {
          const c = coinRef.current?.getBoundingClientRect();
          const d = doorRef.current?.getBoundingClientRect();
          if (!reduced && c && d) setWalk({ dx: d.left + d.width / 2 - (c.left + c.width / 2), dy: d.top + d.height * 0.62 - (c.top + c.height / 2) });
        },
        reduced ? 250 : BOARD_AT_MS,
      ),
      setTimeout(
        () => {
          setDoors(true);
          // "doors closing": a two-note station chime
          if (!reduced) sound.pin('success');
        },
        reduced ? 300 : DOORS_AT_MS,
      ),
    ];
    return () => ids.forEach(clearTimeout);
  }, [stamped, reduced]);
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const serial = `${String(ticket.arenaId).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const style = { '--kl-ink': arenaMeta(ticket.arenaId ?? 0).ink } as CSSProperties;
  const tearTo = reduced ? { opacity: 0 } : { x: [0, 6, 30], y: [0, 4, 46], rotate: [0, 4, 14], opacity: [1, 1, 0] };
  return (
    <div className={`tf-ticket${torn ? ' is-torn' : ''}${doors ? ' is-boarded' : ''}`} style={style} aria-hidden="true">
      {/* behind the stub: the shuttle's hatch, lit, waiting */}
      <span ref={doorRef} className="tf-hatch">
        <svg viewBox="0 0 116 120" preserveAspectRatio="xMidYMid slice" className="tf-hatch__svg" focusable="false">
          <rect x="0" y="0" width="116" height="120" fill="#0F2A30" />
          <path d="M-10 26 Q58 -6 126 26" stroke="#1E4D5A" strokeWidth="3" fill="none" />
          <circle cx="20" cy="14" r="1.6" fill="#93D9EE" />
          <circle cx="92" cy="10" r="1.3" fill="#93D9EE" />
          <path d="M28 120 V58 a30 30 0 0 1 60 0 V120Z" fill="#04181C" />
          <path d="M33 120 V60 a25 25 0 0 1 50 0 V120Z" fill="#F2C14E" />
          <path d="M33 120 V60 a25 25 0 0 1 50 0 V120Z" fill="#F6EEDA" opacity="0.35" />
          <g className="tf-hatch__door is-left">
            <path d="M33 120 V60 a25 25 0 0 1 25 -25 V120Z" fill="#2D7388" stroke="#04181C" strokeWidth="2.5" />
            <path d="M50 72 v18" stroke="#93D9EE" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <g className="tf-hatch__door is-right">
            <path d="M83 120 V60 a25 25 0 0 0 -25 -25 V120Z" fill="#2D7388" stroke="#04181C" strokeWidth="2.5" />
            <path d="M66 72 v18" stroke="#93D9EE" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <path d="M28 120 V58 a30 30 0 0 1 60 0 V120" stroke="#04181C" strokeWidth="4" fill="none" />
          <circle cx="58" cy="22" r="5" className="tf-hatch__lamp" stroke="#04181C" strokeWidth="2.5" />
          <path d="M14 120 L40 98 H76 L102 120Z" fill="#DDD6C7" stroke="#04181C" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M30 112 H86 M38 104 H78" stroke="#04181C" strokeWidth="1.6" opacity="0.5" />
        </svg>
      </span>
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
          <span className="tf-ticket__fields">
            <span>
              <i className="mono">{t('tf.field.from')}</i>
              <b className="mono">{t('tf.field.fromV')}</b>
            </span>
            <span>
              <i className="mono">{t('tf.field.to')}</i>
              <b className="mono">{t('tf.field.toV')}</b>
            </span>
            <span>
              <i className="mono">{t('tf.field.date')}</i>
              <b className="mono">
                {date} {time}
              </b>
            </span>
          </span>
          <span className="tf-ticket__serial mono">{t('tf.serial', { n: serial })}</span>
          <motion.span
            ref={coinRef}
            className="tf-ticket__coin"
            initial={false}
            animate={
              walk
                ? {
                    // hop, hop, hop up the gangway and in through the hatch
                    x: [0, walk.dx * 0.3, walk.dx * 0.62, walk.dx * 0.9, walk.dx],
                    y: [0, -16, walk.dy * 0.5 - 12, walk.dy - 10, walk.dy],
                    scale: [1, 1, 0.95, 0.85, 0.62],
                    rotate: [0, 8, -6, 6, 0],
                    opacity: [1, 1, 1, 1, 0],
                  }
                : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }
            }
            transition={walk ? { duration: WALK_MS / 1000, times: [0, 0.25, 0.55, 0.85, 1], ease: 'easeInOut' } : { duration: 0 }}
          >
            <CoinCharacter paint="sun" mood={stamped ? 'happy' : 'smile'} size={54} bob={!reduced && !walk} feet={!!walk} />
          </motion.span>
          {stamped && (
            <span className="tf-ticket__stamp">
              <Stamp text={t('tf.stamped')} tone="up" size="lg" rotate={-9} animateIn />
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
          <span className="tf-ticket__fee num">{fee}</span>
          <span className="tf-ticket__sym mono">{sym}</span>
        </div>
      </motion.div>
    </div>
  );
}

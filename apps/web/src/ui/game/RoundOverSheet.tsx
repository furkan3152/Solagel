import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Receipt, Sheet, Stamp, useReducedMotion, type ReceiptLine } from '../../design';
import { CoinPortrait } from './CoinPortrait';
import { engine } from '../../game/instance';
import { roundStartLabel } from '../../game/round';
import { useChainData } from '../../wallet/chain';
import { isFakeHash } from '../../wallet/devFake';
import { feeBps } from '../../wallet/ticket';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { explorerTx } from '../../wallet/links';
import { requestTicket, useUi } from '../../store';
import { formatClock, ordinal, roomName, useTokenFormat } from './format';

/** The receipt waits for the bell to swing in and ring over the frozen world (ms). */
export const ROUND_SHEET_DELAY_MS = 1500;

/** Rows of the room's standings shown on the receipt sheet. */
const TOP = 5;

/**
 * Receipt numbers: the settlement's own `fee` / `net` once it arrives, an
 * estimate at `bps` (the live config's rate for this ticket: `feeBps`) before.
 * After settlement the fee % label is derived from the real fee and the gain.
 */
export function receiptNumbers(payout: number, entryFee: number, bps: number, settled: { fee?: number; net?: number } | null) {
  const gain = payout - entryFee;
  const estFee = Math.floor((Math.max(0, gain) * bps) / 10_000);
  const final = settled?.fee !== undefined;
  const fee = settled?.fee ?? estFee;
  const net = settled?.net ?? payout - fee;
  const pct = final && gain > 0 ? Math.round((fee / gain) * 1000) / 10 : bps / 100;
  return { gain, fee, net, pct, final };
}

/** The settlement for this ticket: matched by its session key only. */
export function settlementFor<T extends { session: string | null }>(settled: T | null, ticketSession: string | null | undefined): T | null {
  return settled && ticketSession && settled.session === ticketSession ? settled : null;
}

/**
 * "Round over", the landing report: the bell rang while my coin was alive, so the till is paid.
 * After a beat (the bell wave over the frozen world) the report flies out of the worth sticker: the
 * till, the fee on profit and what was paid (an estimate until `settled` arrives, then a PAID
 * stamp and the transaction link), my place and the room's top 5 at the bell. "Next round"
 * goes back to the lobby with this arena's ticket ready to buy.
 *
 * The same receipt, without the standings, serves an operator exit (`exit`: an admin kick or
 * a server shutdown pays the current value).
 */
export function RoundOverSheet() {
  const t = useT();
  const tf = useTokenFormat();
  const res = useUi((s) => s.roundResult);
  const room = useUi((s) => s.room);
  const ticket = useUi((s) => s.ticket);
  const chain = useUi((s) => s.chain);
  const settledRaw = useUi((s) => s.lastSettlement);
  const config = useChainData((s) => s.config);
  const serverBps = useUi((s) => s.chain?.feeBps ?? null);
  // the rate fixed into this ticket at join (its session), else the live rate
  const sessionBps = useChainData((s) => (ticket?.arenaId != null ? (s.sessions[ticket.arenaId]?.feeBps ?? null) : null));
  const over = useUi((s) => s.screen === 'roundover' && s.roundResult !== null);
  const reduced = useReducedMotion();
  const exit = res?.kind === 'exit';
  const mySkin = useUi((s) => s.me?.skin ?? s.settings.skin);

  // the bell first, then the receipt (at once with reduced motion or after an operator exit)
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!over) {
      setOpen(false);
      return;
    }
    if (reduced || exit) {
      setOpen(true);
      return;
    }
    const id = setTimeout(() => setOpen(true), ROUND_SHEET_DELAY_MS);
    return () => clearTimeout(id);
  }, [over, reduced, exit]);

  // the receipt slips out of the till and grows into this sheet (read while the till is on screen)
  const fromTill = useMemo(() => (open ? receiptOrigin() : null), [open]);
  const [since, setSince] = useState(() => Date.now());
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSince(Date.now());
    setPrinted(false);
    // the slip feeds out of the till's printer
    if (!reduced) sound.print(1300);
    return () => sound.stopPrint();
  }, [open]);

  const settled = settlementFor(settledRaw, ticket?.session);
  useEffect(() => {
    if (settled && printed) sound.stamp('paid');
  }, [settled, printed]);

  const toLobby = () => engine()?.backToLobby();
  const nextRound = () => {
    if (room?.arenaId !== undefined) requestTicket(room.arenaId);
    engine()?.backToLobby();
  };

  const payout = res?.payout ?? 0;
  const entry = ticket?.entryFee ?? room?.entryFee ?? 0;
  const n = receiptNumbers(payout, entry, sessionBps ?? feeBps(serverBps, config), settled);
  const roundTime = res?.round != null ? roundStartLabel(res.round, room?.round) : '';
  const approx = n.final ? '' : `${t('gr.estimate')} `;
  const lines: ReceiptLine[] = [
    { label: t('gr.till'), value: tf.fmt(payout) },
    {
      label: <>{t('gr.fee', { pct: n.pct.toLocaleString('en-US', { maximumFractionDigits: 1 }) })}</>,
      value: n.fee > 0 ? `${approx}−${tf.fmt(n.fee)}` : tf.fmt(0),
      muted: true,
    },
    {
      label: t('gr.paidLine'),
      value: (
        <span className="g-receipt__net">
          {approx}
          {tf.fmt(n.net)}
          <small className="mono">{tf.symbol}</small>
        </span>
      ),
      strong: true,
    },
  ];
  const date = new Date(since).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const txHref = settled && !isFakeHash(settled.txHash) ? explorerTx(settled.txHash, chain?.explorerUrl) : null;
  const footer = settled ? (
    txHref ? (
      <a className="g-receipt__tx" href={txHref} target="_blank" rel="noreferrer">
        {t('gr.viewTx')} · {settled.txHash.slice(0, 6)}…{settled.txHash.slice(-4)}
        <Icon name="arrow" size={14} />
      </a>
    ) : (
      <span className="g-receipt__tx mono">
        {settled.txHash.slice(0, 6)}…{settled.txHash.slice(-4)}
      </span>
    )
  ) : (
    <span className="g-receipt__pending" role="status">
      {t('gr.settling')}
      <span className="g-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );

  const standings = res?.standings ?? [];
  const mine = standings.findIndex((s) => s.you);
  const place = mine >= 0 ? ordinal(mine + 1) : standings.length > 0 ? t('gr.placeOut', { n: standings.length }) : '—';

  return (
    <Sheet
      open={open}
      onClose={toLobby}
      closeLabel={t('gr.close')}
      kicker={exit ? t('gr.exitKicker', { room: roomName(room) }) : t('gr.kicker', { time: roundTime, room: roomName(room) })}
      title={<span className="g-roundover__title">{exit ? t('gr.exitTitle') : t('gr.title')}</span>}
      className={`g-sheet g-roundover${exit ? '' : ' has-board'}`}
      enterFrom={fromTill}
      footer={
        <>
          <Button variant="primary" size="lg" icon="ticket" onClick={nextRound} data-autofocus>
            {exit ? t('gr.newTicket') : t('gr.next')}
          </Button>
          <Button variant="secondary" size="lg" icon="menu" onClick={toLobby}>
            {t('gr.lobby')}
          </Button>
        </>
      }
    >
      <div className="g-roundover__body">
        <div className="g-roundover__slip">
          <Receipt
            printing
            onPrinted={() => setPrinted(true)}
            title={exit ? t('gr.receiptExit') : t('gr.receipt', { time: roundTime })}
            meta={`${date}${res?.stats ? ` · ${formatClock(res.stats.aliveMs)}` : ''}`}
            lines={lines}
            code={settled?.txHash ?? `pending-${since}`}
            footer={footer}
          />
          <AnimatePresence>
            {settled && printed && (
              <motion.div className="g-roundover__stamp" initial={false} exit={{ opacity: 0 }}>
                <Stamp text={t('gr.paid')} sub="ELYSIUM" round size="md" tone="up" rotate={-12} animateIn={!reduced} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {settled?.collect && (
          <p className="g-roundover__note" role="status">
            {t('gr.collect')}
          </p>
        )}
        <p className="g-roundover__note mono">{exit ? t('gr.exitNote') : t('gr.feeNote')}</p>

        {!exit && (
          <section className="g-board" aria-label={t('gr.top')}>
            <div className="g-board__landing">
              <CoinPortrait skin={mySkin} size={76} expression="happy" seed={5} className="g-board__coin" />
              <dl className="g-board__place">
                <dt className="mono">{t('gr.place')}</dt>
                <dd>{place}</dd>
              </dl>
            </div>
            <h3 className="g-board__title mono">{t('gr.top')}</h3>
            <ol className="g-board__list">
              {standings.slice(0, TOP).map((s, i) => (
                <li key={`${i}-${s.name}`} className={`g-board__row${s.you ? ' is-me' : ''}`}>
                  <span className="g-board__rank num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="g-board__name">
                    <span className="g-board__nm">{s.name}</span>
                    {s.you && <span className="g-you mono">{t('gr.you')}</span>}
                  </span>
                  <span className="g-board__value num">{tf.fmt(s.value, { compact: true, maxFrac: 1 })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Start of the receipt's flight: the till on the HUD. A strip at that spot, as a motion target
 * relative to where the sheet settles (centred, or a bottom sheet).
 */
function receiptOrigin(): TargetAndTransition | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('.g-till');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bottom = window.matchMedia?.('(max-width: 639px)').matches === true;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return { x: cx - vw / 2, y: bottom ? cy - vh * 0.62 : cy - vh / 2, scaleX: 0.24, scaleY: 0.08, rotate: -4, opacity: 1, '--lift': 0 };
}

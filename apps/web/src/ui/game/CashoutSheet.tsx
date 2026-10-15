import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Icon, InkButton, Receipt, Sheet, Stamp, useReducedMotion, type ReceiptLine } from '../../design';
import { engine } from '../../game/instance';
import { sound } from '../../game/sound';
import { useT } from '../../i18n';
import { explorerTx } from '../../solana/links';
import { requestTicket, useUi } from '../../store';
import { formatClock, roomName, useTokenFormat } from './format';

/** Program defaults (spec §3.3): 5 % of the profit, 2 % on a Pass ticket. */
export const FEE_BPS = 500;
export const PASS_FEE_BPS = 200;

/**
 * Receipt numbers: the settlement's own `fee` / `net` once it arrives, an
 * estimate (5 %, 2 % with a Pass) before. After settlement the fee % label is
 * derived from the real fee and the gain.
 */
export function receiptNumbers(payout: number, entryFee: number, hasPass: boolean, settled: { fee?: number; net?: number } | null) {
  const gain = payout - entryFee;
  const bps = hasPass ? PASS_FEE_BPS : FEE_BPS;
  const estFee = Math.floor((Math.max(0, gain) * bps) / 10_000);
  const final = settled?.fee !== undefined;
  const fee = settled?.fee ?? estFee;
  const net = settled?.net ?? payout - fee;
  const pct = final && gain > 0 ? Math.round((fee / gain) * 1000) / 10 : bps / 100;
  return { gain, fee, net, pct, final };
}

/** The settlement for this ticket: matched by on-chain session address only (ruling R16). */
export function settlementFor<T extends { session: string | null }>(settled: T | null, ticketSession: string | null | undefined): T | null {
  return settled && ticketSession && settled.session === ticketSession ? settled : null;
}

/**
 * Cash-out receipt: a slip prints out of the till (entry fee, gain, fee %,
 * net). While the settlement is pending the slip says so; once `settled`
 * arrives the real fee and net are printed, a PAID stamp lands and the
 * explorer link appears.
 */
export function CashoutSheet() {
  const t = useT();
  const tf = useTokenFormat();
  const res = useUi((s) => s.cashoutResult);
  const room = useUi((s) => s.room);
  const ticket = useUi((s) => s.ticket);
  const chain = useUi((s) => s.chain);
  const settledRaw = useUi((s) => s.lastSettlement);
  const lang = useUi((s) => s.settings.lang);
  const open = useUi((s) => s.screen === 'cashedout' && s.cashoutResult !== null);
  const newTicket = () => {
    if (room?.arenaId !== undefined) requestTicket(room.arenaId);
    engine()?.backToLobby();
  };
  const reduced = useReducedMotion();
  const [since, setSince] = useState(() => Date.now());
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSince(Date.now());
    setPrinted(false);
  }, [open]);

  const settled = settlementFor(settledRaw, ticket?.session);
  useEffect(() => {
    if (settled && printed) sound.stamp();
  }, [settled, printed]);

  const payout = res?.value ?? 0;
  const entry = ticket?.entryFee ?? room?.entryFee ?? 0;
  const n = receiptNumbers(payout, entry, ticket?.hasPass ?? false, settled);
  const approx = n.final ? '' : `${t('gc.estimate')} `;
  const amount = (raw: number, signed = false) => (signed ? tf.signed(raw) : tf.fmt(raw));
  const lines: ReceiptLine[] = [
    { label: t('gc.entry'), value: amount(entry) },
    { label: t('gc.payout'), value: amount(payout), muted: true },
    { label: t('gc.gain'), value: amount(n.gain, true) },
    {
      label: (
        <>
          {t('gc.fee', { pct: n.pct.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 1 }) })}
          {ticket?.hasPass && <span className="g-receipt__pass">PASS</span>}
        </>
      ),
      value: n.fee > 0 ? `${approx}−${tf.fmt(n.fee)}` : tf.fmt(0),
      muted: true,
    },
    {
      label: t('gc.net'),
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
  const date = new Date(since).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const footer = settled ? (
    <a className="g-receipt__tx" href={explorerTx(settled.signature, chain?.cluster ?? 'devnet')} target="_blank" rel="noreferrer">
      {t('gc.viewTx')} · {settled.signature.slice(0, 4)}…{settled.signature.slice(-4)}
      <Icon name="arrow" size={14} />
    </a>
  ) : (
    <span className="g-receipt__pending" role="status">
      {t('gc.settling')}
      <span className="g-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );

  return (
    <Sheet
      open={open}
      onClose={() => engine()?.backToLobby()}
      closeLabel={t('gc.close')}
      kicker={t('gc.kicker', { room: roomName(room, lang) })}
      title={t('gc.title')}
      className="g-sheet g-cashout"
      footer={
        <>
          <InkButton variant="pink" size="lg" icon="ticket" onClick={newTicket} data-autofocus>
            {t('gc.newTicket')}
          </InkButton>
          <InkButton variant="paper" size="lg" icon="play" onClick={() => engine()?.play('practice')}>
            {t('gd.practice')}
          </InkButton>
        </>
      }
    >
      <div className="g-cashout__body">
        <div className="g-cashout__slip">
          <Receipt
            printing
            onPrinted={() => setPrinted(true)}
            title="SLANA · CASH-OUT"
            meta={`${date}${res?.stats ? ` · ${formatClock(res.stats.aliveMs)}` : ''}`}
            lines={lines}
            code={settled?.signature ?? `pending-${since}`}
            footer={footer}
          />
          <AnimatePresence>
            {settled && printed && (
              <motion.div className="g-cashout__stamp" initial={false} exit={{ opacity: 0 }}>
                <Stamp text={t('gc.paid')} sub="SOLANA" round size="lg" tone="teal" rotate={-12} animateIn={!reduced} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {settled?.collect && (
          <p className="g-cashout__note" role="status">
            {t('gc.collect')}
          </p>
        )}
        <p className="g-cashout__note mono">{t('gc.feeNote')}</p>
      </div>
    </Sheet>
  );
}

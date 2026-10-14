import { useRef, useState } from 'react';
import { InkButton, printerEase, useReducedMotion } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { useTicker } from '../ticker';
import { useTokenFormat } from './format';

const STEPS = 14;
const ease = printerEase(STEPS);

/**
 * Cash-out: a printed button with a receipt printer on top. While the channel
 * runs (2 s with a Pass ticket, 3 s without) a slip feeds out of the slot in
 * printer steps and the remaining time counts down on it.
 */
export function CashoutButton() {
  const t = useT();
  const tf = useTokenFormat();
  const cashout = useUi((s) => s.cashout);
  const ticket = useUi((s) => s.ticket);
  const value = useUi((s) => s.hud.value);
  const reduced = useReducedMotion();
  const slip = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  const channel = cashout.state === 'channel';
  const total = cashout.total || (ticket?.hasPass ? 2000 : 3000);

  useTicker(() => {
    const ms = Math.max(0, cashout.until - performance.now());
    const p = 1 - ms / total;
    slip.current?.style.setProperty('--p', String(reduced ? Math.min(1, Math.ceil(p * 4) / 4) : ease(Math.max(0, Math.min(1, p)))));
    setLeft(Math.ceil(ms / 100) / 10);
  }, channel);

  const secs = (total / 1000).toLocaleString(tf.lang === 'tr' ? 'tr-TR' : 'en-US');
  return (
    <div className={`g-cash${channel ? ' is-printing' : ''}`}>
      <div className="g-cash__printer" aria-hidden="true">
        <div ref={slip} className="g-cash__slip">
          <div className="g-cash__slip-paper mono">
            <span className="g-cash__line">
              <b>{t('g.till')}</b>
              <i />
              <span>{value !== null ? tf.fmt(value, { compact: true, maxFrac: 1 }) : '—'}</span>
            </span>
            <span className="g-cash__line">
              <b>{t('g.printing')}</b>
              <i />
              <span>{left.toLocaleString(tf.lang === 'tr' ? 'tr-TR' : 'en-US', { minimumFractionDigits: 1 })}</span>
            </span>
          </div>
        </div>
        <div className="g-cash__slot" />
      </div>
      <InkButton
        variant="pink"
        size="lg"
        icon="cashout"
        className="g-cash__btn"
        sub={t('g.cashoutSub', { s: secs })}
        onClick={() => engine()?.cashout()}
        disabled={channel}
        aria-keyshortcuts="C"
      >
        {channel ? t('g.printing') : t('g.cashout')}
      </InkButton>
    </div>
  );
}

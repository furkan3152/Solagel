import {
  CUSTOM_DEFAULTS,
  CUSTOM_DIFFICULTIES,
  CUSTOM_DURATIONS_MIN,
  CUSTOM_FOOD,
  CUSTOM_LIMITS,
  CUSTOM_MAP_SIZES,
  validateCustomConfig,
  type CustomRoomConfig,
  type CustomRoomQuote,
  type CustomRoomView,
} from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import type { Address, Hash } from 'viem';
import { AddressChip, Button, Chip, CoinCharacter, Field, HypeAmount, QuantityStepper, Receipt, Sheet, Stamp, StampSpinner } from '../design';
import { engine } from '../game/instance';
import { sound } from '../audio';
import { useT, type TKey } from '../i18n';
import { openModal, toast, useUi } from '../store';
import { isFakeHash } from '../wallet/devFake';
import { explorerTx } from '../wallet/links';
import { serverChainInfo } from '../wallet/network';
import { signInWithWallet } from '../wallet/signIn';
import { useAddress } from '../wallet/store';
import type { TxPhase } from '../wallet/tx';
import { RoomApiError, loadPendingPayment, roomLink, roomsApi, savePendingPayment } from './api';
import { payRoomFee } from './pay';
import './rooms.css';

type Step = 'setup' | 'pay' | 'working' | 'done';

/** One row of choices (a toggle chip each). */
function Choice<T extends string | number>({ label, options, value, onPick, text }: { label: string; options: readonly T[]; value: T; onPick: (v: T) => void; text: (v: T) => string }) {
  return (
    <div className="cr-row" role="group" aria-label={label}>
      <span className="cr-row__label mono">{label}</span>
      <div className="cr-row__chips">
        {options.map((o) => (
          <Chip key={String(o)} selected={o === value} onClick={() => onPick(o)} data-value={String(o)}>
            {text(o)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

const MAP_KEY: Record<CustomRoomConfig['mapSize'], TKey> = { S: 'cr.map.S', M: 'cr.map.M', L: 'cr.map.L' };
const DIFF_KEY: Record<CustomRoomConfig['difficulty'], TKey> = { easy: 'cr.diff.easy', mixed: 'cr.diff.mixed', hard: 'cr.diff.hard' };
const FOOD_KEY: Record<CustomRoomConfig['food'], TKey> = { low: 'cr.food.low', normal: 'cr.food.normal', high: 'cr.food.high' };

/**
 * "Create your own room": the creator picks the rules, pays the small HYPE fee to the treasury
 * (one native transfer; NFT holders get the perk the admin chose), the server checks the payment
 * on chain and opens the room; the sheet ends on the invite code and share link.
 *
 * Money safety: one in-flight guard (a ref), the price and treasury are frozen at "Continue", and a
 * payment that went through but did not open a room yet is kept (this browser) and offered again,
 * so the creator never pays twice.
 */
export function RoomCreator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const chain = useUi((s) => s.chain);
  const auth = useUi((s) => s.auth);
  const address = useAddress();
  const [cfg, setCfg] = useState<CustomRoomConfig>(() => ({ ...CUSTOM_DEFAULTS, name: '' }));
  const [step, setStep] = useState<Step>('setup');
  const [quote, setQuote] = useState<CustomRoomQuote | null>(null);
  const [frozen, setFrozen] = useState<{ wei: bigint; to: Address } | null>(null);
  const [phase, setPhase] = useState<TxPhase | 'creating' | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [made, setMade] = useState<CustomRoomView | null>(null);
  const inFlight = useRef(false);

  const signedIn = !!auth && !!address && auth.address.toLowerCase() === address.toLowerCase();
  const token = signedIn ? auth!.token : null;
  const pending = signedIn ? loadPendingPayment(address) : null;

  useEffect(() => {
    if (!open) return;
    inFlight.current = false;
    setStep('setup');
    setPhase(null);
    setError(null);
    setHash(null);
    setMade(null);
    setFrozen(null);
    let live = true;
    roomsApi.quote(token).then(
      (q) => live && setQuote(q),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [open, token]);

  const set = <K extends keyof CustomRoomConfig>(k: K, v: CustomRoomConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const youPay = quote ? BigInt(quote.youPayWei) : null;
  const base = quote ? BigInt(quote.priceWei) : null;
  const free = youPay === 0n;
  const full = !!quote && quote.live >= quote.maxLive;
  const capped = !!quote && quote.mine >= quote.maxPerWallet;
  const chainName = serverChainInfo(chain)?.name ?? 'Elysium';

  const toPay = () => {
    const v = validateCustomConfig(cfg);
    if (!v.ok) {
      if (v.field === 'name') setNameError(v.message);
      else setError(v.message);
      return;
    }
    setNameError(null);
    setError(null);
    if (!quote?.treasury || youPay === null) return;
    setCfg(v.config);
    setFrozen({ wei: youPay, to: quote.treasury as Address });
    setStep('pay');
  };

  const create = async (txHash: string | null) => {
    setPhase('creating');
    try {
      const r = await roomsApi.create(token!, cfg, txHash);
      savePendingPayment(null);
      setMade(r.room);
      setStep('done');
      sound.punch();
    } catch (e) {
      const err = e as RoomApiError;
      // the payment is fine but no room opened: keep it for "Open the room" later (never pay twice)
      if (txHash && !(err instanceof RoomApiError && ['payment_invalid', 'payment_used', 'payment_low', 'payment_stale'].includes(err.code))) {
        setError(`${err.message} ${t('cr.keptPayment')}`);
      } else {
        if (txHash) savePendingPayment(null);
        setError(err.message);
      }
      setStep('pay');
    } finally {
      setPhase(null);
      inFlight.current = false;
    }
  };

  const pay = async () => {
    if (inFlight.current || !frozen || !chain || !token || !address) return;
    inFlight.current = true;
    setError(null);
    setStep('working');
    if (frozen.wei === 0n) return create(null);
    if (pending) return create(pending.hash);
    const res = await payRoomFee(chain, frozen.to, frozen.wei, (p, h) => {
      setPhase(p);
      if (h) setHash(h);
    });
    if (!res.ok) {
      inFlight.current = false;
      setPhase(null);
      setStep('pay');
      setError(res.message);
      return;
    }
    savePendingPayment({ hash: res.hash, wallet: address, wei: frozen.wei.toString(), at: Date.now() });
    setHash(res.hash);
    // the server may lag the receipt by a block: a few quiet retries before giving up
    for (let i = 0; i < 4; i++) {
      try {
        setPhase('creating');
        const r = await roomsApi.create(token, cfg, res.hash);
        savePendingPayment(null);
        setMade(r.room);
        setStep('done');
        setPhase(null);
        inFlight.current = false;
        sound.punch();
        return;
      } catch (e) {
        if (e instanceof RoomApiError && (e.code === 'payment_pending' || e.code === 'chain_busy') && i < 3) {
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        const err = e as RoomApiError;
        setError(`${err.message}${err instanceof RoomApiError && ['payment_invalid', 'payment_low', 'payment_stale', 'payment_used'].includes(err.code) ? '' : ` ${t('cr.keptPayment')}`}`);
        break;
      }
    }
    setPhase(null);
    setStep('pay');
    inFlight.current = false;
  };

  const enter = () => {
    if (!made) return;
    onClose();
    engine()?.play(`private:${made.code}`);
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast('success', t('cr.copied')),
      () => {},
    );
  };

  const link = made ? roomLink(made.code) : '';
  const phaseText =
    phase === 'switching' ? t('cr.phase.switching', { chain: chainName }) : phase === 'signing' ? t('cr.phase.signing') : phase === 'confirming' ? t('cr.phase.confirming') : phase === 'creating' ? t('cr.phase.creating') : '';
  const txLink = hash && !isFakeHash(hash) ? explorerTx(hash) : null;

  const gate = !address ? (
    <Button variant="primary" size="lg" block lead="wallet" onClick={() => openModal('wallet')}>
      {t('cr.connect')}
    </Button>
  ) : !signedIn ? (
    <Button variant="primary" size="lg" block lead="lock" onClick={() => void signInWithWallet(true)}>
      {t('cr.verify')}
    </Button>
  ) : null;

  let footer;
  if (step === 'setup') {
    footer = gate ?? (
      <Button
        variant="primary"
        size="lg"
        block
        icon="arrow"
        disabled={!quote || !quote.enabled || full || capped}
        onClick={toPay}
        sub={quote ? (free ? t('cr.freeSub') : t('cr.paySub', { chain: chainName })) : undefined}
        data-testid="cr-continue"
      >
        {full ? t('cr.full') : capped ? t('cr.capped', { n: quote!.maxPerWallet }) : free ? t('cr.createFree') : t('cr.continue')}
      </Button>
    );
  } else if (step === 'pay' || step === 'working') {
    footer = (
      <div className="cr-foot">
        <Button variant="ghost" onClick={() => setStep('setup')} disabled={step === 'working'}>
          {t('cr.back')}
        </Button>
        <Button variant="primary" size="lg" loading={step === 'working'} onClick={() => void pay()} data-testid="cr-pay" lead={pending || free ? 'key' : 'wallet'}>
          {pending ? t('cr.useKept') : free ? t('cr.createFree') : t('cr.pay', { amount: hypeText(frozen?.wei ?? 0n) })}
        </Button>
      </div>
    );
  } else {
    footer = (
      <Button variant="primary" size="lg" block icon="arrow" onClick={enter} data-testid="cr-enter">
        {t('cr.enter')}
      </Button>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      closeLabel={t('cr.close')}
      kicker={step === 'done' ? t('cr.kicker.done') : t('cr.kicker')}
      title={step === 'done' ? t('cr.title.done') : step === 'setup' ? t('cr.title') : t('cr.title.pay')}
      footer={footer}
      className="cr-sheet"
    >
      {step === 'setup' && (
        <div className="cr-form" data-testid="cr-setup">
          <p className="cr-lede">{t('cr.lede')}</p>
          <Field
            label={t('cr.name')}
            value={cfg.name}
            maxLength={CUSTOM_LIMITS.nameMax}
            placeholder={t('cr.namePlaceholder')}
            error={nameError ?? undefined}
            onChange={(e) => set('name', e.target.value)}
            data-autofocus
          />
          <Choice label={t('cr.duration')} options={CUSTOM_DURATIONS_MIN} value={cfg.durationMin} onPick={(v) => set('durationMin', v)} text={(v) => t('cr.minutes', { n: v })} />
          <Choice label={t('cr.map')} options={CUSTOM_MAP_SIZES} value={cfg.mapSize} onPick={(v) => set('mapSize', v)} text={(v) => t(MAP_KEY[v])} />
          <div className="cr-pair">
            <div className="cr-row">
              <span className="cr-row__label mono">{t('cr.bots')}</span>
              <QuantityStepper value={cfg.bots} min={0} max={CUSTOM_LIMITS.botsMax} onChange={(v) => set('bots', v)} label={t('cr.bots')} />
            </div>
            <div className="cr-row">
              <span className="cr-row__label mono">{t('cr.players')}</span>
              <QuantityStepper value={cfg.maxPlayers} min={CUSTOM_LIMITS.playersMin} max={CUSTOM_LIMITS.playersMax} onChange={(v) => set('maxPlayers', v)} label={t('cr.players')} />
            </div>
          </div>
          {cfg.bots > 0 && <Choice label={t('cr.difficulty')} options={CUSTOM_DIFFICULTIES} value={cfg.difficulty} onPick={(v) => set('difficulty', v)} text={(v) => t(DIFF_KEY[v])} />}
          <Choice label={t('cr.food')} options={CUSTOM_FOOD} value={cfg.food} onPick={(v) => set('food', v)} text={(v) => t(FOOD_KEY[v])} />
          <Choice label={t('cr.powerUps')} options={['on', 'off'] as const} value={cfg.powerUps ? 'on' : 'off'} onPick={(v) => set('powerUps', v === 'on')} text={(v) => t(v === 'on' ? 'cr.on' : 'cr.off')} />
          {quote && (
            <div className="cr-price" data-testid="cr-price">
              <span className="cr-row__label mono">{t('cr.price')}</span>
              {free ? <b className="cr-price__free">{t('cr.free')}</b> : <HypeAmount wei={youPay ?? 0n} decimals={hypeDecimals(youPay ?? 0n)} />}
              {base !== null && youPay !== null && youPay < base && !free && <s className="cr-price__was mono">{hypeText(base)} HYPE</s>}
              <span className="cr-price__note">{perkNote(quote, t)}</span>
            </div>
          )}
          {quote && <p className="cr-slots mono">{t('cr.slots', { live: quote.live, max: quote.maxLive })}</p>}
          {!quote?.enabled && quote && <p className="cr-error" role="alert">{t('cr.closedNow')}</p>}
          {!address || !signedIn ? <p className="cr-note">{t('cr.guestNote')}</p> : null}
          {error && <p className="cr-error" role="alert">{error}</p>}
        </div>
      )}

      {(step === 'pay' || step === 'working') && frozen && (
        <div className="cr-pay" data-testid="cr-payment">
          <Receipt
            title={t('cr.receipt')}
            meta={cfg.name}
            lines={[
              { label: t('cr.duration'), value: t('cr.minutes', { n: cfg.durationMin }) },
              { label: t('cr.map'), value: t(MAP_KEY[cfg.mapSize]) },
              { label: t('cr.bots'), value: cfg.bots > 0 ? `${cfg.bots} · ${t(DIFF_KEY[cfg.difficulty])}` : t('cr.noBots') },
              { label: t('cr.players'), value: t('cr.upTo', { n: cfg.maxPlayers }) },
              { label: t('cr.powerUps'), value: t(cfg.powerUps ? 'cr.on' : 'cr.off'), muted: true },
              { label: t('cr.stakes'), value: t('cr.noStakes'), muted: true },
              { label: t('cr.total'), value: frozen.wei === 0n ? t('cr.free') : `${hypeText(frozen.wei)} HYPE`, strong: true },
            ]}
          />
          {frozen.wei > 0n && (
            <div className="cr-to">
              <span className="cr-row__label mono">{t('cr.to')}</span>
              <AddressChip address={frozen.to} label={t('cr.treasury')} size="sm" copyLabel={t('cr.copy')} />
            </div>
          )}
          <p className="cr-note">{pending ? t('cr.keptNote') : frozen.wei === 0n ? t('cr.freeNote') : t('cr.payNote', { chain: chainName })}</p>
          {step === 'working' && (
            <p className="cr-phase" role="status">
              <StampSpinner size="sm" /> {phaseText}
              {txLink && (
                <a className="cr-phase__link mono" href={txLink} target="_blank" rel="noreferrer">
                  {t('tf.viewTx')}
                </a>
              )}
            </p>
          )}
          {error && <p className="cr-error" role="alert">{error}</p>}
        </div>
      )}

      {step === 'done' && made && (
        <div className="cr-done" data-testid="cr-done">
          <div className="cr-done__art" aria-hidden="true">
            <CoinCharacter paint="sun" mood="smile" size={72} bob />
            <Stamp text={t('cr.stamp')} tone="up" animateIn size="md" rotate={-10} />
          </div>
          <p className="cr-lede">{t('cr.doneLede', { name: made.name, n: made.durationMin })}</p>
          <div className="cr-code" aria-label={t('cr.codeLabel')}>
            <span className="cr-row__label mono">{t('cr.codeLabel')}</span>
            <button type="button" className="cr-code__value mono" onClick={() => copy(made.code)} data-testid="cr-code">
              {made.code}
            </button>
          </div>
          <div className="cr-link">
            <input className="cr-link__input mono" readOnly value={link} aria-label={t('cr.link')} onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" onClick={() => copy(link)} lead="docs">
              {t('cr.copyLink')}
            </Button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <Button size="sm" variant="ghost" onClick={() => void navigator.share({ title: made.name, text: t('cr.shareText', { name: made.name }), url: link }).catch(() => {})}>
                {t('cr.share')}
              </Button>
            )}
          </div>
          <p className="cr-note">{t('cr.doneNote')}</p>
        </div>
      )}
    </Sheet>
  );
}

/** HYPE with as few decimals as it needs (0.05, 0.025). */
function hypeDecimals(wei: bigint): number {
  for (let d = 2; d <= 6; d++) if (wei % 10n ** BigInt(18 - d) === 0n) return d;
  return 6;
}

export function hypeText(wei: bigint): string {
  const d = hypeDecimals(wei);
  const s = (wei / 10n ** BigInt(18 - d)).toString().padStart(d + 1, '0');
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

function perkNote(q: CustomRoomQuote, t: ReturnType<typeof useT>): string {
  if (q.holderPerk === 'none') return t('cr.perk.none');
  if (q.holder) return q.holderPerk === 'discount' ? t('cr.perk.youDiscount', { pct: q.holderDiscountPct }) : q.freeAvailable ? t('cr.perk.youFree') : t('cr.perk.freeUsed');
  return q.holderPerk === 'discount' ? t('cr.perk.discount', { pct: q.holderDiscountPct }) : t('cr.perk.free');
}

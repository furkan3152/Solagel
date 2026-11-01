import { BOOST_KEY_LABELS, SHOP_DEFAULTS, boostCooldownMs, formatToken, type BoostKind, type ShopPack, type ShopView } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Sheet, shortAddress } from '../../design';
import { useT } from '../../i18n';
import { closeModal, openModal, toast, useUi } from '../../store';
import { ShopError, buyPack, fetchShop, type BuyPhase } from '../../wallet/shop';
import { BOOST_PATH } from '../game/BoostBar';
import './shop.css';

/** A pack price for display: `210 tELYMUM` (whole tokens, at most two decimals). */
export function priceText(raw: string, view: Pick<ShopView, 'token'>): string {
  const decimals = view.token?.decimals ?? 18;
  return `${formatToken(BigInt(raw), decimals, { maxFrac: 2 })} ${view.token?.symbol ?? '$ELYMUM'}`;
}

function PackCard({
  pack,
  view,
  owned,
  busy,
  phase,
  canBuy,
  onBuy,
}: {
  pack: ShopPack;
  view: ShopView;
  owned: number | null;
  busy: boolean;
  phase: BuyPhase | null;
  canBuy: boolean;
  onBuy: () => void;
}) {
  const t = useT();
  const kind: BoostKind = pack.kind;
  const discounted = pack.priceRaw !== pack.fullPriceRaw;
  const phaseText = phase === 'verifying' ? t('shop.verifying') : phase === 'confirming' ? t('shop.confirming') : phase ? t('shop.paying') : null;
  return (
    <li className={`sh-pack sh-pack--${kind}${pack.enabled ? '' : ' is-off'}`} data-kind={kind}>
      <span className="sh-pack__glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d={BOOST_PATH[kind]} />
        </svg>
        <kbd className="sh-pack__key mono">{BOOST_KEY_LABELS[kind]}</kbd>
      </span>
      <div className="sh-pack__body">
        <h3 className="sh-pack__name">{t(`boost.${kind}` as 'boost.magnet')}</h3>
        <p className="sh-pack__note">{t(`boost.${kind}.note` as 'boost.magnet.note')}</p>
        <p className="sh-pack__meta mono">
          {t('shop.cooldown', { s: Math.round(boostCooldownMs(kind) / 1000) })}
          {owned !== null && <> · {t('shop.owned', { n: owned })}</>}
        </p>
      </div>
      <div className="sh-pack__buy">
        {discounted && <s className="sh-pack__was mono">{priceText(pack.fullPriceRaw, view)}</s>}
        <Button
          variant={kind === 'shock' ? 'teal' : 'secondary'}
          size="sm"
          loading={busy}
          disabled={!canBuy || !pack.enabled || busy}
          onClick={onBuy}
          sub={phaseText ?? undefined}
          data-testid={`shop-buy-${kind}`}
        >
          {t('shop.buy', { n: pack.charges, price: priceText(pack.priceRaw, view) })}
        </Button>
      </div>
    </li>
  );
}

/**
 * The power-up shop (lobby and HUD): three packs priced for the signed-in wallet (holders see the
 * discount), each bought with one game-token transfer to the shop's sink; the server checks the
 * payment and the charges appear on the HUD at once. Guests are asked to sign in.
 */
export function ShopSheet() {
  const t = useT();
  const open = useUi((s) => s.modal === 'shop');
  const auth = useUi((s) => s.auth);
  const chain = useUi((s) => s.chain);
  const live = useUi((s) => s.boosts?.charges ?? null);
  const [view, setView] = useState<ShopView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [buying, setBuying] = useState<{ kind: BoostKind; phase: BuyPhase | null } | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetchShop(auth?.token ?? null, signal).then(
        (v) => {
          setView(v);
          setErr(null);
        },
        (e: Error) => {
          if (e.name !== 'AbortError') setErr(e.message);
        },
      ),
    [auth?.token],
  );
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [open, load]);

  const charges = live ?? view?.charges ?? null;
  const buy = async (pack: ShopPack) => {
    if (!view || !auth || !chain) return;
    setBuying({ kind: pack.kind, phase: 'switching' });
    try {
      const r = await buyPack(view, pack, { token: auth.token, owner: auth.address, chain, onPhase: (phase) => setBuying({ kind: pack.kind, phase }) });
      setView((v) => (v ? { ...v, charges: r.charges } : v));
      // the HUD follows at once (the server also pushes `boosts` to a live game)
      useUi.setState((s) => (s.boosts ? { boosts: { ...s.boosts, charges: r.charges } } : {}));
      toast('success', t('shop.done', { n: r.added, name: t(`boost.${r.kind}` as 'boost.magnet') }));
    } catch (e) {
      const msg = e instanceof ShopError ? e.message : (e as Error).message;
      if (!(e instanceof ShopError && e.code === 'rejected')) toast('error', t('shop.failed', { msg }), undefined, 8000);
    } finally {
      setBuying(null);
    }
  };

  const s = view ?? null;
  const max = s?.arenaUsesPerRound ?? SHOP_DEFAULTS.arenaUsesPerRound;
  const pct = s?.holderDiscountPct ?? SHOP_DEFAULTS.holderDiscountPct;
  const extra = s?.holderExtraArenaUses ?? SHOP_DEFAULTS.holderExtraArenaUses;
  const closed = s && !s.open ? (s.closedReason === 'no_token' ? t('shop.closed.no_token') : t('shop.closed')) : null;
  return (
    <Sheet
      open={open}
      onClose={closeModal}
      closeLabel={t('common.close')}
      kicker={t('boost.shop')}
      title={t('shop.title')}
      className="g-sheet sh-sheet"
      footer={
        s?.sink ? (
          <p className="sh-foot mono">
            {t(s.sinkKind === 'burn' ? 'shop.sink.burn' : 'shop.sink.treasury', { addr: shortAddress(s.sink) })} {t('shop.keys')}
          </p>
        ) : undefined
      }
    >
      <p className="sh-lede">{t('shop.lede', { n: s?.packs[0]?.charges ?? SHOP_DEFAULTS.packSize, sym: s?.token?.symbol ?? '$ELYMUM', max })}</p>
      {s?.holder ? (
        <Chip tone="up" className="sh-holder">
          {t('shop.holder', { pct, extra })}
        </Chip>
      ) : (
        <p className="sh-hint mono">{t('shop.holderHint', { pct, extra })}</p>
      )}
      {closed && <p className="sh-closed">{closed}</p>}
      {err && <p className="sh-closed">{err}</p>}
      {s ? (
        <ul className="sh-packs">
          {s.packs.map((p) => (
            <PackCard
              key={p.kind}
              pack={p}
              view={s}
              owned={charges ? charges[p.kind] : null}
              busy={buying?.kind === p.kind}
              phase={buying?.kind === p.kind ? buying.phase : null}
              canBuy={!!auth && s.open && !buying}
              onBuy={() => void buy(p)}
            />
          ))}
        </ul>
      ) : (
        !err && <p className="sh-hint mono">…</p>
      )}
      {!auth && (
        <div className="sh-signin">
          <p>{t('shop.signIn')}</p>
          <Button variant="primary" size="md" lead="wallet" onClick={() => openModal('wallet')}>
            {t('shop.signInBtn')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

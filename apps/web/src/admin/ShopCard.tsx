import { BOOST_KINDS, BURN_ADDRESS, SHOP_LIMITS, formatToken, type BoostKind, type ShopSettings } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { SiteApiError, type ShopAdminView } from '../site/api';
import { SwitchRow } from './GameTab';
import { Btn, Card, FormError, type ChainCtx } from './ui';

const KIND_LABEL: Record<BoostKind, string> = { magnet: 'Magnet', shock: 'Shockwave', speed: 'Speed burst' };

/** The fields that changed (a partial PUT). */
export function shopPatch(saved: ShopSettings, draft: ShopSettings): Partial<ShopSettings> {
  const out: Record<string, unknown> = {};
  for (const f of ['enabled', 'sink', 'treasury', 'packSize', 'holderDiscountPct', 'arenaUsesPerRound', 'holderExtraArenaUses'] as const) if (draft[f] !== saved[f]) out[f] = draft[f];
  const prices: Record<string, string> = {};
  const kinds: Record<string, boolean> = {};
  for (const k of BOOST_KINDS) {
    if (draft.prices[k] !== saved.prices[k]) prices[k] = draft.prices[k];
    if (draft.kinds[k] !== saved.kinds[k]) kinds[k] = draft.kinds[k];
  }
  if (Object.keys(prices).length) out.prices = prices;
  if (Object.keys(kinds).length) out.kinds = kinds;
  return out as Partial<ShopSettings>;
}

function Num({ value, onChange, label, min, max }: { value: number; onChange: (n: number) => void; label: string; min: number; max: number }) {
  return (
    <input
      className="ad-input ad-input--num num"
      type="number"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
    />
  );
}

/**
 * Game → power-ups: on/off (all, and per power-up), pack prices in whole tokens, where payments go
 * (burned by default, or the treasury), the holder discount and the paid arenas' per-round limit,
 * and the last purchases. Saved on the server (`DATA_DIR/site/shop.json`), applied at once.
 */
export function ShopCard({ ctx }: { ctx: ChainCtx }) {
  const [view, setView] = useState<ShopAdminView | null>(null);
  const [draft, setDraft] = useState<ShopSettings | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!ctx.api) return;
    ctx.api.shop().then(
      (v) => {
        setView(v);
        setDraft(structuredClone(v.settings));
        setState('ok');
      },
      (e) => {
        if (e instanceof SiteApiError && e.status === 404) setState('missing');
        else {
          setState('error');
          setErr((e as Error).message);
        }
      },
    );
  }, [ctx.api]);
  useEffect(load, [load]);

  if (!ctx.api) return <Card title="Power-ups" id="shop" tone="quiet" lede="Sign in as the admin (top right) to see and change the power-up shop." />;
  if (state === 'missing') return <Card title="Power-ups" id="shop" tone="quiet" lede="This server has no power-up shop yet (/api/admin/shop). Update the game server." />;
  if (!view || !draft) return <Card title="Power-ups" id="shop" tone="quiet" lede={state === 'error' ? `Cannot load the shop: ${err}` : 'Loading the shop…'} />;

  const patch = shopPatch(view.settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const v = await ctx.api!.saveShop(patch);
      setView(v);
      setDraft(structuredClone(v.settings));
      setMsg('Shop saved: prices and limits apply at once.');
    } catch (e) {
      const f = e instanceof SiteApiError && e.field ? ` (${e.field})` : '';
      setErr(`${(e as Error).message}${f}`);
    } finally {
      setBusy(false);
    }
  };
  const decimals = ctx.status?.arena?.config?.decimals ?? 18;
  return (
    <Card
      title="Power-ups"
      id="shop"
      kicker={`${view.purchaseCount} purchases`}
      lede="Players buy packs of power-up charges with the game token (one transfer to the sink; the server checks the receipt). Practice and private rooms: free use with cooldowns. Paid arenas: a per-round limit. Bots never use them."
    >
      <SwitchRow
        label="Shop"
        options={[
          { id: 'on', label: 'Selling' },
          { id: 'off', label: 'Off' },
        ]}
        value={draft.enabled ? 'on' : 'off'}
        onPick={(v) => setDraft({ ...draft, enabled: v === 'on' })}
        testId="shop-enabled"
      />
      <SwitchRow
        label="Payments go to"
        options={[
          { id: 'burn', label: 'Burn', note: BURN_ADDRESS },
          { id: 'treasury', label: 'Treasury' },
        ]}
        value={draft.sink}
        onPick={(v) => setDraft({ ...draft, sink: v })}
        testId="shop-sink"
      />
      {draft.sink === 'treasury' && (
        <label className="ad-field">
          <span className="ad-field__label mono">Treasury wallet (empty: the owner {view.owner ?? 'not set'})</span>
          <input className="ad-input mono" value={draft.treasury ?? ''} placeholder={view.owner ?? '0x…'} onChange={(e) => setDraft({ ...draft, treasury: e.target.value.trim() || null })} />
        </label>
      )}
      <p className="ad-note mono" data-testid="shop-sink-now">
        Sink now: {view.sink ?? 'none (set a treasury wallet)'}
      </p>
      <div className="ad-tablewrap">
        <table className="ad-table" data-testid="shop-table">
          <thead>
            <tr>
              <th scope="col">Power-up</th>
              <th scope="col">On</th>
              <th scope="col" className="is-num">
                Pack price (tokens)
              </th>
              <th scope="col" className="is-num">
                Holders pay
              </th>
            </tr>
          </thead>
          <tbody>
            {BOOST_KINDS.map((k) => {
              let holder = '—';
              try {
                const full = BigInt(Math.round(Number(draft.prices[k]) * 1e6));
                holder = formatToken((full * BigInt(100 - draft.holderDiscountPct)) / 100n, 6, { maxFrac: 2 });
              } catch {
                /* a half-typed price */
              }
              return (
                <tr key={k} data-kind={k}>
                  <td>
                    <strong>{KIND_LABEL[k]}</strong>
                  </td>
                  <td>
                    <label className="ad-switch ad-switch--inline">
                      <input type="checkbox" role="switch" checked={draft.kinds[k]} onChange={() => setDraft({ ...draft, kinds: { ...draft.kinds, [k]: !draft.kinds[k] } })} aria-label={`${KIND_LABEL[k]} on`} />
                    </label>
                  </td>
                  <td className="is-num">
                    <input className="ad-input ad-input--num num" value={draft.prices[k]} aria-label={`${KIND_LABEL[k]} price`} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, [k]: e.target.value.trim() } })} />
                  </td>
                  <td className="num is-num">{holder}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ad-form2 ad-form3">
        <label className="ad-field">
          <span className="ad-field__label mono">Charges per pack</span>
          <Num value={draft.packSize} min={1} max={SHOP_LIMITS.packSize} label="Charges per pack" onChange={(n) => setDraft({ ...draft, packSize: n })} />
        </label>
        <label className="ad-field">
          <span className="ad-field__label mono">Holder discount %</span>
          <Num value={draft.holderDiscountPct} min={0} max={SHOP_LIMITS.holderDiscountPct} label="Holder discount" onChange={(n) => setDraft({ ...draft, holderDiscountPct: n })} />
        </label>
        <label className="ad-field">
          <span className="ad-field__label mono">Arena uses per round</span>
          <Num value={draft.arenaUsesPerRound} min={0} max={SHOP_LIMITS.arenaUsesPerRound} label="Arena uses per round" onChange={(n) => setDraft({ ...draft, arenaUsesPerRound: n })} />
        </label>
        <label className="ad-field">
          <span className="ad-field__label mono">Extra arena uses for holders</span>
          <Num value={draft.holderExtraArenaUses} min={0} max={SHOP_LIMITS.holderExtraArenaUses} label="Extra arena uses for holders" onChange={(n) => setDraft({ ...draft, holderExtraArenaUses: n })} />
        </label>
      </div>
      {view.purchases.length > 0 && (
        <details className="ad-rooms">
          <summary className="mono">Recent purchases ({view.purchases.length})</summary>
          <ul className="ad-rooms__list">
            {view.purchases.map((p) => (
              <li key={p.tx}>
                <span className="mono">
                  {p.wallet.slice(0, 8)}… · {p.charges} {KIND_LABEL[p.kind]}
                </span>
                <span className="num ad-dim">
                  {formatToken(BigInt(p.paid), decimals, { maxFrac: 2 })} · {new Date(p.at).toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="ad-actions">
        <Btn sun disabled={!dirty || busy} onClick={() => void save()} testId="shop-save">
          {busy ? 'Saving…' : 'Save power-ups'}
        </Btn>
        {dirty && <Btn onClick={() => setDraft(structuredClone(view.settings))}>Undo</Btn>}
        {msg && !dirty && <span className="ad-note">{msg}</span>}
      </div>
      <FormError error={err} />
    </Card>
  );
}

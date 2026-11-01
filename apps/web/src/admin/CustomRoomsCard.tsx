import { CUSTOM_HOLDER_PERKS, CUSTOM_SETTINGS_LIMITS, type CustomHolderPerk, type CustomRoomSettings } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import { SiteApiError, type CustomRoomsAdminView } from '../site/api';
import { SwitchRow } from './GameTab';
import { Btn, Card, FormError, type ChainCtx } from './ui';

const PERK_LABEL: Record<CustomHolderPerk, { label: string; note: string }> = {
  discount: { label: 'Discount', note: 'NFT holders pay less (the percent below).' },
  free_daily: { label: 'One free a day', note: 'NFT holders open one room a day (UTC) without paying.' },
  none: { label: 'No perk', note: 'Everyone pays the same.' },
};

/** The fields that changed (a partial PUT). */
export function customRoomsPatch(saved: CustomRoomSettings, draft: CustomRoomSettings): Partial<CustomRoomSettings> {
  const out: Partial<CustomRoomSettings> = {};
  for (const k of Object.keys(draft) as (keyof CustomRoomSettings)[]) if (draft[k] !== saved[k]) (out as Record<string, unknown>)[k] = draft[k];
  return out;
}

const minutesLeft = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 60_000));

/**
 * Game → custom rooms: the price (HYPE), the treasury the fee goes to (empty: the owner wallet),
 * the NFT holder perk, the caps (the server is small) and the live rooms, each with a close button.
 */
export function CustomRoomsCard({ ctx }: { ctx: ChainCtx }) {
  const [view, setView] = useState<CustomRoomsAdminView | null>(null);
  const [draft, setDraft] = useState<CustomRoomSettings | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!ctx.api) return;
    ctx.api.customRooms().then(
      (v) => {
        setView(v);
        setDraft({ ...v.settings });
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
  useEffect(() => {
    if (!ctx.api || state !== 'ok') return;
    const id = window.setInterval(() => ctx.api!.customRooms().then((v) => setView((cur) => (cur ? { ...cur, rooms: v.rooms } : v)), () => {}), 15_000);
    return () => clearInterval(id);
  }, [ctx.api, state]);

  if (!ctx.api) return <Card title="Custom rooms" id="custom-rooms" tone="quiet" lede="Sign in as the admin (top right) to see and change the custom rooms." />;
  if (state === 'missing') return <Card title="Custom rooms" id="custom-rooms" tone="quiet" lede="This server has no custom rooms route yet (/api/admin/custom-rooms). Update the game server." />;
  if (!view || !draft) return <Card title="Custom rooms" id="custom-rooms" tone="quiet" lede={state === 'error' ? `Cannot load the custom rooms: ${err}` : 'Loading the custom rooms…'} />;

  const patch = customRoomsPatch(view.settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const v = await ctx.api!.saveCustomRooms(patch);
      setView(v);
      setDraft({ ...v.settings });
      setMsg('Saved: new rooms use it at once.');
    } catch (e) {
      const f = e instanceof SiteApiError && e.field ? ` (${e.field})` : '';
      setErr(`${(e as Error).message}${f}`);
    } finally {
      setBusy(false);
    }
  };
  const close = async (code: string) => {
    if (!window.confirm(`Close room ${code} for everyone in it now?`)) return;
    setErr(null);
    try {
      const r = await ctx.api!.closeCustomRoom(code);
      setView({ ...view, rooms: r.rooms });
      setMsg(`Room ${code} closed.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const num = (k: 'holderDiscountPct' | 'maxLive' | 'maxPerWallet', max: number, min = 0) => (
    <input
      className="ad-input ad-input--num num"
      type="number"
      min={min}
      max={max}
      value={draft[k]}
      aria-label={k}
      data-testid={`cr-${k}`}
      onChange={(e) => setDraft({ ...draft, [k]: Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || 0))) })}
    />
  );

  return (
    <Card
      title="Custom rooms"
      id="custom-rooms"
      lede="Players pay a small HYPE fee to open a private room with their own rules (no token stakes). The server checks every payment on chain before the room opens."
    >
      <SwitchRow
        label="Creating rooms"
        options={[
          { id: 'on', label: 'Open' },
          { id: 'off', label: 'Closed' },
        ]}
        value={draft.enabled ? 'on' : 'off'}
        onPick={(v) => setDraft({ ...draft, enabled: v === 'on' })}
        testId="cr-enabled"
      />
      <div className="ad-form2 ad-form3">
        <label className="ad-field">
          <span className="ad-field__label mono">Price (HYPE)</span>
          <input className="ad-input num" value={draft.priceHype} onChange={(e) => setDraft({ ...draft, priceHype: e.target.value.trim() })} data-testid="cr-price" />
        </label>
        <label className="ad-field">
          <span className="ad-field__label mono">Treasury (empty: owner)</span>
          <input
            className="ad-input mono"
            value={draft.treasury ?? ''}
            placeholder={view.treasury ?? '0x…'}
            onChange={(e) => setDraft({ ...draft, treasury: e.target.value.trim() || null })}
            spellCheck={false}
            data-testid="cr-treasury"
          />
        </label>
      </div>
      <p className="ad-note">
        Fees go to <span className="mono">{view.treasury ?? 'nobody yet (set ADMIN_WALLETS or a treasury)'}</span>.
      </p>
      <SwitchRow
        label="NFT holder perk"
        options={CUSTOM_HOLDER_PERKS.map((p) => ({ id: p, label: PERK_LABEL[p].label, note: PERK_LABEL[p].note }))}
        value={draft.holderPerk}
        onPick={(p) => setDraft({ ...draft, holderPerk: p })}
        testId="cr-perk"
      />
      <div className="ad-form2 ad-form3">
        {draft.holderPerk === 'discount' && (
          <label className="ad-field">
            <span className="ad-field__label mono">Holder discount %</span>
            {num('holderDiscountPct', 100)}
          </label>
        )}
        <label className="ad-field">
          <span className="ad-field__label mono">Live rooms (server)</span>
          {num('maxLive', CUSTOM_SETTINGS_LIMITS.maxLive)}
        </label>
        <label className="ad-field">
          <span className="ad-field__label mono">Per wallet</span>
          {num('maxPerWallet', CUSTOM_SETTINGS_LIMITS.maxPerWallet, 1)}
        </label>
      </div>

      <h3 className="ad-h3">
        Live rooms <span className="ad-dim num">· {view.rooms.length} of {view.settings.maxLive}</span>
      </h3>
      {view.rooms.length === 0 ? (
        <p className="ad-note">No custom room is open.</p>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table" data-testid="cr-rooms">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Creator</th>
                <th>Players</th>
                <th>Left</th>
                <th>Paid</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.rooms.map((r) => (
                <tr key={r.code}>
                  <td className="mono">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="mono">{`${r.creator.slice(0, 6)}…${r.creator.slice(-4)}`}</td>
                  <td className="num">
                    {r.players}/{r.maxPlayers} · {r.bots} bots
                  </td>
                  <td className="num">{minutesLeft(r.endsAt)} min</td>
                  <td className="mono">{r.paidWith}</td>
                  <td>
                    <Btn danger onClick={() => void close(r.code)} testId={`cr-close-${r.code}`}>
                      Close
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ad-actions">
        <Btn sun disabled={!dirty || busy} onClick={() => void save()} testId="cr-save">
          {busy ? 'Saving…' : 'Save custom rooms'}
        </Btn>
        {dirty && <Btn onClick={() => setDraft({ ...view.settings })}>Undo</Btn>}
        {msg && !dirty && <span className="ad-note">{msg}</span>}
      </div>
      <FormError error={err} />
    </Card>
  );
}

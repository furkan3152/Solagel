import { GAME_ACCESS_MODES, normalizeXHandle, type GameAccess, type SiteSettings } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { Field, InkButton, StampSpinner } from '../../design';
import { errText, useFlash, type TabProps } from './common';

export const GAME_ACCESS_LABEL: Record<GameAccess, { label: string; note: string }> = {
  admins: { label: 'Admins only', note: 'Only wallets in ADMIN_WALLETS can enter rooms; /play shows “The arena opens soon”.' },
  holders: { label: 'NFT holders', note: 'Wallets holding an Elymum NFT (and admins) can play; everyone else is sent to the mint.' },
  public: { label: 'Everyone', note: 'The game is open to every visitor; practice needs no wallet.' },
};

/** Site switches: who may play (gameAccess), WL open, collab open, the X handle. */
export function SettingsTab({ api }: TabProps) {
  const [saved, setSaved] = useState<SiteSettings | null>(null);
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [env, setEnv] = useState<GameAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [flashNode, flash] = useFlash();

  useEffect(() => {
    api.settings().then(
      (r) => {
        setSaved(r.settings);
        setDraft(r.settings);
        setEnv(r.gameAccessEnv ?? null);
      },
      (e) => flash('err', errText(e)),
    );
  }, [api, flash]);

  if (!draft || !saved) return <StampSpinner label="Loading" />;

  const toggle = (k: 'wlOpen' | 'collabOpen') => setDraft({ ...draft, [k]: !draft[k] });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    const h = normalizeXHandle(draft.xHandle);
    if (!h) {
      setHandleErr('Not an X handle (1 to 15 letters, numbers or underscores).');
      return;
    }
    setBusy(true);
    try {
      const patch: Partial<SiteSettings> = {};
      for (const k of ['wlOpen', 'collabOpen'] as const) if (draft[k] !== saved[k]) patch[k] = draft[k];
      if (draft.gameAccess !== saved.gameAccess) patch.gameAccess = draft.gameAccess;
      if (h !== saved.xHandle) patch.xHandle = h;
      const r = await api.saveSettings(patch);
      setSaved(r.settings);
      setDraft(r.settings);
      setEnv(r.gameAccessEnv ?? null);
      flash('ok', 'Settings saved.');
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };

  const switchRow = (k: 'wlOpen' | 'collabOpen', label: string, note: string) => (
    <label className="ad-check" key={k}>
      <input type="checkbox" checked={draft[k]} onChange={() => toggle(k)} />
      <span>
        {label}
        <span className="ad-note" style={{ display: 'block', fontWeight: 400 }}>
          {note}
        </span>
      </span>
    </label>
  );

  return (
    <section className="ad-card" aria-labelledby="ad-set-h">
      <h2 className="ad-card__title" id="ad-set-h">
        Site settings
      </h2>
      <fieldset className="ad-access" aria-describedby="ad-access-note">
        <legend className="mono ad-cap">Who may play</legend>
        {GAME_ACCESS_MODES.map((m) => (
          <label className="ad-check" key={m}>
            <input type="radio" name="ad-game-access" value={m} checked={draft.gameAccess === m} onChange={() => setDraft({ ...draft, gameAccess: m })} />
            <span>
              {GAME_ACCESS_LABEL[m].label}
              <span className="ad-note" style={{ display: 'block', fontWeight: 400 }}>
                {GAME_ACCESS_LABEL[m].note}
              </span>
            </span>
          </label>
        ))}
        <p className="ad-note" id="ad-access-note">
          {env ? `GAME_ACCESS=${env} is set on the server: it wins over this setting.` : 'The server reads this on every room entry.'}
        </p>
      </fieldset>
      {switchRow('wlOpen', 'WL applications open', `When off, /wl shows “Applications are closed, follow @${saved.xHandle}”.`)}
      {switchRow('collabOpen', 'Collab applications open', "When off, the landing's Collab button reads “Soon” and /collab takes no new communities.")}
      <Field
        label="X handle"
        prefix="@"
        value={draft.xHandle}
        onChange={(e) => {
          setDraft({ ...draft, xHandle: e.target.value });
          setHandleErr(null);
        }}
        error={handleErr ?? undefined}
        autoComplete="off"
      />
      <div className="ad-actions">
        <InkButton variant="pink" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save settings'}
        </InkButton>
        {dirty && (
          <InkButton variant="paper" size="sm" onClick={() => setDraft(saved)}>
            Undo changes
          </InkButton>
        )}
      </div>
      {flashNode}
    </section>
  );
}

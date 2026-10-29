import { normalizeXHandle, type SiteSettings } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { Field, InkButton, StampSpinner } from '../../design';
import { errText, useFlash, type TabProps } from './common';

/** Site switches: WL open, collab open, game public, the X handle. */
export function SettingsTab({ api }: TabProps) {
  const [saved, setSaved] = useState<SiteSettings | null>(null);
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [env, setEnv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [flashNode, flash] = useFlash();

  useEffect(() => {
    api.settings().then(
      (r) => {
        setSaved(r.settings);
        setDraft(r.settings);
        setEnv(r.gamePublicEnv);
      },
      (e) => flash('err', errText(e)),
    );
  }, [api, flash]);

  if (!draft || !saved) return <StampSpinner label="Loading" />;

  const toggle = (k: 'wlOpen' | 'collabOpen' | 'gamePublic') => setDraft({ ...draft, [k]: !draft[k] });
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
      for (const k of ['wlOpen', 'collabOpen', 'gamePublic'] as const) if (draft[k] !== saved[k]) patch[k] = draft[k];
      if (h !== saved.xHandle) patch.xHandle = h;
      const r = await api.saveSettings(patch);
      setSaved(r.settings);
      setDraft(r.settings);
      setEnv(r.gamePublicEnv);
      flash('ok', 'Settings saved.');
    } catch (e) {
      flash('err', errText(e));
    } finally {
      setBusy(false);
    }
  };

  const switchRow = (k: 'wlOpen' | 'collabOpen' | 'gamePublic', label: string, note: string) => (
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
      {switchRow('wlOpen', 'WL applications open', 'When off, /wl shows “Applications are closed, follow @slanaio”.')}
      {switchRow('collabOpen', 'Collab applications open', "When off, the landing's Collab button reads “Soon” and /collab takes no new communities.")}
      {switchRow(
        'gamePublic',
        'Game public',
        env ? 'GAME_PUBLIC=1 is set on the server: the game is open to everyone whatever this says.' : 'When off, only admin wallets can enter rooms; /play shows “The arena opens soon”.',
      )}
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

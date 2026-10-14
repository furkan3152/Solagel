import { useId, type ReactNode } from 'react';
import { Chip, Icon } from '../../design';
import { APP_VERSION } from '../../config';
import { useT, type TKey } from '../../i18n';
import { openModal, updateSettings, useUi, type Settings } from '../../store';

type Flag = 'showNames' | 'showMass' | 'showChat' | 'showFps';

/** A punched-ticket toggle: role=switch, 44 px tall hit area. */
export function Punch({ on, onChange, label, disabled = false }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`g-punch${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <span className="g-punch__track" aria-hidden="true">
        <span className="g-punch__hole" />
      </span>
      <span className="mono g-punch__state" aria-hidden="true">
        {on ? t('gs.on') : t('gs.off')}
      </span>
    </button>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="g-set__row">
      <span className="st-label">
        <span className="g-set__label">{label}</span>
        {note && <span className="st-note">{note}</span>}
      </span>
      <div className="g-set__ctl">{children}</div>
    </div>
  );
}

/**
 * Settings as a print order: language, stock (paper / night), sound (master,
 * sound, the map sheet and performance mode first, then the in-room
 * the in-room overlays. Used on the profile page and inside the settings sheet.
 */
export function SettingsPage({ headings = true }: { headings?: boolean }) {
  const t = useT();
  const s = useUi((st) => st.settings);
  const volId = useId();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const flags: [TKey, Flag][] = [
    ['gs.names', 'showNames'],
    ['gs.mass', 'showMass'],
    ['gs.chat', 'showChat'],
    ['gs.fps', 'showFps'],
  ];
  return (
    <div className="st-page">
      {headings && <h3 className="st-h mono">{t('st.look')}</h3>}
      <div className="g-set">
        <Row label={t('gs.lang')}>
          <Chip selected={s.lang === 'tr'} onClick={() => set({ lang: 'tr' })} lang="tr">
            Türkçe
          </Chip>
          <Chip selected={s.lang === 'en'} onClick={() => set({ lang: 'en' })} lang="en">
            English
          </Chip>
        </Row>
        <Row label={t('gs.theme')}>
          <Chip icon="sun" selected={s.theme === 'light'} onClick={() => set({ theme: 'light' })}>
            {t('gs.paper')}
          </Chip>
          <Chip icon="moon" selected={s.theme === 'dark'} onClick={() => set({ theme: 'dark' })}>
            {t('gs.night')}
          </Chip>
        </Row>
        <Row label={t('gs.sound')}>
          <Punch on={s.sound} onChange={(v) => set({ sound: v })} label={t('gs.sound')} />
        </Row>
        <div className="g-set__row">
          <label className="g-set__label" htmlFor={volId}>
            {t('gs.volume')}
          </label>
          <div className="g-set__ctl">
            <input
              id={volId}
              className="g-range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              disabled={!s.sound}
              style={{ ['--v' as string]: s.volume }}
              onChange={(e) => set({ volume: Number(e.target.value) })}
            />
          </div>
        </div>
        <Row label={t('st.perf')} note={t('st.perfNote')}>
          <Punch on={s.quality === 'low'} onChange={(v) => set({ quality: v ? 'low' : 'high' })} label={t('st.perf')} />
        </Row>
      </div>
      {headings && <h3 className="st-h mono">{t('st.game')}</h3>}
      <div className="g-set">
        <Row label={t('gs.minimap')}>
          <Punch on={s.showMinimap} onChange={(v) => set({ showMinimap: v })} label={t('gs.minimap')} />
        </Row>
        {flags.map(([key, flag]) => (
          <Row key={flag} label={t(key)}>
            <Punch on={s[flag]} onChange={(v) => set({ [flag]: v } as Partial<Settings>)} label={t(key)} />
          </Row>
        ))}
      </div>
      <div className="st-foot">
        <button type="button" className="kl-link mono" onClick={() => openModal('howto')}>
          <Icon name="docs" size={16} />
          {t('st.howto')}
        </button>
        <span className="st-version mono">{t('st.version', { v: APP_VERSION })}</span>
      </div>
    </div>
  );
}

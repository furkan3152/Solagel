import { useId, type ReactNode } from 'react';
import { Chip, Icon } from '../../design';
import { sound } from '../../audio';
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

/** A volume slider row (0..1). `onCommit`: a preview when the thumb is let go. */
function Level({ label, value, disabled, onChange, onCommit }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void; onCommit?: () => void }) {
  const id = useId();
  return (
    <div className="g-set__row">
      <label className="g-set__label" htmlFor={id}>
        {label}
      </label>
      <div className="g-set__ctl">
        <input
          id={id}
          className="g-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={disabled}
          style={{ ['--v' as string]: value }}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
      </div>
    </div>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="g-set__row">
      <span className="gs-label">
        <span className="g-set__label">{label}</span>
        {note && <span className="gs-note">{note}</span>}
      </span>
      <div className="g-set__ctl">{children}</div>
    </div>
  );
}

/**
 * Settings as a print order: language, stock (paper / night), sound (master,
 * music, effects, announcer), the map sheet and performance mode first, then
 * the in-room overlays. Used on the profile page and inside the settings sheet.
 */
export function SettingsPage({ headings = true }: { headings?: boolean }) {
  const t = useT();
  const s = useUi((st) => st.settings);
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const flags: [TKey, Flag][] = [
    ['gs.names', 'showNames'],
    ['gs.mass', 'showMass'],
    ['gs.chat', 'showChat'],
    ['gs.fps', 'showFps'],
  ];
  return (
    <div className="gs-page">
      {headings && <h3 className="gs-h mono">{t('st.look')}</h3>}
      <div className="g-set">
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
        <Level label={t('gs.volume')} value={s.volume} disabled={!s.sound} onChange={(v) => set({ volume: v })} onCommit={() => sound.click()} />
        <Row label={t('gs.music')} note={t('gs.musicNote')}>
          <Punch on={s.musicOn} onChange={(v) => set({ musicOn: v })} label={t('gs.music')} disabled={!s.sound} />
        </Row>
        <Level label={t('gs.musicVol')} value={s.music} disabled={!s.sound || !s.musicOn} onChange={(v) => set({ music: v })} />
        <Row label={t('gs.sfx')}>
          <Punch on={s.sfxOn} onChange={(v) => set({ sfxOn: v })} label={t('gs.sfx')} disabled={!s.sound} />
        </Row>
        <Level label={t('gs.sfxVol')} value={s.sfx} disabled={!s.sound || !s.sfxOn} onChange={(v) => set({ sfx: v })} onCommit={() => sound.click()} />
        <Row label={t('gs.announcer')} note={t('gs.announcerNote')}>
          <Punch on={s.announcer} onChange={(v) => set({ announcer: v })} label={t('gs.announcer')} disabled={!s.sound} />
        </Row>
        <Level label={t('gs.voiceVol')} value={s.voice} disabled={!s.sound || !s.announcer} onChange={(v) => set({ voice: v })} />
        <Row label={t('st.perf')} note={t('st.perfNote')}>
          <Punch on={s.quality === 'low'} onChange={(v) => set({ quality: v ? 'low' : 'high' })} label={t('st.perf')} />
        </Row>
      </div>
      {headings && <h3 className="gs-h mono">{t('st.game')}</h3>}
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
      <div className="gs-foot">
        <button type="button" className="kl-link mono" onClick={() => openModal('howto')}>
          <Icon name="docs" size={16} />
          {t('st.howto')}
        </button>
        <span className="gs-version mono">{t('st.version', { v: APP_VERSION })}</span>
      </div>
    </div>
  );
}

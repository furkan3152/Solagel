import { useId } from 'react';
import { Chip, Sheet } from '../../design';
import { useT, type TKey } from '../../i18n';
import { closeModal, updateSettings, useUi, type Settings } from '../../store';

type Flag = 'sound' | 'showNames' | 'showMass' | 'showMinimap' | 'showChat' | 'showFps';

/** A punched-ticket toggle: role=switch, 44 px tall hit area. */
function Punch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  const t = useT();
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`g-punch${on ? ' is-on' : ''}`} onClick={() => onChange(!on)}>
      <span className="g-punch__track" aria-hidden="true">
        <span className="g-punch__hole" />
      </span>
      <span className="mono g-punch__state" aria-hidden="true">
        {on ? t('gs.on') : t('gs.off')}
      </span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="g-set__row">
      <span className="g-set__label">{label}</span>
      <div className="g-set__ctl">{children}</div>
    </div>
  );
}

/** Settings as a print order: language, stock (paper / night), graphics, sound and overlays. */
export function SettingsSheet() {
  const t = useT();
  const s = useUi((st) => st.settings);
  const open = useUi((st) => st.modal === 'settings');
  const volId = useId();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const flags: [TKey, Flag][] = [
    ['gs.names', 'showNames'],
    ['gs.mass', 'showMass'],
    ['gs.minimap', 'showMinimap'],
    ['gs.chat', 'showChat'],
    ['gs.fps', 'showFps'],
  ];
  return (
    <Sheet open={open} onClose={closeModal} closeLabel={t('gs.close')} kicker={t('gs.kicker')} title={t('gs.title')} className="g-sheet g-settings">
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
        <Row label={t('gs.quality')}>
          <Chip selected={s.quality === 'high'} onClick={() => set({ quality: 'high' })}>
            {t('gs.high')}
          </Chip>
          <Chip selected={s.quality === 'low'} onClick={() => set({ quality: 'low' })}>
            {t('gs.low')}
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
              style={{ ['--v' as string]: s.volume }}
              onChange={(e) => set({ volume: Number(e.target.value) })}
            />
          </div>
        </div>
        {flags.map(([key, flag]) => (
          <Row key={flag} label={t(key)}>
            <Punch on={s[flag]} onChange={(v) => set({ [flag]: v } as Partial<Settings>)} label={t(key)} />
          </Row>
        ))}
      </div>
    </Sheet>
  );
}

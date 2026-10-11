import { SKINS, isSkinUnlocked } from '@solagel/shared';
import { sound } from '../game/sound';
import { useT } from '../i18n';
import { openModal, updateSettings, useUi } from '../store';
import { SkinCanvas } from './common';

export function useOwnership() {
  const profile = useUi((s) => s.auth?.profile ?? null);
  return profile ? { xp: profile.xp, premiumMask: profile.premiumSkins } : null;
}

export function SkinPicker() {
  const t = useT();
  const skin = useUi((s) => s.settings.skin);
  const lang = useUi((s) => s.settings.lang);
  const own = useOwnership();
  const def = SKINS[skin] ?? SKINS[0];
  const unlocked = isSkinUnlocked(skin, own);

  const step = (d: number) => {
    sound.click();
    updateSettings({ skin: (skin + d + SKINS.length) % SKINS.length });
  };

  return (
    <div className="skin-picker">
      <button className="btn btn-icon btn-ghost" onClick={() => step(-1)} aria-label="Previous skin">
        ◀︎
      </button>
      <button type="button" className="skin-stage" onClick={() => openModal('shop')} aria-label={`${def.name.en}: ${t('skins.shop')}`}>
        <SkinCanvas skin={skin} size={150} followPointer seed={skin + 1} />
        {!unlocked && <span className="lock-veil" aria-hidden="true">🔒</span>}
        <span className="skin-name">
          {def.name[lang]}
          {def.tier === 'free' && <span className="badge mint">{t('skins.free')}</span>}
          {def.tier === 'level' && <span className="badge sky">{t('skins.level', { n: def.level ?? 0 })}</span>}
          {def.tier === 'premium' && <span className="badge pink">{t('skins.premium')}</span>}
        </span>
        <span className="muted small center" style={{ maxWidth: 260 }}>
          {def.desc[lang]}
        </span>
      </button>
      <button className="btn btn-icon btn-ghost" onClick={() => step(1)} aria-label="Next skin">
        ▶︎
      </button>
    </div>
  );
}

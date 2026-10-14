import { SKINS, formatSol, isSkinUnlocked } from '@slana/shared';
import { useEffect, useState } from 'react';
import { sound } from '../game/sound';
import { useT } from '../i18n';
import { BuySkinButton } from '../solana/BuySkinButton';
import { WalletModal } from '../solana/WalletModal';
import { ProfileModal } from '../solana/ProfileModal';
import { closeModal, updateSettings, useUi } from '../store';
import { Modal, SkinCanvas } from './common';
// Death, cash-out and settings moved to ./game (Kâğıt Bilet sheets, Task 13).
import { useOwnership } from './SkinPicker';

export function HowToModal() {
  const t = useT();
  const items: [string, string][] = [
    ['🖱️', t('howto.move')],
    ['🪙', t('howto.eat')],
    ['✂️', t('howto.split')],
    ['💸', t('howto.eject')],
    ['🌵', t('howto.cactus')],
    ['🪂', t('howto.powerups')],
    ['◎', t('howto.stakes')],
    ['🏆', t('howto.season')],
  ];
  return (
    <Modal onClose={closeModal} wide title={`❓ ${t('howto.title')}`}>
      <div className="howto-grid">
        {items.map(([ico, text]) => (
          <div className="howto-item" key={text}>
            <span className="ico">{ico}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <div className="keys" style={{ paddingTop: 14 }}>
        {t('lobby.keys')}
      </div>
    </Modal>
  );
}

export function SkinShopModal() {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const selected = useUi((s) => s.settings.skin);
  const own = useOwnership();
  const [focus, setFocus] = useState(selected);
  const def = SKINS[focus];
  const unlocked = isSkinUnlocked(focus, own);
  useEffect(() => setFocus(selected), [selected]);

  const tiers: { title: string; ids: number[] }[] = [
    { title: t('skins.free'), ids: SKINS.filter((s) => s.tier === 'free').map((s) => s.id) },
    { title: t('skins.levelTier'), ids: SKINS.filter((s) => s.tier === 'level').map((s) => s.id) },
    { title: t('skins.premiumTier'), ids: SKINS.filter((s) => s.tier === 'premium').map((s) => s.id) },
  ];

  return (
    <Modal onClose={closeModal} wide title={`🎨 ${t('skins.shop')}`}>
      <div className="row" style={{ alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <SkinCanvas skin={focus} size={130} followPointer seed={focus + 3} />
        <div className="col grow" style={{ minWidth: 200 }}>
          <div className="skin-name" style={{ fontSize: 24 }}>
            {def.name[lang]}
          </div>
          <div className="muted">{def.desc[lang]}</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {unlocked ? (
              <button
                className="btn btn-gold"
                onClick={() => {
                  updateSettings({ skin: focus });
                  sound.click();
                  closeModal();
                }}
              >
                {focus === selected ? `✓ ${t('skins.owned')}` : t('skins.equip')}
              </button>
            ) : def.tier === 'level' ? (
              <span className="badge sky">🔒 {t('skins.level', { n: def.level ?? 0 })}</span>
            ) : (
              <BuySkinButton skin={focus} />
            )}
          </div>
        </div>
      </div>
      {tiers.map((tier) => (
        <div key={tier.title} style={{ marginBottom: 12 }}>
          <div className="side-title" style={{ fontSize: 15, marginBottom: 8 }}>
            {tier.title}
          </div>
          <div className="skin-grid">
            {tier.ids.map((id) => {
              const s = SKINS[id];
              const ok = isSkinUnlocked(id, own);
              return (
                <div key={id} className={`skin-tile ${id === focus ? 'selected' : ''}`} onClick={() => setFocus(id)}>
                  {!ok && <span className="lock">🔒</span>}
                  <SkinCanvas skin={id} size={84} animate={id === focus} seed={id} />
                  <span>{s.name[lang]}</span>
                  {s.tier === 'level' && <span className="badge sky">Lv {s.level}</span>}
                  {s.tier === 'premium' && !ok && <span className="badge pink">{t('skins.premium')}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`card toast ${x.kind}`}>
          <span>{x.text}</span>
          {x.link && (
            <a href={x.link.href} target="_blank" rel="noreferrer">
              {x.link.label} ↗
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export function Modals() {
  const modal = useUi((s) => s.modal);
  switch (modal) {
    case 'howto':
      return <HowToModal />;
    case 'shop':
      return <SkinShopModal />;
    case 'wallet':
      return <WalletModal />;
    case 'profile':
      return <ProfileModal />;
    default:
      return null;
  }
}

export { formatSol };

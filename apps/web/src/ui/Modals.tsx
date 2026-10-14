import { SKINS, formatSol, isSkinUnlocked } from '@slana/shared';
import { useEffect, useState } from 'react';
import { engine } from '../game/instance';
import { sound } from '../game/sound';
import { useT } from '../i18n';
import { explorerTx } from '../solana/links';
import { BuySkinButton } from '../solana/BuySkinButton';
import { WalletModal } from '../solana/WalletModal';
import { ProfileModal } from '../solana/ProfileModal';
import { closeModal, updateSettings, useUi } from '../store';
import { Modal, SkinCanvas, Switch, compact, formatDuration } from './common';
import { useOwnership } from './SkinPicker';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function DeathModal() {
  const t = useT();
  const death = useUi((s) => s.death);
  const me = useUi((s) => s.me);
  const room = useUi((s) => s.room);
  const auth = useUi((s) => s.auth);
  if (!death) return null;
  const s = death.stats;
  const shareText = encodeURIComponent(t('death.shareText', { mass: compact(s.maxMass) }));
  const again = () => {
    sound.click();
    engine()?.play(room?.mode === 'private' && room.code ? `private:${room.code}` : 'free');
  };
  return (
    <Modal>
      <div className="death-hero">
        <SkinCanvas skin={me?.skin ?? 0} size={120} expression="dead" />
        <h2>{t('death.title')} 😵</h2>
        <div className="row" style={{ justifyContent: 'center', fontWeight: 600 }}>
          {death.killer ? (
            <>
              <SkinCanvas skin={death.killerSkin ?? 0} size={30} animate={false} expression="hungry" />
              {t('death.by', { name: death.killer })}
            </>
          ) : (
            t('death.byNobody')
          )}
        </div>
        {room?.mode === 'stake' && death.killer && <div className="notice">{t('death.lost', { name: death.killer })}</div>}
      </div>
      <div className="result-grid">
        <Stat label={t('death.alive')} value={formatDuration(s.aliveMs)} />
        <Stat label={t('death.maxMass')} value={compact(s.maxMass)} />
        <Stat label={t('death.food')} value={s.foodEaten} />
        <Stat label={t('death.players')} value={s.playersEaten} />
        <Stat label={t('death.rank')} value={s.bestRank ? `#${s.bestRank}` : '–'} />
        <Stat label={t('death.xp')} value={auth ? `+${s.xp ?? 0}` : '—'} />
      </div>
      {!auth && <div className="notice">{t('lobby.guestNote')}</div>}
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {room?.mode !== 'stake' && (
          <button className="btn btn-gold btn-xl" onClick={again} autoFocus>
            ▶ {t('death.again')}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => engine()?.watch()}>
          👀 {t('death.spectate')}
        </button>
        <button className="btn btn-ghost" onClick={() => engine()?.backToLobby()}>
          🏠 {t('death.menu')}
        </button>
        <a className="btn btn-sky" href={`https://twitter.com/intent/tweet?text=${shareText}`} target="_blank" rel="noreferrer">
          🐦 {t('death.share')}
        </a>
      </div>
    </Modal>
  );
}

export function CashoutModal() {
  const t = useT();
  const res = useUi((s) => s.cashoutResult);
  const me = useUi((s) => s.me);
  const room = useUi((s) => s.room);
  const chain = useUi((s) => s.chain);
  const settled = useUi((s) => s.lastSettlement);
  const [since] = useState(() => Date.now());
  if (!res) return null;
  const paid = settled && settled.at >= since - 2000 && settled.kind !== 'record';
  const profit = room?.buyIn ? res.value - room.buyIn : null;
  return (
    <Modal>
      <div className="death-hero">
        <SkinCanvas skin={me?.skin ?? 0} size={120} expression="love" />
        <h2>{t('cash.title')} 🎉</h2>
        <div className="muted" style={{ fontWeight: 600 }}>
          {t('cash.value')}
        </div>
        <div className="big-sol">{formatSol(res.value, 4)}</div>
        {profit !== null && (
          <div className="badge" style={{ background: profit >= 0 ? '#7EE8C4' : '#FF8FB8' }}>
            {t('cash.profit')}: {profit >= 0 ? '+' : '−'}
            {formatSol(Math.abs(profit), 4)}
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          {paid ? (
            <>
              ✅ {t('cash.done')}{' '}
              <a href={explorerTx(settled!.signature, chain?.cluster ?? 'devnet')} target="_blank" rel="noreferrer">
                {t('cash.viewTx')} ↗
              </a>
            </>
          ) : (
            <>
              <span className="spin" /> {t('cash.pending')}
            </>
          )}
        </div>
      </div>
      {res.stats && (
        <div className="result-grid">
          <Stat label={t('death.alive')} value={formatDuration(res.stats.aliveMs)} />
          <Stat label={t('death.maxMass')} value={compact(res.stats.maxMass)} />
          <Stat label={t('death.players')} value={res.stats.playersEaten} />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-gold" onClick={() => engine()?.backToLobby()}>
          🏠 {t('death.menu')}
        </button>
      </div>
    </Modal>
  );
}

export function SettingsModal() {
  const t = useT();
  const s = useUi((st) => st.settings);
  const rows: [string, keyof typeof s][] = [
    [t('settings.sound'), 'sound'],
    [t('settings.names'), 'showNames'],
    [t('settings.mass'), 'showMass'],
    [t('settings.minimap'), 'showMinimap'],
    [t('settings.chat'), 'showChat'],
    [t('settings.fps'), 'showFps'],
  ];
  return (
    <Modal onClose={closeModal} title={`⚙️ ${t('settings.title')}`}>
      <div className="setting-row">
        <span>{t('settings.lang')}</span>
        <div className="seg">
          <button className={`btn ${s.lang === 'tr' ? 'on' : ''}`} onClick={() => updateSettings({ lang: 'tr' })}>
            🇹🇷 Türkçe
          </button>
          <button className={`btn ${s.lang === 'en' ? 'on' : ''}`} onClick={() => updateSettings({ lang: 'en' })}>
            🇬🇧 English
          </button>
        </div>
      </div>
      <div className="setting-row">
        <span>{t('settings.theme')}</span>
        <div className="seg">
          <button className={`btn ${s.theme === 'light' ? 'on' : ''}`} onClick={() => updateSettings({ theme: 'light' })}>
            🍬 {t('settings.light')}
          </button>
          <button className={`btn ${s.theme === 'dark' ? 'on' : ''}`} onClick={() => updateSettings({ theme: 'dark' })}>
            🌙 {t('settings.dark')}
          </button>
        </div>
      </div>
      <div className="setting-row">
        <span>{t('settings.quality')}</span>
        <div className="seg">
          <button className={`btn ${s.quality === 'high' ? 'on' : ''}`} onClick={() => updateSettings({ quality: 'high' })}>
            🍮 {t('settings.high')}
          </button>
          <button className={`btn ${s.quality === 'low' ? 'on' : ''}`} onClick={() => updateSettings({ quality: 'low' })}>
            ⚡ {t('settings.low')}
          </button>
        </div>
      </div>
      <div className="setting-row">
        <span>{t('settings.volume')}</span>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => updateSettings({ volume: Number(e.target.value) })} />
      </div>
      {rows.map(([label, key]) => (
        <div className="setting-row" key={key}>
          <span>{label}</span>
          <Switch on={!!s[key]} onChange={(v) => updateSettings({ [key]: v })} label={label} />
        </div>
      ))}
    </Modal>
  );
}

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
    case 'settings':
      return <SettingsModal />;
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

import { useWallet } from '@solana/wallet-adapter-react';
import { formatSol } from '@slana/shared';
import { useState } from 'react';
import { levelProgress } from '../game/engine';
import { useT } from '../i18n';
import { openModal, useUi } from '../store';
import { SkinCanvas, compact } from '../ui/common';
import { useChainData } from './chain';
import { signInWithWallet } from './siws';

export function ProfileCard() {
  const t = useT();
  const wallet = useWallet();
  const chain = useUi((s) => s.chain);
  const auth = useUi((s) => s.auth);
  const skin = useUi((s) => s.settings.skin);
  const data = useChainData();
  const [busy, setBusy] = useState(false);
  const pubkey = wallet.publicKey?.toBase58();
  const verified = !!pubkey && auth?.pubkey === pubkey;

  // guest
  if (!wallet.connected || !pubkey) {
    return (
      <div className="card side-card">
        <div className="side-title">
          <span>🪪 {t('profile.title')}</span>
          <span className="badge lav">{t('profile.guest')}</span>
        </div>
        <div className="row">
          <SkinCanvas skin={skin} size={64} seed={9} />
          <div className="muted small">{t('lobby.guestNote')}</div>
        </div>
        <button className="btn btn-purple" onClick={() => openModal('wallet')}>
          👛 {t('wallet.connect')}
        </button>
        <FeatureList />
      </div>
    );
  }

  const offline = !chain?.enabled || data.deployed === false;
  const profile = data.profile;
  const xp = profile?.xp ?? auth?.profile?.xp ?? 0;
  const prog = levelProgress(xp);

  return (
    <div className="card side-card">
      <div className="side-title">
        <span>🪪 {t('profile.title')}</span>
        {verified ? <span className="badge mint">✓ {t('wallet.verified')}</span> : <span className="badge">!</span>}
      </div>
      {offline && <div className="notice">⛓️‍💥 {t('chain.offline')}</div>}
      {!verified && (
        <button
          className="btn btn-mint"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await signInWithWallet(wallet, true);
            setBusy(false);
          }}
        >
          {busy ? <span className="spin" /> : '✍️'} {t('wallet.verify')}
        </button>
      )}
      {!offline && !data.profileLoaded && (
        <div className="row muted">
          <span className="spin" /> {t('common.loading')}
        </div>
      )}
      {!offline && data.profileLoaded && !profile && (
        <>
          <div className="row">
            <SkinCanvas skin={skin} size={64} seed={9} />
            <div className="muted small">{t('profile.createDesc')}</div>
          </div>
          <button className="btn btn-gold" onClick={() => openModal('profile')}>
            ✨ {t('profile.create')}
          </button>
        </>
      )}
      {profile && (
        <>
          <div className="row">
            <SkinCanvas skin={profile.skin} size={64} seed={9} expression="proud" />
            <div className="col grow" style={{ gap: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{profile.name}</div>
              <div className="row small" style={{ fontWeight: 600 }}>
                <span className="badge sky">{t('profile.level', { n: prog.level })}</span>
                <span className="muted">{t('profile.xpTo', { xp: compact(xp), next: compact(prog.next) })}</span>
              </div>
              <div className="xp-bar">
                <div style={{ width: `${Math.round(prog.pct * 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <b>{compact(profile.gamesPlayed)}</b>
              <span>{t('profile.games')}</span>
            </div>
            <div className="stat">
              <b>{compact(profile.kills)}</b>
              <span>{t('profile.kills')}</span>
            </div>
            <div className="stat">
              <b>{compact(profile.bestScore)}</b>
              <span>{t('profile.best')}</span>
            </div>
            <div className="stat">
              <b>{profile.season === chain?.currentSeason ? compact(profile.seasonPoints) : 0}</b>
              <span>{t('profile.season')}</span>
            </div>
            <div className="stat" style={{ gridColumn: 'span 2' }}>
              <b>{formatSol(profile.totalWon, 4)}</b>
              <span>{t('profile.won')}</span>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-ghost grow" onClick={() => openModal('profile')}>
              ✏️ {t('profile.edit')}
            </button>
            <button className="btn btn-pink grow" onClick={() => openModal('shop')}>
              🎨 {t('skins.shop')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FeatureList() {
  const t = useT();
  const items = [`⛓️ ${t('howto.season')}`, `◎ ${t('howto.stakes')}`];
  return (
    <div className="col" style={{ gap: 6 }}>
      {items.map((x) => (
        <div key={x} className="notice" style={{ borderStyle: 'solid' }}>
          {x}
        </div>
      ))}
    </div>
  );
}

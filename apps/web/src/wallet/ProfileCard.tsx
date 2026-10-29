import { useWallet } from '@solana/wallet-adapter-react';
import { InkButton } from '../design';
import { levelProgress } from '../game/engine';
import { useT } from '../i18n';
import { useUi } from '../store';
import { CoinPortrait } from '../ui/game/CoinPortrait';
import { useTokenText } from '../ui/lobby/useLobby';
import { useChainData } from './chain';

/** Name, level and the on-chain record, printed like a membership card. */
export function ProfileCard({ onEdit }: { onEdit?: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const settings = useUi((s) => s.settings);
  const auth = useUi((s) => s.auth);
  const profile = useChainData((s) => s.profile);
  const tok = useTokenText();
  const nf = new Intl.NumberFormat('en-US');
  const connected = wallet.connected && !!wallet.publicKey;
  const name = profile?.name ?? auth?.profile?.name ?? (settings.name || t('pf.guest'));
  const xp = profile?.xp ?? auth?.profile?.xp ?? 0;
  const prog = levelProgress(xp);

  return (
    <section className="kl-card kl-profile" aria-labelledby="kl-profile-h">
      <div className="kl-profile__top">
        <CoinPortrait skin={settings.skin} size={64} expression="happy" seed={9} className="kl-profile__coin" />
        <div className="kl-profile__id">
          <h3 id="kl-profile-h" className="kl-profile__name">
            {name}
          </h3>
          {connected ? (
            <>
              <span className="mono kl-profile__lvl">
                {t('pf.level', { n: prog.level })} · {t('pf.xp', { xp: nf.format(xp), next: nf.format(prog.next) })}
              </span>
              <span className="kl-xp" aria-hidden="true">
                <span style={{ width: `${Math.round(prog.pct * 100)}%` }} />
              </span>
            </>
          ) : (
            <span className="mono kl-profile__lvl">{t('pf.guest')}</span>
          )}
        </div>
      </div>
      {!connected && <p className="kl-note">{t('pf.guestNote')}</p>}
      {profile && (
        <dl className="kl-stats">
          <div>
            <dt className="mono">{t('pf.games')}</dt>
            <dd>{nf.format(profile.gamesPlayed)}</dd>
          </div>
          <div>
            <dt className="mono">{t('pf.kills')}</dt>
            <dd>{nf.format(profile.kills)}</dd>
          </div>
          <div>
            <dt className="mono">{t('pf.best')}</dt>
            <dd>{nf.format(profile.bestScore)}</dd>
          </div>
          <div>
            <dt className="mono">{t('pf.won')}</dt>
            <dd>
              {tok.fee(profile.totalWon)} <span className="mono kl-unit">{tok.symbol}</span>
            </dd>
          </div>
        </dl>
      )}
      {onEdit && (
        <InkButton variant="paper" size="sm" lead="user" onClick={onEdit}>
          {t('pf.edit')}
        </InkButton>
      )}
    </section>
  );
}

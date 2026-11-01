import { shortAddress } from '@elymum/shared';
import { Button } from '../design';
import { levelProgress } from '../game/engine';
import { useT } from '../i18n';
import { useUi } from '../store';
import { CoinPortrait } from '../ui/game/CoinPortrait';
import { wearsPicture } from '../ui/profile/picture';
import { useChainData } from './chain';
import { useAddress } from './store';

/**
 * The player as a membership sticker: a mist band with the member number, the coin they
 * wear, name, level and XP, and the server's record of them in three mono figures.
 */
export function ProfileCard({ onEdit }: { onEdit?: () => void }) {
  const t = useT();
  const address = useAddress();
  const settings = useUi((s) => s.settings);
  const auth = useUi((s) => s.auth);
  const profile = useChainData((s) => s.profile);
  const nf = new Intl.NumberFormat('en-US');
  const connected = address !== null;
  const name = profile?.name ?? auth?.profile?.name ?? (settings.name || t('pf.guest'));
  const xp = auth?.profile?.xp ?? 0;
  const prog = levelProgress(xp);

  return (
    <section className="kl-card kl-profile" aria-labelledby="kl-profile-h">
      <div className="kl-profile__band mono" aria-hidden="true">
        <span>{t('pf.member')}</span>
        <span>{connected ? shortAddress(address, 4, 4) : t('pf.guestNo')}</span>
      </div>
      <div className="kl-profile__top">
        <span className="kl-profile__photo">
          <CoinPortrait
            skin={settings.skin}
            size={64}
            expression="happy"
            seed={9}
            className="kl-profile__coin"
            avatar={address && wearsPicture(settings.picture, profile?.avatar) ? profile?.avatar : null}
          />
        </span>
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
            <dd className="num">{nf.format(profile.stats.games)}</dd>
          </div>
          <div>
            <dt className="mono">{t('pf.kills')}</dt>
            <dd className="num">{nf.format(profile.stats.kills)}</dd>
          </div>
          <div>
            <dt className="mono">{t('pf.best')}</dt>
            <dd className="num">{nf.format(profile.stats.best)}</dd>
          </div>
        </dl>
      )}
      {onEdit && (
        <Button variant="secondary" size="sm" lead="user" onClick={onEdit} className="kl-profile__edit">
          {t('pf.edit')}
        </Button>
      )}
    </section>
  );
}

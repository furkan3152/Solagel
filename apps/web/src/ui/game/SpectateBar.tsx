import { Icon, InkButton } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { useUi } from '../../store';

/** Spectator strip: who we are watching, next (Q), play and back to the lobby. */
export function SpectateBar() {
  const t = useT();
  const lb = useUi((s) => s.lb);
  const target = useUi((s) => s.spectateTarget);
  const name = lb.find((e) => e.pid === target)?.name ?? lb[0]?.name ?? '…';
  return (
    <div className="g-spectate g-slip">
      <div className="g-slip__paper g-spectate__paper">
        <div className="g-spectate__who">
          <span className="mono g-spectate__kicker">{t('g.watching')}</span>
          <b className="g-spectate__name">{name}</b>
        </div>
        <div className="g-spectate__actions">
          <button type="button" className="kb-iconbtn" onClick={() => engine()?.spectateNext()} aria-label={`${t('g.next')} (Q)`} aria-keyshortcuts="Q" title={`${t('g.next')} · Q`}>
            <Icon name="chevron" size={22} />
          </button>
          <button type="button" className="kb-iconbtn" onClick={() => engine()?.backToLobby()} aria-label={t('g.lobby')} title={t('g.lobby')}>
            <Icon name="menu" size={22} />
          </button>
          <InkButton variant="pink" size="md" icon="play" onClick={() => engine()?.play('practice')}>
            {t('g.play')}
          </InkButton>
        </div>
      </div>
    </div>
  );
}

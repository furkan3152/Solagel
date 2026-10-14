import { Icon, Sheet } from '../../design';
import { useT, type TKey } from '../../i18n';
import { closeModal, useUi } from '../../store';
import { SettingsPage } from '../profile/SettingsPage';

/** Settings as a sheet (masthead gear, in-game top bar): the same print order as the profile page. */
export function SettingsSheet() {
  const t = useT();
  const open = useUi((st) => st.modal === 'settings');
  return (
    <Sheet open={open} onClose={closeModal} closeLabel={t('gs.close')} kicker={t('gs.kicker')} title={t('gs.title')} className="g-sheet g-settings">
      <SettingsPage />
    </Sheet>
  );
}

const HOWTO: { icon: Parameters<typeof Icon>[0]['name']; key: TKey }[] = [
  { icon: 'arrow', key: 'howto.move' },
  { icon: 'coin', key: 'howto.eat' },
  { icon: 'split', key: 'howto.split' },
  { icon: 'eject', key: 'howto.eject' },
  { icon: 'flame', key: 'howto.cactus' },
  { icon: 'emote', key: 'howto.powerups' },
  { icon: 'cashout', key: 'howto.stakes' },
  { icon: 'trophy', key: 'howto.season' },
];

/** How to play: eight numbered lines with drawn icons (no emoji). */
export function HowToSheet() {
  const t = useT();
  const open = useUi((st) => st.modal === 'howto');
  return (
    <Sheet open={open} onClose={closeModal} closeLabel={t('lo.close')} kicker={t('st.kicker')} title={t('howto.title')} className="g-sheet g-howto">
      <ol className="g-howto__list">
        {HOWTO.map((h, i) => (
          <li key={h.key}>
            <span className="g-howto__n mono" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <Icon name={h.icon} size={22} className="g-howto__icon" />
            <span>{t(h.key)}</span>
          </li>
        ))}
      </ol>
      <p className="g-howto__keys mono">{t('lobby.keys')}</p>
    </Sheet>
  );
}

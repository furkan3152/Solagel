import { Button, CoinCharacter, Sheet } from '../../design';
import { t } from '../../i18n';
import { useUi } from '../../store';

/**
 * The server answered a room entry with `game_closed` (the game is open to admins or NFT holders
 * only and this wallet is neither, or its sign-in expired). One calm sheet instead of an error loop.
 */
export function GameClosedSheet() {
  const open = useUi((s) => s.gameClosed);
  const close = () => useUi.setState({ gameClosed: false });
  return (
    <Sheet
      open={open}
      onClose={close}
      kicker="Elymum arena · holders only"
      title="Not open to this wallet yet."
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="primary" icon="arrow" onClick={() => location.assign('/mint')}>
            Mint
          </Button>
          <Button variant="secondary" onClick={() => location.assign('/')}>
            Back home
          </Button>
          <Button variant="ghost" size="sm" onClick={() => location.assign('/admin')}>
            Admin sign-in
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <CoinCharacter paint="cyan" mood="sleepy" size={84} feet style={{ flex: 'none' }} />
        <div>
          <p style={{ margin: 0 }}>{t('err.game_closed')}</p>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-2)' }}>
            Holders: sign in with the wallet that holds your Elymum emblem. Admins: sign in on /admin, then open Play from there.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

import { InkButton, Sheet } from '../../design';
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
      kicker="Elymum arena"
      title="Not open to this wallet yet."
      closeLabel={t('common.close')}
      footer={
        <>
          <InkButton variant="pink" onClick={() => location.assign('/')}>
            Back home
          </InkButton>
          <InkButton variant="paper" onClick={() => location.assign('/mint')}>
            Mint
          </InkButton>
          <InkButton variant="paper" onClick={() => location.assign('/admin')}>
            Admin sign-in
          </InkButton>
        </>
      }
    >
      <p>{t('err.game_closed')}</p>
      <p className="mono" style={{ marginTop: 12, fontSize: 12 }}>
        Holders: verify the wallet that holds your Elymum NFT. Admins: sign in on /admin with the admin wallet, then open Play from there.
      </p>
    </Sheet>
  );
}

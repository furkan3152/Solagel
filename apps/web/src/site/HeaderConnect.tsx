import { useState } from 'react';
import { Icon, Modal, shortAddress } from '../design';
import { useT } from '../i18n';
import { useWallet } from '../wallet/store';
import { useSession } from './session';
import { WalletSignIn } from './wallet/SiteWallet';

/**
 * The header's wallet button. Signed out: "Connect" opens the wallet picker (one free SIWE
 * signature, no transaction). Signed in: the short address, which opens the same sheet to
 * switch wallets. Lives in its own chunk so the landing paints before viem loads.
 */
export function HeaderConnect() {
  const t = useT();
  const session = useSession((s) => s.session);
  // a wallet connected for a page that needs no sign-in (the faucet) shows too, with a hollow dot
  const wallet = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const shown = session?.address ?? wallet;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`kb-btn kb-btn--secondary kb-btn--md st-connect${shown ? ' is-signed' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={session ? t('site.hc.signedIn', { addr: shortAddress(session.address) }) : shown ? t('site.hc.connected', { addr: shortAddress(shown) }) : t('site.hc.connect')}
      >
        {shown ? <span className={`st-connect__dot${session ? '' : ' is-hollow'}`} aria-hidden="true" /> : <Icon name="wallet" size={20} className="kb-btn__lead" />}
        <span className="kb-btn__label">
          <span className={`kb-btn__text${shown ? ' num' : ''}`}>{shown ? shortAddress(shown) : t('site.connect')}</span>
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        kicker={t('wl.kickerConnect')}
        title={session ? t('site.hc.titleIn') : t('site.hc.title')}
        closeLabel={t('common.close')}
      >
        <p className="st-connect__lede">
          {t('site.hc.lede')}
        </p>
        <WalletSignIn label={t('site.hc.signIn')} onSession={() => setOpen(false)} />
      </Modal>
    </>
  );
}

import { useState } from 'react';
import { Icon, Modal, shortAddress } from '../design';
import { useWallet } from '../wallet/store';
import { useSession } from './session';
import { WalletSignIn } from './wallet/SiteWallet';

/**
 * The header's wallet button. Signed out: "Connect" opens the wallet picker (one free SIWE
 * signature, no transaction). Signed in: the short address, which opens the same sheet to
 * switch wallets. Lives in its own chunk so the landing paints before viem loads.
 */
export function HeaderConnect() {
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
        aria-label={session ? `Wallet ${shortAddress(session.address)}, signed in` : shown ? `Wallet ${shortAddress(shown)}, connected` : 'Connect a wallet'}
      >
        {shown ? <span className={`st-connect__dot${session ? '' : ' is-hollow'}`} aria-hidden="true" /> : <Icon name="wallet" size={20} className="kb-btn__lead" />}
        <span className="kb-btn__label">
          <span className={`kb-btn__text${shown ? ' num' : ''}`}>{shown ? shortAddress(shown) : 'Connect'}</span>
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        kicker="Connect · Elysium"
        title={session ? 'Signed in' : 'Bring a wallet'}
        closeLabel="Close"
      >
        <p className="st-connect__lede">
          Any EVM wallet works. We ask for one signature to know it is you: free, and it sends no transaction. We will never ask for your seed phrase.
        </p>
        <WalletSignIn label="Sign in" onSession={() => setOpen(false)} />
      </Modal>
    </>
  );
}

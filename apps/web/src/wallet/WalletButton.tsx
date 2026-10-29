import { shortAddress } from '@elymum/shared';
import { Icon } from '../design';
import { useT } from '../i18n';
import { openModal, useUi } from '../store';
import { useTokenText } from '../ui/lobby/useLobby';
import { useChainData } from './chain';
import { useWallet } from './store';

/**
 * The wallet label in the masthead: a dashed slip with the short address over the $ELYMUM
 * balance. Disconnected, it is the "connect" slip.
 */
export function WalletButton() {
  const t = useT();
  const status = useWallet((s) => s.status);
  const address = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const tokens = useChainData((s) => s.tokenBalance);
  const auth = useUi((s) => s.auth);
  const tok = useTokenText();
  // the game token is not set on chain yet: there is no balance to read
  const soon = useUi((s) => !!s.chain?.enabled && s.chain.tokenReady === false);

  if (!address) {
    const connecting = status === 'connecting';
    return (
      <button type="button" className="kl-wallet is-off" onClick={() => openModal('wallet')} disabled={connecting} aria-busy={connecting}>
        <span className="kl-wallet__top mono">{t('wl.connectSub')}</span>
        <span className="kl-wallet__main">
          <Icon name="wallet" size={18} />
          {t('wl.connect')}
        </span>
      </button>
    );
  }
  const short = shortAddress(address, 6, 4);
  const verified = !!auth && auth.address.toLowerCase() === address.toLowerCase();
  const bal = tokens === null ? null : tok.fee(tokens);
  return (
    <button
      type="button"
      className="kl-wallet"
      onClick={() => openModal('wallet')}
      aria-label={bal === null ? t('wl.labelNoBal', { addr: short }) : t('wl.label', { addr: short, bal, sym: tok.symbol })}
      title={address}
    >
      <span className="kl-wallet__top mono">
        {!verified && <span className="kl-wallet__dot" title={t('wl.unverified')} />}
        {short}
      </span>
      <span className="kl-wallet__main">
        {soon ? (
          <span className="kl-wallet__sym mono">{t('wl.tokenSoon')}</span>
        ) : (
          <>
            {bal ?? '…'} <span className="kl-wallet__sym mono">{tok.symbol}</span>
          </>
        )}
      </span>
    </button>
  );
}

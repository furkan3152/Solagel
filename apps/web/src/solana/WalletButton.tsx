import { useWallet } from '@solana/wallet-adapter-react';
import { shortAddress } from '@elymum/shared';
import { Icon } from '../design';
import { useT } from '../i18n';
import { openModal, useUi } from '../store';
import { useTokenText } from '../ui/lobby/useLobby';
import { useChainData } from './chain';

/**
 * The wallet label in the masthead: a dashed slip with the short address
 * over the $SLANA balance. Disconnected, it is the "connect" slip.
 */
export function WalletButton() {
  const t = useT();
  const { publicKey, connected, connecting } = useWallet();
  const tokens = useChainData((s) => s.tokenBalance);
  const auth = useUi((s) => s.auth);
  const tok = useTokenText();
  // the game token is not set on chain yet: there is no balance to read
  const soon = useUi((s) => !!s.chain?.enabled && s.chain.tokenReady === false);

  if (!connected || !publicKey) {
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
  const addr = publicKey.toBase58();
  const short = shortAddress(addr, 4, 4);
  const verified = auth?.pubkey === addr;
  const bal = tokens === null ? null : tok.fee(tokens);
  return (
    <button
      type="button"
      className="kl-wallet"
      onClick={() => openModal('wallet')}
      aria-label={bal === null ? t('wl.labelNoBal', { addr: short }) : t('wl.label', { addr: short, bal, sym: tok.symbol })}
      title={addr}
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

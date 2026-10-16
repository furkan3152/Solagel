import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWallet } from '@solana/wallet-adapter-react';
import { formatToken } from '@slana/shared';
import { useState } from 'react';
import { Chip, Icon, InkButton, Sheet } from '../design';
import { useT } from '../i18n';
import { closeModal, toast, useUi } from '../store';
import { useTokenText } from '../ui/lobby/useLobby';
import { useChainData } from './chain';
import { explorerAddress } from './links';
import { signInWithWallet } from './siws';
import { markUserConnect } from './useWalletAuth';

/**
 * Wallet sheet. Disconnected: the Wallet Standard wallets found in the
 * browser (no per-wallet adapters). Connected: address, $SLANA and SOL
 * balances, network, the free sign-in signature, explorer and disconnect.
 */
export function WalletModal() {
  const t = useT();
  const open = useUi((s) => s.modal === 'wallet');
  const wallet = useWallet();
  const { wallets, select, publicKey, connected, disconnect } = wallet;
  const lamports = useChainData((s) => s.balance);
  const tokens = useChainData((s) => s.tokenBalance);
  const ataExists = useChainData((s) => s.ataExists);
  const auth = useUi((s) => s.auth);
  const cluster = useUi((s) => s.chain?.cluster ?? 'devnet');
  const tok = useTokenText();
  const soon = useUi((s) => !!s.chain?.enabled && s.chain.tokenReady === false);
  const [busy, setBusy] = useState(false);

  const addr = connected && publicKey ? publicKey.toBase58() : null;
  const verified = !!addr && auth?.pubkey === addr;

  const listed = [...wallets]
    .filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable)
    .sort((a, b) => Number(b.readyState === WalletReadyState.Installed) - Number(a.readyState === WalletReadyState.Installed));

  return (
    <Sheet
      open={open}
      onClose={closeModal}
      closeLabel={t('wl.close')}
      kicker={t('wl.kicker')}
      title={addr ? (wallet.wallet?.adapter.name ?? t('wl.kicker')) : t('wl.choose')}
      className="kl-sheet wl-sheet"
      footer={
        addr ? (
          <InkButton
            variant="paper"
            size="md"
            onClick={() => {
              void disconnect();
              closeModal();
            }}
          >
            {t('wl.disconnect')}
          </InkButton>
        ) : undefined
      }
    >
      {addr ? (
        <div className="wl-body">
          <div className="wl-addr">
            <span className="mono wl-cap">{t('wl.address')}</span>
            <code className="wl-addr__full">{addr}</code>
            <span className="wl-addr__actions">
              <Chip
                icon="docs"
                onClick={() => {
                  void navigator.clipboard?.writeText(addr).then(() => toast('success', t('wl.copied')));
                }}
              >
                {t('wl.copy')}
              </Chip>
              <a className="kl-link mono" href={explorerAddress(addr, cluster)} target="_blank" rel="noreferrer">
                {t('wl.explorer')}
              </a>
            </span>
          </div>
          <dl className="wl-bal">
            <div>
              <dt className="mono wl-cap">{t('wl.tokens')}</dt>
              <dd>
                {soon ? (
                  <span className="mono">{t('wl.tokenSoonLong')}</span>
                ) : (
                  <>
                    <span className="wl-bal__big">{tokens === null ? '…' : tok.exact(tokens)}</span> <span className="mono">{tok.symbol}</span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="mono wl-cap">{t('wl.sol')}</dt>
              <dd>
                <span className="wl-bal__mid">{lamports === null ? '…' : formatToken(lamports, 9, { maxFrac: 4 })}</span>{' '}
                <span className="mono">SOL</span>
              </dd>
            </div>
            <div>
              <dt className="mono wl-cap">{t('wl.network')}</dt>
              <dd className="mono">{cluster}</dd>
            </div>
          </dl>
          {ataExists === false && <p className="kl-note">{t('wl.noAta')}</p>}
          {verified ? (
            <p className="wl-ok mono">
              <Icon name="check" size={16} /> {t('wl.verified')}
            </p>
          ) : (
            <div className="wl-verify">
              <p className="kl-note">{t('wl.verifyNote')}</p>
              <InkButton
                variant="ink"
                size="md"
                lead="key"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await signInWithWallet(wallet, true);
                  setBusy(false);
                }}
              >
                {t('wl.verify')}
              </InkButton>
            </div>
          )}
        </div>
      ) : (
        <div className="wl-body">
          {listed.length > 0 ? (
            <ul className="wl-list">
              {listed.map((w) => (
                <li key={w.adapter.name}>
                  <button
                    type="button"
                    className="wl-item"
                    onClick={() => {
                      markUserConnect();
                      select(w.adapter.name);
                      closeModal();
                    }}
                  >
                    <img src={w.adapter.icon} alt="" width={32} height={32} />
                    <span className="wl-item__name">{w.adapter.name}</span>
                    {w.readyState === WalletReadyState.Installed && <span className="wl-item__tag mono">{t('wl.installed')}</span>}
                    <Icon name="chevron" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="kl-note">{t('wl.none')}</p>
              <span className="wl-install">
                <a className="kb-btn kb-btn--ink kb-btn--md" href="https://phantom.app/download" target="_blank" rel="noreferrer">
                  {t('wl.install')}
                </a>
                <a className="kl-link mono" href="https://solflare.com/download" target="_blank" rel="noreferrer">
                  Solflare
                </a>
                <a className="kl-link mono" href="https://backpack.app/downloads" target="_blank" rel="noreferrer">
                  Backpack
                </a>
              </span>
            </>
          )}
          <p className="kl-note">{t('wl.verifyNote')}</p>
        </div>
      )}
    </Sheet>
  );
}

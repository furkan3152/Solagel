import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWallet } from '@solana/wallet-adapter-react';
import { formatSol } from '@solagel/shared';
import { useState } from 'react';
import { useT } from '../i18n';
import { closeModal, toast, useUi } from '../store';
import { Modal } from '../ui/common';
import { useChainData } from './chain';
import { explorerAddress } from './links';
import { markUserConnect } from './useWalletAuth';
import { signInWithWallet } from './siws';

export function WalletModal() {
  const t = useT();
  const wallet = useWallet();
  const { wallets, select, publicKey, connected, disconnect } = wallet;
  const balance = useChainData((s) => s.balance);
  const auth = useUi((s) => s.auth);
  const cluster = useUi((s) => s.chain?.cluster ?? 'devnet');
  const [busy, setBusy] = useState(false);

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    const verified = auth?.pubkey === addr;
    return (
      <Modal onClose={closeModal} title={`👛 ${wallet.wallet?.adapter.name ?? 'Wallet'}`}>
        <div className="col">
          <div className="stat" style={{ wordBreak: 'break-all' }}>
            <span>{t('wallet.copy')}</span>
            <b style={{ fontSize: 14 }}>{addr}</b>
          </div>
          <div className="row">
            <div className="stat grow">
              <span>{t('wallet.balance')}</span>
              <b>{balance === null ? '…' : formatSol(balance, 4)}</b>
            </div>
            <div className="stat grow">
              <span>{t('chain.cluster')}</span>
              <b>{cluster}</b>
            </div>
          </div>
          {!verified && (
            <>
              <div className="notice">{t('wallet.signInfo')}</div>
              <button
                className="btn btn-mint"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await signInWithWallet(wallet, true);
                  setBusy(false);
                }}
              >
                {busy ? <span className="spin" /> : '✍️'} {busy ? t('wallet.verifying') : t('wallet.verify')}
              </button>
            </>
          )}
          {verified && <div className="badge mint" style={{ alignSelf: 'flex-start' }}>✅ {t('wallet.verified')}</div>}
          <div className="row">
            <button className="btn btn-ghost grow" onClick={() => navigator.clipboard?.writeText(addr).then(() => toast('success', '📋 Copied'))}>
              📋 {t('wallet.copy')}
            </button>
            <a className="btn btn-ghost grow" href={explorerAddress(addr, cluster)} target="_blank" rel="noreferrer">
              🔎 Explorer
            </a>
          </div>
          <button
            className="btn btn-pink"
            onClick={() => {
              void disconnect();
              closeModal();
            }}
          >
            {t('wallet.disconnect')}
          </button>
        </div>
      </Modal>
    );
  }

  const sorted = [...wallets].sort((a, b) => Number(b.readyState === WalletReadyState.Installed) - Number(a.readyState === WalletReadyState.Installed));
  const installed = sorted.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  return (
    <Modal onClose={closeModal} title={`👛 ${t('wallet.choose')}`}>
      <div className="wallet-list">
        {installed.map((w) => (
          <button
            key={w.adapter.name}
            className="wallet-item"
            onClick={() => {
              markUserConnect();
              select(w.adapter.name);
              closeModal();
            }}
          >
            <img src={w.adapter.icon} alt="" />
            {w.adapter.name}
            <span className="badge mint tag">✓</span>
          </button>
        ))}
        {installed.length === 0 && (
          <>
            <div className="notice">{t('wallet.none')}</div>
            <a className="btn btn-purple" href="https://phantom.app/download" target="_blank" rel="noreferrer">
              👻 {t('wallet.install')}
            </a>
            <a className="btn btn-ghost" href="https://solflare.com/download" target="_blank" rel="noreferrer">
              🔆 Solflare
            </a>
          </>
        )}
      </div>
      <div className="muted small" style={{ marginTop: 12 }}>
        {t('wallet.signInfo')}
      </div>
    </Modal>
  );
}

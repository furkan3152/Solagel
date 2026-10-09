import { useWallet } from '@solana/wallet-adapter-react';
import { formatSol, shortAddress } from '@solagel/shared';
import { useT } from '../i18n';
import { openModal, useUi } from '../store';
import { useChainData } from './chain';

export function WalletButton() {
  const t = useT();
  const { publicKey, connected, connecting } = useWallet();
  const balance = useChainData((s) => s.balance);
  const auth = useUi((s) => s.auth);
  if (!connected || !publicKey) {
    return (
      <button className="btn btn-purple wallet-btn" onClick={() => openModal('wallet')} disabled={connecting}>
        {connecting ? <span className="spin" /> : '👛'} <span className="hide-sm">{t('wallet.connect')}</span>
      </button>
    );
  }
  const verified = auth?.pubkey === publicKey.toBase58();
  return (
    <button className="btn btn-ghost wallet-btn" onClick={() => openModal('wallet')} title={publicKey.toBase58()}>
      <span>{verified ? '✅' : '👛'}</span>
      <span className="hide-sm">{shortAddress(publicKey.toBase58())}</span>
      {balance !== null && <span className="badge mint">{formatSol(balance)}</span>}
    </button>
  );
}

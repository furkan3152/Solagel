import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { formatSol } from '@solagel/shared';
import { useState } from 'react';
import { useT } from '../i18n';
import { openModal, updateSettings } from '../store';
import { refreshChain, useChainData, useSolagelClient } from './chain';
import { signInWithWallet } from './siws';
import { sendWalletTx } from './tx';

/** Buys a premium skin on-chain (price goes to the treasury) and equips it. */
export function BuySkinButton({ skin }: { skin: number }) {
  const t = useT();
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSolagelClient();
  const config = useChainData((s) => s.config);
  const profile = useChainData((s) => s.profile);
  const [busy, setBusy] = useState(false);

  if (!wallet.connected) {
    return (
      <button className="btn btn-purple" onClick={() => openModal('wallet')}>
        👛 {t('skins.needWallet')}
      </button>
    );
  }
  if (!client || !config) return <span className="badge pink">{t('chain.offline')}</span>;
  if (!profile) {
    return (
      <button className="btn btn-gold" onClick={() => openModal('profile')}>
        ✨ {t('profile.create')}
      </button>
    );
  }
  return (
    <button
      className="btn btn-gold"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const ix = await client.ix.buySkin(wallet.publicKey!, skin, config.treasury);
        const sig = await sendWalletTx(client, connection, wallet, [ix], { success: '🎨 New skin unlocked!' });
        setBusy(false);
        if (!sig) return;
        updateSettings({ skin });
        refreshChain();
        await signInWithWallet(wallet);
      }}
    >
      {busy ? <span className="spin" /> : '💎'} {t('skins.buy', { sol: formatSol(config.skinPrice) })}
    </button>
  );
}

import { formatHypeAmount } from '@elymum/sdk';
import { useState } from 'react';
import { Button, Chip, CoinCharacter, Icon, Sheet, WalletPicker } from '../design';
import { useT } from '../i18n';
import { closeModal, toast, useUi } from '../store';
import { useTokenText } from '../ui/lobby/useLobby';
import { useChainData } from './chain';
import { explorerAddress } from './links';
import { ensureChain, serverChainInfo } from './network';
import { signInWithWallet } from './signIn';
import { connectWallet, disconnectWallet, initWallets, useWallet } from './store';
import { txErrorText } from './tx';
import { describeError } from '@elymum/sdk';

/**
 * Wallet sheet. Disconnected: the EVM wallets found in the browser (EIP-6963: MetaMask, Rabby or
 * any browser wallet). Connected: address, $ELYMUM and HYPE balances, the network (with a switch
 * when the wallet is on another chain), the free sign-in signature, explorer and disconnect.
 */
export function WalletModal() {
  const t = useT();
  const open = useUi((s) => s.modal === 'wallet');
  const providers = useWallet((s) => s.providers);
  const current = useWallet((s) => s.current);
  const status = useWallet((s) => s.status);
  const walletChain = useWallet((s) => s.chainId);
  const walletError = useWallet((s) => s.error);
  const wei = useChainData((s) => s.balance);
  const tokens = useChainData((s) => s.tokenBalance);
  const auth = useUi((s) => s.auth);
  const chain = useUi((s) => s.chain);
  const tok = useTokenText();
  const soon = !!chain?.enabled && chain.tokenReady === false;
  const [busy, setBusy] = useState(false);

  const addr = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const verified = !!addr && !!auth && auth.address.toLowerCase() === addr.toLowerCase();
  const info = serverChainInfo(chain);
  const wrongChain = !!addr && !!info && walletChain !== null && walletChain !== info.id;
  const explorer = addr ? explorerAddress(addr) : null;

  if (open) initWallets();

  const switchChain = async () => {
    if (!current || !chain) return;
    setBusy(true);
    try {
      await ensureChain(current.provider, chain);
    } catch (err) {
      const e = describeError(err, { chainName: info?.name });
      toast(e.kind === 'rejected' ? 'warn' : 'error', txErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!addr) {
    return (
      <WalletPicker
        open={open}
        onClose={closeModal}
        title={t('wl.choose')}
        kicker={t('wl.kickerConnect')}
        closeLabel={t('wl.close')}
        wallets={providers.map((d) => ({ id: d.info.uuid, name: d.info.name, icon: d.info.icon || undefined, detected: true }))}
        busyId={status === 'connecting' ? (current?.info.uuid ?? null) : null}
        onPick={(id) => {
          const d = providers.find((p) => p.info.uuid === id);
          if (d) void connectWallet(d).then((a) => a && closeModal());
        }}
        error={walletError ?? undefined}
        empty={
          <>
            {t('wl.none')}{' '}
            <span className="wl-install">
              <a className="kl-link mono" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                {t('wl.install')}
              </a>
              <a className="kl-link mono" href="https://rabby.io/" target="_blank" rel="noreferrer">
                Rabby
              </a>
            </span>
          </>
        }
        footnote={t('wl.footnote')}
      />
    );
  }

  return (
    <Sheet
      open={open}
      onClose={closeModal}
      closeLabel={t('wl.close')}
      kicker={t('wl.kicker')}
      title={current?.info.name ?? t('wl.kicker')}
      className="kl-sheet wl-sheet"
      footer={
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            disconnectWallet();
            closeModal();
          }}
        >
          {t('wl.disconnect')}
        </Button>
      }
    >
      <div className="wl-body">
        <div className="wl-card">
          <span className="wl-card__coin" aria-hidden="true">
            <CoinCharacter paint="cyan" mood={verified ? 'happy' : 'smile'} size={56} />
          </span>
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
              {explorer && (
                <a className="kl-link mono" href={explorer} target="_blank" rel="noreferrer">
                  {t('wl.explorer')}
                </a>
              )}
            </span>
          </div>
        </div>
        <dl className="wl-bal">
          <div>
            <dt className="mono wl-cap">{t('wl.tokens')}</dt>
            <dd>
              {soon ? (
                <span className="mono">{t('wl.tokenSoonLong')}</span>
              ) : (
                <>
                  <span className="wl-bal__big num">{tokens === null ? '…' : tok.exact(tokens)}</span> <span className="mono">{tok.symbol}</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="mono wl-cap">{t('wl.hype')}</dt>
            <dd>
              <span className="wl-bal__mid num">{wei === null ? '…' : formatHypeAmount(wei, 4)}</span>
            </dd>
          </div>
          <div>
            <dt className="mono wl-cap">{t('wl.network')}</dt>
            <dd className="mono">{info?.name ?? '—'}</dd>
          </div>
        </dl>
        {wrongChain && (
          <div className="wl-verify" data-testid="wl-wrong-chain">
            <p className="kl-note">{t('wl.wrongChain', { chain: info!.name })}</p>
            <Button variant="teal" size="md" lead="arrow" disabled={busy} onClick={() => void switchChain()}>
              {t('wl.switch', { chain: info!.name })}
            </Button>
          </div>
        )}
        {verified ? (
          <p className="wl-ok mono">
            <Icon name="check" size={16} /> {t('wl.verified')}
          </p>
        ) : (
          <div className="wl-verify">
            <p className="kl-note">{t('wl.verifyNote')}</p>
            <Button
              variant="teal"
              size="md"
              lead="key"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signInWithWallet(true);
                setBusy(false);
              }}
            >
              {t('wl.verify')}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

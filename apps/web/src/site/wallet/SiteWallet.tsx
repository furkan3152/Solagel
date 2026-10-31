import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AddressChip, Button, Icon, StatusPill } from '../../design';
import { providerSigner } from '../../wallet/siwe';
import { connectWallet, connected, disconnectWallet, initWallets, useWallet } from '../../wallet/store';
import { signIn, signOut, useSession, type SiteSession } from '../session';
import './wallet.css';

/**
 * Wallets for the site pages (WL, collab, mint): EIP-6963 discovery (MetaMask, Rabby or any
 * browser wallet), with `window.ethereum` as the fallback. Kept as a provider component so the
 * pages keep their structure; it only starts the discovery (the wallet lives in one store).
 */
export function SiteWalletProvider({ children }: { children: ReactNode }) {
  useEffect(() => initWallets(), []);
  return <>{children}</>;
}

/** The signed-in session, if any (the wallet need not be connected to use it). */
export function useSiteSession(): SiteSession | null {
  return useSession((s) => s.session);
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Connect a wallet and sign in (one free SIWE message, no transaction). Shows the wallets found in
 * this browser; after the visitor picks one, it asks for the signature once by itself.
 */
export function WalletSignIn({ label = 'Sign in with your wallet', onSession }: { label?: string; onSession?: (s: SiteSession) => void }) {
  const providers = useWallet((s) => s.providers);
  const status = useWallet((s) => s.status);
  const current = useWallet((s) => s.current);
  const walletError = useWallet((s) => s.error);
  const address = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const session = useSession((s) => s.session);
  const signing = useSession((s) => s.signing);
  const error = useSession((s) => s.error);
  const [picked, setPicked] = useState(false);
  const asked = useRef<string | null>(null);
  const connecting = status === 'connecting';

  useEffect(() => initWallets(), []);

  const doSign = async () => {
    const w = connected();
    if (!w) return;
    try {
      const s = await signIn(providerSigner(w.provider, w.address));
      onSession?.(s);
    } catch {
      /* the error is in the session store */
    }
  };

  // after the visitor picks a wallet: ask for the signature once it connects
  useEffect(() => {
    if (!picked || !address || asked.current === address) return;
    asked.current = address;
    void doSign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, address]);

  if (session && (!address || same(session.address, address))) {
    const signed = (
      <div className="sw-signed">
        <StatusPill tone="ok" size="sm">
          Signed in
        </StatusPill>
        <AddressChip address={session.address} size="sm" />
        <button
          type="button"
          className="sw-link"
          onClick={() => {
            signOut();
            asked.current = null;
            setPicked(false);
            disconnectWallet();
          }}
        >
          Switch wallet
        </button>
      </div>
    );
    if (address) return signed;
    // signed in on an earlier visit (the session outlives the wallet connection), but the wallet
    // is not connected on this page: offer to reconnect it (same wallet: no new signature)
    return (
      <div className="sw">
        {signed}
        <WalletConnect note="Reconnect your wallet to send transactions. The same wallet needs no new signature." onPick={() => setPicked(true)} />
      </div>
    );
  }

  if (address) {
    return (
      <div className="sw">
        <div className="sw-signed">
          <StatusPill tone="live" size="sm">
            Connected
          </StatusPill>
          <AddressChip address={address} size="sm" copy={false} />
          <button type="button" className="sw-link" onClick={() => disconnectWallet()}>
            Use another wallet
          </button>
        </div>
        <div className="sw-row">
          <Button variant="teal" lead="wallet" onClick={() => void doSign()} disabled={signing} loading={signing}>
            {signing ? 'Check your wallet…' : label}
          </Button>
        </div>
        <p className="sw-note">Signing is free and sends no transaction.</p>
        {error && (
          <p className="sw-note is-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="sw">
      {providers.length === 0 ? (
        <p className="sw-none">
          <span className="sw-none__icon" aria-hidden="true">
            <Icon name="wallet" size={22} />
          </span>
          <span>
            <strong>No browser wallet found.</strong> Install MetaMask, Rabby or any browser wallet, or open this page in your wallet app&apos;s browser.
          </span>
        </p>
      ) : (
        <div className="sw-wallets" role="group" aria-label="Wallets">
          {providers.map((d) => {
            const busy = connecting && current?.info.uuid === d.info.uuid;
            return (
              <button
                key={d.info.uuid}
                type="button"
                className={`sw-opt${busy ? ' is-busy' : ''}`}
                disabled={connecting}
                aria-busy={busy}
                onClick={() => {
                  setPicked(true);
                  asked.current = null;
                  void connectWallet(d);
                }}
              >
                <span className="sw-opt__icon" aria-hidden="true">
                  {d.info.icon ? <img src={d.info.icon} alt="" /> : <Icon name="wallet" size={20} />}
                </span>
                <span className="sw-opt__name">{d.info.name}</span>
                <Icon name="arrow" size={18} className="sw-opt__go" />
              </button>
            );
          })}
        </div>
      )}
      <p className="sw-note">{connecting ? 'Connecting… check your wallet.' : 'Signing in is free and sends no transaction.'}</p>
      {(error || walletError) && (
        <p className="sw-note is-error" role="alert">
          {error ?? walletError}
        </p>
      )}
    </div>
  );
}

/**
 * Connect only (no sign-in): for pages that need the wallet's address and its transactions but
 * not a session (the mint). Lists the wallets found in this browser.
 */
export function WalletConnect({ note = 'Connecting sends nothing and costs nothing.', onPick }: { note?: string; onPick?: () => void }) {
  const providers = useWallet((s) => s.providers);
  const status = useWallet((s) => s.status);
  const current = useWallet((s) => s.current);
  const walletError = useWallet((s) => s.error);
  const connecting = status === 'connecting';

  useEffect(() => initWallets(), []);

  if (providers.length === 0)
    return (
      <p className="sw-none">
        <span className="sw-none__icon" aria-hidden="true">
          <Icon name="wallet" size={22} />
        </span>
        <span>
          <strong>No browser wallet found.</strong> Install MetaMask, Rabby or any browser wallet, or open this page in your wallet app&apos;s browser.
        </span>
      </p>
    );
  return (
    <div className="sw" data-testid="sw-connect">
      <div className="sw-wallets" role="group" aria-label="Wallets">
        {providers.map((d) => {
          const busy = connecting && current?.info.uuid === d.info.uuid;
          return (
            <button
              key={d.info.uuid}
              type="button"
              className={`sw-opt${busy ? ' is-busy' : ''}`}
              disabled={connecting}
              aria-busy={busy}
              onClick={() => {
                onPick?.();
                void connectWallet(d);
              }}
            >
              <span className="sw-opt__icon" aria-hidden="true">
                {d.info.icon ? <img src={d.info.icon} alt="" /> : <Icon name="wallet" size={20} />}
              </span>
              <span className="sw-opt__name">Connect {d.info.name}</span>
              <Icon name="arrow" size={18} className="sw-opt__go" />
            </button>
          );
        })}
      </div>
      <p className="sw-note">{connecting ? 'Connecting… check your wallet.' : note}</p>
      {walletError && (
        <p className="sw-note is-error" role="alert">
          {walletError}
        </p>
      )}
    </div>
  );
}

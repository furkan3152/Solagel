import { useEffect, useRef, useState, type ReactNode } from 'react';
import { InkButton } from '../../design';
import { providerSigner } from '../../wallet/siwe';
import { connectWallet, connected, disconnectWallet, initWallets, useWallet } from '../../wallet/store';
import { shortWallet } from '../settings';
import { signIn, signOut, useSession, type SiteSession } from '../session';

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
    return (
      <div className="st-signed">
        <span className="kb-chip mono kb-tone-teal">Signed in</span>
        <code title={session.address}>{shortWallet(session.address)}</code>
        <button
          type="button"
          className="st-textlink"
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
  }

  if (address) {
    return (
      <div className="st-signin">
        <div className="st-signed">
          <span className="kb-chip mono kb-tone-ink">Connected</span>
          <code title={address}>{shortWallet(address)}</code>
          <button type="button" className="st-textlink" onClick={() => disconnectWallet()}>
            Use another wallet
          </button>
        </div>
        <div className="st-row" style={{ marginTop: 12 }}>
          <InkButton variant="pink" onClick={() => void doSign()} disabled={signing}>
            {signing ? 'Check your wallet…' : label}
          </InkButton>
        </div>
        <p className="st-note">Signing is free and sends no transaction.</p>
        {error && (
          <p className="st-note is-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="st-signin">
      {providers.length === 0 ? (
        <p className="st-note">
          No browser wallet found. Install MetaMask, Rabby or any browser wallet, or open this page in your wallet app&apos;s browser.
        </p>
      ) : (
        <div className="st-wallets" role="group" aria-label="Wallets">
          {providers.map((d) => (
            <button
              key={d.info.uuid}
              type="button"
              className="st-wallet-opt"
              disabled={connecting}
              aria-busy={connecting && current?.info.uuid === d.info.uuid}
              onClick={() => {
                setPicked(true);
                asked.current = null;
                void connectWallet(d);
              }}
            >
              {d.info.icon && <img src={d.info.icon} alt="" />}
              <span>{d.info.name}</span>
            </button>
          ))}
        </div>
      )}
      <p className="st-note">{connecting ? 'Connecting…' : 'Signing in is free and sends no transaction.'}</p>
      {(error || walletError) && (
        <p className="st-note is-error" role="alert">
          {error ?? walletError}
        </p>
      )}
    </div>
  );
}

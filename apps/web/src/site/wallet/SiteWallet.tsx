import '../../polyfills';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InkButton } from '../../design';
import { shortWallet } from '../settings';
import { signIn, signOut, useSession, type SiteSession } from '../session';

/**
 * Wallets for the site pages (WL, collab): Wallet Standard discovery (Phantom, Solflare,
 * Backpack and others), no per-wallet adapters. The site only asks wallets to sign the free
 * sign-in message; nothing here sends a transaction, so the RPC endpoint is never used.
 */
export function SiteWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
      <WalletProvider wallets={wallets} autoConnect onError={(e) => console.warn('wallet error', e)}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** The signed-in session, if any (the wallet need not be connected to use it). */
export function useSiteSession(): SiteSession | null {
  return useSession((s) => s.session);
}

/**
 * Connect a wallet and sign in (one free message, no transaction). Shows the wallets found in
 * this browser; after the visitor picks one, it asks for the signature once by itself.
 */
export function WalletSignIn({ label = 'Sign in with your wallet', onSession }: { label?: string; onSession?: (s: SiteSession) => void }) {
  const wallet = useWallet();
  const { wallets, select, connected, connecting, publicKey, disconnect } = wallet;
  const session = useSession((s) => s.session);
  const signing = useSession((s) => s.signing);
  const error = useSession((s) => s.error);
  const [picked, setPicked] = useState(false);
  const asked = useRef<string | null>(null);
  const pubkey = publicKey?.toBase58() ?? null;

  const listed = [...wallets]
    .filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable)
    .sort((a, b) => Number(b.readyState === WalletReadyState.Installed) - Number(a.readyState === WalletReadyState.Installed));

  const doSign = async () => {
    try {
      const s = await signIn(wallet);
      onSession?.(s);
    } catch {
      /* the error is in the session store */
    }
  };

  // after the visitor picks a wallet: ask for the signature once it connects
  useEffect(() => {
    if (!picked || !connected || !pubkey || asked.current === pubkey) return;
    asked.current = pubkey;
    void doSign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, connected, pubkey]);

  if (session && (!pubkey || session.pubkey === pubkey)) {
    return (
      <div className="st-signed">
        <span className="kb-chip mono kb-tone-teal">Signed in</span>
        <code title={session.pubkey}>{shortWallet(session.pubkey)}</code>
        <button
          type="button"
          className="st-textlink"
          onClick={() => {
            signOut();
            asked.current = null;
            setPicked(false);
            void disconnect().catch(() => {});
          }}
        >
          Switch wallet
        </button>
      </div>
    );
  }

  if (connected && pubkey) {
    return (
      <div className="st-signin">
        <div className="st-signed">
          <span className="kb-chip mono kb-tone-ink">Connected</span>
          <code title={pubkey}>{shortWallet(pubkey)}</code>
          <button type="button" className="st-textlink" onClick={() => void disconnect().catch(() => {})}>
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
      {listed.length === 0 ? (
        <p className="st-note">
          No Solana wallet in this browser. Install Phantom, Solflare or Backpack, or open this page in your wallet app&apos;s browser.
        </p>
      ) : (
        <div className="st-wallets" role="group" aria-label="Wallets">
          {listed.map((w) => (
            <button
              key={w.adapter.name}
              type="button"
              className="st-wallet-opt"
              disabled={connecting}
              onClick={() => {
                setPicked(true);
                asked.current = null;
                if (wallet.wallet?.adapter.name === w.adapter.name && !connected) void wallet.connect().catch(() => {});
                else select(w.adapter.name);
              }}
            >
              {w.adapter.icon && <img src={w.adapter.icon} alt="" />}
              <span>{w.adapter.name}</span>
            </button>
          ))}
        </div>
      )}
      <p className="st-note">{connecting ? 'Connecting…' : 'Signing in is free and sends no transaction.'}</p>
      {error && (
        <p className="st-note is-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

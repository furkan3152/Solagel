import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useState } from 'react';
import { InkButton } from '../../design';
import { SiteApiError, adminApi } from '../../site/api';
import { signIn, signOut, useSession, type SiteSession } from '../../site/session';
import { WalletBox } from '../AdminPanel';

export type AdminState = { kind: 'none' } | { kind: 'checking' } | { kind: 'admin'; session: SiteSession } | { kind: 'denied'; session: SiteSession } | { kind: 'error'; message: string };

/**
 * The admin's site session: SIWS (one free signature) traded for the server's session token, then
 * checked with `/api/admin/me`. Every WL / collab / settings call carries it as a Bearer token,
 * and `/play` reads the same token.
 */
export function useAdminSession(): AdminState {
  const session = useSession((s) => s.session);
  const [state, setState] = useState<AdminState>(session ? { kind: 'checking' } : { kind: 'none' });
  useEffect(() => {
    if (!session) {
      setState({ kind: 'none' });
      return;
    }
    let live = true;
    setState({ kind: 'checking' });
    adminApi(session.token)
      .me()
      .then(
        () => live && setState({ kind: 'admin', session: { ...session, admin: true } }),
        (err: unknown) => {
          if (!live) return;
          if (err instanceof SiteApiError && err.code === 'forbidden') setState({ kind: 'denied', session });
          else if (err instanceof SiteApiError && err.code === 'unauthorized') {
            signOut();
            setState({ kind: 'none' });
          } else setState({ kind: 'error', message: (err as Error).message });
        },
      );
    return () => {
      live = false;
    };
  }, [session]);
  return state;
}

export function AdminSessionBar({ state }: { state: AdminState }) {
  const wallet = useWallet();
  const signing = useSession((s) => s.signing);
  const error = useSession((s) => s.error);
  const pubkey = wallet.publicKey?.toBase58() ?? null;
  const session = state.kind === 'admin' || state.kind === 'denied' ? state.session : null;

  return (
    <section className="ad-card ad-session" aria-labelledby="ad-session-h">
      <div className="ad-card__bar">
        <h2 className="ad-card__title" id="ad-session-h">
          Admin session
        </h2>
        {state.kind === 'admin' && <span className="kb-chip mono kb-tone-teal">Admin</span>}
        {state.kind === 'denied' && <span className="kb-chip mono kb-tone-pink">Not an admin</span>}
      </div>
      <WalletBox />
      {session ? (
        <div className="ad-actions">
          <span className="ad-note">
            Signed in as <code>{session.pubkey}</code>
          </span>
          <InkButton variant="paper" size="sm" onClick={() => signOut()}>
            Sign out
          </InkButton>
        </div>
      ) : (
        <div className="ad-actions">
          <InkButton variant="pink" size="sm" disabled={!pubkey || signing || state.kind === 'checking'} onClick={() => void signIn(wallet).catch(() => {})}>
            {signing ? 'Check your wallet…' : 'Sign in (free, no transaction)'}
          </InkButton>
          <span className="ad-note">{pubkey ? 'Sign one message to open the WL, collab and site tabs.' : 'Connect the admin wallet first.'}</span>
        </div>
      )}
      {state.kind === 'denied' && <p className="ad-bad">This wallet is not in ADMIN_WALLETS. Sign in with the admin wallet.</p>}
      {state.kind === 'error' && <p className="ad-bad">{state.message}</p>}
      {error && <p className="ad-bad">{error}</p>}
    </section>
  );
}

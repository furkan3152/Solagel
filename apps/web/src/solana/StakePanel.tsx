import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { arenaMeta, formatSol } from '@solagel/shared';
import { useState } from 'react';
import { useT } from '../i18n';
import { openModal, useUi } from '../store';
import { refreshChain, useChainData, useSolagelClient } from './chain';
import { signInWithWallet } from './siws';
import { sendWalletTx } from './tx';

const REFUND_AFTER_S = 24 * 3600;

/** SOL arenas: buy in on-chain, then join the stake room on the game server. */
export function StakePanel({ onPlay }: { onPlay: (room: string) => void }) {
  const t = useT();
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSolagelClient();
  const chain = useUi((s) => s.chain);
  const lang = useUi((s) => s.settings.lang);
  const rooms = useUi((s) => s.rooms);
  const auth = useUi((s) => s.auth);
  const data = useChainData();
  const [busy, setBusy] = useState<number | null>(null);
  const pubkey = wallet.publicKey?.toBase58();
  const verified = !!pubkey && auth?.pubkey === pubkey;

  const header = (
    <>
      <div className="muted small center">{t('stakes.desc')}</div>
      <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <span className="badge lav">🤖 {t('stakes.noBots')}</span>
        {data.config && <span className="badge mint">{t('stakes.fee', { fee: data.config.feeBps / 100 })}</span>}
      </div>
    </>
  );

  if (!chain?.stakeEnabled || data.deployed === false) {
    return (
      <div className="mode-panel">
        {header}
        <div className="notice">⛓️‍💥 {t('stakes.offline')}</div>
      </div>
    );
  }

  const gate = (() => {
    if (!wallet.connected) return { text: t('stakes.needWallet'), action: () => openModal('wallet'), label: `👛 ${t('wallet.connect')}` };
    if (!verified) return { text: t('stakes.needLogin'), action: () => void signInWithWallet(wallet, true), label: `✍️ ${t('wallet.verify')}` };
    if (data.profileLoaded && !data.profile) return { text: t('stakes.needProfile'), action: () => openModal('profile'), label: `✨ ${t('profile.create')}` };
    return null;
  })();

  const join = async (arenaId: number) => {
    if (!client || !wallet.publicKey) return;
    const session = data.sessions[arenaId];
    if (session) {
      onPlay(`stake:${arenaId}`);
      return;
    }
    setBusy(arenaId);
    const ix = await client.ix.joinArena(wallet.publicKey, arenaId);
    const sig = await sendWalletTx(client, connection, wallet, [ix], { success: '🎟️ Ticket bought — good luck!' });
    setBusy(null);
    if (!sig) return;
    refreshChain();
    onPlay(`stake:${arenaId}`);
  };

  const refund = async (arenaId: number) => {
    if (!client || !wallet.publicKey) return;
    setBusy(arenaId);
    const ix = await client.ix.refundSession(wallet.publicKey, arenaId);
    await sendWalletTx(client, connection, wallet, [ix], { success: '↩️ Refunded' });
    setBusy(null);
    refreshChain();
  };

  const now = Date.now() / 1000;
  return (
    <div className="mode-panel">
      {header}
      {gate && (
        <div className="col">
          <div className="notice">{gate.text}</div>
          <button className="btn btn-purple" onClick={gate.action}>
            {gate.label}
          </button>
        </div>
      )}
      {data.arenas.length === 0 && <div className="muted small center">{data.loading ? t('common.loading') : t('stakes.empty')}</div>}
      {data.arenas
        .filter((a) => a.enabled)
        .map((a) => {
          const meta = arenaMeta(a.id);
          const room = rooms.find((r) => r.arenaId === a.id);
          const session = data.sessions[a.id];
          const refundable = !!session && now - session.openedAt > REFUND_AFTER_S;
          return (
            <div key={a.id} className="arena">
              <div className="arena-emoji">{meta.emoji}</div>
              <div>
                <div className="arena-name">{meta.name[lang]}</div>
                <div className="arena-meta">
                  {t('stakes.buyIn')} {formatSol(a.buyIn)} · {t('stakes.pot')} {formatSol(a.pot)} · 👥 {room?.players ?? a.openSessions}/{a.maxPlayers}
                </div>
                {session && <div className="arena-meta" style={{ color: 'var(--purple)' }}>🎟️ {refundable ? t('stakes.refundable') : t('stakes.ticketOpen')}</div>}
              </div>
              {refundable ? (
                <button className="btn btn-sm btn-pink" disabled={busy !== null} onClick={() => refund(a.id)}>
                  {busy === a.id ? <span className="spin" /> : '↩️'} {t('stakes.refund')}
                </button>
              ) : (
                <button className="btn btn-sm btn-gold" disabled={!!gate || busy !== null} onClick={() => join(a.id)}>
                  {busy === a.id ? <span className="spin" /> : session ? '▶' : '◎'} {session ? t('stakes.resume') : t('stakes.join', { sol: formatSol(a.buyIn) })}
                </button>
              )}
            </div>
          );
        })}
      <div className="notice">⚠️ {t('stakes.disclaimer')}</div>
    </div>
  );
}

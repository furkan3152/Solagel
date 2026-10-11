import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { describeError } from '@solagel/sdk';
import { arenaMeta, formatSol, isSkinUnlocked } from '@solagel/shared';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { openModal, toast, useUi } from '../store';
import { refreshChain, useChainData, useSolagelClient } from './chain';
import { signInWithWallet } from './siws';
import { sendWalletTx } from './tx';

const REFUND_AFTER_S = 24 * 3600;

/** Buy a SOL ticket, then enter the continuously running arena. */
export function StakePanel({ onPlay }: { onPlay: (room: string) => void }) {
  const t = useT();
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSolagelClient();
  const chain = useUi((s) => s.chain);
  const connected = useUi((s) => s.connected);
  const rooms = useUi((s) => s.rooms);
  const auth = useUi((s) => s.auth);
  const data = useChainData();
  const [busy, setBusy] = useState<number | null>(null);
  const busyRef = useRef(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const pubkey = wallet.publicKey?.toBase58();
  const ownerRef = useRef(pubkey);
  ownerRef.current = pubkey;
  const verified = !!pubkey && auth?.pubkey === pubkey;
  const ready = !!data.updatedAt && data.owner === (pubkey ?? null) && !data.error;
  const paidOnline = connected && !!chain?.stakeEnabled && data.deployed !== false && !data.config?.paused;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  const gate = (() => {
    if (!wallet.connected) return { text: t('stakes.needWallet'), action: () => openModal('wallet'), label: `👛 ${t('wallet.connect')}` };
    if (!verified) return { text: t('stakes.needLogin'), action: () => void signInWithWallet(wallet, true), label: `✍️ ${t('wallet.verify')}` };
    if (ready && data.profileLoaded && !data.profile) return { text: t('stakes.needProfile'), action: () => openModal('profile'), label: `✨ ${t('profile.create')}` };
    return null;
  })();

  const transact = async (arenaId: number, kind: 'join' | 'refund') => {
    if (busyRef.current || !client || !wallet.publicKey || (kind === 'join' && !verified)) return;
    const player = wallet.publicKey;
    const currentOwner = player.toBase58();
    busyRef.current = true;
    setBusy(arenaId);
    try {
      // A stale or failed RPC read must never turn an existing ticket into a second purchase.
      const [config, arena, session] = await Promise.all([
        client.fetchConfig(), client.fetchArena(arenaId), client.fetchSession(arenaId, player),
      ]);
      if (ownerRef.current !== currentOwner) return;
      if (kind === 'refund') {
        if (!session || session.activated || Date.now() / 1000 - session.openedAt < REFUND_AFTER_S) {
          toast('warn', 'Only unused tickets older than 24 hours can be refunded.');
          return;
        }
        const ix = await client.ix.refundSession(player, arenaId);
        await sendWalletTx(client, connection, wallet, [ix], { success: 'Unused ticket refunded' });
        return;
      }
      if (!useUi.getState().connected || !arena || (!session?.activated && (!useUi.getState().chain?.stakeEnabled || config?.paused || !arena.enabled))) {
        toast('warn', 'SOL arena entry is currently unavailable. Your existing ticket is kept.');
        return;
      }
      const profile = await client.fetchProfile(player);
      const own = profile ? { xp: profile.xp, premiumMask: profile.premiumSkins } : null;
      if (!profile || !isSkinUnlocked(useUi.getState().settings.skin, own)) {
        toast('warn', profile ? 'Choose an unlocked beta skin before buying a ticket.' : t('stakes.needProfile'));
        openModal(profile ? 'shop' : 'profile');
        return;
      }
      if (ownerRef.current !== currentOwner) return;
      if (!session) {
        if (arena.openSessions >= arena.maxPlayers) { toast('warn', t('err.room_full')); return; }
        const ix = await client.ix.joinArena(player, arenaId);
        const sig = await sendWalletTx(client, connection, wallet, [ix], { success: 'SOL ticket confirmed — entering the arena!' });
        if (!sig) return;
      }
      if (ownerRef.current === currentOwner && useUi.getState().connected) onPlay(`stake:${arenaId}`);
      else toast('info', 'Your ticket is saved. Reconnect this wallet to enter.');
    } catch (error) {
      toast('error', describeError(error).message);
    } finally {
      busyRef.current = false;
      setBusy(null);
      refreshChain();
    }
  };

  const arenas = data.arenas.filter((a) => a.enabled || data.sessions[a.id]);
  return (
    <div className="mode-panel">
      <div className="muted small center">{t('stakes.desc')}</div>
      <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <span className="badge lav">◎ SOL beta</span>
        {chain?.enabled && <span className="badge sky">{chain.cluster === 'mainnet-beta' ? 'Mainnet' : `${chain.cluster} · test SOL`}</span>}
        {data.config && <span className="badge mint">{t('stakes.fee', { fee: data.config.feeBps / 100 })}</span>}
      </div>
      <div className="notice small">🤖 Bots fill quiet arenas and give mass only. They carry no SOL and cannot eat players here.</div>
      {!paidOnline && <div className="notice" role="status">{t('stakes.offline')} Practice is available without a wallet.</div>}
      {paidOnline && gate && (
        <div className="col">
          <div className="notice">{gate.text}</div>
          <button className="btn btn-purple" onClick={gate.action}>{gate.label}</button>
        </div>
      )}
      {data.error && <div className="notice" role="alert">{data.error} <button className="btn btn-sm btn-ghost" onClick={refreshChain}>Retry</button></div>}
      {paidOnline && !gate && !ready && !data.error && <div className="muted small center" role="status">Checking your wallet and arena tickets…</div>}
      {paidOnline && arenas.length === 0 && <div className="muted small center">{data.loading ? t('common.loading') : t('stakes.empty')}</div>}
      {arenas.map((a) => {
        const meta = arenaMeta(a.id);
        const room = rooms.find((r) => r.arenaId === a.id);
        const session = data.owner === pubkey ? data.sessions[a.id] : null;
        const refundable = !!session && !session.activated && now - session.openedAt >= REFUND_AFTER_S;
        const full = !session && (a.openSessions >= a.maxPlayers || (room?.players ?? 0) >= a.maxPlayers);
        return (
          <div key={a.id} className="arena">
            <div className="arena-emoji" aria-hidden="true">{meta.emoji}</div>
            <div>
              <div className="arena-name">{meta.name.en}</div>
              <div className="arena-meta">{t('stakes.buyIn')} {formatSol(a.buyIn)} · {room?.players ?? 0} players · {room?.bots ?? 0} bots</div>
              <div className="arena-meta">{a.openSessions}/{a.maxPlayers} tickets · Entry + Solana network/account fees</div>
              {session && <div className="arena-meta">🎟️ {session.activated ? 'Active ticket · resume or await settlement' : refundable ? 'Unused ticket · refund available' : 'Unused ticket · ready to enter'}</div>}
            </div>
            <div className="col" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-gold" disabled={!(session?.activated ? connected && chain?.enabled : paidOnline && a.enabled) || !!gate || !ready || !data.profile || busy !== null || full} onClick={() => void transact(a.id, 'join')}>
                {busy === a.id ? <span className="spin" /> : session ? '▶' : '◎'} {full ? 'Full' : session ? t('stakes.resume') : t('stakes.join', { sol: formatSol(a.buyIn) })}
              </button>
              {refundable && <button className="btn btn-sm btn-pink" disabled={busy !== null || !wallet.connected || !ready} onClick={() => void transact(a.id, 'refund')}>↩️ Refund</button>}
            </div>
          </div>
        );
      })}
      <div className="muted small center">Each new life needs a new ticket. Reconnecting to a surviving life is free.</div>
      <div className="notice">⚠️ {t('stakes.disclaimer')}</div>
    </div>
  );
}

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PRIZE_SHARES_BPS, formatSol } from '@solagel/shared';
import { useEffect, useState } from 'react';
import { SERVER } from '../config';
import { useT } from '../i18n';
import { useUi } from '../store';
import { BoardRows } from '../ui/Leaderboards';
import { refreshChain, useSolagelClient } from './chain';
import { sendWalletTx } from './tx';

interface SeasonEntry {
  player: string;
  name: string;
  skin: number;
  points: number;
  bestScore: number;
}

interface SeasonResponse {
  enabled?: false;
  id: number;
  startedAt: number;
  finalized: boolean;
  prizePool: number;
  entries: SeasonEntry[];
  previous: { id: number; prizePool: number; endedAt: number; entries: SeasonEntry[]; claimedMask: number } | null;
}

const CLAIM_WINDOW_S = 30 * 24 * 3600;

/** On-chain season leaderboard (served from the game server's chain cache). */
export function SeasonBoard() {
  const t = useT();
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSolagelClient();
  const [season, setSeason] = useState<SeasonResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = wallet.publicKey?.toBase58() ?? null;

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${SERVER.http}/api/season`)
        .then((r) => r.json())
        .then((d: SeasonResponse) => {
          if (!alive) return;
          if (d.enabled === false) setFailed(true);
          else {
            setSeason(d);
            setFailed(false);
          }
        })
        .catch(() => alive && setFailed(true));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (failed) return <div className="notice">⛓️‍💥 {t('lb.offline')}</div>;
  if (!season) {
    return (
      <div className="row muted" style={{ justifyContent: 'center', padding: 16 }}>
        <span className="spin" /> {t('common.loading')}
      </div>
    );
  }

  const prev = season.previous;
  const myPrevRank = prev && me ? prev.entries.slice(0, 10).findIndex((e) => e.player === me) : -1;
  const canClaim =
    prev && myPrevRank >= 0 && ((prev.claimedMask >> myPrevRank) & 1) === 0 && Date.now() / 1000 < prev.endedAt + CLAIM_WINDOW_S && prev.prizePool > 0;
  const myPrize = canClaim ? Math.floor((prev!.prizePool * PRIZE_SHARES_BPS[myPrevRank]) / 10_000) : 0;

  const claim = async () => {
    if (!client || !wallet.publicKey || !prev) return;
    setBusy(true);
    const ix = await client.ix.claimSeasonReward(wallet.publicKey, prev.id);
    await sendWalletTx(client, connection, wallet, [ix], { success: '🏆 Prize claimed!' });
    setBusy(false);
    refreshChain();
  };

  return (
    <>
      <div className="prize">
        <span>💰 {t('lb.prizePool')}</span>
        <span>{formatSol(season.prizePool, 3)}</span>
      </div>
      {canClaim && (
        <div className="col" style={{ gap: 6 }}>
          <div className="notice">🎉 {t('lb.youWon', { rank: myPrevRank + 1 })}</div>
          <button className="btn btn-gold" onClick={claim} disabled={busy}>
            {busy ? <span className="spin" /> : '🏆'} {t('lb.claim', { sol: formatSol(myPrize, 4) })}
          </button>
        </div>
      )}
      <BoardRows
        rows={season.entries.map((e) => ({ name: e.name, score: e.points, skin: e.skin, wallet: e.player, extra: `${compactPts(e.points)} ${t('lb.points')}` }))}
        me={me}
      />
      <div className="muted small center">
        {useUi.getState().chain?.cluster} · {t('lb.live')} ⛓️
      </div>
    </>
  );
}

const compactPts = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n));

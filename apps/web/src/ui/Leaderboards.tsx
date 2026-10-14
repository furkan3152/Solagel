import { formatSol } from '@slana/shared';
import { useEffect, useState } from 'react';
import { SERVER } from '../config';
import { useT } from '../i18n';
import { useUi } from '../store';
import { SeasonBoard } from '../solana/SeasonBoard';
import { SkinCanvas, compact, medal } from './common';

interface LbRecord {
  name: string;
  score: number;
  skin: number;
  wallet: string | null;
  kills: number;
}

function useOffchainBoards() {
  const [data, setData] = useState<{ daily: LbRecord[]; allTime: LbRecord[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${SERVER.http}/api/leaderboard`)
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return data;
}

export function BoardRows({ rows, me }: { rows: { name: string; score: number; skin: number; wallet?: string | null; extra?: string }[]; me?: string | null }) {
  const t = useT();
  if (rows.length === 0) return <div className="muted small center" style={{ padding: 20 }}>{t('lb.empty')}</div>;
  return (
    <div className="lb-list scroll">
      {rows.map((r, i) => (
        <div key={`${r.name}-${i}`} className={`lb-row ${me && r.wallet === me ? 'me' : ''}`}>
          <span className="lb-rank">{medal(i + 1)}</span>
          <SkinCanvas skin={r.skin} size={28} animate={false} className="avatar" seed={i} />
          <span className="lb-name">{r.name}</span>
          <span className="lb-score">{r.extra ?? compact(r.score)}</span>
        </div>
      ))}
    </div>
  );
}

export function LeaderboardsCard() {
  const t = useT();
  const chain = useUi((s) => s.chain);
  const me = useUi((s) => s.auth?.pubkey ?? null);
  const [tab, setTab] = useState<'season' | 'today' | 'all'>(chain?.enabled ? 'season' : 'today');
  const boards = useOffchainBoards();

  useEffect(() => {
    if (chain && !chain.enabled && tab === 'season') setTab('today');
  }, [chain, tab]);

  return (
    <div className="card side-card">
      <div className="side-title">
        <span>🏆 {t('lb.title')}</span>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'season' ? 'active' : ''}`} onClick={() => setTab('season')}>
          ⛓ {t('lb.season', { n: chain?.currentSeason ?? 1 })}
        </button>
        <button className={`tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
          {t('lb.today')}
        </button>
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          {t('lb.allTime')}
        </button>
      </div>
      {tab === 'season' ? (
        <SeasonBoard />
      ) : (
        <BoardRows rows={(tab === 'today' ? boards?.daily : boards?.allTime) ?? []} me={me} />
      )}
    </div>
  );
}

export const solLabel = (lamports: number) => formatSol(lamports);

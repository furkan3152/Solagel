import { motion } from 'motion/react';
import { useAddress } from '../../wallet/store';
import { useEffect, useState, type ReactNode } from 'react';
import { Chip, Icon, STAGGER, Skeleton, StampSpinner, Tabs, tabPanelProps, useReducedMotion, type TabItem } from '../../design';
import { SERVER } from '../../config';
import { useT } from '../../i18n';
import { CoinPortrait } from '../game/CoinPortrait';
import { PageHead } from '../PageHead';
import './news.css';

type Board = 'today' | 'all';

/** `/api/leaderboard`: off-chain best single games (bots excluded). */
interface LbRecord {
  name: string;
  score: number;
  skin: number;
  wallet: string | null;
  kills: number;
}
type Boards = { state: 'loading' } | { state: 'error' } | { state: 'ok'; daily: LbRecord[]; allTime: LbRecord[] };

function useOffchainBoards(active: boolean): Boards {
  const [boards, setBoards] = useState<Boards>({ state: 'loading' });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () =>
      fetch(`${SERVER.http}/api/leaderboard`)
        .then((r) => (r.ok ? (r.json() as Promise<{ daily?: LbRecord[]; allTime?: LbRecord[] }>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => alive && setBoards({ state: 'ok', daily: d.daily ?? [], allTime: d.allTime ?? [] }))
        .catch(() => alive && setBoards((b) => (b.state === 'ok' ? b : { state: 'error' })));
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);
  return boards;
}

/**
 * The standings as a newspaper page: Today / All time tabs over the server's
 * off-chain records (best single games, bots excluded). No prizes: the
 * standings are for bragging rights only.
 */
export function Leaderboards() {
  const t = useT();
  const [tab, setTab] = useState<Board>('today');
  const boards = useOffchainBoards(true);
  const items: TabItem<Board>[] = [
    { id: 'today', label: t('nw.tab.today'), icon: 'sun' },
    { id: 'all', label: t('nw.tab.all'), icon: 'crown' },
  ];
  return (
    <div className="nw-page">
      <PageHead kicker={t('nw.kicker')} title={t('nw.title')} />
      <Tabs items={items} value={tab} onChange={setTab} label={t('nw.tabs')} idBase="nw" className="nw-tabs" />
      <motion.div key={tab} {...tabPanelProps('nw', tab)} className="nw-panel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
        <OffchainFront kind={tab} boards={boards} />
      </motion.div>
    </div>
  );
}

/* ── today / all time ────────────────────────────────────────────────── */

function OffchainFront({ kind, boards }: { kind: 'today' | 'all'; boards: Boards }) {
  const t = useT();
  const me = useAddress();
  const nf = new Intl.NumberFormat('en-US');
  const rows = boards.state === 'ok' ? (kind === 'today' ? boards.daily : boards.allTime) : [];
  const top = rows[0];
  return (
    <div className="nw-cols">
      <article className="nw-lead">
        <h3 className="nw-headline">{kind === 'today' ? t('nw.today.title') : t('nw.all.title')}</h3>
        <p className="nw-deck">
          {top ? (
            <>
              <b>{top.name}</b> · {nf.format(Math.round(top.score))} · {kind === 'today' ? t('nw.today.sub') : t('nw.all.sub')}
            </>
          ) : kind === 'today' ? (
            t('nw.today.sub')
          ) : (
            t('nw.all.sub')
          )}
        </p>
        {boards.state === 'error' && <p className="nw-note">{t('nw.offline')}</p>}
        {boards.state === 'loading' && (
          <>
            <p className="nw-note kb-wait">
              <StampSpinner size="sm" />
              {t('lo.live.connecting')}
            </p>
            <Skeleton rows={6} />
          </>
        )}
        {boards.state === 'ok' && rows.length === 0 && <p className="nw-note">{t('nw.empty')}</p>}
        {rows.length > 0 && (
          <Standings
            rows={rows.map((r, i) => ({
              key: `${r.wallet ?? r.name}:${i}`,
              name: r.name,
              skin: r.skin,
              me: !!me && !!r.wallet && r.wallet.toLowerCase() === me.toLowerCase(),
              value: nf.format(Math.round(r.score)),
              extra: nf.format(r.kills),
            }))}
            valueLabel={t('nw.col.best')}
            extraLabel={t('nw.col.kills')}
          />
        )}
      </article>
    </div>
  );
}

/* ── the results table ───────────────────────────────────────────────── */

interface Row {
  key: string;
  name: string;
  skin: number;
  me: boolean;
  value: string;
  extra?: string;
}

function Standings({
  rows,
  valueLabel,
  extraLabel,
}: {
  rows: Row[];
  valueLabel: string;
  extraLabel?: string;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <table className="nw-table">
      <thead>
        <tr>
          <th scope="col" className="nw-table__rank mono">
            {t('nw.col.rank')}
          </th>
          <th scope="col" className="mono">
            {t('nw.col.player')}
          </th>
          <th scope="col" className="nw-table__num mono">
            {valueLabel}
          </th>
          {extraLabel && (
            <th scope="col" className="nw-table__num mono">
              {extraLabel}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 50).map((r, i) => (
          <motion.tr
            key={r.key}
            className={`${r.me ? 'is-me ' : ''}${i < 3 ? `is-top is-top-${i + 1}` : ''}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(i, 20) * STAGGER }}
          >
            <td className="nw-table__rank">
              <RankMark n={i + 1} />
            </td>
            <th scope="row" className="nw-table__name">
              <span className="nw-table__who">
                <CoinPortrait skin={r.skin} size={i < 3 ? 38 : 30} still seed={i + 1} className="nw-table__coin" />
                <span className="nw-table__label">{r.name}</span>
                {r.me && (
                  <Chip tone="pink" className="nw-table__me">
                    {t('nw.you')}
                  </Chip>
                )}
                <span className="nw-table__leader" aria-hidden="true" />
              </span>
            </th>
            <td className="nw-table__num mono">{r.value}</td>
            {extraLabel && <td className="nw-table__num mono">{r.extra}</td>}
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}

function RankMark({ n }: { n: number }): ReactNode {
  if (n > 3) return <span className="nw-rank mono">{String(n).padStart(2, '0')}</span>;
  return (
    <span className={`nw-rank is-medal is-${n}`}>
      {n === 1 && <Icon name="crown" size={14} className="nw-rank__crown" />}
      <span>{n}</span>
    </span>
  );
}

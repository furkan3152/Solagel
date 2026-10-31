import { motion } from 'motion/react';
import { useAddress } from '../../wallet/store';
import { useEffect, useState, type ReactNode } from 'react';
import { Chip, Icon, STAGGER, Skeleton, StampSpinner, Tabs, springs, tabPanelProps, useReducedMotion, type TabItem } from '../../design';
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
 * The standings: Today / All time tabs over the server's off-chain records (best single
 * games, bots excluded), the top three on a podium of terraces, then the table. No prizes: the
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
        {rows.length > 0 && <Podium rows={rows} />}
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

/* ── the podium: the top three coins on terraces ──────────────────────── */

function Podium({ rows }: { rows: LbRecord[] }) {
  const nf = new Intl.NumberFormat('en-US');
  const reduced = useReducedMotion();
  // second, first, third: the winner stands on the tallest terrace in the middle
  const order = [1, 0, 2].filter((i) => rows[i]);
  return (
    <div className="nw-podium" aria-hidden="true">
      {order.map((i, k) => {
        const r = rows[i];
        return (
          <motion.div
            key={`${i}-${r.name}`}
            className={`nw-podium__spot is-${i + 1}`}
            initial={reduced ? false : { opacity: 0, y: -18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { ...springs.drop, delay: k * STAGGER * 2 }}
          >
            {/* the top three hop on their terraces, out of step; the winner wears the crown */}
            <span className="nw-podium__hop" style={{ animationDelay: `${[0, 0.35, 0.7][i]}s` }}>
              {i === 0 && <PodiumCrown />}
              <CoinPortrait skin={r.skin} size={i === 0 ? 96 : 72} expression={i === 0 ? 'proud' : 'happy'} seed={i + 4} still={reduced} />
            </span>
            <span className="nw-podium__name">{r.name}</span>
            <span className="nw-podium__step">
              <span className="nw-podium__n display">{i + 1}</span>
              <span className="nw-podium__score num">{nf.format(Math.round(r.score))}</span>
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/** A die-cut crown sticker for the day's winner: sun paint, one shade, ink edge, three jewels. */
function PodiumCrown() {
  return (
    <svg className="nw-podium__crown" viewBox="0 0 64 44" aria-hidden="true" focusable="false">
      <path d="M6 38 L4 12 L18 22 L32 4 L46 22 L60 12 L58 38 Z" fill="#F6EEDA" stroke="#04181C" strokeWidth="9" strokeLinejoin="round" />
      <path d="M6 38 L4 12 L18 22 L32 4 L46 22 L60 12 L58 38 Z" fill="#F2C14E" stroke="#04181C" strokeWidth="3" strokeLinejoin="round" />
      <path d="M44 24 L58 15 L56 36 H40Z" fill="#D49A2B" />
      <path d="M6 38 H58" stroke="#04181C" strokeWidth="3" />
      <circle cx="18" cy="31" r="3.4" fill="#F39B86" stroke="#04181C" strokeWidth="2" />
      <circle cx="32" cy="30" r="3.8" fill="#6FCDE8" stroke="#04181C" strokeWidth="2" />
      <circle cx="46" cy="31" r="3.4" fill="#3C9A87" stroke="#04181C" strokeWidth="2" />
    </svg>
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
                  <Chip tone="sun" className="nw-table__me">
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

import { PRIZE_SHARES_BPS, shortAddress } from '@slana/shared';
import { useWallet } from '@solana/wallet-adapter-react';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Chip, Counter, Icon, Rule, STAGGER, Tabs, tabPanelProps, useReducedMotion, type TabItem } from '../../design';
import { SERVER } from '../../config';
import { useT } from '../../i18n';
import { useChainData, type PreviousSeasonInfo, type SeasonInfo } from '../../solana/chain';
import { CLAIM_WINDOW_S, PRIZE_RANKS, prizeAmount } from '../../solana/season';
import { bpsPercent } from '../../solana/ticket';
import { CoinPortrait } from '../game/CoinPortrait';
import { useMedia, useTokenText, type TokenText } from '../lobby/useLobby';
import { PageHead } from '../PageHead';
import { SeasonClaim } from './SeasonClaim';
import './news.css';

type Board = 'season' | 'today' | 'all';

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

const seasonDay = (s: SeasonInfo) => (s.startedAt > 0 ? Math.max(1, Math.floor((Date.now() / 1000 - s.startedAt) / 86_400) + 1) : 1);

/**
 * The standings as a newspaper page (spec §7.2.7): Season / Today / All time
 * tabs; the season front has a headline on the leader, the full table with
 * prize shares, the pool box, the winner's prize cheque and last season's
 * final table.
 */
export function Leaderboards() {
  const t = useT();
  const season = useChainData((s) => s.season);
  const [tab, setTab] = useState<Board>('season');
  const boards = useOffchainBoards(tab !== 'season');
  const items: TabItem<Board>[] = [
    { id: 'season', label: t('nw.tab.season'), icon: 'trophy' },
    { id: 'today', label: t('nw.tab.today'), icon: 'sun' },
    { id: 'all', label: t('nw.tab.all'), icon: 'crown' },
  ];
  const edition = season ? `${t('lo.season', { n: String(season.id).padStart(2, '0') })} · ${t('nw.edition', { d: seasonDay(season) })}` : null;
  return (
    <div className="nw-page">
      <PageHead kicker={t('nw.kicker')} title={t('nw.title')} aside={edition ? <span className="nw-edition mono">{edition}</span> : undefined} />
      <Tabs items={items} value={tab} onChange={setTab} label={t('nw.tabs')} idBase="nw" className="nw-tabs" />
      <motion.div key={tab} {...tabPanelProps('nw', tab)} className="nw-panel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
        {tab === 'season' ? <SeasonFront season={season} /> : <OffchainFront kind={tab} boards={boards} />}
      </motion.div>
    </div>
  );
}

/* ── season ──────────────────────────────────────────────────────────── */

function SeasonFront({ season }: { season: SeasonInfo | null }) {
  const t = useT();
  const tok = useTokenText();
  const me = useWallet().publicKey?.toBase58() ?? null;
  const wide = useMedia('(min-width: 900px)');
  if (!season) return <p className="nw-note">{t('lo.ranks.offline')}</p>;
  const n = String(season.id).padStart(2, '0');
  const leader = season.entries[0];
  const nf = new Intl.NumberFormat('en-US');
  const pool = BigInt(Math.trunc(season.prizePool));

  const lead = (
    <article className="nw-lead">
      <h3 className="nw-headline">{leader ? t('nw.headline', { name: leader.name, n }) : t('nw.headlineEmpty', { n })}</h3>
      <p className="nw-deck">
        {leader ? t('nw.deck', { pts: nf.format(leader.points), d: seasonDay(season) }) : t('nw.deckEmpty')}
      </p>
      {season.entries.length > 0 && (
        <Standings
          rows={season.entries.map((e) => ({ key: e.player, name: e.name, skin: e.skin, me: e.player === me, value: nf.format(e.points) }))}
          valueLabel={t('nw.col.points')}
          prize={(i) => (i < PRIZE_RANKS ? `${bpsPercent(PRIZE_SHARES_BPS[i])}% · ${tok.compact(prizeAmount(pool, i))}` : null)}
          prizeLabel={t('nw.col.prize')}
        />
      )}
      {leader && <p className="nw-note">{t('nw.deckEmpty')}</p>}
    </article>
  );
  const side = (
    <aside className="nw-side">
      <SeasonClaim />
      <PoolBox season={season} tok={tok} />
      {season.previous && <PreviousTable prev={season.previous} tok={tok} me={me} />}
    </aside>
  );
  return (
    <div className={`nw-cols${wide ? ' is-wide' : ''}`}>
      {wide ? (
        <>
          {lead}
          <Rule className="kl-vrule" aria-hidden="true" />
          {side}
        </>
      ) : (
        <>
          <SeasonClaim />
          {lead}
          <PoolBox season={season} tok={tok} />
          {season.previous && <PreviousTable prev={season.previous} tok={tok} me={me} />}
        </>
      )}
    </div>
  );
}

function PoolBox({ season, tok }: { season: SeasonInfo; tok: TokenText }) {
  const t = useT();
  const seasonBps = useChainData((s) => s.config?.seasonBps ?? 3000);
  const pool = BigInt(Math.trunc(season.prizePool));
  const whole = Number(pool / 10n ** BigInt(tok.decimals));
  const nf = new Intl.NumberFormat('en-US');
  return (
    <section className="nw-pool" aria-labelledby="nw-pool-h">
      <h3 id="nw-pool-h" className="nw-pool__kicker mono">
        {t('nw.pool')}
      </h3>
      <Counter value={whole} format={(v) => nf.format(Math.round(v))} unit={tok.symbol} className="nw-pool__value" />
      <p className="nw-pool__note">{t('nw.poolNote', { pct: bpsPercent(seasonBps) })}</p>
      <h4 className="nw-shares__h mono">{t('nw.shares')}</h4>
      <ol className="nw-shares">
        {PRIZE_SHARES_BPS.map((bps, i) => (
          <li key={i}>
            <span className="nw-shares__rank mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="nw-shares__pct">{bpsPercent(bps)}%</span>
            <span className="nw-shares__amt mono">{tok.compact(prizeAmount(pool, i))}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PreviousTable({ prev, tok, me }: { prev: PreviousSeasonInfo; tok: TokenText; me: string | null }) {
  const t = useT();
  const pool = BigInt(Math.trunc(prev.prizePool));
  const closes = prev.endedAt + CLAIM_WINDOW_S;
  const open = Date.now() / 1000 <= closes;
  const date = new Date(closes * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const n = String(prev.id).padStart(2, '0');
  return (
    <section className="nw-prev" aria-labelledby="nw-prev-h">
      <h3 id="nw-prev-h" className="kl-h3">
        {t('nw.prev', { n })}
      </h3>
      <p className="nw-prev__note mono">
        {open ? t('nw.prevNote', { pool: tok.compact(pool), sym: tok.symbol, date }) : t('nw.prevClosed', { pool: tok.compact(pool), sym: tok.symbol })}
      </p>
      <ol className="nw-prev__list">
        {prev.entries.slice(0, PRIZE_RANKS).map((e, i) => {
          const paid = (prev.claimedMask & (1 << i)) !== 0;
          return (
            <li key={e.player} className={e.player === me ? 'is-me' : undefined}>
              <span className="nw-prev__rank mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="nw-prev__name">{e.name || shortAddress(e.player, 4, 4)}</span>
              <span className="nw-prev__amt mono">{tok.compact(prizeAmount(pool, i))}</span>
              {paid && <span className="nw-prev__paid mono">{t('nw.paid')}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ── today / all time ────────────────────────────────────────────────── */

function OffchainFront({ kind, boards }: { kind: 'today' | 'all'; boards: Boards }) {
  const t = useT();
  const me = useWallet().publicKey?.toBase58() ?? null;
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
        {boards.state === 'loading' && <p className="nw-note">{t('lo.live.connecting')}</p>}
        {boards.state === 'ok' && rows.length === 0 && <p className="nw-note">{t('nw.empty')}</p>}
        {rows.length > 0 && (
          <Standings
            rows={rows.map((r, i) => ({
              key: `${r.wallet ?? r.name}:${i}`,
              name: r.name,
              skin: r.skin,
              me: !!me && r.wallet === me,
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
  prize,
  prizeLabel,
}: {
  rows: Row[];
  valueLabel: string;
  extraLabel?: string;
  prize?: (i: number) => string | null;
  prizeLabel?: string;
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
          {prize && (
            <th scope="col" className="nw-table__num nw-table__prize mono">
              {prizeLabel}
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
            {prize && <td className="nw-table__num nw-table__prize mono">{prize(i)}</td>}
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

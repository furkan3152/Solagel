import { avatarPath, type LbEntry, type StandingRow } from '@elymum/shared';
import { memo, useEffect } from 'react';
import { Icon, Laurel, Sheet } from '../../design';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { lookForSkin as lookForBasicSkin } from '../../render/looks';
import { closeModal, useUi } from '../../store';
import { BotTag } from './BotTag';
import { useTokenFormat } from './format';

/** The leaderboard's top rows as standings rows (shown until the server's full list arrives). */
export function rowsFromLb(lb: readonly LbEntry[]): StandingRow[] {
  return lb.map((e) => ({ pid: e.pid, name: e.name, skin: e.skin, score: e.score, value: e.value, isBot: e.isBot ?? e.bot, verified: e.verified }));
}

/** The coin of a row: the uploaded picture in the skin's rim, else the skin's paint. */
function RowCoin({ skin, avatar }: { skin: number; avatar?: string }) {
  const body = lookForBasicSkin(skin).body;
  return (
    <span className="g-full__coin" aria-hidden="true" style={{ ['--coin' as string]: body }}>
      {avatar && <img src={avatarPath(avatar)} alt="" width={24} height={24} loading="lazy" draggable={false} />}
    </span>
  );
}

interface RowProps {
  r: StandingRow;
  rank: number;
  mine: boolean;
  arena: boolean;
}

const FullRow = memo(function FullRow({ r, rank, mine, arena }: RowProps) {
  const t = useT();
  const tf = useTokenFormat();
  return (
    <li className={`g-full__row${mine ? ' is-me' : ''}${r.away ? ' is-away' : ''}`} data-testid="standings-row" aria-current={mine ? 'true' : undefined}>
      <span className="g-full__rank mono">
        {rank === 1 && (
          <svg className="g-standings__crown" viewBox="0 0 24 16" aria-hidden="true">
            <path d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14Z" />
          </svg>
        )}
        {rank}
      </span>
      <RowCoin skin={r.skin} avatar={r.avatar} />
      <span className="g-full__name">
        <span className="g-full__nm" title={r.name}>
          {mine ? t('g.full.you', { name: r.name }) : r.name}
        </span>
        {r.holder && (
          <span className="g-full__laurel" title={t('g.full.holder')}>
            <Laurel size={14} />
            <span className="kb-sr">{t('g.full.holder')}</span>
          </span>
        )}
        {r.verified && <Icon name="check" size={12} className="g-standings__ver" />}
        {r.isBot && <BotTag />}
        {r.away && <span className="g-full__away mono">{t('g.full.away')}</span>}
      </span>
      <span className="g-full__mass num">{Math.floor(r.score).toLocaleString('en-US')}</span>
      {arena && <span className="g-full__value num">{r.value !== undefined ? tf.fmt(r.value, { compact: true, maxFrac: 1 }) : '—'}</span>}
    </li>
  );
});

/**
 * Everyone in the room: opened by tapping the in-game leaderboard. Every coin in play with its rank,
 * name, mass (and value in arenas), BOT tag, holder laurel and picture; my row highlighted. The
 * server sends the list once a second while the sheet is open (`standings`); until it arrives the
 * leaderboard's top rows stand in. Esc, the close button or a tap outside closes it.
 */
export function StandingsSheet() {
  const t = useT();
  const open = useUi((s) => s.modal === 'standings');
  const inGame = useUi((s) => s.screen === 'playing' || s.screen === 'spectating' || s.screen === 'dead');
  const full = useUi((s) => s.standings);
  const lb = useUi((s) => s.lb);
  const myPid = useUi((s) => s.me?.pid ?? null);
  const playing = useUi((s) => s.screen === 'playing');
  const arena = useUi((s) => s.room?.mode === 'arena');
  const players = useUi((s) => s.hud.players);

  useEffect(() => {
    if (!open) return;
    engine()?.watchStandings(true);
    return () => engine()?.watchStandings(false);
  }, [open]);
  // leaving the game closes the sheet
  useEffect(() => {
    if (open && !inGame) closeModal();
  }, [open, inGame]);

  const rows = full?.rows ?? rowsFromLb(lb);
  const n = full?.players ?? players;
  const bots = rows.filter((r) => r.isBot).length;
  const people = Math.max(0, rows.length - bots);
  return (
    <Sheet open={open} onClose={closeModal} closeLabel={t('lo.close')} kicker={t('g.full.kicker', { n })} title={t('g.full.title')} className="g-sheet g-full" quiet>
      <p className="g-full__sum mono" data-testid="standings-sheet">
        {t('g.full.summary', { people: people === 1 ? t('g.full.person') : t('g.full.people', { n: people }), bots: bots === 1 ? t('g.full.bot') : t('g.full.bots', { n: bots }) })}
        {full && full.watching > 0 && <> · {t('g.full.watching', { n: full.watching })}</>}
        {!full && <> · {t('g.full.loading')}</>}
      </p>
      <div className={`g-full__head mono${arena ? ' is-arena' : ''}`} aria-hidden="true">
        <span>#</span>
        <span />
        <span>{t('g.full.player')}</span>
        <span>{t('g.full.mass')}</span>
        {arena && <span>{t('g.full.value')}</span>}
      </div>
      <ol className={`g-full__list${arena ? ' is-arena' : ''}`} aria-label={t('g.full.title')}>
        {rows.map((r, i) => (
          <FullRow key={r.pid} r={r} rank={i + 1} mine={playing && r.pid === myPid} arena={arena} />
        ))}
      </ol>
      {rows.length === 0 && <p className="g-full__empty">{t('g.full.empty')}</p>}
    </Sheet>
  );
}

import { PRIZE_SHARES_BPS } from '@slana/shared';
import { useWallet } from '@solana/wallet-adapter-react';
import { motion } from 'motion/react';
import { Icon, Skeleton, staggerIn, useReducedMotion } from '../../design';
import { useUi } from '../../store';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { bpsPercent } from '../../solana/ticket';
import { useTokenText } from './useLobby';

/**
 * Season standings as a newspaper results table: rank, name, points and the
 * prize share of the running pool (Task 15 brings the full leaderboard page).
 */
export function SeasonColumn({ limit = 10, onMore }: { limit?: number; onMore?: () => void }) {
  const t = useT();
  const season = useChainData((s) => s.season);
  const tok = useTokenText();
  const me = useWallet().publicKey?.toBase58() ?? null;
  const rows = (season?.entries ?? []).slice(0, limit);
  const reduced = useReducedMotion();
  const connected = useUi((s) => s.connected);
  const nf = new Intl.NumberFormat('en-US');
  return (
    <section className="kl-season" aria-labelledby="kl-season-h">
      <header className="kl-season__head">
        <h3 id="kl-season-h" className="kl-h3">
          <Icon name="trophy" size={20} />
          {t('lo.ranks.title')}
        </h3>
        {season && <span className="kl-season__pool mono">{t('lo.pool', { n: tok.compact(season.prizePool), sym: tok.symbol })}</span>}
      </header>
      {!season && (connected ? <p className="kl-note">{t('lo.ranks.offline')}</p> : <Skeleton rows={Math.min(limit, 5)} />)}
      {season && rows.length === 0 && <p className="kl-note">{t('lo.ranks.empty')}</p>}
      {rows.length > 0 && (
        <table className="kl-standings">
          <thead className="kb-sr">
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('pf.name')}</th>
              <th scope="col">{t('lo.ranks.points', { n: '' }).trim()}</th>
              <th scope="col">{t('lo.ranks.prizeLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr key={r.player} className={r.player === me ? 'is-me' : undefined} {...staggerIn(i, reduced)}>
                <td className="kl-standings__rank mono">{String(i + 1).padStart(2, '0')}</td>
                <td className="kl-standings__name">{r.name}</td>
                <td className="kl-standings__pts mono">{t('lo.ranks.points', { n: nf.format(r.points) })}</td>
                <td className="kl-standings__share mono">
                  {i < PRIZE_SHARES_BPS.length ? t('lo.ranks.prize', { n: bpsPercent(PRIZE_SHARES_BPS[i]) }) : ''}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      )}
      {onMore && season && (
        <button type="button" className="kl-link mono kl-season__more" onClick={onMore}>
          {t('nw.more')}
          <Icon name="arrow" size={16} />
        </button>
      )}
    </section>
  );
}

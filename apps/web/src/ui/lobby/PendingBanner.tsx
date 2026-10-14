import { InkButton } from '../../design';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { useTokenText } from './useLobby';

/**
 * Ruling R10: the server never pays a player's token-account rent. When a
 * payout waits for the player's account, this slip says so, shows the amount
 * and offers the one-instruction transaction that creates it (player-paid).
 * Payouts that are merely in flight are shown as such.
 */
export function PendingBanner({ onCreateAta }: { onCreateAta: () => void }) {
  const t = useT();
  const pending = useChainData((s) => s.pending);
  const tok = useTokenText();
  if (pending.length === 0) return null;
  const total = pending.reduce((s, p) => s + p.payout, 0);
  const needsAta = pending.some((p) => p.needsTokenAccount);
  return (
    <section className={`kl-owed${needsAta ? ' is-action' : ''}`} role={needsAta ? 'alert' : 'status'} aria-labelledby="kl-owed-k">
      <div className="kl-owed__slip">
        <div className="kl-owed__top">
          <span id="kl-owed-k" className="kl-owed__kicker mono">
            {t('lo.pending.kicker')}
          </span>
          <span className="kl-owed__amount">
            {tok.fee(total)} <span className="mono">{tok.symbol}</span>
          </span>
        </div>
        {needsAta ? (
          <>
            <p className="kl-owed__title">{t('lo.pending.ata')}</p>
            <p className="kl-owed__note">{t('lo.pending.ataNote')}</p>
            <InkButton variant="pink" size="sm" icon="arrow" onClick={onCreateAta}>
              {t('lo.pending.cta')}
            </InkButton>
          </>
        ) : (
          <p className="kl-owed__note mono">
            <span className="kl-dots" aria-hidden="true" />
            {t('lo.pending.settling')}
          </p>
        )}
      </div>
    </section>
  );
}

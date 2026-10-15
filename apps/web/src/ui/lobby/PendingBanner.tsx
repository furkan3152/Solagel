import { InkButton } from '../../design';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { sessionsToCollect, type OpenSession } from '../../solana/ticket';
import { useTokenText } from './useLobby';

/**
 * Payouts owed to this wallet. R24: a game settled without a usable token account
 * leaves its payout in the arena vault; this slip shows the amount and opens the
 * "Collect payout" sheet (one transaction, the token account is created if needed,
 * player-paid, no waiting time). Payouts the server is still sending are shown as such.
 */
export function PendingBanner({ onCollect }: { onCollect: () => void }) {
  const t = useT();
  const pending = useChainData((s) => s.pending);
  const sessions = useChainData((s) => s.sessions);
  const tok = useTokenText();
  const collect = sessionsToCollect(sessions as Record<number, OpenSession | null>);
  if (pending.length === 0 && collect.length === 0) return null;
  const action = collect.length > 0;
  const total = action ? collect.reduce((s, c) => s + c.owed, 0n) : pending.reduce((s, p) => s + BigInt(p.payout), 0n);
  return (
    <section className={`kl-owed${action ? ' is-action' : ''}`} role={action ? 'alert' : 'status'} aria-labelledby="kl-owed-k">
      <div className="kl-owed__slip">
        <div className="kl-owed__top">
          <span id="kl-owed-k" className="kl-owed__kicker mono">
            {t('lo.pending.kicker')}
          </span>
          <span className="kl-owed__amount">
            {tok.fee(total)} <span className="mono">{tok.symbol}</span>
          </span>
        </div>
        {action ? (
          <>
            <p className="kl-owed__title">{t('lo.pending.collect')}</p>
            <p className="kl-owed__note">{t('lo.pending.collectNote')}</p>
            <InkButton variant="pink" size="sm" icon="arrow" onClick={onCollect}>
              {t('lo.pending.collectCta')}
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

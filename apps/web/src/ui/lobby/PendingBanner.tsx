import { Button } from '../../design';
import { useT } from '../../i18n';
import { openSessionOf, useChainData } from '../../wallet/chain';
import { sessionsToCollect, type OpenSession } from '../../wallet/ticket';
import { useTokenText } from './useLobby';

/**
 * Payouts owed to this wallet. A game whose token transfer to the player failed at settlement
 * leaves its payout in the arena vault (`owed`); this slip shows the amount and opens the
 * "Collect payout" sheet (one `refund` transaction, no waiting time). Payouts the server is
 * still sending are shown as such.
 */
export function PendingBanner({ onCollect }: { onCollect: () => void }) {
  const t = useT();
  const pending = useChainData((s) => s.pending);
  const sessions = useChainData((s) => s.sessions);
  const tok = useTokenText();
  const open: Record<number, OpenSession | null> = {};
  for (const [id, s] of Object.entries(sessions)) open[Number(id)] = openSessionOf(s);
  const collect = sessionsToCollect(open);
  if (pending.length === 0 && collect.length === 0) return null;
  const action = collect.length > 0;
  // collect: base units from the chain; settling: ledger units from the server
  const amount = action ? tok.fee(collect.reduce((s, c) => s + c.owed, 0n)) : tok.wire(pending.reduce((s, p) => s + p.payout, 0));
  return (
    <section className={`kl-owed${action ? ' is-action' : ''}`} role={action ? 'alert' : 'status'} aria-labelledby="kl-owed-k">
      <div className="kl-owed__slip">
        <div className="kl-owed__top">
          <span id="kl-owed-k" className="kl-owed__kicker mono">
            {t('lo.pending.kicker')}
          </span>
          <span className="kl-owed__amount">
            {amount} <span className="mono">{tok.symbol}</span>
          </span>
        </div>
        {action ? (
          <>
            <p className="kl-owed__title">{t('lo.pending.collect')}</p>
            <p className="kl-owed__note">{t('lo.pending.collectNote')}</p>
            <Button variant="teal" size="sm" icon="arrow" onClick={onCollect}>
              {t('lo.pending.collectCta')}
            </Button>
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

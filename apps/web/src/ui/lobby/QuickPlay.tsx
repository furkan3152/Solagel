import { InkButton, type IconName } from '../../design';
import { useT } from '../../i18n';
import type { TicketGate, TicketModel } from '../../solana/ticket';
import { useUi } from '../../store';
import { ticketName, useTokenText } from './useLobby';

export interface CtaText {
  label: string;
  sub: string;
  icon: IconName;
  /** Nothing the player can do from here (shown, but not pressable). */
  inert: boolean;
}

/** What the big button says for a ticket and its gate. */
export function useCtaText(ticket: TicketModel | undefined, gate: TicketGate | undefined): CtaText {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const tok = useTokenText();
  if (!ticket || !gate) return { label: t('lo.cta.practice'), sub: t('lo.cta.practiceSub'), icon: 'play', inert: false };
  const room = ticketName(ticket, lang, t('lo.practice'));
  const feeLine = t('lo.cta.fee', { room, fee: tok.fee(ticket.entryFee), sym: tok.symbol });
  switch (gate.kind) {
    case 'practice':
      return { label: t('lo.cta.practice'), sub: t('lo.cta.practiceSub'), icon: 'play', inert: false };
    case 'offline':
      return { label: t('lo.cta.offline'), sub: t('lo.cta.offlineSub'), icon: 'lock', inert: true };
    case 'maintenance':
      return { label: t('lo.cta.maintenance'), sub: t('lo.cta.maintenanceSub'), icon: 'lock', inert: true };
    case 'connect':
      return { label: t('lo.cta.connect'), sub: feeLine, icon: 'wallet', inert: false };
    case 'verify':
      return { label: t('lo.cta.verify'), sub: t('lo.cta.verifySub'), icon: 'key', inert: false };
    case 'resume':
      return { label: t('lo.cta.resume'), sub: t('lo.cta.resumeSub', { room }), icon: 'play', inert: false };
    case 'settling':
      return { label: t('lo.cta.settling'), sub: t('lo.cta.settlingSub', { amount: tok.fee(gate.payout), sym: tok.symbol }), icon: 'coin', inert: true };
    case 'collect':
      return { label: t('lo.cta.collect'), sub: t('lo.cta.collectSub', { amount: tok.fee(gate.owed), sym: tok.symbol }), icon: 'coin', inert: false };
    case 'refund':
      return { label: t('lo.cta.refund'), sub: t('lo.cta.refundSub', { room }), icon: 'coin', inert: false };
    case 'needPass':
      return { label: t('lo.cta.needPass'), sub: t('lo.cta.needPassSub', { room }), icon: 'passport', inert: false };
    case 'insufficient':
      return {
        label: t('lo.cta.insufficient', { sym: tok.symbol }),
        sub: t('lo.cta.insufficientSub', { room, missing: tok.fee(gate.missing), sym: tok.symbol }),
        icon: 'lock',
        inert: true,
      };
    case 'buy':
      return { label: t('lo.cta.buy'), sub: feeLine, icon: 'arrow', inert: false };
  }
}

/**
 * Quick Play: the printed CTA under the tickets. The lobby preselects Quick
 * Play's pick (practice without a wallet or tokens, else the open ticket, the
 * last arena or the cheapest affordable one); the button acts on whatever
 * ticket is selected. It never signs anything itself: paid tickets open the
 * confirm sheet first.
 */
export function QuickPlay({
  ticket,
  gate,
  onPress,
  busy,
}: {
  ticket: TicketModel | undefined;
  gate: TicketGate | undefined;
  onPress: () => void;
  busy?: boolean;
}) {
  const text = useCtaText(ticket, gate);
  return (
    <InkButton size="lg" block className="kl-cta" icon={text.icon} sub={text.sub} disabled={text.inert || busy} onClick={onPress}>
      {text.label}
    </InkButton>
  );
}

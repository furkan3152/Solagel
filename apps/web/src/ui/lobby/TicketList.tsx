import { arenaMeta } from '@slana/shared';
import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { STAGGER, Ticket, TicketGroup, TicketStub, useReducedMotion } from '../../design';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { PASS_POWER, bpsPercent, feeBps, type TicketGate, type TicketKey, type TicketModel } from '../../solana/ticket';
import { useUi } from '../../store';
import { ticketName, useTokenText } from './useLobby';

/**
 * The tickets: practice first, then one per arena (instances summed), each
 * with its price on the stub, live counts, the loot on the floor, a PASS stamp
 * when a Pass is required and the Pass perk line where it is optional.
 */
export function TicketList({
  tickets,
  gates,
  openTickets,
  value,
  onChange,
  onActivate,
}: {
  tickets: TicketModel[];
  gates: Record<string, TicketGate>;
  /** Arenas where the wallet has an open on-chain ticket. */
  openTickets: number[];
  value: TicketKey;
  onChange: (key: TicketKey) => void;
  /** Double click / Enter on the selected ticket: same as the CTA. */
  onActivate: () => void;
}) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const config = useChainData((s) => s.config);
  const tok = useTokenText();
  const reduced = useReducedMotion();
  const perk = t('lo.perk', { start: PASS_POWER.startPct, s: PASS_POWER.cashoutS, fee: bpsPercent(feeBps(config, true), lang) });

  const count = (n: number, one: 'lo.humans1' | 'lo.bots1', many: 'lo.humans' | 'lo.bots') => (n === 1 ? t(one) : t(many, { n }));

  return (
    <TicketGroup label={t('lo.tickets')} value={value} onChange={(v) => onChange(v as TicketKey)} className="kl-tickets">
      {tickets.map((tk, i) => {
        const gate = gates[tk.key];
        const practice = tk.arenaId === null;
        const name = ticketName(tk, lang, t('lo.practice'));
        const maintenance = gate?.kind === 'maintenance';
        const closed = gate?.kind === 'offline' || maintenance;
        const status =
          gate?.kind === 'settling' || gate?.kind === 'needAta'
            ? t('lo.payoutChip')
            : !practice && openTickets.includes(tk.arenaId!)
              ? t('lo.yourTicket')
              : null;
        const meta = practice
          ? [t('lo.practiceMeta'), tk.humans > 0 ? count(tk.humans, 'lo.humans1', 'lo.humans') : null].filter(Boolean).join(' · ')
          : [count(tk.humans, 'lo.humans1', 'lo.humans'), count(tk.bots, 'lo.bots1', 'lo.bots'), t('lo.onFloor', { n: tok.compact(tk.loot), sym: tok.symbol })]
              .filter(Boolean)
              .join(' · ');
        const style = { '--kl-ink': practice ? 'var(--ink-2)' : arenaMeta(tk.arenaId!).ink } as CSSProperties;
        return (
          <motion.div
            key={tk.key}
            className="kl-ticket"
            style={style}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, delay: i * STAGGER, ease: [0.2, 0.9, 0.25, 1] }}
          >
            <Ticket
              value={tk.key}
              stamp={tk.requiresPass ? t('lo.passStamp') : undefined}
              disabled={closed}
              onDoubleClick={onActivate}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value === tk.key) {
                  e.preventDefault();
                  onActivate();
                }
              }}
              stub={practice ? <TicketStub value={t('lo.free')} unit={t('lo.noTokens')} /> : <TicketStub value={tok.fee(tk.entryFee)} unit={tok.symbol} />}
            >
              <span className="kl-ticket__head">
                <span className="kb-ticket__title">{name}</span>
                {closed && <span className="kl-ticket__flag mono">{maintenance ? t('lo.maintenance') : t('lo.closed')}</span>}
                {status && <span className="kl-ticket__flag is-open mono">{status}</span>}
              </span>
              <span className="kb-ticket__meta mono">
                {tk.humans > 0 && <span className="kl-live-dot" aria-hidden="true" />}
                {meta}
              </span>
              {!practice && !tk.requiresPass && <span className="kl-ticket__perk mono">{perk}</span>}
            </Ticket>
          </motion.div>
        );
      })}
    </TicketGroup>
  );
}

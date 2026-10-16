import { arenaMeta } from '@slana/shared';
import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { STAGGER, Ticket, TicketGroup, TicketStub, useReducedMotion } from '../../design';
import { formatCountdown, useRound } from '../../game/round';
import { useT } from '../../i18n';
import { useUi } from '../../store';
import { bpsPercent, feeBps, type TicketGate, type TicketKey, type TicketModel } from '../../solana/ticket';
import { ticketName, useTokenText } from './useLobby';

/**
 * Where an arena's round stands: "Round ends in 3:12", or in the final minute "Joins closed ·
 * next round in 0:42". Its own component, so only this line re-renders every second.
 */
export function RoundLine({ arenaId }: { arenaId: number }) {
  const t = useT();
  const round = useRound(arenaId);
  if (!round) return null;
  const time = formatCountdown(round.msLeft);
  const closed = round.phase === 'closing';
  return (
    <span className={`kl-ticket__round mono${closed ? ' is-closed' : ''}`} data-phase={round.phase}>
      {closed ? t('lo.round.closed', { time }) : t('lo.round.ends', { time })}
    </span>
  );
}

/**
 * The tickets: practice first, then one per arena (instances summed), each
 * with its price on the stub, live counts, the loot on the floor, the round's
 * state and the fee line. While the game token is not set the arenas are listed
 * as "Opening soon" (not for sale); practice plays.
 */
export function TicketList({
  tickets,
  gates,
  openTickets,
  value,
  onChange,
  onActivate,
  punched = null,
}: {
  tickets: TicketModel[];
  gates: Record<string, TicketGate>;
  /** Arenas where the wallet has an open on-chain ticket. */
  openTickets: number[];
  value: TicketKey;
  onChange: (key: TicketKey) => void;
  /** Double click / Enter on the selected ticket: same as the CTA. */
  onActivate: () => void;
  /** The ticket the conductor just punched (on the way into its room). */
  punched?: TicketKey | null;
}) {
  const t = useT();
  const serverBps = useUi((s) => s.chain?.feeBps ?? null);
  const tok = useTokenText();
  const reduced = useReducedMotion();
  const held = useUi((s) => s.held);
  const feeLine = t('lo.feeLine', { fee: bpsPercent(feeBps(serverBps)) });

  const count = (n: number, one: 'lo.humans1' | 'lo.bots1', many: 'lo.humans' | 'lo.bots') => (n === 1 ? t(one) : t(many, { n }));

  return (
    <TicketGroup label={t('lo.tickets')} value={value} onChange={(v) => onChange(v as TicketKey)} className="kl-tickets">
      {tickets.map((tk, i) => {
        const gate = gates[tk.key];
        const practice = tk.arenaId === null;
        const name = ticketName(tk, t('lo.practice'));
        const maintenance = gate?.kind === 'maintenance';
        const soon = gate?.kind === 'soon';
        const closed = gate?.kind === 'offline' || maintenance || soon;
        const status =
          !practice && held?.arenaId === tk.arenaId
            ? t('lo.held')
            : gate?.kind === 'settling'
            ? t('lo.payoutChip')
            : gate?.kind === 'collect'
              ? t('lo.collectChip')
              : !practice && openTickets.includes(tk.arenaId!)
              ? t('lo.yourTicket')
              : null;
        const meta = practice
          ? [t('lo.practiceMeta'), tk.humans > 0 ? count(tk.humans, 'lo.humans1', 'lo.humans') : null].filter(Boolean).join(' · ')
          : soon
            ? t('lo.soonMeta')
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
              disabled={closed}
              punched={punched === tk.key}
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
                {closed && <span className="kl-ticket__flag mono">{maintenance ? t('lo.maintenance') : soon ? t('lo.soon') : t('lo.closed')}</span>}
                {status && <span className="kl-ticket__flag is-open mono">{status}</span>}
              </span>
              <span className="kb-ticket__meta mono">
                {tk.humans > 0 && <span className="kl-live-dot" aria-hidden="true" />}
                {meta}
              </span>
              {!practice && !closed && <RoundLine arenaId={tk.arenaId!} />}
              {!practice && !soon && <span className="kl-ticket__fee mono">{feeLine}</span>}
            </Ticket>
          </motion.div>
        );
      })}
    </TicketGroup>
  );
}

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import type { TicketGate, TicketModel } from '../src/wallet/ticket';
import { useUi } from '../src/store';
import { useCtaText } from '../src/ui/lobby/QuickPlay';
import { TicketList } from '../src/ui/lobby/TicketList';

const initial = useUi.getState();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

const M = 10n ** 18n;
const practice: TicketModel = { key: 'practice', arenaId: null, entryFee: 0n, humans: 0, bots: 0, loot: 0, open: true };
const penny: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * M, humans: 0, bots: 0, loot: 0, open: true, blocked: true };
const gates: Record<string, TicketGate> = { practice: { kind: 'practice' }, 'arena:1': { kind: 'maintenance' } };

function Cta() {
  const cta = useCtaText(penny, gates['arena:1']);
  return <p data-testid="cta">{`${cta.label}|${cta.sub}|${cta.inert}`}</p>;
}

describe('R20: lobby shows a server-blocked arena as under maintenance', () => {
  it('flags the ticket and disables it', () => {
    render(
      <Kb>
        <TicketList tickets={[practice, penny]} gates={gates} openTickets={[]} value="practice" onChange={() => {}} onActivate={() => {}} />
        <Cta />
      </Kb>,
    );
    expect(screen.getByText('Under maintenance')).toBeTruthy();
    const ticket = screen.getAllByRole('radio').find((el) => el.textContent?.includes('Under maintenance'))!;
    expect(ticket.getAttribute('aria-disabled') === 'true' || (ticket as HTMLInputElement).disabled).toBe(true);
    // the big button cannot buy it
    expect(screen.getByTestId('cta').textContent).toBe('Under maintenance|This room is closed for a check; no tickets are sold|true');
  });
});

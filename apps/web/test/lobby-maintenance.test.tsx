import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import type { TicketGate, TicketModel } from '../src/solana/ticket';
import { useUi } from '../src/store';
import { useCtaText } from '../src/ui/lobby/QuickPlay';
import { TicketList } from '../src/ui/lobby/TicketList';

const initial = useUi.getState();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

const M = 1_000_000n;
const practice: TicketModel = { key: 'practice', arenaId: null, entryFee: 0n, requiresPass: false, humans: 0, bots: 0, loot: 0, open: true };
const penny: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * M, requiresPass: false, humans: 0, bots: 0, loot: 0, open: true, blocked: true };
const gates: Record<string, TicketGate> = { practice: { kind: 'practice' }, 'arena:1': { kind: 'maintenance' } };

function Cta() {
  const cta = useCtaText(penny, gates['arena:1']);
  return <p data-testid="cta">{`${cta.label}|${cta.sub}|${cta.inert}`}</p>;
}

describe('R20: lobby shows a server-blocked arena as under maintenance', () => {
  it('flags the ticket and disables it (TR)', () => {
    act(() => useUi.setState({ settings: { ...initial.settings, lang: 'tr' } }));
    render(
      <Kb>
        <TicketList tickets={[practice, penny]} gates={gates} openTickets={[]} value="practice" onChange={() => {}} onActivate={() => {}} />
        <Cta />
      </Kb>,
    );
    expect(screen.getByText('Bakımda')).toBeTruthy();
    const ticket = screen.getAllByRole('radio').find((el) => el.textContent?.includes('Bakımda'))!;
    expect(ticket.getAttribute('aria-disabled') === 'true' || (ticket as HTMLInputElement).disabled).toBe(true);
    // the big button cannot buy it
    expect(screen.getByTestId('cta').textContent).toBe('Bakımda|Oda kontrol için kapalı; bilet satılmıyor|true');
  });

  it('uses the English label', () => {
    act(() => useUi.setState({ settings: { ...initial.settings, lang: 'en' } }));
    render(
      <Kb>
        <Cta />
      </Kb>,
    );
    expect(screen.getByTestId('cta').textContent).toMatch(/^Under maintenance\|.*\|true$/);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import type { TicketGate, TicketModel } from '../src/solana/ticket';
import { TicketList } from '../src/ui/lobby/TicketList';

const M = 1_000_000n;
const practice: TicketModel = { key: 'practice', arenaId: null, entryFee: 0n, requiresPass: false, humans: 0, bots: 0, loot: 0, open: true };
const penny: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * M, requiresPass: false, humans: 0, bots: 0, loot: 0, open: true };

function renderWith(gate: TicketGate) {
  return render(
    <Kb>
      <TicketList tickets={[practice, penny]} gates={{ practice: { kind: 'practice' }, 'arena:1': gate }} openTickets={[1]} value="practice" onChange={() => {}} onActivate={() => {}} />
    </Kb>,
  );
}

describe('lobby ticket chip for a payout', () => {
  it('a settled game whose payout waits in the vault says "Payout waiting", not "on the way"', () => {
    renderWith({ kind: 'collect', owed: 5n * M });
    expect(screen.getByText('Payout waiting')).toBeTruthy();
    expect(screen.queryByText('Payout on the way')).toBeNull();
  });

  it('a payout the server is still sending says "Payout on the way"', () => {
    renderWith({ kind: 'settling', payout: 5 });
    expect(screen.getByText('Payout on the way')).toBeTruthy();
    expect(screen.queryByText('Payout waiting')).toBeNull();
  });
});

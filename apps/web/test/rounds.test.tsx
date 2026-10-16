import { RULES, roundAt, type DeathStats, type RoomInfo, type RoundInfo } from '@slana/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import { ServerClock, serverClock } from '../src/game/clock';
import { HELD_JITTER_MS, HeldTicket } from '../src/game/held';
import { Input } from '../src/game/input';
import { formatCountdown, roundInfoFor, roundLengths, roundStartLabel, roundStateAt } from '../src/game/round';
import { useChainData } from '../src/solana/chain';
import { RoundCues, type RoundCueSink } from '../src/game/roundCues';
import type { TicketGate, TicketModel } from '../src/solana/ticket';
import { useUi } from '../src/store';
import { setReducedMotion } from '../src/test/media';
import { DeathSheet, GameHud, RoundChip, RoundCountdown, RoundOverSheet } from '../src/ui/game';
import { MobileControls } from '../src/ui/game/MobileControls';
import { HeldBanner } from '../src/ui/lobby/HeldBanner';
import { QuickPlay } from '../src/ui/lobby/QuickPlay';
import { TicketList } from '../src/ui/lobby/TicketList';

const M = 1_000_000; // one whole token (6 decimals)
/** A round boundary: round N starts here (default 5-minute rounds). */
const N = 5_800_000;
const START = N * RULES.roundMs;
const R: RoundInfo = { n: N, endsAt: START + RULES.roundMs, joinsCloseAt: START + RULES.roundMs - RULES.roundJoinCloseMs };
const ARENA: RoomInfo = { id: 'arena-1-1', mode: 'arena', name: 'Penny Pond', width: 6400, height: 6400, players: 3, bots: 10, maxPlayers: 50, arenaId: 1, entryFee: 1000 * M, round: R };
const STATS: DeathStats = { aliveMs: 94_000, finalMass: 0, maxMass: 640, foodEaten: 88, cellsEaten: 1, playersEaten: 1, bestRank: 5 };
const CHAIN = { enabled: true, cluster: 'devnet', programId: null, rpcUrl: null, arenasEnabled: true, tokenReady: true, token: { mint: 'M', symbol: '$SLANA', decimals: 6 }, feeBps: null };
// jsdom has no canvas: the same null it returns, without the "not implemented" warning
HTMLCanvasElement.prototype.getContext = (() => null) as never;
const initial = useUi.getState();

/** Freezes `Date.now()` (the server clock, offset 0) at `at`; timers stay real. */
function clockAt(at: number) {
  vi.setSystemTime(at);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  serverClock.reset();
  useUi.setState({ chain: CHAIN, rooms: [ARENA] });
});
afterEach(() => {
  vi.useRealTimers();
  act(() => useUi.setState(initial, true));
});

describe('round math on the client', () => {
  it('derives the round length from RoundInfo and rolls past the bell with roundAt', () => {
    expect(roundLengths(R)).toEqual({ roundMs: 300_000, closeMs: 60_000 });
    // a server running 30 s rounds with a 5 s close (ROUND_SECONDS / ROUND_JOIN_CLOSE_SECONDS)
    const short = { n: 100, endsAt: 101 * 30_000, joinsCloseAt: 101 * 30_000 - 5_000 };
    expect(roundLengths(short)).toEqual({ roundMs: 30_000, closeMs: 5_000 });
    expect(roundStateAt(short, short.endsAt + 1)).toMatchObject({ n: 101, endsAt: 102 * 30_000, phase: 'open', msLeft: 29_999 });

    expect(roundStateAt(R, START + 108_000)).toMatchObject({ n: N, msLeft: 192_000, phase: 'open' });
    expect(roundStateAt(R, R.joinsCloseAt)).toMatchObject({ n: N, msLeft: 60_000, phase: 'closing' });
    // at the bell the next round is open (no intermission)
    const next = roundAt(R.endsAt);
    expect(roundStateAt(R, R.endsAt)).toEqual({ n: N + 1, endsAt: next.endsAt, joinsCloseAt: next.joinsCloseAt, msLeft: RULES.roundMs, phase: 'open' });
    expect(formatCountdown(192_000)).toBe('3:12');
    expect(formatCountdown(41_200)).toBe('0:42');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('takes the round from the room on screen, else its listing, else any arena', () => {
    const other: RoomInfo = { ...ARENA, id: 'arena-2-1', arenaId: 2, round: { ...R, n: N + 1 } };
    expect(roundInfoFor([ARENA, other], null, 2)?.n).toBe(N + 1);
    expect(roundInfoFor([ARENA], { ...ARENA, round: { ...R, n: 7 } }, 1)?.n).toBe(7);
    expect(roundInfoFor([ARENA], null, 9)?.n).toBe(N);
    expect(roundInfoFor([], null, 1)).toBeNull();
  });

  it('corrects clock skew with the server time of the fastest round trip', () => {
    let local = 1_000_000;
    const clock = new ServerClock(() => local);
    expect(clock.now()).toBe(local);
    clock.sync(1_005_000); // welcome: no round trip known
    expect(clock.offset).toBe(5_000);
    clock.sync(1_003_000, 200); // pong: +100 for the half trip
    expect(clock.offset).toBe(3_100);
    clock.sync(1_009_000, 900); // a slow trip does not win
    expect(clock.offset).toBe(3_100);
    local += 10_000;
    expect(clock.now()).toBe(1_013_100);
    expect(clock.toLocal(1_013_100)).toBe(local);
    // a bad round trip (negative, NaN) counts as unmeasured: no half-trip added, and it never wins
    const c2 = new ServerClock(() => 0);
    c2.sync(10_000, Number.NaN);
    expect(c2.offset).toBe(10_000);
    c2.sync(20_000, -5);
    expect(c2.offset).toBe(20_000);
  });
});

describe('round sound cues', () => {
  function cues() {
    const calls: string[] = [];
    const sink: RoundCueSink = { tick: (s) => calls.push(`tick ${s}`), bell: (n) => calls.push(`bell ${n}`), say: (l) => calls.push(l) };
    return { c: new RoundCues(sink), calls };
  }
  const at = (ms: number) => roundStateAt(R, ms);

  it('one minute, ten seconds, a tick each of the last ten seconds, then the bell once', () => {
    const { c, calls } = cues();
    for (let t = R.endsAt - 62_000; t <= R.endsAt + 500; t += 250) c.update(at(t));
    expect(calls).toEqual(['oneMinute', 'tenSeconds', 'tick 10', 'tick 9', 'tick 8', 'tick 7', 'tick 6', 'tick 5', 'tick 4', 'tick 3', 'tick 2', 'tick 1', `bell ${N}`, 'roundOver']);
    // the server's roundOver for the same round does not ring it again
    c.ring(N);
    expect(calls.filter((x) => x.startsWith('bell'))).toHaveLength(1);
  });

  it('stays quiet after a jump (hidden tab) and outside arenas', () => {
    const { c, calls } = cues();
    c.update(at(R.endsAt - 120_000));
    c.update(at(R.endsAt - 5_000)); // jumped over the minute and the ten seconds
    c.update(null);
    c.update(at(R.endsAt + 3_000)); // a fresh start after the bell
    expect(calls).toEqual([]);
  });
});

describe('HUD round chip', () => {
  const renderChip = () =>
    render(
      <Kb>
        <RoundChip />
        <RoundCountdown />
      </Kb>,
    );
  beforeEach(() => useUi.setState({ screen: 'playing', room: ARENA }));

  it('open: m:ss to the bell', () => {
    clockAt(START + 108_000);
    renderChip();
    const chip = screen.getByRole('timer', { name: 'Round ends in 3:12' });
    expect(chip.dataset.phase).toBe('open');
    expect(chip.textContent).toBe('Round3:12');
    expect(screen.queryByTestId('round-count')).toBeNull();
  });

  it('final minute: joins closed, the chip says so', () => {
    clockAt(R.endsAt - 42_000);
    renderChip();
    const chip = screen.getByRole('timer', { name: 'Final minute: 0:42 left' });
    expect(chip.className).toContain('is-closing');
    expect(chip.textContent).toBe('Final minute0:42');
    expect(screen.queryByTestId('round-count')).toBeNull();
  });

  it('last 10 s: a big countdown', () => {
    clockAt(R.endsAt - 6_500);
    renderChip();
    expect(screen.getByTestId('round-count').textContent).toBe('7');
    expect(screen.getByRole('timer').textContent).toBe('Final minute0:07');
  });

  it('is not shown outside arenas', () => {
    useUi.setState({ room: { ...ARENA, id: 'practice-rookie-1', mode: 'practice', arenaId: undefined, round: undefined } });
    clockAt(START + 1000);
    renderChip();
    expect(screen.queryByRole('timer')).toBeNull();
  });
});

describe('no cash-out in arenas', () => {
  it('the HUD dock, the phone controls and the C key have no cash-out', () => {
    useUi.setState({ screen: 'playing', room: ARENA, ticket: { entryFee: 1000 * M, arenaId: 1, session: 'S' }, hud: { mass: 20, cells: 1, value: 1000 * M, rank: 2, players: 4 } });
    clockAt(START + 1000);
    render(
      <Kb>
        <GameHud />
        <MobileControls />
      </Kb>,
    );
    expect(screen.getByRole('timer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cash/i })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/cash/i);
    // phones get the chat button in every room now
    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy();

    const actions = { split: vi.fn(), eject: vi.fn(), emote: vi.fn(), openChat: vi.fn(), escape: vi.fn(), spectateNext: vi.fn() };
    const input = new Input(document.createElement('div'), actions, () => {}, () => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c' }));
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
    input.destroy();
  });
});

describe('Round over sheet', () => {
  const standings = [
    { name: 'Nakamoto', value: 9100 * M },
    { name: 'Penny', value: 5200 * M },
    { name: 'Daphne', value: 3000 * M, you: true },
    { name: 'Rocky', value: 2100 * M },
    { name: 'Lulu', value: 1500 * M },
    { name: 'Sixth', value: 900 * M },
  ];

  it('prints till, fee and paid; my place and the top 5; then the PAID transaction', () => {
    setReducedMotion(true);
    clockAt(R.endsAt + 500);
    useUi.setState({
      screen: 'roundover',
      room: ARENA,
      ticket: { entryFee: 1000 * M, arenaId: 1, session: 'SessMine' },
      roundResult: { kind: 'round', round: N, payout: 3000 * M, stats: STATS, standings },
      lastSettlement: null,
    });
    render(
      <Kb>
        <RoundOverSheet />
      </Kb>,
    );
    expect(screen.getByRole('dialog', { name: 'Round over' })).toBeTruthy();
    // the round is named by its start time, not by its index since 1970
    expect(screen.getByText(`SLANA · ${roundStartLabel(N, R)} ROUND`)).toBeTruthy();
    expect(roundStartLabel(N, R)).toMatch(/^\d\d:\d\d$/);
    expect(document.body.textContent).not.toContain(String(N));
    expect(screen.getByText('Your till')).toBeTruthy();
    expect(screen.getByText('3,000')).toBeTruthy();
    expect(screen.getByText('Fee 5%')).toBeTruthy();
    expect(screen.getByText('≈ −100')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(document.querySelector('.g-receipt__net')?.textContent).toBe('≈ 2,900$SLANA');
    expect(screen.getByRole('status').textContent).toContain('Settling on Solana');
    // my place and the room's top 5 at the bell
    expect(screen.getByText('Your place').nextElementSibling?.textContent).toBe('3rd');
    const top = screen.getByRole('region', { name: 'Top 5 at the bell' });
    const rows = [...top.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['01Nakamoto9.1K', '02Penny5.2K', '03DaphneYou3K', '04Rocky2.1K', '05Lulu1.5K']);
    expect(top.querySelector('.is-me')?.textContent).toContain('Daphne');
    expect(screen.getByRole('button', { name: /Next round/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lobby/ })).toBeTruthy();

    act(() => useUi.setState({ lastSettlement: { session: 'SessMine', arenaId: 1, signature: '5igSig'.padEnd(88, 'x'), payout: 3000 * M, fee: 100 * M, net: 2900 * M, at: Date.now() } }));
    expect(screen.getByText('−100')).toBeTruthy();
    expect(screen.getByRole('link', { name: /View transaction/ })).toBeTruthy();
  });

  it('outside the top 10 says so; the sheet waits for the bell without reduced motion', async () => {
    clockAt(R.endsAt + 500);
    useUi.setState({
      screen: 'roundover',
      room: ARENA,
      ticket: { entryFee: 1000 * M, arenaId: 1, session: 'S2' },
      roundResult: { kind: 'round', round: N, payout: 400 * M, stats: STATS, standings: standings.map((s) => ({ name: s.name, value: s.value })) },
    });
    render(
      <Kb>
        <RoundOverSheet />
      </Kb>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByRole('dialog', { name: 'Round over' }, { timeout: 2000 });
    expect(screen.getByText('Your place').nextElementSibling?.textContent).toBe('Outside the top 6');
    // a loss: no fee (the rate shown is the program default while the server's is unknown)
    expect(screen.getByText('Fee 5%')).toBeTruthy();
  });

  it("estimates the fee at the server's live rate (feeBps)", () => {
    setReducedMotion(true);
    clockAt(R.endsAt + 500);
    useChainData.setState({ config: { feeBps: 700 } as never });
    useUi.setState({ chain: { ...CHAIN, feeBps: 300 } });
    useUi.setState({
      screen: 'roundover',
      room: ARENA,
      ticket: { entryFee: 1000 * M, arenaId: 1, session: 'S3' },
      roundResult: { kind: 'round', round: N, payout: 3000 * M, stats: STATS, standings: [] },
    });
    render(
      <Kb>
        <RoundOverSheet />
      </Kb>,
    );
    expect(screen.getByText('Fee 3%')).toBeTruthy();
    expect(screen.getByText('≈ −60')).toBeTruthy();
    useChainData.setState({ config: null });
  });
});

describe('death sheet in an arena', () => {
  const eaten = () => {
    setReducedMotion(true);
    useUi.setState({ screen: 'dead', room: ARENA, ticket: { entryFee: 1000 * M, arenaId: 1, session: 'S' }, death: { stats: { ...STATS, valueLost: 10 * M }, killer: 'Nakamoto', killerSkin: 1 } });
    render(
      <Kb>
        <DeathSheet />
      </Kb>,
    );
  };

  it('"Buy back in" with the fee while joins are open', () => {
    clockAt(START + 30_000);
    eaten();
    expect(screen.getByRole('button', { name: /^Buy back in · 1K \$SLANA/ })).toBeTruthy();
    expect(screen.queryByText(/Next round in/)).toBeNull();
  });

  it('"Next round in m:ss" in the final minute', () => {
    clockAt(R.endsAt - 42_000);
    eaten();
    expect(screen.getByRole('button', { name: /^Next round in 0:42/ })).toBeTruthy();
    expect(screen.queryByText(/Buy back in/)).toBeNull();
  });
});

describe('lobby tickets and the held ticket', () => {
  const practice: TicketModel = { key: 'practice', arenaId: null, entryFee: 0n, humans: 0, bots: 0, loot: 0, open: true };
  const penny: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * 1_000_000n, humans: 3, bots: 10, loot: 0, open: true };
  const list = () =>
    render(
      <Kb>
        <TicketList tickets={[practice, penny]} gates={{ practice: { kind: 'practice' }, 'arena:1': { kind: 'buy' } }} openTickets={[]} value="practice" onChange={() => {}} onActivate={() => {}} />
      </Kb>,
    );

  it('arena rows say when the round ends', () => {
    clockAt(START + 108_000);
    list();
    expect(screen.getByText('Round ends in 3:12')).toBeTruthy();
    expect(screen.getAllByText(/Round ends in|Joins closed/)).toHaveLength(1); // not on practice
  });

  it('in the final minute: joins closed and when the next round opens', () => {
    clockAt(R.endsAt - 42_000);
    list();
    const line = screen.getByText('Joins closed · next round in 0:42');
    expect(line.className).toContain('is-closed');
  });

  it('a held ticket is flagged on its row, in a banner and on the button', () => {
    clockAt(R.endsAt - 41_000);
    useUi.setState({ held: { arenaId: 1, opensAt: R.endsAt } });
    list();
    expect(screen.getByText('Ticket held')).toBeTruthy();
    render(
      <Kb>
        <HeldBanner />
        <QuickPlay ticket={penny} gate={{ kind: 'resume' } as TicketGate} onPress={() => {}} />
      </Kb>,
    );
    expect(screen.getByText('Ticket held — next round in 0:41')).toBeTruthy();
    const cta = screen.getByRole('button', { name: /^Ticket held/ });
    expect(cta.textContent).toContain('Next round in 0:41');
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });

  it('a held ticket joins by itself when the round opens, within the jitter after the bell', () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(R.endsAt - 41_000);
    const join = vi.fn(() => true);
    let free = true;
    const released = vi.fn();
    const held = new HeldTicket({ join, free: () => free, released });
    held.hold('arena:1', R.endsAt);
    expect(useUi.getState().held).toEqual({ arenaId: 1, opensAt: R.endsAt });
    vi.advanceTimersByTime(40_999);
    expect(join).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1 + HELD_JITTER_MS);
    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith('arena:1');
    expect(held.inFlight).toBe(true);
    // refused for another reason: let go
    held.refused();
    expect(useUi.getState().held).toBeNull();

    // cleared before the opening: no join
    held.hold('arena:1', Date.now() + 5_000);
    held.clear();
    vi.advanceTimersByTime(10_000);
    // busy in a game at the opening: no join, released with a reason
    held.hold('arena:1', Date.now() + 5_000);
    free = false;
    vi.advanceTimersByTime(10_000);
    expect(join).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledWith('busy');
    expect(useUi.getState().held).toBeNull();
  });

  it('spreads held tickets over the jitter window', () => {
    const waits: number[] = [];
    for (const random of [0, 0.5, 0.999]) {
      const h = new HeldTicket(
        { join: () => true, free: () => true, released: () => {} },
        { toLocal: (ms) => ms, now: () => 1_000, random: () => random, setTimeout: (_fn, ms) => waits.push(ms), clearTimeout: () => {} },
      );
      h.hold('arena:2', 11_000);
    }
    expect(HELD_JITTER_MS).toBe(1500);
    expect(waits[0]).toBe(10_000);
    expect(waits[1]).toBe(10_750);
    expect(waits[2]).toBeGreaterThan(11_490);
    expect(waits[2]).toBeLessThan(11_500);
  });
});

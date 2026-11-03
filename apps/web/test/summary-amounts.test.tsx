import { RULES, formatToken, type DeathStats, type RoomInfo, type RoundInfo } from '@elymum/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chip, Kb } from '../src/design';
import { serverClock } from '../src/game/clock';
import { useUi } from '../src/store';
import { setReducedMotion } from '../src/test/media';
import { exactAmount, summaryAmount } from '../src/ui/amount';
import { RoundOverSheet } from '../src/ui/game';
import { compactCount, tokenFormat } from '../src/ui/game/format';
import { chainStatus } from './evm-helpers';

// jsdom has no canvas: the same null it returns, without the "not implemented" warning
HTMLCanvasElement.prototype.getContext = (() => null) as never;

// The UI audit's stress amounts (scripts/ui-audit.mjs): summaries must never print them in full.
const WHALE_18 = 999_999_999_999_123_456_000_000_000_000n; // 999,999,999,999.123456 tokens, 18 decimals
const BIG_18 = 1_109_986_257_991_550_000_000_000n; // 1,109,986.25799155 tokens
const TINY_18 = 1_000_000_000_000n; // 0.000001 tokens
const M = 1_000_000; // one whole token in ledger units (6 decimals)

/** At most `max` decimals in every number of `text`. */
const maxDecimals = (text: string) => Math.max(0, ...[...text.matchAll(/\d[\d,]*\.(\d+)/g)].map((m) => m[1].length));
/** The longest run of digits and group commas (a whole part that would stretch a column). */
const longestNumber = (text: string) => Math.max(0, ...[...text.matchAll(/[\d,]+/g)].map((m) => m[0].length));

describe('summary amounts', () => {
  it('cap the decimals at two and switch to K / M / B / T once the whole part gets long', () => {
    expect(summaryAmount(BIG_18, 18)).toBe('1,109,986.26');
    expect(summaryAmount(WHALE_18, 18)).toBe('1T');
    expect(summaryAmount(TINY_18, 18)).toBe('0');
    expect(summaryAmount(0n, 18)).toBe('0');
    expect(summaryAmount(1_234_567_890n * 10n ** 18n, 18)).toBe('1.23B');
    // the exact value stays available for a title / the confirm step
    expect(exactAmount(BIG_18, 18)).toBe('1,109,986.25799155');
    expect(exactAmount(TINY_18, 18)).toBe('0.000001');
  });

  it('the game format compacts from a billion tokens unless a caller asks for the full number', () => {
    const tf = tokenFormat(6, '$ELYMUM');
    expect(tf.fmt(999_999_999_999_123_456)).toBe('1T');
    expect(tf.fmt(1_109_986_257_991)).toBe('1,109,986.26');
    expect(tf.fmt(999_999_999_999_123_456, { compact: false })).toBe('999,999,999,999.12');
    expect(tf.signed(-2_500_000_000_000_000)).toBe('−2.5B');
  });

  it('masses for tight columns: grouped up to 9,999, then one decimal and a suffix', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(9_999)).toBe('9,999');
    expect(compactCount(10_000)).toBe('10K');
    expect(compactCount(99_999)).toBe('99.9K');
    expect(compactCount(250_400)).toBe('250K');
    expect(compactCount(1_250_000)).toBe('1.2M');
    expect(compactCount(99.7)).toBe('99');
  });

  it('formatToken knows trillions', () => {
    expect(formatToken(WHALE_18, 18, { compact: true })).toBe('1T');
  });
});

describe('a chip with a long label', () => {
  it('keeps the full text in its tooltip (the label may end in an ellipsis)', () => {
    render(<Chip onClick={() => {}}>Friday Night Mega Whale Pond of Champions · ABCDE</Chip>);
    expect(screen.getByRole('button').getAttribute('title')).toBe('Friday Night Mega Whale Pond of Champions · ABCDE');
  });
});

describe('the round-over receipt with whale amounts', () => {
  const N = 5_800_000;
  const R: RoundInfo = { n: N, endsAt: (N + 1) * RULES.roundMs, joinsCloseAt: (N + 1) * RULES.roundMs - RULES.roundJoinCloseMs };
  const ARENA: RoomInfo = { id: 'arena-1-1', mode: 'arena', name: 'Asphodel Meadow', width: 6400, height: 6400, players: 3, bots: 10, maxPlayers: 50, arenaId: 1, entryFee: 1000 * M, round: R };
  const STATS: DeathStats = { aliveMs: 94_000, finalMass: 0, maxMass: 99_999, foodEaten: 88, cellsEaten: 1, playersEaten: 1, bestRank: 1 };
  const initial = useUi.getState();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(R.endsAt + 500);
    serverClock.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => useUi.setState(initial, true));
  });

  it('prints every amount with at most two decimals and no 13-digit whole part', () => {
    setReducedMotion(true);
    const whale = 999_999_999_999_123_456;
    useUi.setState({
      chain: chainStatus({ feeBps: null }),
      rooms: [ARENA],
      screen: 'roundover',
      room: ARENA,
      ticket: { entryFee: 1000 * M, arenaId: 1, session: 'SessW' },
      roundResult: {
        kind: 'round',
        round: N,
        payout: whale,
        stats: STATS,
        standings: [
          { name: 'WWWWWWWWWWWWWWWW', value: whale, you: true },
          { name: 'MMMMMMMMMMMMMMMM', value: whale - 1e15, isBot: true },
        ],
      },
      lastSettlement: { session: 'SessW', arenaId: 1, txHash: `0x${'5b'.repeat(32)}`, payout: whale, fee: 50 * M, net: whale, feeOnEntry: true, at: Date.now() },
    });
    render(
      <Kb>
        <RoundOverSheet />
      </Kb>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Round over' });
    const amounts = [...sheet.querySelectorAll('.kb-receipt__line dd, .g-board__value')].map((el) => el.textContent ?? '');
    expect(amounts.length).toBeGreaterThan(3);
    for (const a of amounts) {
      expect(maxDecimals(a)).toBeLessThanOrEqual(2);
      expect(longestNumber(a)).toBeLessThanOrEqual(13);
    }
    expect(document.querySelector('.g-receipt__net')?.textContent).toBe('1T$ELYMUM');
    // long names keep their full text in a tooltip
    expect(sheet.querySelector('.g-board__nm[title="MMMMMMMMMMMMMMMM"]')).toBeTruthy();
  });
});

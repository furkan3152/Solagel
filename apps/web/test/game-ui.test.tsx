import { EMOTES, type DeathStats, type RoomInfo } from '@elymum/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chainStatus } from './evm-helpers';
import { Kb } from '../src/design';
import { useUi } from '../src/store';
import { setReducedMotion } from '../src/test/media';
import { DeathSheet, receiptNumbers, settlementFor, stickerSvg } from '../src/ui/game';
import { roomName, tokenFormat } from '../src/ui/game/format';

const M = 1_000_000; // one whole token in ledger units (6 decimals)
const ARENA: RoomInfo = { id: 'arena-1-1', mode: 'arena', name: 'Asphodel Meadow', width: 6400, height: 6400, players: 3, bots: 10, maxPlayers: 50, arenaId: 1, entryFee: 1000 * M };
const STATS: DeathStats = { aliveMs: 94_000, finalMass: 0, maxMass: 640, foodEaten: 88, cellsEaten: 1, playersEaten: 1, bestRank: 5 };
const initial = useUi.getState();

beforeEach(() => {
  useUi.setState({ chain: chainStatus() });
});
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

describe('round receipt numbers', () => {
  it('estimates the fee on profit only at the ticket\'s rate until the settlement arrives', () => {
    expect(receiptNumbers(3000 * M, 1000 * M, 500, null)).toEqual({ gain: 2000 * M, fee: 100 * M, net: 2900 * M, pct: 5, final: false });
    expect(receiptNumbers(3000 * M, 1000 * M, 200, null)).toMatchObject({ fee: 40 * M, net: 2960 * M, pct: 2 });
    // a loss pays no fee
    expect(receiptNumbers(400 * M, 1000 * M, 500, null)).toMatchObject({ gain: -600 * M, fee: 0, net: 400 * M });
    // the settlement's own numbers win, and the fee % label follows the real fee
    expect(receiptNumbers(3000 * M, 1000 * M, 500, { fee: 99 * M, net: 2901 * M })).toMatchObject({ fee: 99 * M, net: 2901 * M, final: true, pct: 5 });
    expect(receiptNumbers(3000 * M, 1000 * M, 500, { fee: 30 * M, net: 2970 * M })).toMatchObject({ pct: 1.5 });
  });

  it('adopts only the settlement of the ticket that was paid (by session address)', () => {
    const s = (session: string | null) => ({ session, arenaId: 1, txHash: '0x', payout: 1, at: 0 });
    expect(settlementFor(s('SessA'), 'SessA')).toEqual(s('SessA'));
    expect(settlementFor(s('SessB'), 'SessA')).toBeNull();
    expect(settlementFor(s(null), 'SessA')).toBeNull();
    expect(settlementFor(s('SessA'), null)).toBeNull();
    expect(settlementFor(null, 'SessA')).toBeNull();
  });
});

describe('format helpers', () => {
  it('signs token deltas with a real minus and no sign on zero', () => {
    const tf = tokenFormat(6, '$ELYMUM');
    expect(tf.signed(1250 * M)).toBe('+1,250');
    expect(tf.signed(-1250 * M)).toBe('−1,250');
    expect(tf.fmt(1500 * M, { compact: true })).toBe('1.5K');
    expect(tf.signed(-1)).toBe('0');
  });

  it('names arenas and practice rooms', () => {
    expect(roomName(ARENA)).toBe('Asphodel Meadow');
    expect(roomName({ ...ARENA, arenaId: 4, instance: 2 })).toBe('Isles of the Blessed · 2');
    expect(roomName({ ...ARENA, id: 'practice-rookie-2', mode: 'practice', league: 'rookie', arenaId: undefined })).toBe('Rookie Pond #2');
    expect(roomName({ ...ARENA, id: 'practice-pro-1', mode: 'practice', league: 'pro', arenaId: undefined })).toBe('Pro Pond #1');
  });
});

describe('emote stickers', () => {
  it('draws every system emote as an SVG without text or emoji', () => {
    for (const e of EMOTES) {
      const svg = stickerSvg(e.id);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/<text|\p{Extended_Pictographic}/u);
    }
  });
});

describe('death sheet', () => {
  it('stamps EATEN, names the bot line and shows the value lost', async () => {
    useUi.setState({
      screen: 'dead',
      room: ARENA,
      death: { stats: { ...STATS, valueLost: 1450 * M, byBot: true, lootSpilled: 1450 * M }, killer: 'Bot Rocky', killerSkin: 6 },
    });
    render(
      <Kb>
        <DeathSheet />
      </Kb>,
    );
    // the sheet waits out the death slow motion
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Eaten' })).toBeTruthy();
    expect(screen.getByText('Bot · your tokens spilled across the map')).toBeTruthy();
    expect(screen.getByText('−1,450')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Buy back in/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Practice/ })).toBeTruthy();
  });

  it('names the player who ate us (reduced motion: no slow-motion wait)', () => {
    setReducedMotion(true);
    useUi.setState({ screen: 'dead', room: ARENA, death: { stats: { ...STATS, valueLost: 10 * M }, killer: 'Nakamoto', killerSkin: 1 } });
    render(
      <Kb>
        <DeathSheet />
      </Kb>,
    );
    expect(screen.getByText('Nakamoto ate you')).toBeTruthy();
  });
});

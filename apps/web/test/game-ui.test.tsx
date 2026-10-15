import { EMOTES, type DeathStats, type RoomInfo } from '@slana/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import { useUi } from '../src/store';
import { CashoutSheet, DeathSheet, receiptNumbers, settlementFor, stickerSvg } from '../src/ui/game';
import { roomName, tokenFormat } from '../src/ui/game/format';

const M = 1_000_000; // one whole token (6 decimals)
const ARENA: RoomInfo = { id: 'arena-1-1', mode: 'arena', name: 'Penny Pond', width: 6400, height: 6400, players: 3, bots: 10, maxPlayers: 50, arenaId: 1, entryFee: 1000 * M };
const STATS: DeathStats = { aliveMs: 94_000, finalMass: 0, maxMass: 640, foodEaten: 88, cellsEaten: 1, playersEaten: 1, bestRank: 5 };
const initial = useUi.getState();

beforeEach(() => {
  useUi.setState({ settings: { ...initial.settings, lang: 'tr' }, chain: { enabled: true, cluster: 'devnet', programId: null, rpcUrl: null, arenasEnabled: true, currentSeason: 1, token: { mint: 'M', symbol: '$SLANA', decimals: 6 }, pass: null } });
});
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

describe('cash-out receipt numbers', () => {
  it('estimates the fee on profit only (5 %, 2 % with a Pass) until the settlement arrives', () => {
    expect(receiptNumbers(3000 * M, 1000 * M, false, null)).toEqual({ gain: 2000 * M, fee: 100 * M, net: 2900 * M, pct: 5, final: false });
    expect(receiptNumbers(3000 * M, 1000 * M, true, null)).toMatchObject({ fee: 40 * M, net: 2960 * M, pct: 2 });
    // a loss pays no fee
    expect(receiptNumbers(400 * M, 1000 * M, false, null)).toMatchObject({ gain: -600 * M, fee: 0, net: 400 * M });
    // the settlement's own numbers win, and the fee % label follows the real fee
    expect(receiptNumbers(3000 * M, 1000 * M, false, { fee: 99 * M, net: 2901 * M })).toMatchObject({ fee: 99 * M, net: 2901 * M, final: true, pct: 5 });
    expect(receiptNumbers(3000 * M, 1000 * M, false, { fee: 30 * M, net: 2970 * M })).toMatchObject({ pct: 1.5 });
  });

  it('adopts only the settlement of the ticket that was cashed out (by session address)', () => {
    const s = (session: string | null) => ({ session, arenaId: 1, signature: 'x', payout: 1, at: 0 });
    expect(settlementFor(s('SessA'), 'SessA')).toEqual(s('SessA'));
    expect(settlementFor(s('SessB'), 'SessA')).toBeNull();
    expect(settlementFor(s(null), 'SessA')).toBeNull();
    expect(settlementFor(s('SessA'), null)).toBeNull();
    expect(settlementFor(null, 'SessA')).toBeNull();
  });
});

describe('format helpers', () => {
  it('signs token deltas with a real minus and no sign on zero', () => {
    const tf = tokenFormat('tr', 6, '$SLANA');
    expect(tf.signed(1250 * M)).toBe('+1.250');
    expect(tf.signed(-1250 * M)).toBe('−1.250');
    expect(tf.signed(-1)).toBe('0');
  });

  it('names rooms in the player language', () => {
    expect(roomName(ARENA, 'tr')).toBe('Penny Pond');
    expect(roomName({ ...ARENA, id: 'practice-rookie-2', mode: 'practice', league: 'rookie', arenaId: undefined }, 'tr')).toBe('Çaylak Gölü #2');
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
  it('stamps YENİLDİN, names the bot line and shows the value lost', () => {
    useUi.setState({
      screen: 'dead',
      room: ARENA,
      death: { stats: { ...STATS, valueLost: 1450 * M, byBot: true, lootSpilled: 1450 * M }, killer: 'Bot Kaya', killerSkin: 6 },
    });
    render(
      <Kb>
        <DeathSheet />
      </Kb>,
    );
    expect(screen.getByRole('dialog', { name: 'Yenildin' })).toBeTruthy();
    expect(screen.getByText('Bot · tokenlerin haritaya saçıldı')).toBeTruthy();
    expect(screen.getByText('−1.450')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yeni bilet/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Antrenman/ })).toBeTruthy();
  });

  it('names the player who ate us', () => {
    useUi.setState({ screen: 'dead', room: ARENA, death: { stats: { ...STATS, valueLost: 10 * M }, killer: 'Nakamoto', killerSkin: 1 } });
    render(
      <Kb>
        <DeathSheet />
      </Kb>,
    );
    expect(screen.getByText('Nakamoto seni yedi')).toBeTruthy();
  });
});

describe('cash-out sheet', () => {
  it('prints entry, gain, fee and net, settling until `settled` arrives, then links the transaction', () => {
    useUi.setState({
      screen: 'cashedout',
      room: ARENA,
      ticket: { entryFee: 1000 * M, hasPass: false, arenaId: 1, session: 'SessMine' },
      cashoutResult: { value: 3000 * M, stats: STATS },
      lastSettlement: null,
    });
    render(
      <Kb>
        <CashoutSheet />
      </Kb>,
    );
    expect(screen.getByText('Giriş bedeli')).toBeTruthy();
    expect(screen.getByText('+2.000')).toBeTruthy();
    expect(screen.getByText('Kesinti %5')).toBeTruthy();
    expect(screen.getByText('≈ −100')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain("Solana'da ödeniyor");
    expect(screen.queryByRole('link')).toBeNull();

    // a settlement of another ticket (another arena / an earlier session) is ignored
    act(() => useUi.setState({ lastSettlement: { session: 'SessOther', arenaId: 2, signature: 'otherSig'.padEnd(88, 'y'), payout: 50 * M, fee: 0, net: 50 * M, at: Date.now() } }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain("Solana'da ödeniyor");

    act(() => useUi.setState({ lastSettlement: { session: 'SessMine', arenaId: 1, signature: '5igSig'.padEnd(88, 'x'), payout: 3000 * M, fee: 100 * M, net: 2900 * M, at: Date.now() } }));
    expect(screen.getByText('−100')).toBeTruthy();
    expect(screen.getByRole('link', { name: /İşlemi gör/ })).toBeTruthy();
    expect(screen.queryByText("Solana'da ödeniyor")).toBeNull();
  });
});

import type { StandingRow } from '@elymum/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import type { GameEngine } from '../src/game/engine';
import { setEngine } from '../src/game/instance';
import { useUi } from '../src/store';
import { GameHud, StandingsSheet } from '../src/ui/game';
import { MAP_SIZE, hudClass } from '../src/ui/game/GameHud';
import { rowsFromLb } from '../src/ui/game/StandingsSheet';

const initial = useUi.getState();
afterEach(() => {
  act(() => useUi.setState(initial, true));
  setEngine(null);
});

const ROOM = { id: 'practice-rookie-1', mode: 'practice' as const, name: 'Rookie Pond #1', width: 6000, height: 6000, players: 3, bots: 2, maxPlayers: 30 };
const ROWS: StandingRow[] = [
  { pid: 5, name: 'Rocky', skin: 2, score: 812, isBot: true },
  { pid: 9, name: 'Penny', skin: 3, score: 400, holder: true, verified: true, avatar: '0123456789abcdef' },
  { pid: 7, name: 'Daphne', skin: 4, score: 120 },
  { pid: 8, name: 'Lulu', skin: 1, score: 40, isBot: true },
];

describe('size classes', () => {
  it('touch vs mouse comes from the pointer; narrow is a portrait phone, short a landscape one', () => {
    expect(hudClass(true, true, false)).toBe('phone');
    expect(hudClass(true, false, true)).toBe('phone-land');
    expect(hudClass(true, false, false)).toBe('tablet');
    expect(hudClass(false, false, false)).toBe('desktop');
    expect(hudClass(false, true, false)).toBe('desktop-small');
    // the minimap is smaller on phones
    expect(MAP_SIZE.phone).toBeLessThan(MAP_SIZE.tablet);
    expect(MAP_SIZE['phone-land']).toBeLessThan(MAP_SIZE.desktop);
  });
});

describe('everyone in the room', () => {
  it('the leaderboard card opens the sheet', () => {
    act(() =>
      useUi.setState({
        screen: 'playing',
        room: ROOM,
        me: { pid: 7, name: 'Daphne', skin: 4 },
        lb: [{ pid: 5, name: 'Rocky', skin: 2, score: 812, isBot: true }],
        hud: { mass: 120, cells: 1, value: null, rank: 3, players: 4 },
      }),
    );
    render(
      <Kb>
        <GameHud />
      </Kb>,
    );
    fireEvent.click(screen.getByTestId('standings-open'));
    expect(useUi.getState().modal).toBe('standings');
  });

  it('lists every coin with rank, mass, BOT tag, laurel and picture; my row is marked; it asks the server while open', () => {
    const watchStandings = vi.fn();
    setEngine({ watchStandings } as unknown as GameEngine);
    act(() =>
      useUi.setState({
        screen: 'playing',
        room: ROOM,
        me: { pid: 7, name: 'Daphne', skin: 4 },
        modal: 'standings',
        standings: { rows: ROWS, players: 4, watching: 2, at: Date.now() },
      }),
    );
    const { unmount } = render(
      <Kb>
        <StandingsSheet />
      </Kb>,
    );
    expect(watchStandings).toHaveBeenCalledWith(true);
    const rows = screen.getAllByTestId('standings-row');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('1');
    expect(within(rows[0]).getByText('Rocky')).toBeTruthy();
    expect(within(rows[0]).getByText('BOT')).toBeTruthy();
    expect(rows[0].textContent).toContain('812');
    // holder: laurel and picture
    expect(within(rows[1]).getByText('Emblem holder')).toBeTruthy();
    expect(rows[1].querySelector('img')?.getAttribute('src')).toBe('/api/avatar/0123456789abcdef');
    // me
    expect(rows[2].getAttribute('aria-current')).toBe('true');
    expect(rows[2].textContent).toContain('Daphne (you)');
    expect(screen.getByTestId('standings-sheet').textContent).toContain('2 people · 2 bots · 2 watching');
    // Esc closes it, and the server stops sending
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUi.getState().modal).toBeNull();
    unmount();
    expect(watchStandings).toHaveBeenLastCalledWith(false);
  });

  it('until the full list arrives, the leaderboard rows stand in', () => {
    expect(rowsFromLb([{ pid: 1, name: 'A', skin: 0, score: 9, bot: true }])).toEqual([{ pid: 1, name: 'A', skin: 0, score: 9, isBot: true, value: undefined, verified: undefined }]);
  });

  it('closes when the game ends', () => {
    setEngine({ watchStandings: vi.fn() } as unknown as GameEngine);
    act(() => useUi.setState({ screen: 'playing', room: ROOM, modal: 'standings' }));
    render(
      <Kb>
        <StandingsSheet />
      </Kb>,
    );
    act(() => useUi.setState({ screen: 'lobby' }));
    expect(useUi.getState().modal).toBeNull();
  });
});

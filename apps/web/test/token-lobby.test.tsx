import type { ChainStatus, RoomInfo, ServerMessage } from '@elymum/shared';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine without a canvas renderer or a real socket: the test plays the server.
vi.mock('../src/render/renderer', () => ({
  Renderer: class {
    levels = [{ dpr: 1, low: false }];
    autoLow = false;
    resize() {}
    setLevel() {}
    draw() {}
    drawMinimap() {}
    lookFor() {
      return {};
    }
  },
  canvasDpr: () => 1,
}));
const net = vi.hoisted(() => ({ sent: [] as unknown[], handlers: null as null | { onMessage(m: unknown): void } }));
vi.mock('../src/game/net', () => ({
  Net: class {
    rtt = 0;
    constructor(_url: string, handlers: { onMessage(m: unknown): void }) {
      net.handlers = handlers;
    }
    connect() {}
    close() {}
    get open() {
      return true;
    }
    send(msg: unknown) {
      net.sent.push(msg);
    }
    sendBinary() {}
  },
}));

const { GameEngine } = await import('../src/game/engine');
const { setEngine } = await import('../src/game/instance');
const { Kb } = await import('../src/design');
const { useUi } = await import('../src/store');
const { useChainData } = await import('../src/wallet/chain');
const { Lobby } = await import('../src/ui/lobby/Lobby');

// jsdom has no canvas: the same null it returns, without the "not implemented" warning
HTMLCanvasElement.prototype.getContext = (() => null) as never;
// jsdom has no scrolling
Element.prototype.scrollTo = (() => {}) as never;
Element.prototype.scrollIntoView = (() => {}) as never;
const ui0 = useUi.getState();
const chain0 = useChainData.getState();
const recv = (m: Partial<ServerMessage> & { t: string }) => act(() => net.handlers!.onMessage(m));

const PRACTICE: RoomInfo = { id: 'practice-rookie-1', mode: 'practice', name: 'Practice', width: 4000, height: 4000, players: 2, bots: 18, maxPlayers: 40 };
const ARENAS: RoomInfo[] = [1, 2, 3, 4].map((id) => ({
  id: `arena-${id}-1`,
  mode: 'arena',
  name: `Arena ${id}`,
  width: 6400,
  height: 6400,
  players: 0,
  bots: 10,
  maxPlayers: 50,
  arenaId: id,
  // ledger units on the wire (6 decimals of the 18-decimal token)
  entryFee: [0, 1000, 10_000, 50_000, 250_000][id] * 1_000_000,
}));
/** The server before `set-token`: the chain is on, the game token is not set, practice only. */
const UNSET: ChainStatus = {
  enabled: true,
  chainId: 99801,
  chainName: 'Elysium Testnet',
  rpcUrl: null,
  explorerUrl: null,
  arenaAddress: null,
  nftAddress: null,
  arenasEnabled: false,
  tokenReady: false,
  token: null,
  feeBps: 500,
  serverKey: null,
};
const SET: ChainStatus = { ...UNSET, arenasEnabled: true, tokenReady: true, token: { address: '0x0000000000000000000000000000000000007e57', symbol: '$ELYMUM', decimals: 18 } };

let engine: InstanceType<typeof GameEngine>;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  net.sent = [];
  useUi.setState({ ...ui0, screen: 'lobby', page: 'play' }, true);
  engine = new GameEngine(document.createElement('canvas'));
  setEngine(engine);
  recv({ t: 'welcome', v: 4, serverTime: Date.now(), serverNow: Date.now(), rooms: [PRACTICE], chain: UNSET, online: 2 });
});
afterEach(() => {
  setEngine(null);
  engine.destroy();
  vi.unstubAllGlobals();
  act(() => {
    useUi.setState(ui0, true);
    useChainData.setState(chain0, true);
  });
});

/** No wallet connected (practice needs none). */
const lobby = () =>
  render(
    <Kb>
      <Lobby />
    </Kb>,
  );
/** The big ticket button under the list (Quick Play). */
const cta = () => document.querySelector<HTMLButtonElement>('button.kl-cta')!;
const ticketsGroup = () => screen.getByRole('radiogroup', { name: 'Tickets' });
const arenaTickets = () => within(ticketsGroup()).getAllByRole('radio').filter((el) => el.getAttribute('data-kb-value')?.startsWith('arena:'));
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;

describe('lobby while the game token is not set', () => {
  it('lists the four arenas as "Opening soon", sells none of them, and keeps practice playable', () => {
    lobby();
    const arenas = arenaTickets();
    expect(arenas.map((el) => el.getAttribute('data-kb-value'))).toEqual(['arena:1', 'arena:2', 'arena:3', 'arena:4']);
    for (const el of arenas) {
      expect(el.textContent).toContain('Opening soon');
      expect(disabled(el)).toBe(true);
    }
    // prices still read from the default arenas, in the default symbol
    expect(within(arenas[0]).getByText('1,000')).toBeTruthy();
    expect(within(arenas[0]).getByText('$ELYMUM')).toBeTruthy();
    expect(screen.getByText('Arenas opening soon')).toBeTruthy();
    // practice is selected and plays
    const practice = within(ticketsGroup()).getAllByRole('radio').find((el) => el.getAttribute('data-kb-value') === 'practice')!;
    expect(practice.getAttribute('aria-checked')).toBe('true');
    expect(disabled(practice)).toBe(false);
    expect(cta().textContent).toContain('Start practice');
    expect(cta().disabled).toBe(false);
    act(() => cta().click());
    expect(net.sent).toContainEqual(expect.objectContaining({ t: 'join', room: 'practice' }));
    // nothing anywhere offers to buy a ticket
    expect(screen.queryByRole('button', { name: /Buy ticket/ })).toBeNull();
  });

  it('a `chain` push (the token was set) opens the arenas live, with no reload', () => {
    lobby();
    expect(arenaTickets().every((el) => el.textContent?.includes('Opening soon'))).toBe(true);

    // the server announces the token, then lists the arena rooms (its next `rooms` message)
    recv({ t: 'chain', chain: SET });
    expect(useUi.getState().chain).toEqual(SET);
    expect(screen.queryByText('Opening soon')).toBeNull();
    expect(screen.getByText('Arenas open')).toBeTruthy();
    recv({ t: 'rooms', rooms: [PRACTICE, ...ARENAS], online: 2 });

    const arenas = arenaTickets();
    expect(arenas).toHaveLength(4);
    for (const el of arenas) {
      expect(el.textContent).not.toContain('Opening soon');
      expect(disabled(el)).toBe(false);
      // the fee line uses the server's rate
      expect(el.textContent).toContain('Fee 5% of profit only');
    }
    // an arena can now be picked; without a wallet its button asks to connect (the path to buying)
    act(() => arenas[0].click());
    expect(cta().textContent).toContain('Connect wallet');
    expect(cta().textContent).toContain('Asphodel Meadow · 1,000 $ELYMUM');
    expect(cta().disabled).toBe(false);
  });
});

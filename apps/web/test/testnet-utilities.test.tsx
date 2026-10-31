import type { StatusSnapshot } from '@elymum/sdk/ops';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotsCard, botsPatch } from '../src/admin/GameTab';
import { adminHash, groupSummary, parseAdminHash } from '../src/admin/groups';
import { ImportHoldersCard } from '../src/admin/MintTab';
import { mainnetChecklist } from '../src/admin/NetworkTab';
import { resolveNetwork } from '../src/admin/net';
import type { Plan } from '../src/admin/plan';
import { HoldersOnlyCard } from '../src/admin/SetupExtras';
import type { ChainCtx } from '../src/admin/ui';
import { Kb } from '../src/design';
import { adminApi, type BotAdminView } from '../src/site/api';
import { FaucetPage } from '../src/site/faucet/FaucetPage';
import { faucetTokenAddress, servedConfig, faucetView, formatWait, holderMultiple, watchAssetParams, wholeTokens } from '../src/site/faucet/logic';
import { emblemPerks } from '../src/site/mint/logic';
import { isLazyPage, loadedPage, resetPages, warmPage } from '../src/site/pages';
import { navigate } from '../src/site/router';
import { resetServerChain } from '../src/site/serverChain';
import { navFor } from '../src/site/Shell';
import { Feed } from '../src/ui/game/Feed';
import { useUi } from '../src/store';
import { buildTickets, quickPlayTarget, ticketFeeBps, ticketGate, type TicketModel } from '../src/wallet/ticket';
import { resetWallets } from '../src/wallet/store';
import { ALICE, ONE, chainStatus } from './evm-helpers';
import { installDomStubs, mockFetch } from './site-helpers';

const ARENA = '0x00000000000000000000000000000000000a4e4a';
const ui = (node: ReactElement) => render(<Kb>{node}</Kb>);

let restore: (() => void) | null = null;
beforeEach(() => {
  installDomStubs();
  resetServerChain();
});
afterEach(() => {
  restore?.();
  restore = null;
  act(() => resetWallets());
});

/* ── navigation ───────────────────────────────────────────────────── */

describe('fast navigation', () => {
  it('keeps the header short: Play, Mint, Faucet only on testnet, WL, Docs', () => {
    expect(navFor(true).map((n) => n.label)).toEqual(['Play', 'Mint', 'Faucet', 'WL', 'Docs']);
    expect(navFor(false).map((n) => n.label)).toEqual(['Play', 'Mint', 'WL', 'Docs']);
    expect(navFor(null).map((n) => n.label)).toEqual(['Play', 'Mint', 'WL', 'Docs']);
  });

  it('warms a page once and hands the loaded component back synchronously after that', async () => {
    resetPages();
    expect(isLazyPage('/faucet')).toBe(true);
    expect(isLazyPage('/')).toBe(false);
    expect(loadedPage('/docs')).toBeNull();
    const a = warmPage('/docs');
    const b = warmPage('/docs');
    expect(a).toBe(b);
    const c = await a;
    expect(c).toBeTypeOf('function');
    expect(loadedPage('/docs')).toBe(c);
  });

  it('a click on a page that is not warm waits for its chunk, then turns the page', async () => {
    resetPages();
    history.replaceState(null, '', '/');
    navigate('/wl');
    // the old page stays until the chunk is in (no loader flash)
    expect(location.pathname).toBe('/');
    await waitFor(() => expect(location.pathname).toBe('/wl'), { timeout: 3000 });
    history.replaceState(null, '', '/');
  });
});

/* ── faucet ───────────────────────────────────────────────────────── */

describe('the faucet', () => {
  it('picks what to show from the chain and the token', () => {
    expect(faucetView({ chain: 'loading', token: null })).toBe('loading');
    expect(faucetView({ chain: 'off', token: '0x1' })).toBe('offline');
    expect(faucetView({ chain: 'mainnet', token: '0x1' })).toBe('mainnet');
    expect(faucetView({ chain: 'testnet', token: null })).toBe('no-token');
    expect(faucetView({ chain: 'testnet', token: '0x1', tokenUnreadable: true })).toBe('no-token');
    expect(faucetView({ chain: 'testnet', token: '0x1' })).toBe('ready');
  });

  it('reads the TestToken from the registry first, then the game token', () => {
    const rec = (address: string) => ({ address, txHash: null, chainId: 99801, registeredAt: 1, registeredBy: ALICE });
    expect(faucetTokenAddress({ arena: null, nft: null, token: rec('0xaa') }, '0xbb')).toBe('0xaa');
    expect(faucetTokenAddress({ arena: null, nft: null, token: null }, '0xbb')).toBe('0xbb');
    expect(faucetTokenAddress(null, null)).toBeNull();
  });

  it('formats the countdown, the amounts, the holder bonus and the watchAsset call', () => {
    expect(formatWait(3599)).toBe('59:59');
    expect(formatWait(3661)).toBe('1:01:01');
    expect(formatWait(-5)).toBe('0:00');
    expect(wholeTokens(1_000_000n * ONE, 18)).toBe('1,000,000');
    expect(holderMultiple({ amount: 1_000_000n * ONE, holderAmount: 2_000_000n * ONE, holderNft: '0xnft' })).toBe(2);
    expect(holderMultiple({ amount: 1n, holderAmount: 2n, holderNft: null })).toBeNull();
    expect(watchAssetParams('0xabc', 'tELYMUM', 18)).toEqual({ type: 'ERC20', options: { address: '0xabc', symbol: 'tELYMUM', decimals: 18 } });
    expect(watchAssetParams('0xabc', 'AVERYLONGSYMBOL', 18).options.symbol).toHaveLength(11);
  });

  it("takes the server's faucet settings (GET /api/site/faucet)", () => {
    const f = { enabled: true, chainId: 99801, token: '0x00000000000000000000000000000000000007e5', decimals: 18, amount: (1_000_000n * ONE).toString(), holderAmount: (2_000_000n * ONE).toString(), cooldownSecs: 3600, holderNft: '0x0000000000000000000000000000000000000f7e', hypeFaucetUrl: 'https://x' };
    expect(servedConfig(f, f.token)).toMatchObject({ amount: 1_000_000n * ONE, holderAmount: 2_000_000n * ONE, cooldownSecs: 3600, holderNft: f.holderNft });
    expect(servedConfig({ ...f, enabled: false }, f.token)).toBeNull();
    expect(servedConfig({ ...f, amount: null }, f.token)).toBeNull();
  });

  it('a testnet server whose faucet is off shows the not-plumbed note', async () => {
    ({ restore } = mockFetch({
      'GET /api/config': { chain: chainStatus() },
      'GET /api/site/faucet': { enabled: false, chainId: 99801, token: null, decimals: 18, amount: null, holderAmount: null, cooldownSecs: null, holderNft: null, hypeFaucetUrl: 'https://x' },
    }));
    ui(<FaucetPage />);
    expect(await screen.findByTestId('fc-no-token')).toBeTruthy();
  });

  it('on mainnet the route says the faucet is testnet only', async () => {
    ({ restore } = mockFetch({ 'GET /api/config': { chain: chainStatus({ chainId: 4242, chainName: 'Elysium' }) } }));
    ui(<FaucetPage />);
    expect(await screen.findByText('Faucet is testnet only')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Site' }).textContent).not.toContain('Faucet');
  });

  it('on testnet without a registered TestToken it says the tap is not plumbed in yet', async () => {
    ({ restore } = mockFetch({
      'GET /api/config': { chain: chainStatus({ token: null }) },
      'GET /api/site/contracts': { arena: null, nft: null, token: null },
    }));
    ui(<FaucetPage />);
    expect(await screen.findByTestId('fc-no-token')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Site' }).textContent).toContain('Faucet'));
  });
});

/* ── NFT utilities ────────────────────────────────────────────────── */

describe('what the emblem does', () => {
  it('on testnet: open game, the WL carry-over and the faucet bonus; never mainnet access as live', () => {
    const t = emblemPerks(true);
    expect(t.map((p) => p.id)).toEqual(['access', 'fee', 'isles', 'wl', 'skin', 'faucet']);
    expect(t[0].note).toMatch(/testnet the ring is open to everyone/);
    expect(t[1].title).toBe('3% fee instead of 5%');
  });
  it('on mainnet: no testnet lines', () => {
    expect(emblemPerks(false).map((p) => p.id)).toEqual(['access', 'fee', 'isles', 'skin']);
    expect(emblemPerks(false, { holderBps: 250, feeBps: 500 })[1].title).toBe('2.5% fee instead of 5%');
  });
});

describe('holders-only arenas and the holder fee in the lobby', () => {
  const arenas = [
    { id: 1, entryFee: 1000n * ONE, enabled: true, exists: true },
    { id: 4, entryFee: 250_000n * ONE, enabled: true, exists: true },
  ];
  const gate = (t: TicketModel, holder: boolean | null) =>
    ticketGate({ ticket: t, arenasEnabled: true, walletConnected: true, verified: true, balance: 1_000_000n * ONE, session: null, pending: [], nowS: 0, holder });

  it('marks the arena and refuses to sell it to a wallet without an emblem', () => {
    const tickets = buildTickets([], arenas, [], undefined, [4]);
    const isles = tickets.find((t) => t.arenaId === 4)!;
    expect(isles.holdersOnly).toBe(true);
    expect(tickets.find((t) => t.arenaId === 1)!.holdersOnly).toBeUndefined();
    expect(gate(isles, false)).toEqual({ kind: 'holders' });
    expect(gate(isles, true)).toEqual({ kind: 'buy' });
    // unknown: the contract still checks at join
    expect(gate(isles, null)).toEqual({ kind: 'buy' });
    expect(quickPlayTarget({ walletConnected: true, balance: 1_000_000n * ONE, tickets: [isles], lastArena: 4, holder: false })).toBe('practice');
    expect(quickPlayTarget({ walletConnected: true, balance: 1_000_000n * ONE, tickets: [isles], lastArena: 4, holder: true })).toBe('arena:4');
  });

  it('holders see their discounted fee', () => {
    const cfg = { holderNft: '0xnft', holderFeeBps: 300 };
    expect(ticketFeeBps(500, cfg, true)).toEqual({ bps: 300, discount: true });
    expect(ticketFeeBps(500, cfg, false)).toEqual({ bps: 500, discount: false });
    expect(ticketFeeBps(500, { holderNft: null, holderFeeBps: 300 }, true)).toEqual({ bps: 500, discount: false });
    expect(ticketFeeBps(200, cfg, true)).toEqual({ bps: 200, discount: false });
  });
});

/* ── BOT tags ─────────────────────────────────────────────────────── */

describe('BOT tags', () => {
  it('the kill feed tags bots and says when a bot went home', () => {
    act(() =>
      useUi.setState({
        killfeed: [
          { id: 0, killer: 'marco_88', killerSkin: 1, killerIsBot: true, victim: 'ella', victimSkin: 2, cause: 'eat', at: Date.now() },
          { id: 1, killer: '', killerSkin: 0, victim: 'sophie_m', victimSkin: 3, victimIsBot: true, cause: 'left', at: Date.now() },
        ],
        chat: [],
      }),
    );
    ui(<Feed narrow={false} />);
    const tags = screen.getAllByTestId('bot-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0].textContent).toBe('BOT');
    expect(screen.getByText(/went home/).textContent).toContain('sophie_m');
    act(() => useUi.setState({ killfeed: [] }));
  });
});

/* ── admin ─────────────────────────────────────────────────────────── */

const ctxOf = (over: Partial<ChainCtx> = {}): ChainCtx & { plans: Plan[] } => {
  const plans: Plan[] = [];
  return {
    net: resolveNetwork(chainStatus()),
    status: null,
    refresh: vi.fn(async () => {}),
    reloadNet: vi.fn(async () => {}),
    me: ALICE,
    walletChainId: 99801,
    client: null,
    api: null,
    open: (p: Plan) => plans.push(p),
    plans,
    ...over,
  };
};

describe('admin groups', () => {
  it('maps the old drawers into the groups and back to a hash', () => {
    expect(parseAdminHash('#deploy')).toEqual({ group: 'setup', sub: 'wl' });
    expect(parseAdminHash('#arena').group).toBe('game');
    expect(parseAdminHash('#tasks')).toEqual({ group: 'community', sub: 'tasks' });
    expect(parseAdminHash('#community/collabs')).toEqual({ group: 'community', sub: 'collabs' });
    expect(parseAdminHash('#integrity').group).toBe('safety');
    expect(parseAdminHash('')).toEqual({ group: 'network', sub: 'wl' });
    expect(adminHash('network')).toBe('');
    expect(adminHash('community', 'tasks')).toBe('#community/tasks');
    expect(adminHash('game')).toBe('#game');
  });

  it('opens every drawer with what is true now and the next step', () => {
    const net = resolveNetwork(chainStatus({ nftAddress: null }));
    const status = { block: 12n, arena: { code: 'ok', serverBalance: 0n, config: { token: null, holderNft: null }, arenas: [] }, nft: null } as unknown as StatusSnapshot;
    expect(groupSummary('network', { net, status })).toMatchObject({ next: expect.stringMatching(/Fund the server key/) });
    expect(groupSummary('network', { net, status }).now).toMatch(/Testnet · Elysium Testnet \(99801\) · block 12/);
    expect(groupSummary('setup', { net, status }).next).toMatch(/Deploy ElymumNFT/);
    // registered: the next step is Finish setup, never "register" or "paste an address"
    const both = resolveNetwork(chainStatus({ nftAddress: '0x0000000000000000000000000000000000000f7e' }));
    const registered = {
      ...status,
      arena: { ...status.arena, address: ARENA, config: { admin: ALICE, serverAuthority: '0x000000000000000000000000000000000000bEEF', token: null, feeBps: 500, holderNft: null }, token: null, arenas: [] },
      nft: { address: '0x0000000000000000000000000000000000000f7e', code: 'ok', state: { phaseName: 'closed' } },
      testToken: { address: '0x0000000000000000000000000000000000007e57', serverIsMinter: false, faucet: { holderNft: null } },
    } as unknown as StatusSnapshot;
    expect(groupSummary('setup', { net: both, status: registered }).next).toMatch(/^Finish setup: 10 steps left/);
    const mainnet = resolveNetwork(chainStatus({ chainId: 4242, chainName: 'Elysium', nftAddress: '0x0000000000000000000000000000000000000f7e' }));
    const noTt = { ...registered, testToken: null } as unknown as StatusSnapshot;
    expect(groupSummary('setup', { net: mainnet, status: noTt, registry: { token: { address: '0x0000000000000000000000000000000000007e57' } } as never }).next).toMatch(/Confirm the game token/);
    expect(groupSummary('setup', { net: mainnet, status: noTt }).next).toMatch(/TOKEN_ADDRESS/);
    for (const g of ['setup', 'mint', 'game', 'network'] as const) expect(groupSummary(g, { net: both, status: registered }).next ?? '').not.toMatch(/regist|paste/i);
    expect(groupSummary('network', { net: resolveNetwork(chainStatus({ enabled: false, chainId: null })), status: null }).next).toMatch(/EVM_RPC_URL/);
    expect(groupSummary('game', { net, status, settings: { gameAccess: 'admins' } as never }).next).toMatch(/Testnet: open the game to everyone/);
  });

  it('lists the mainnet launch with the Render step first; nothing is ticked on testnet', () => {
    const steps = mainnetChecklist(resolveNetwork(chainStatus()), null);
    expect(steps[0].label).toMatch(/Set EVM_RPC_URL in Render/);
    expect(steps.filter((s) => s.ok === true)).toHaveLength(0);
    const main = mainnetChecklist(resolveNetwork(chainStatus({ chainId: 4242, chainName: 'Elysium' })), null);
    expect(main[0].ok).toBe(true);
  });

  it('marks an arena holders-only through the transaction preview', () => {
    const status = {
      arena: { config: { admin: ALICE, holderNft: '0x0000000000000000000000000000000000000f7e', decimals: 18 }, arenas: [{ id: 4, exists: true, enabled: true, entryFee: 1n, holdersOnly: false }] },
    } as unknown as StatusSnapshot;
    const ctx = ctxOf({ net: resolveNetwork(chainStatus({ arenaAddress: ARENA })), status });
    ui(<HoldersOnlyCard ctx={ctx} />);
    fireEvent.click(screen.getByTestId('holders-only-4'));
    expect(ctx.plans[0].call).toMatchObject({ functionName: 'setArenaHoldersOnly', args: [4, true] });
    expect(ctx.plans[0].ownerOf?.toLowerCase()).toBe(ARENA);
  });

  it('"Import testnet holders" is disabled with a note while the server has no route', async () => {
    // (mockFetch answers 404 to every route)
    ({ restore } = mockFetch({}));
    ui(<ImportHoldersCard ctx={ctxOf({ api: adminApi('t') })} />);
    expect(await screen.findByTestId('mint-import-missing')).toBeTruthy();
    expect((screen.getByTestId('mint-import') as HTMLButtonElement).disabled).toBe(true);
  });

  it('imports and reports the counts when the route is there', async () => {
    const empty = { entries: [], counts: { wallets: 0, tokens: 0, alsoWl: 0 }, importedAt: null, importedFrom: null };
    let body: unknown = null;
    ({ restore } = mockFetch({
      'GET /api/admin/mint/import-holders': empty,
      'POST /api/admin/mint/import-holders': (c: { body: unknown }) => {
        body = c.body;
        return { entries: [], counts: { wallets: 12, tokens: 15, alsoWl: 3 }, importedAt: Date.UTC(2026, 9, 31, 20, 0), importedFrom: 99801 };
      },
    }));
    ui(<ImportHoldersCard ctx={ctxOf({ api: adminApi('t') })} />);
    await waitFor(() => expect((screen.getByTestId('mint-import') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('mint-import'));
    expect((await screen.findByTestId('mint-import-result')).textContent).toMatch(/^12 wallets \(15 emblems\) · 3 also on the WL · imported .* from chain 99801$/);
    expect(body).toEqual({});
  });

  const BOTS: BotAdminView = {
    settings: {
      kinds: {
        practiceRookie: { enabled: true, cap: 12, min: 2, target: 14, mix: { easy: 60, medium: 30, hard: 10 } },
        arena: { enabled: true, cap: 12, min: 0, target: 10, mix: { easy: 40, medium: 40, hard: 20 } },
      },
      testnet: { stakedPerArena: 6, bankroll: '1000000', gasHype: '0.05', arenas: {} },
    },
    testnet: true,
    stakedActive: false,
    staked: { active: true, chainId: 99801, wallets: 6, playing: 0, problem: 'the server key is not a TestToken minter' },
    live: { rooms: [{ id: 'r1', kind: 'arena', name: 'Asphodel Meadow', arenaId: 1, humans: 2, bots: 9, stakedBots: 0 }], totals: { rooms: 1, humans: 2, bots: 9, stakedBots: 0 } },
  };

  it('sends only what changed in the bot settings', () => {
    const draft = structuredClone(BOTS.settings);
    draft.kinds.arena.cap = 8;
    draft.kinds.arena.mix.hard = 30;
    draft.testnet.arenas['4'] = { stakedBots: 3 };
    expect(botsPatch(BOTS.settings, draft)).toEqual({ kinds: { arena: { cap: 8, mix: { hard: 30 } } }, testnet: { arenas: { '4': { stakedBots: 3 } } } });
    expect(botsPatch(BOTS.settings, structuredClone(BOTS.settings))).toEqual({});
  });

  it('renders the bots from the GET answer and saves a partial PUT', async () => {
    let put: unknown = null;
    ({ restore } = mockFetch({
      'GET /api/admin/bots': BOTS,
      'PUT /api/admin/bots': (c: { body: unknown }) => {
        put = c.body;
        return BOTS;
      },
    }));
    ui(<BotsCard ctx={ctxOf({ api: adminApi('t') })} arenaIds={[1, 4]} />);
    expect(await screen.findByTestId('bots-table')).toBeTruthy();
    expect(screen.getByText('9 bots · 2 people · 1 rooms')).toBeTruthy();
    expect(screen.getByTestId('bots-staked')).toBeTruthy();
    expect(screen.getByTestId('bots-problem').textContent).toMatch(/Grant minter to the server key: Setup → Finish setup/);
    fireEvent.change(screen.getByLabelText('arena cap'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('bots-save'));
    await waitFor(() => expect(put).toEqual({ kinds: { arena: { cap: 5 } } }));
  });
});

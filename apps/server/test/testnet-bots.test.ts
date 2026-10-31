import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BotSettingsStore, defaultBotSettings } from '../src/bots/settings';
import { TestnetBotSource, deriveBotKey, type StakedChainView } from '../src/bots/testnet-source';
import { loadConfig } from '../src/config';
import { Journal } from '../src/stake/journal';
import { ARENA, E18, FakeEvm, SERVER, TOKEN } from './fake-evm';

const SERVER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

function setup(opts: { chainId?: number; minter?: boolean; dir?: string | null; view?: Partial<StakedChainView> } = {}) {
  const evm = new FakeEvm();
  evm.addArena(1, 1000n);
  evm.addArena(4, 250_000n, { holdersOnly: true });
  if (opts.minter !== false) evm.minters.add(SERVER.toLowerCase());
  const settings = new BotSettingsStore(null, defaultBotSettings(loadConfig({}).bots));
  const journal = new Journal(null);
  const logs: string[] = [];
  const view: StakedChainView = { chainId: opts.chainId ?? 31337, stakeEnabled: true, arena: ARENA, token: { address: TOKEN, decimals: 18 }, ...opts.view };
  const dir = opts.dir === undefined ? mkdtempSync(join(tmpdir(), 'elymum-tbots-')) : opts.dir;
  const make = () =>
    new TestnetBotSource({ chain: () => view, client: () => evm, serverKey: SERVER_KEY, settings, journal, stateDir: dir, log: (m) => logs.push(m), receiptTimeoutMs: 1000 });
  return { evm, settings, journal, logs, view, dir, source: make(), make };
}

describe('testnet staked bots: wallets', () => {
  it('derives bot keys deterministically from the server key (keccak(serverKey ‖ "elymum-bot" ‖ i))', () => {
    const a = deriveBotKey(SERVER_KEY, 0)!;
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(deriveBotKey(SERVER_KEY, 0)).toBe(a);
    expect(deriveBotKey(SERVER_KEY, 1)).not.toBe(a);
    expect(deriveBotKey(`0x${'11'.repeat(32)}`, 0)).not.toBe(a);
  });

  it('stores addresses only in chains/<id>/bots.json and re-derives the keys at boot', async () => {
    const t = setup();
    const ticket = await t.source.acquire(1, 'arena-1-1');
    expect(ticket).not.toBeNull();
    const file = readFileSync(join(t.dir!, 'bots.json'), 'utf8');
    expect(file).not.toContain(deriveBotKey(SERVER_KEY, 0)!.slice(2));
    const parsed = JSON.parse(file);
    expect(parsed).toMatchObject({ version: 1, serverKey: SERVER, wallets: [{ index: 0, address: privateKeyToAccount(deriveBotKey(SERVER_KEY, 0)!).address }] });
    const again = t.make();
    expect(again.addresses()).toEqual([ticket!.stake.player]);
  });
});

describe('testnet staked bots: funding and tickets', () => {
  it('funds a bot (HYPE for gas from the server key, tELYMUM minted to the bankroll), approves once, joins: a real ticket', async () => {
    const t = setup();
    expect(t.source.wanted(1)).toBe(6);
    const ticket = (await t.source.acquire(1, 'arena-1-1'))!;
    const bot = ticket.stake.player as Address;
    expect(ticket.stake).toMatchObject({ arenaId: 1, entryFee: 1000 * 1e6, value: 1000 * 1e6, sessionId: 1, session: `1:${bot.toLowerCase()}:1` });
    expect(t.evm.valueSent).toEqual([{ to: bot, wei: 5n * 10n ** 16n }]);
    // bankroll 1,000,000 minted, the 1,000 ticket paid out of it
    expect(t.evm.tokenOf(bot)).toBe(999_000n * E18);
    expect(t.evm.sentBy.map((s) => s.call.functionName)).toEqual(['approve', 'join']);
    expect((await t.evm.session(ARENA, 1, bot)).id).toBe(1n);
    expect(t.source.status()).toMatchObject({ active: true, wallets: 1, playing: 1, problem: null });
  });

  it('a wallet with a live ticket is not reused; a released one is, once its session is closed on chain (no new mint, no new approve)', async () => {
    const t = setup();
    const a = (await t.source.acquire(1, 'r'))!;
    const b = (await t.source.acquire(1, 'r'))!;
    expect(b.stake.player).not.toBe(a.stake.player);
    t.source.released(a, 'round', {} as never);
    // the settlement is not confirmed yet: the session is still open on chain
    const c = (await t.source.acquire(1, 'r'))!;
    expect([a.stake.player, b.stake.player]).not.toContain(c.stake.player);
    t.evm.close(1, a.stake.player);
    const before = t.evm.sent.length;
    const d = (await t.source.acquire(1, 'r'))!;
    expect(d.stake.player).toBe(a.stake.player);
    expect(t.evm.sent.length).toBe(before); // still funded: no mint
    expect(t.evm.sentBy.filter((s) => s.from === a.stake.player).map((s) => s.call.functionName)).toEqual(['approve', 'join', 'join']);
  });

  it('the server key is not a TestToken minter: no ticket, a clear log line, zero staked bots', async () => {
    const t = setup({ minter: false });
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(await t.source.acquire(1, 'r')).toBeNull();
    const lines = t.logs.filter((l) => /not a minter/.test(l));
    expect(lines).toHaveLength(1); // rate-limited
    expect(lines[0]).toMatch(/grant it in \/admin/);
    expect(t.source.status().problem).toMatch(/not a minter/);
    expect(t.evm.sentBy).toHaveLength(0);
  });

  it('the server key is out of HYPE: no ticket and a log line that says so', async () => {
    const t = setup();
    t.evm.balanceWei = 10n ** 15n;
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(t.logs.join('\n')).toMatch(/out of HYPE.*fund it/);
    expect(t.evm.valueSent).toHaveLength(0);
  });

  it('settings apply live: staked bots per arena, per-arena overrides, bankroll and gas', async () => {
    const t = setup();
    t.settings.update({ testnet: { stakedPerArena: 2, gasHype: '0.2', arenas: { '1': { stakedBots: 3, bankroll: '5000' } } } });
    expect(t.source.wanted(1)).toBe(3);
    expect(t.source.wanted(2)).toBe(2);
    const ticket = (await t.source.acquire(1, 'r'))!;
    expect(t.evm.tokenOf(ticket.stake.player)).toBe(4000n * E18);
    expect(t.evm.valueSent[0].wei).toBe(2n * 10n ** 17n);
    t.settings.update({ testnet: { arenas: { '1': { bankroll: '500' } } } });
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(t.logs.join('\n')).toMatch(/bankroll of arena #1 is below its entry fee/);
  });

  it('never joins holders-only arenas without an emblem', async () => {
    const t = setup();
    await t.source.acquire(1, 'r');
    expect(await t.source.acquire(4, 'r')).toBeNull();
    expect(t.source.wanted(4)).toBe(0);
    expect(t.evm.sentBy.filter((s) => s.call.functionName === 'join').map((s) => s.call.args[0])).toEqual([1]);
    // a bot wallet that holds an emblem may go (holder checks are cached 5 min: a fresh boot sees it at once)
    t.evm.arenaHolders.add(t.source.addresses()[0].toLowerCase());
    const ticket = await t.make().acquire(4, 'r');
    expect(ticket?.stake.arenaId).toBe(4);
  });

  it('never plays on mainnet (or with the arenas off)', async () => {
    const main = setup({ chainId: 4242 });
    expect(main.source.wanted(1)).toBe(0);
    expect(main.source.active()).toBe(false);
    expect(await main.source.acquire(1, 'r')).toBeNull();
    const off = setup({ view: { stakeEnabled: false } });
    expect(off.source.wanted(1)).toBe(0);
    expect(await off.source.acquire(1, 'r')).toBeNull();
    expect(main.evm.sentBy.length + off.evm.sentBy.length).toBe(0);
  });

  it('a closed arena or a failing join leaves no ticket (the room asks again later), never a throw', async () => {
    const t = setup();
    t.evm.arenaMap.get(1)!.enabled = false;
    expect(await t.source.acquire(1, 'r')).toBeNull();
    expect(t.evm.sentBy).toHaveLength(0);
    const u = setup();
    u.evm.rpcDown = true;
    await expect(u.source.acquire(1, 'r')).resolves.toBeNull();
    expect(u.logs.join('\n')).toMatch(/ticket for arena #1 failed/);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BinaryWriter, EMBLEM_SKIN_ID, PlayerFlag, decodeSnapshot, writeSnapshot, type ChainStatus } from '@elymum/shared';
import { getAddress } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';
import { chainDir, migrateLegacyState, rememberedChainId, resolveStateChainId, storedChains } from '../src/chain/state-dir';
import type { ServerKeyInfo } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Limiter } from '../src/net/limiter';
import { ADMIN, ARENA, FakeEvm, NFT, SERVER, TOKEN } from './fake-evm';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

const record = (address: string, chainId: number) => ({ address, txHash: null, chainId, registeredAt: 1, registeredBy: ADMIN });

class EvmTestChain extends ArenaChain {
  constructor(readonly fake: FakeEvm) {
    super([arena(1, 1000)]);
  }
  override status(): ChainStatus {
    return { ...super.status(), chainId: this.fake.chainId, serverKey: SERVER };
  }
  override serverInfo(): ServerKeyInfo {
    return { address: SERVER, balanceWei: '5000000000000000000', low: false };
  }
  evm() {
    return this.fake;
  }
  async refresh() {}
}

const apps: App[] = [];
afterAll(async () => {
  for (const a of apps) await a.close();
});

async function start(dir: string, chainId: number, extra: Parameters<typeof createApp>[1] = {}) {
  const evm = new FakeEvm();
  evm.chainId = chainId;
  const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '1', BOT_MIN: '0', BOT_MAX: '1', ADMIN_WALLETS: ADMIN, PUBLIC_URL: 'https://elymum.example' } as NodeJS.ProcessEnv);
  const app = await createApp(cfg, {
    chain: new EvmTestChain(evm),
    log: () => {},
    persist: true,
    siteLimits: { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
    apiLimiter: new Limiter(10_000, 60_000),
    fetchPrice: async () => ({ price: '40', value: 40 }),
    ...extra,
  });
  apps.push(app);
  const port = await app.listen();
  const call = async (method: string, path: string, opts: { wallet?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.wallet) headers.Authorization = `Bearer ${app.auth.issueToken(opts.wallet)}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { app, evm, call };
}

function legacy(dir: string, opts: { contractsChain?: number | null } = {}) {
  if (opts.contractsChain !== null) writeFileSync(join(dir, 'contracts.json'), JSON.stringify({ arena: record(ARENA, opts.contractsChain ?? 99801), nft: record(NFT, opts.contractsChain ?? 99801), token: null }));
  writeFileSync(join(dir, 'journal.json'), JSON.stringify({ version: 1, pending: [], live: [], loot: [] }));
  writeFileSync(join(dir, 'journal.json.corrupt-1700000000000'), '{');
  mkdirSync(join(dir, 'site'), { recursive: true });
  writeFileSync(join(dir, 'site', 'allowlist.json'), '{}');
}

describe('chain-keyed state: migration', () => {
  it('moves the legacy registry, journal (with quarantined copies) and allowlist into chains/<chain of the records>/, idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-state-'));
    legacy(dir);
    const logs: string[] = [];
    // even when this boot is on another chain: the records say where they belong
    expect(migrateLegacyState(dir, 4242, (m) => logs.push(m)).sort()).toEqual(['contracts.json', 'journal.json', 'journal.json.corrupt-1700000000000', 'site/allowlist.json'].sort());
    const c = chainDir(dir, 99801);
    for (const f of ['contracts.json', 'journal.json', 'journal.json.corrupt-1700000000000', 'allowlist.json']) expect(existsSync(join(c, f))).toBe(true);
    for (const f of ['contracts.json', 'journal.json', join('site', 'allowlist.json')]) expect(existsSync(join(dir, f))).toBe(false);
    expect(logs.join('\n')).toMatch(/moved .* into chains\/99801/);
    expect(migrateLegacyState(dir, 4242)).toEqual([]);
    expect(storedChains(dir)).toEqual([99801]);
  });

  it('never overwrites: a legacy file whose target exists stays (logged)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-state-'));
    legacy(dir);
    mkdirSync(chainDir(dir, 99801), { recursive: true });
    writeFileSync(join(chainDir(dir, 99801), 'journal.json'), '"newer"');
    const logs: string[] = [];
    expect(migrateLegacyState(dir, 99801, (m) => logs.push(m))).not.toContain('journal.json');
    expect(readFileSync(join(chainDir(dir, 99801), 'journal.json'), 'utf8')).toBe('"newer"');
    expect(existsSync(join(dir, 'journal.json'))).toBe(true);
    expect(logs.join('\n')).toMatch(/journal\.json was not moved/);
  });

  it('without a registry the files go to the boot chain on a test chain, to the testnet otherwise', () => {
    const local = mkdtempSync(join(tmpdir(), 'elymum-state-'));
    legacy(local, { contractsChain: null });
    migrateLegacyState(local, 31337);
    expect(storedChains(local)).toEqual([31337]);
    const main = mkdtempSync(join(tmpdir(), 'elymum-state-'));
    legacy(main, { contractsChain: null });
    migrateLegacyState(main, 4242);
    expect(storedChains(main)).toEqual([99801]);
  });

  it('keys the state on eth_chainId of the RPC, remembered for a boot with the RPC down', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-state-'));
    const cfg = loadConfig({ DATA_DIR: dir, EVM_RPC_URL: 'https://rpc.example/key123', SERVER_PRIVATE_KEY: 'auto' } as NodeJS.ProcessEnv);
    const logs: string[] = [];
    expect(await resolveStateChainId(cfg, { persist: true, log: (m) => logs.push(m), readId: async () => 99801 })).toBe(99801);
    expect(rememberedChainId(dir, 'https://rpc.example/key123')).toBe(99801);
    expect(readFileSync(join(dir, 'chains', 'rpc-ids.json'), 'utf8')).not.toContain('key123');
    const down = async () => {
      throw new Error('fetch failed');
    };
    expect(await resolveStateChainId(cfg, { persist: true, log: (m) => logs.push(m), readId: down })).toBe(99801);
    const other = loadConfig({ DATA_DIR: dir, EVM_RPC_URL: 'https://other.example', SERVER_PRIVATE_KEY: 'auto' } as NodeJS.ProcessEnv);
    expect(await resolveStateChainId(other, { persist: true, log: (m) => logs.push(m), readId: down })).toBeNull();
    expect(logs.join('\n')).toMatch(/chain id is unknown/);
    expect(await resolveStateChainId(loadConfig({ DATA_DIR: dir } as NodeJS.ProcessEnv), { persist: true, log: () => {} })).toBeNull();
  });
});

describe('chain-keyed state: the app', () => {
  it('testnet: migrates on first start, opens chains/99801, the game is public by default; mainnet then starts clean and keeps the testnet records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-app-'));
    legacy(dir);
    const t = await start(dir, 99801);
    expect(t.app.stateChainId).toBe(99801);
    expect(t.app.contracts.stored().arena?.address).toBe(ARENA);
    expect((await t.call('GET', '/api/site/settings')).body.settings.gameAccess).toBe('public');
    t.app.journal.enqueue({ kind: 'sweep', key: 'sweep:x:1', arenaId: 1, roomId: 'x', round: 1, amount: 5, attempts: 0, nextAttemptAt: Date.now() + 60_000, createdAt: Date.now() });
    expect(existsSync(join(dir, 'chains', '99801', 'journal.json'))).toBe(true);
    const net = (await t.call('GET', '/api/admin/network', { wallet: ADMIN })).body;
    expect(net).toMatchObject({ chainId: 99801, testnet: true, rpcOk: true, block: '1000', serverKey: SERVER, serverBalanceWei: '5000000000000000000', low: false, otherChains: [] });
    expect(typeof net.rpcLatencyMs).toBe('number');
    expect(net.contracts).toEqual([
      { kind: 'arena', address: ARENA, code: 'ok', registeredBy: ADMIN },
      { kind: 'nft', address: NFT, code: 'ok', registeredBy: ADMIN },
    ]);
    expect((await t.call('GET', '/api/admin/network', { wallet: testSigner().address })).status).toBe(403);
    await t.app.close();

    // EVM_RPC_URL now points at mainnet
    const m = await start(dir, 4242);
    expect(m.app.contracts.stored()).toEqual({ arena: null, nft: null, token: null });
    expect(m.app.journal.pending).toHaveLength(0);
    expect((await m.call('GET', '/api/site/settings')).body.settings.gameAccess).toBe('admins');
    const mnet = (await m.call('GET', '/api/admin/network', { wallet: ADMIN })).body;
    expect(mnet).toMatchObject({ chainId: 4242, testnet: false, contracts: [], otherChains: [99801] });
    // the testnet records are still there
    expect(JSON.parse(readFileSync(join(dir, 'chains', '99801', 'journal.json'), 'utf8')).pending).toHaveLength(1);
  });

  it('testnet default never overrides a stored gameAccess', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-app-'));
    mkdirSync(join(dir, 'site'), { recursive: true });
    writeFileSync(join(dir, 'site', 'settings.json'), JSON.stringify({ wlOpen: true, collabOpen: false, gameAccess: 'holders', xHandle: 'elymumio', launchPostUrl: null }));
    const t = await start(dir, 99801);
    expect((await t.call('GET', '/api/site/settings')).body.settings.gameAccess).toBe('holders');
  });
});

describe('faucet config (GET /api/site/faucet)', () => {
  it('enabled on a test chain with a registered TestToken: amounts from the token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-app-'));
    mkdirSync(chainDir(dir, 99801), { recursive: true });
    writeFileSync(join(chainDir(dir, 99801), 'contracts.json'), JSON.stringify({ arena: null, nft: record(NFT, 99801), token: record(TOKEN, 99801) }));
    const t = await start(dir, 99801);
    t.evm.faucet.holderNft = NFT;
    const f = (await t.call('GET', '/api/site/faucet')).body;
    expect(f).toEqual({
      enabled: true,
      chainId: 99801,
      token: TOKEN,
      decimals: 18,
      amount: (1_000_000n * 10n ** 18n).toString(),
      holderAmount: (2_000_000n * 10n ** 18n).toString(),
      cooldownSecs: 3600,
      holderNft: NFT,
      hypeFaucetUrl: 'https://elysium.kinetiq.xyz/testnet-faucet',
    });
  });

  it('off without a token, and on mainnet', async () => {
    const t = await start(mkdtempSync(join(tmpdir(), 'elymum-app-')), 99801);
    expect((await t.call('GET', '/api/site/faucet')).body).toMatchObject({ enabled: false, token: null, amount: null });
    const dir = mkdtempSync(join(tmpdir(), 'elymum-app-'));
    mkdirSync(chainDir(dir, 4242), { recursive: true });
    writeFileSync(join(chainDir(dir, 4242), 'contracts.json'), JSON.stringify({ arena: null, nft: null, token: record(TOKEN, 4242) }));
    const m = await start(dir, 4242);
    expect((await m.call('GET', '/api/site/faucet')).body).toMatchObject({ enabled: false, chainId: 4242, token: TOKEN });
  });
});

describe('testnet emblem holders → mainnet WL', () => {
  it('imports the current owners of the testnet NFT (from its chain registry, over the testnet reader) and adds them to the allowlist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-app-'));
    mkdirSync(chainDir(dir, 99801), { recursive: true });
    writeFileSync(join(chainDir(dir, 99801), 'contracts.json'), JSON.stringify({ arena: null, nft: record(NFT, 99801), token: null }));
    const testnet = new FakeEvm();
    testnet.chainId = 99801;
    const [a, b, c] = [testSigner().address, testSigner().address, testSigner().address];
    testnet.mintNft(a, 2);
    testnet.mintNft(b, 1);
    // b sells its emblem to c
    testnet.block += 1n;
    testnet.transfers.push({ from: getAddress(b), to: getAddress(c), tokenId: 3n, blockNumber: testnet.block });
    testnet.balances.set(b.toLowerCase(), 0n);
    testnet.balances.set(c.toLowerCase(), 1n);
    const t = await start(dir, 4242, { holderReaderFor: (id) => (id === 99801 ? testnet : null) });
    // a is also on the approved WL
    t.app.site.store.submitWl(a, { xHandle: 'alice', answers: { follow_x: true, post_x: 'https://x.com/alice/status/1790000000000000001' } });
    const id = t.app.site.store.listWl({ status: null, q: null, page: 1, pageSize: 10 }).items[0].id;
    t.app.site.store.setWlStatus([id], 'approved');

    expect((await t.call('GET', '/api/admin/mint/import-holders', { wallet: ADMIN })).body).toMatchObject({ entries: [], counts: { wallets: 0 }, importedAt: null });
    expect((await t.call('POST', '/api/admin/mint/import-holders', { wallet: ADMIN, body: { fromChainId: 1234 } })).status).toBe(409);
    const r = await t.call('POST', '/api/admin/mint/import-holders', { wallet: ADMIN, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.counts).toEqual({ wallets: 2, tokens: 3, alsoWl: 1 });
    expect(r.body.importedFrom).toBe(99801);
    const byWallet = Object.fromEntries(r.body.entries.map((e: { wallet: string; tokenIds: string[] }) => [e.wallet, e]));
    expect(byWallet[a]).toEqual({ wallet: a, source: 'testnet-emblem', chainId: 99801, tokenIds: ['1', '2'] });
    expect(byWallet[c]).toMatchObject({ tokenIds: ['3'] });
    expect(byWallet[b]).toBeUndefined();
    expect(JSON.parse(readFileSync(join(dir, 'site', 'holder-wl.json'), 'utf8')).entries).toHaveLength(2);
    // the allowlist builder includes them, de-duplicated with the WL
    const built = await t.call('POST', '/api/admin/mint/allowlist', { wallet: ADMIN });
    expect(built.body.count).toBe(2);
    const status = (await t.call('GET', '/api/admin/mint/allowlist', { wallet: ADMIN })).body;
    expect(status.snapshot.sources).toEqual({ wl: 1, collab: 0, holders: 2 });
    expect(existsSync(join(dir, 'chains', '4242', 'allowlist.json'))).toBe(true);
    // a reader on the wrong chain is refused
    testnet.chainId = 1;
    expect((await t.call('POST', '/api/admin/mint/import-holders', { wallet: ADMIN, body: { fromChainId: 99801 } })).status).toBe(502);
  });
});

describe('NFT utilities: emblem skin and laurel flag', () => {
  it('the emblem skin is offered and accepted for holders only (checked server side)', async () => {
    const t = await start(mkdtempSync(join(tmpdir(), 'elymum-app-')), 99801);
    t.app.contracts.set('nft', record(NFT, 99801));
    const holder = testSigner().address;
    const other = testSigner().address;
    t.evm.balances.set(holder.toLowerCase(), 1n);
    const g = (await t.call('GET', '/api/profile', { wallet: holder })).body;
    expect(g).toMatchObject({ holder: true, skinOptions: [0, 1, 2, 3, 4, 5, 6, 7, EMBLEM_SKIN_ID] });
    expect((await t.call('GET', '/api/profile', { wallet: other })).body).toMatchObject({ holder: false, skinOptions: [0, 1, 2, 3, 4, 5, 6, 7] });
    const bad = await t.call('PUT', '/api/profile', { wallet: other, body: { name: 'bob', skin: EMBLEM_SKIN_ID } });
    expect(bad).toMatchObject({ status: 400, body: { field: 'skin' } });
    const ok = await t.call('PUT', '/api/profile', { wallet: holder, body: { name: 'ann', skin: EMBLEM_SKIN_ID } });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.skin).toBe(EMBLEM_SKIN_ID);
  });

  it('holders carry PlayerFlag.Holder on the wire (decoded as `holder: true`, absent otherwise)', () => {
    const w = new BinaryWriter(1024);
    writeSnapshot(w, {
      tick: 1,
      view: { x: 0, y: 0, h: 100 },
      players: [
        { id: 1, skin: EMBLEM_SKIN_ID, flags: PlayerFlag.Verified | PlayerFlag.Holder, name: 'ann' },
        { id: 2, skin: 1, flags: 0, name: 'bob', holder: true },
        { id: 3, skin: 1, flags: PlayerFlag.Bot, name: 'kenjiplays', isBot: true },
      ],
      upserts: [],
      removals: [],
    });
    const snap = decodeSnapshot(w.finish());
    expect(snap.players.map((p) => [p.id, p.skin, p.holder ?? false, p.isBot])).toEqual([
      [1, EMBLEM_SKIN_ID, true, false],
      [2, 1, true, false],
      [3, 1, false, true],
    ]);
  });
});

describe('staked bots wiring', () => {
  const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

  it('on a test chain the app runs the testnet source and the bots admin shows it; on mainnet it does not exist', async () => {
    const t = await start(mkdtempSync(join(tmpdir(), 'elymum-app-')), 31337, { stakedBotKey: KEY });
    expect(t.app.stakedBots).not.toBeNull();
    const bots = (await t.call('GET', '/api/admin/bots', { wallet: ADMIN })).body;
    expect(bots).toMatchObject({ stakedActive: true, staked: { active: true, chainId: 31337, wallets: 0, playing: 0, problem: null } });
    expect(t.app.stakedBots!.wanted(1)).toBe(6); // the default: 6 staked bots per arena
    const m = await start(mkdtempSync(join(tmpdir(), 'elymum-app-')), 4242, { stakedBotKey: KEY });
    expect(m.app.stakedBots).toBeNull();
    expect((await m.call('GET', '/api/admin/bots', { wallet: ADMIN })).body).toMatchObject({ testnet: false, stakedActive: false });
  });
});

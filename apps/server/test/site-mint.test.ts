import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMerkleProof } from '@elymum/sdk';
import { PROTOCOL_VERSION, type ChainStatus, type ServerMessage } from '@elymum/shared';
import type { Address, Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import type { ServerKeyInfo } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Limiter } from '../src/net/limiter';
import { ProfileStore } from '../src/profiles';
import { CONTRACTS_FILE } from '../src/site/contracts';
import { EMBLEM_MOODS, emblemSvg, emblemTraits } from '../src/site/emblem';
import { ALLOWLIST_FILE, parseNftPath } from '../src/site/mint';
import { SITE_FILES, SiteStore } from '../src/site/store';
import { ADMIN, ARENA, FakeEvm, NFT, SERVER, TOKEN } from './fake-evm';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

const wallet = () => testSigner().address;
const post = (h = 'alice', id = '1790000000000000001') => `https://x.com/${h}/status/${id}`;
const SOL = 'D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm';

/** A chain gateway with arenas plus EVM access (the fake contracts): what the site reads the NFT through. */
class EvmTestChain extends ArenaChain {
  constructor(readonly fake: FakeEvm) {
    super([arena(1, 1000)]);
  }
  override status(): ChainStatus {
    return { ...super.status(), chainId: this.fake.chainId, serverKey: SERVER };
  }
  override serverInfo(): ServerKeyInfo {
    return { address: SERVER, balanceWei: '123', low: true };
  }
  evm() {
    return this.fake;
  }
  refreshes = 0;
  async refresh() {
    this.refreshes++;
  }
}

interface Harness {
  app: App;
  port: number;
  dir: string;
  evm: FakeEvm;
  chain: EvmTestChain;
  call(method: string, path: string, opts?: { wallet?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; text: string; headers: Headers }>;
}

async function harness(env: Record<string, string> = {}, setupDir?: (dir: string) => void): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'elymum-mint-'));
  setupDir?.(dir);
  const evm = new FakeEvm();
  const chain = new EvmTestChain(evm);
  const cfg = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: dir,
    BOT_TARGET: '2',
    BOT_MIN: '0',
    BOT_MAX: '2',
    ADMIN_WALLETS: ADMIN,
    PUBLIC_URL: 'https://elymum.example',
    ROUND_JOIN_CLOSE_SECONDS: '0',
    ...env,
  } as NodeJS.ProcessEnv);
  const app = await createApp(cfg, {
    chain,
    log: () => {},
    persist: true,
    siteLimits: { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
    apiLimiter: new Limiter(10_000, 60_000),
    fetchPrice: async () => ({ price: '40', value: 40 }),
  });
  const port = await app.listen();
  const call: Harness['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.wallet) headers.Authorization = `Bearer ${app.auth.issueToken(opts.wallet)}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed, text, headers: res.headers };
  };
  return { app, port, dir, evm, chain, call };
}

const wlBody = (handle: string) => ({ xHandle: handle, answers: { follow_x: true, post_x: post(handle) } });

describe('contracts registry', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.app.close();
  });

  it('is public, empty at first', async () => {
    expect((await h.call('GET', '/api/site/contracts')).body).toEqual({ arena: null, nft: null, token: null });
  });

  it('checks the code hash, the owner (the signed-in admin) and the arena server authority', async () => {
    const reg = (body: unknown, w: string = ADMIN) => h.call('POST', '/api/admin/contracts', { wallet: w, body });
    expect((await reg({ kind: 'arena', address: ARENA }, wallet())).status).toBe(403);
    expect((await reg({ kind: 'vault', address: ARENA })).body.field).toBe('kind');
    expect((await reg({ kind: 'arena', address: 'nope' })).body.field).toBe('address');
    expect((await reg({ kind: 'arena', address: ARENA, txHash: '0x12' })).body.field).toBe('txHash');
    h.evm.code.set(ARENA.toLowerCase(), 'mismatch');
    expect((await reg({ kind: 'arena', address: ARENA })).body.error).toBe('code_mismatch');
    h.evm.code.set(ARENA.toLowerCase(), 'missing');
    expect((await reg({ kind: 'arena', address: ARENA })).body.error).toBe('code_mismatch');
    h.evm.code.delete(ARENA.toLowerCase());
    h.evm.config.admin = '0x00000000000000000000000000000000000000Ee';
    expect((await reg({ kind: 'arena', address: ARENA })).body.error).toBe('not_owner');
    h.evm.config.admin = ADMIN;
    h.evm.config.serverAuthority = '0x0000000000000000000000000000000000000bAd';
    const wrong = await reg({ kind: 'arena', address: ARENA });
    expect([wrong.status, wrong.body.error]).toEqual([400, 'wrong_authority']);
    h.evm.config.serverAuthority = SERVER;
    const tx = `0x${'ab'.repeat(32)}`;
    const refreshes = h.chain.refreshes;
    const ok = await reg({ kind: 'arena', address: ARENA.toLowerCase(), txHash: tx });
    expect(ok.status).toBe(201);
    expect(ok.body.record).toMatchObject({ address: ARENA, txHash: tx, chainId: 31337, registeredBy: ADMIN });
    // the gateway re-reads at once (a new arena is picked up without a restart)
    expect(h.chain.refreshes).toBe(refreshes + 1);
    // the NFT: owner check through owner()
    h.evm.owners.set(NFT.toLowerCase(), '0x00000000000000000000000000000000000000Ee');
    expect((await reg({ kind: 'nft', address: NFT })).body.error).toBe('not_owner');
    h.evm.owners.set(NFT.toLowerCase(), ADMIN);
    expect((await reg({ kind: 'nft', address: NFT })).status).toBe(201);
    // a game token that is not the TestToken: only the arena's own token
    h.evm.code.set(TOKEN.toLowerCase(), 'mismatch');
    h.evm.code.set('0x0000000000000000000000000000000000001234', 'mismatch');
    expect((await reg({ kind: 'token', address: '0x0000000000000000000000000000000000001234' })).body.error).toBe('code_mismatch');
    expect((await reg({ kind: 'token', address: TOKEN })).status).toBe(201);
    const pub = (await h.call('GET', '/api/site/contracts')).body;
    expect(pub).toMatchObject({ arena: { address: ARENA }, nft: { address: NFT }, token: { address: TOKEN } });
    // persisted
    const file = JSON.parse(readFileSync(join(h.dir, CONTRACTS_FILE), 'utf8'));
    expect(file.arena.address).toBe(ARENA);
    expect((await h.call('GET', '/api/config')).body.chain).toMatchObject({ chainId: 31337 });
  });

  it('DELETE clears a kind; the arena only while nothing is owed', async () => {
    h.app.journal.enqueue({ kind: 'sweep', key: 'sweep:arena-1-1:1', arenaId: 1, roomId: 'arena-1-1', round: 1, amount: 5, attempts: 0, nextAttemptAt: Date.now() + 60_000, createdAt: Date.now() });
    const busy = await h.call('DELETE', '/api/admin/contracts?kind=arena', { wallet: ADMIN });
    expect([busy.status, busy.body.error]).toEqual([409, 'wrong_state']);
    h.app.journal.remove('sweep:arena-1-1:1');
    expect((await h.call('DELETE', '/api/admin/contracts?kind=token', { wallet: ADMIN })).body).toMatchObject({ cleared: true, registry: { token: null } });
    expect((await h.call('DELETE', '/api/admin/contracts?kind=bogus', { wallet: ADMIN })).status).toBe(400);
  });

  it('admins see the server key balance in /api/config; others do not', async () => {
    expect((await h.call('GET', '/api/config')).body.server).toBeUndefined();
    expect((await h.call('GET', '/api/config', { wallet: wallet() })).body.server).toBeUndefined();
    expect((await h.call('GET', '/api/config', { wallet: ADMIN })).body.server).toEqual({ address: SERVER, balanceWei: '123', low: true, priceKeeper: null });
  });

  it('ARENA_ADDRESS / NFT_ADDRESS override the registry', async () => {
    const env = await harness({ ARENA_ADDRESS: '0x00000000000000000000000000000000000000a1' });
    try {
      expect((await env.call('GET', '/api/site/contracts')).body.arena).toMatchObject({ address: '0x00000000000000000000000000000000000000A1', registeredBy: 'env' });
      expect(env.app.contracts.view().arena).toBe('0x00000000000000000000000000000000000000A1');
      expect((await env.call('POST', '/api/admin/contracts', { wallet: ADMIN, body: { kind: 'arena', address: ARENA } })).body.error).toBe('wrong_state');
    } finally {
      await env.app.close();
    }
  });
});

describe('mint: allowlist, proofs, state, price', () => {
  let h: Harness;
  const approved: string[] = [];
  beforeAll(async () => {
    h = await harness();
    h.app.contracts.set('nft', { address: NFT, txHash: null, chainId: 31337, registeredAt: 1, registeredBy: ADMIN });
  });
  afterAll(async () => {
    await h.app.close();
  });

  it('builds a snapshot of approved WL + submitted collab wallets; proofs verify against its root', async () => {
    expect((await h.call('POST', '/api/admin/mint/allowlist', { wallet: ADMIN })).body.error).toBe('bad_request'); // empty
    const s = h.app.site.store;
    for (const handle of ['amy', 'ben', 'cat']) {
      const w = wallet();
      s.submitWl(w, wlBody(handle));
      approved.push(w);
    }
    const pending = wallet();
    s.submitWl(pending, wlBody('dan'));
    const ids = s.listWl({ pageSize: 100 }).items.filter((e) => approved.includes(e.wallet)).map((e) => e.id);
    s.setWlStatus(ids, 'approved');
    // a submitted collab list (one wallet also on the WL: counted once)
    s.updateSettings({ collabOpen: true });
    const owner = wallet();
    const c = s.applyCollab(owner, { community: 'Coin Guild', type: 'guild', members: 10, communityX: 'coinguild', contactX: 'eve', role: 'founder', postUrl: post('coinguild'), about: 'x' });
    s.approveCollab(c.id, { spots: 2, deadline: Date.now() + 3_600_000 });
    const extra = wallet();
    s.submitCollab(owner, c.id, { raffleUrl: post('coinguild', '2'), wallets: [{ name: 'a', wallet: extra }, { name: 'b', wallet: approved[0].toLowerCase() }] });

    const built = await h.call('POST', '/api/admin/mint/allowlist', { wallet: ADMIN });
    expect(built.status).toBe(201);
    expect(built.body.count).toBe(4);
    expect(built.body.root).toMatch(/^0x[0-9a-f]{64}$/);
    const status = (await h.call('GET', '/api/admin/mint/allowlist', { wallet: ADMIN })).body;
    expect(status.snapshot).toMatchObject({ root: built.body.root, count: 4, builtBy: ADMIN, sources: { wl: 3, collab: 2 } });
    expect(status.snapshot.wallets).toEqual([...approved, extra].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
    expect(status).toMatchObject({ diff: { added: [], removed: [] }, onchainRoot: null, published: false });
    // on disk
    expect(JSON.parse(readFileSync(join(h.dir, ALLOWLIST_FILE), 'utf8')).root).toBe(built.body.root);

    for (const w of [...approved, extra]) {
      const p = (await h.call('GET', `/api/site/mint/proof?wallet=${w.toLowerCase()}`)).body;
      expect(p.eligible).toBe(true);
      expect(p.root).toBe(built.body.root);
      expect(verifyMerkleProof(p.root as Hex, w as Address, p.proof as Hex[])).toBe(true);
    }
    expect((await h.call('GET', `/api/site/mint/proof?wallet=${pending}`)).body).toMatchObject({ eligible: false, proof: [], root: built.body.root });
    expect((await h.call('GET', '/api/site/mint/proof?wallet=nope')).status).toBe(400);

    // the root is published on chain; then approvals change: the diff shows it
    h.evm.mint.root = built.body.root;
    await h.app.mint.chainState(true);
    const later = wallet();
    s.submitWl(later, wlBody('fay'));
    s.setWlStatus([s.listWl({ q: 'fay' }).items[0].id], 'approved');
    s.setWlStatus([s.listWl({ q: 'amy' }).items[0].id], 'rejected');
    const diff = (await h.call('GET', '/api/admin/mint/allowlist', { wallet: ADMIN })).body;
    expect(diff).toMatchObject({ onchainRoot: built.body.root, published: true, diff: { added: [later], removed: [approved[0]].filter(() => false) } });
    // amy is still in the collab list: not removed
    expect(diff.diff.removed).toEqual([]);
  });

  it('GET /api/site/mint: contract state, HYPE/USD, price in USD, holders, game access', async () => {
    h.evm.mint.phase = 1;
    h.evm.mint.price = 25n * 10n ** 15n; // 0.025 HYPE at $40 = $1.00
    h.evm.mintNft(wallet(), 2);
    h.evm.mintNft(wallet(), 1);
    await h.app.mint.chainState(true);
    const m = (await h.call('GET', '/api/site/mint')).body;
    expect(m).toMatchObject({
      nftAddress: NFT,
      chainId: 31337,
      contract: { phase: 'allowlist', priceWei: '25000000000000000', maxSupply: 1000, totalSupply: 3, keeper: '0x0000000000000000000000000000000000000000' },
      hypeUsd: 40,
      priceUsd: 1,
      targetUsdCents: 100,
      holders: 2,
      soldOut: false,
      gameAccess: 'admins',
    });
    const q = (await h.call('GET', '/api/admin/mint/price', { wallet: ADMIN })).body;
    expect(q).toMatchObject({ hypeUsd: 40, targetUsdCents: 100, priceWei: '25000000000000000' });
    expect(q.fetchedAt).toBeGreaterThan(0);
  });

  it('NFT metadata and the emblem SVG exist for minted ids only', async () => {
    const meta = await h.call('GET', '/api/nft/2');
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ name: 'Elymum No. 2', image: 'https://elymum.example/api/nft/2.svg', external_url: 'https://elymum.example' });
    expect(meta.body.attributes.map((a: { trait_type: string }) => a.trait_type)).toEqual(['Coin', 'Ring', 'Mood', 'Feet', 'Sweat']);
    const svg = await h.call('GET', '/api/nft/2.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');
    expect(svg.text).toBe(emblemSvg(2));
    for (const missing of ['/api/nft/4', '/api/nft/4.svg', '/api/nft/0', '/api/nft/abc', '/api/nft/01.svg']) expect((await h.call('GET', missing)).status, missing).toBe(404);
    // a fresh mint shows up without waiting for the cache: even right after a read that predates it
    // (the mint page asks for the emblem the moment the receipt lands), past the 500 ms miss throttle
    await new Promise((r) => setTimeout(r, 600));
    expect((await h.call('GET', '/api/site/mint')).status).toBe(200);
    h.evm.mintNft(wallet());
    expect((await h.call('GET', '/api/nft/4.svg')).status).toBe(200);
    expect((await h.call('GET', '/api/nft/4')).status).toBe(200);
    // ids beyond the max supply never trigger a chain read
    expect((await h.call('GET', '/api/nft/5000000')).status).toBe(404);
    const contract = (await h.call('GET', '/api/nft/contract')).body;
    expect(contract).toMatchObject({ name: 'Elymum', external_link: 'https://elymum.example', seller_fee_basis_points: 500, fee_recipient: ADMIN });
    // royaltyInfo is cached (5 min): an unauthenticated route never turns every hit into an RPC call
    const calls = h.evm.royaltyCalls;
    for (let i = 0; i < 5; i++) expect((await h.call('GET', '/api/nft/contract')).body).toMatchObject({ seller_fee_basis_points: 500 });
    expect(h.evm.royaltyCalls).toBe(calls);
    // metadata links come from PUBLIC_URL, never from a spoofed X-Forwarded-Host
    expect((await h.call('GET', '/api/nft/2', { headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' } })).body).toMatchObject({
      image: 'https://elymum.example/api/nft/2.svg',
      external_url: 'https://elymum.example',
    });
  }, 10_000);
});

describe('emblem', () => {
  it('is deterministic per id, uses the palette and ink outlines, and says "No. <id>"', () => {
    expect(emblemSvg(7)).toBe(emblemSvg(7));
    expect(emblemSvg(7)).not.toBe(emblemSvg(8));
    const svg = emblemSvg(123);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('No. 123');
    expect(svg).toContain('stroke="#04181C" stroke-width="3"');
    expect(svg).toMatch(/#2D7388|#34B7DD|#93D9EE|#F2C14E|#3C9A87/);
    // every mood shows up over a range of ids, and the ring is never the coin's paint
    const moods = new Set<string>();
    for (let id = 1; id <= 300; id++) {
      const t = emblemTraits(id);
      moods.add(t.mood);
      expect(t.ring).not.toBe(t.coin);
    }
    expect([...moods].sort()).toEqual([...EMBLEM_MOODS].sort());
    expect(() => emblemTraits(0)).toThrow(RangeError);
    expect(parseNftPath('12.svg')).toEqual({ id: 12, svg: true });
    expect(parseNftPath('12')).toEqual({ id: 12, svg: false });
    expect(parseNftPath('-1')).toBeNull();
  });
});

describe('game gate modes', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    h.app.contracts.set('nft', { address: NFT, txHash: null, chainId: 31337, registeredAt: 1, registeredBy: ADMIN });
  });
  afterAll(async () => {
    await h.app.close();
  });

  async function tryJoin(w: string | null): Promise<string> {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws`);
    const msgs: ServerMessage[] = [];
    ws.on('message', (d, bin) => {
      if (!bin) msgs.push(JSON.parse(d.toString()) as ServerMessage);
    });
    await new Promise((r) => ws.once('open', r));
    const until = async (pred: (m: ServerMessage) => boolean) => {
      for (let i = 0; i < 300; i++) {
        const m = msgs.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no reply: ${JSON.stringify(msgs.map((m) => m.t))}`);
    };
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    await until((m) => m.t === 'welcome');
    if (w) {
      ws.send(JSON.stringify({ t: 'auth', token: h.app.auth.issueToken(w) }));
      await until((m) => m.t === 'authed');
    }
    ws.send(JSON.stringify({ t: 'join', room: 'practice', name: 'x', skin: 0 }));
    const r = await until((m) => m.t === 'joined' || m.t === 'error');
    ws.close();
    return r.t === 'error' ? r.code : r.t;
  }

  it('admins: only admin wallets; holders: NFT holders + admins (balanceOf, cached 60 s); public: everyone', async () => {
    const holder = wallet();
    const nobody = wallet();
    h.evm.mintNft(holder);
    expect(await tryJoin(ADMIN)).toBe('joined');
    expect(await tryJoin(holder)).toBe('game_closed');
    expect((await h.call('PUT', '/api/admin/settings', { wallet: ADMIN, body: { gameAccess: 'holders' } })).status).toBe(200);
    expect(await tryJoin(holder)).toBe('joined');
    expect(await tryJoin(holder.toLowerCase())).toBe('joined');
    expect(await tryJoin(nobody)).toBe('game_closed');
    expect(await tryJoin(null)).toBe('game_closed');
    expect(await tryJoin(ADMIN)).toBe('joined');
    expect((await h.call('GET', '/api/auth/me', { wallet: holder })).body).toEqual({ address: holder, admin: false, holder: true, canPlay: true });
    // a refused wallet that then mints gets in within seconds: a negative answer is cached only 2 s
    // (the mint page sends it straight to /play)
    expect((await h.call('GET', '/api/auth/me', { wallet: nobody })).body.canPlay).toBe(false);
    h.evm.mintNft(nobody);
    await new Promise((r) => setTimeout(r, 2_100));
    expect((await h.call('GET', '/api/auth/me', { wallet: nobody })).body.canPlay).toBe(true);
    // the balance is cached 15 s for the lobby; an arena seat re-checks it uncached (`fresh`)
    h.evm.balances.set(holder.toLowerCase(), 0n);
    expect(await h.app.site.gameOpenFor(holder)).toBe(true);
    expect(await h.app.site.gameOpenFor(holder, true)).toBe(false);
    expect(await h.app.site.gameOpenFor(holder)).toBe(false);
    await h.call('PUT', '/api/admin/settings', { wallet: ADMIN, body: { gameAccess: 'public' } });
    expect(await tryJoin(null)).toBe('joined');
    expect((await h.call('GET', '/api/site/mint')).body.gameAccess).toBe('public');
    await h.call('PUT', '/api/admin/settings', { wallet: ADMIN, body: { gameAccess: 'admins' } });
  });

  it('GAME_ACCESS overrides the setting', async () => {
    const x = await harness({ GAME_ACCESS: 'holders' });
    try {
      expect(x.app.site.gameAccess()).toBe('holders');
      expect((await x.call('GET', '/api/site/settings')).body.settings.gameAccess).toBe('holders');
      expect((await x.call('GET', '/api/admin/settings', { wallet: ADMIN })).body).toMatchObject({ settings: { gameAccess: 'admins' }, gameAccessEnv: 'holders' });
      // no NFT registered: nobody holds one
      expect(await x.app.site.gameOpenFor(wallet())).toBe(false);
    } finally {
      await x.app.close();
    }
  });
});

describe('profiles', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness({ GAME_ACCESS: 'public' });
  });
  afterAll(async () => {
    await h.app.close();
  });

  it('GET / PUT /api/profile (signed-in), validated, used by the websocket sign-in', async () => {
    const w = wallet();
    expect((await h.call('GET', '/api/profile')).status).toBe(401);
    expect((await h.call('GET', '/api/profile', { wallet: w })).body.profile).toEqual({ wallet: w, name: null, skin: 0, stats: { games: 0, kills: 0, best: 0 }, updatedAt: null });
    expect((await h.call('PUT', '/api/profile', { wallet: w, body: { name: '', skin: 1 } })).body.field).toBe('name');
    expect((await h.call('PUT', '/api/profile', { wallet: w, body: { name: 'n'.repeat(17), skin: 1 } })).body.field).toBe('name');
    expect((await h.call('PUT', '/api/profile', { wallet: w, body: { name: 'Coin Lord', skin: 9999 } })).body.field).toBe('skin');
    const put = await h.call('PUT', '/api/profile', { wallet: w, body: { name: '  Coin   Lord ', skin: 3 } });
    expect(put.status).toBe(200);
    expect(put.body.profile).toMatchObject({ wallet: w, name: 'Coin Lord', skin: 3 });

    // the websocket sign-in reads the same store; the name is used (verified) in rooms
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws`);
    const msgs: ServerMessage[] = [];
    ws.on('message', (d, bin) => {
      if (!bin) msgs.push(JSON.parse(d.toString()) as ServerMessage);
    });
    await new Promise((r) => ws.once('open', r));
    const wait = async <T extends ServerMessage['t']>(t: T) => {
      for (let i = 0; i < 300; i++) {
        const m = msgs.find((x) => x.t === t);
        if (m) return m as Extract<ServerMessage, { t: T }>;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${t}`);
    };
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    await wait('welcome');
    ws.send(JSON.stringify({ t: 'auth', token: h.app.auth.issueToken(w) }));
    expect((await wait('authed')).profile).toEqual({ name: 'Coin Lord', skin: 3, xp: 0, level: 1, premiumSkins: 0 });
    ws.send(JSON.stringify({ t: 'join', room: 'practice', name: 'ignored', skin: 0 }));
    expect((await wait('joined')).name).toBe('Coin Lord');
    // a finished game counts in the server's own records
    ws.send(JSON.stringify({ t: 'leave' }));
    const xp = await wait('xp');
    expect(xp.xp).toBeGreaterThanOrEqual(0);
    ws.close();
    const after = (await h.call('GET', '/api/profile', { wallet: w })).body.profile;
    expect(after.stats.games).toBe(1);
    h.app.profiles.flush();
    expect(JSON.parse(readFileSync(join(h.dir, 'profiles.json'), 'utf8')).profiles[0]).toMatchObject({ wallet: w, name: 'Coin Lord', games: 1 });
  });

  it('the store persists and reloads, and ignores malformed rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-profiles-'));
    const path = join(dir, 'profiles.json');
    const a = new ProfileStore(path);
    const w = wallet();
    a.update(w.toLowerCase(), { name: 'Bob', skin: 2 });
    a.recordGame(w, { score: 500, kills: 3, xp: 120 });
    a.recordGame(w, { score: 200, kills: 1, xp: 30 });
    a.flush();
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.profiles.push({ wallet: SOL, name: 'old' });
    writeFileSync(path, JSON.stringify(raw));
    const b = new ProfileStore(path);
    expect(b.size).toBe(1);
    expect(b.view(w)).toMatchObject({ wallet: w, name: 'Bob', skin: 2, stats: { games: 2, kills: 4, best: 500 } });
    expect(b.summary(w)).toMatchObject({ name: 'Bob', xp: 150 });
    expect(b.summary(wallet())).toBeNull();
  });
});

describe('legacy (pre-Elysium) site data', () => {
  function seed(dir: string): void {
    mkdirSync(join(dir, 'site'), { recursive: true });
    writeFileSync(join(dir, SITE_FILES.settings), JSON.stringify({ wlOpen: true, collabOpen: true, gamePublic: true, xHandle: 'slanaio', launchPostUrl: null }));
    writeFileSync(
      join(dir, SITE_FILES.tasks),
      JSON.stringify([
        { id: 'follow_x', kind: 'follow_x', title: 'Follow @slanaio', body: 'Follow @slanaio on X.', target: 'https://x.com/slanaio', required: true, enabled: false, order: 0 },
        { id: 'custom', kind: 'text', title: 'Your Solana memories', body: 'kept: not a seeded task', target: null, required: false, enabled: true, order: 1 },
      ]),
    );
    const now = 1_700_000_000_000;
    writeFileSync(
      join(dir, SITE_FILES.wl),
      JSON.stringify([
        { id: 'wl_old', wallet: SOL, xHandle: 'oldtimer', status: 'approved', tasks: [], note: 'early', createdAt: now, updatedAt: now },
        { id: 'wl_old2', wallet: '8xYzR9MzN1nXHzS5eqb7KvR7cJBpfF3QeyhXHhFJ1kTr', xHandle: 'stayer', status: 'pending', tasks: [], note: '', createdAt: now, updatedAt: now },
      ]),
    );
    writeFileSync(
      join(dir, SITE_FILES.collab),
      JSON.stringify([
        {
          id: 'co_old',
          wallet: SOL,
          community: 'Old Guild',
          type: 'guild',
          members: 5,
          communityX: 'oldguild',
          contactX: 'oldtimer',
          discord: '',
          role: 'founder',
          postUrl: post('oldguild'),
          about: 'x',
          status: 'submitted',
          spots: 2,
          deadline: now + 1,
          wallets: [
            { name: 'sol', wallet: SOL },
            { name: 'evm', wallet: '0x00000000000000000000000000000000000000c1' },
          ],
          raffleUrl: post('oldguild', '2'),
          submittedAt: now,
          note: '',
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
  }

  it('the one legacy handle claim survives a restart: the handle stays taken, both entries kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-legacy-'));
    seed(dir);
    const s = new SiteStore(dir);
    const w = wallet();
    const claimed = s.submitWl(w, wlBody('oldtimer'));
    expect(claimed).toMatchObject({ wallet: w, status: 'pending' });
    const again = new SiteStore(dir);
    expect(again.listWl({ q: 'oldtimer' }).items).toHaveLength(2);
    expect(again.myWl(w)?.id).toBe(claimed.id);
    expect(() => again.submitWl(wallet(), wlBody('oldtimer'))).toThrow(/already applied/);
  });

  it('migrates settings (gamePublic → gameAccess, slanaio → elymum) and seeded task text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-legacy-'));
    seed(dir);
    const logs: string[] = [];
    const s = new SiteStore(dir, { log: (m) => logs.push(m) });
    expect(s.settings).toEqual({ wlOpen: true, collabOpen: true, gameAccess: 'public', xHandle: 'elymum', launchPostUrl: null });
    expect(JSON.parse(readFileSync(join(dir, SITE_FILES.settings), 'utf8'))).not.toHaveProperty('gamePublic');
    expect(s.tasks[0]).toMatchObject({ id: 'follow_x', title: 'Follow @elymum', target: 'https://x.com/elymum', enabled: false });
    expect(s.tasks[1].title).toBe('Your Solana memories');
    expect(logs.join()).toMatch(/legacy WL entr/);
    // gamePublic false → admins
    writeFileSync(join(dir, SITE_FILES.settings), JSON.stringify({ gamePublic: false, xHandle: 'other' }));
    expect(new SiteStore(dir).settings).toMatchObject({ gameAccess: 'admins', xHandle: 'other' });
  });

  it('keeps legacy entries (legacy: true), never in the allowlist; their X handle can be claimed once, as a fresh entry for review', async () => {
    const h = await harness({}, seed);
    try {
      const s = h.app.site.store;
      const list = s.listWl({}).items;
      expect(list.find((e) => e.id === 'wl_old')).toMatchObject({ wallet: SOL, legacy: true, status: 'approved' });
      const collab = s.getCollab('co_old');
      expect(collab.legacy).toBe(true);
      expect(collab.wallets.map((w) => !!w.legacy)).toEqual([true, false]);
      // only the EVM collab wallet is eligible
      expect(h.app.mint.currentAllowlist().wallets).toEqual(['0x00000000000000000000000000000000000000C1']);
      // re-apply with an EVM wallet and the legacy entry's handle
      const w = wallet();
      const r = await h.call('POST', '/api/site/wl', { wallet: w, body: wlBody('oldtimer') });
      expect(r.status).toBe(201);
      // a new pending entry: it never takes over the legacy one nor inherits its "approved" or its note
      expect(r.body.entry).toMatchObject({ wallet: w, xHandle: 'oldtimer', status: 'pending' });
      expect(r.body.entry.id).not.toBe('wl_old');
      expect(r.body.entry.legacy).toBeUndefined();
      const fresh = (await h.call('GET', `/api/admin/wl/${r.body.entry.id}`, { wallet: ADMIN })).body.entry;
      expect(fresh.note).toBe('claims legacy handle @oldtimer (legacy status: approved, legacy entry wl_old); verify before approving');
      expect(fresh.note).not.toContain('early');
      // the legacy entry is kept as it was (plus a pointer to the claim); both are visible to the admin
      const old = (await h.call('GET', '/api/admin/wl/wl_old', { wallet: ADMIN })).body.entry;
      expect(old).toMatchObject({ id: 'wl_old', wallet: SOL, legacy: true, status: 'approved' });
      expect(old.note).toBe(`early\nhandle claimed by EVM application ${r.body.entry.id} (${w})`);
      expect(s.listWl({ q: 'oldtimer' }).items.map((e) => e.id).sort()).toEqual([r.body.entry.id, 'wl_old'].sort());
      expect((await h.call('GET', '/api/site/wl', { wallet: w })).body.entry.id).toBe(r.body.entry.id);
      // not in the allowlist until an admin approves it
      expect(h.app.mint.currentAllowlist().wallets).not.toContain(w);
      // exactly one claim: the handle is now taken
      expect((await h.call('POST', '/api/site/wl', { wallet: wallet(), body: wlBody('oldtimer') })).body.error).toBe('handle_taken');
      expect(s.counts().wl.total).toBe(3);
    } finally {
      await h.app.close();
    }
  });
});

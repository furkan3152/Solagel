import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MINT_PHASE_NAMES,
  buildMerkleTree,
  fetchHypeUsd,
  normalizeAllowlist,
  usdCentsToWei,
  weiToUsdCents,
  type AllowlistTree,
  type MintState as ChainMintState,
} from '@elymum/sdk';
import type {
  AllowlistBuildResponse,
  AllowlistSnapshot,
  AllowlistStatus,
  GameAccess,
  MintContractState,
  MintPriceQuote,
  MintProofResponse,
  MintState,
} from '@elymum/shared';
import { getAddress, type Address, type Hash } from 'viem';
import { ChainCache } from '../chain/chain-cache';
import type { EvmClient } from '../chain/evm-client';
import { isRateLimited, withRpcPriority } from '../chain/rpc-budget';
import { emblemTraits } from './emblem';
import type { SiteStore } from './store';
import { SiteFail, userWallet } from './validate';

/** The allowlist snapshot, inside the chain's state directory (`DATA_DIR/chains/<id>/allowlist.json`). */
export const ALLOWLIST_FILE = 'allowlist.json';
const PRICE_TTL_MS = 60_000;
const PRICE_RETRY_MS = 15_000;
/** A HYPE/USD reading older than this is not shown (the feed is down). */
const PRICE_MAX_AGE_MS = 10 * 60_000;
/** `mintState()` is re-read in the background when older than this (the page is answered from the cache). */
const STATE_TTL_MS = 30_000;
/** After a failed `mintState()` read the next one waits this long (the cached state is served meanwhile). */
const STATE_RETRY_MS = 15_000;
/** With nothing cached yet, a page request waits at most this long for the first read (then answers without it). */
export const FIRST_READ_WAIT_MS = 2_500;
/** The mint page's last good reads (`DATA_DIR/chains/<id>/mint-cache.json`): served at once after a restart. */
export const MINT_CACHE_FILE = 'mint-cache.json';
/** A holder check (`balanceOf`) is reused this long: the game gate re-checks at every arena ticket and round. */
export const HOLDER_TTL_MS = 15_000;
/** A negative holder check is reused only this long (a fresh mint must open /play at once). */
export const HOLDER_MISS_TTL_MS = 2_000;
/** `royaltyInfo` of the collection (`/api/nft/contract`, an unauthenticated route) is read at most this often. */
export const ROYALTY_TTL_MS = 5 * 60_000;
const ROYALTY_RETRY_MS = 30_000;
/** The holder index polls new `Transfer` logs at most this often (it is only a count on the mint page). */
export const HOLDERS_INDEX_TTL_MS = 2 * 60_000;
/** After a failed scan: 1 min, doubling up to 15 min (rate limits must not be hammered). */
export const HOLDERS_RETRY_MS = 60_000;
export const HOLDERS_RETRY_MAX_MS = 15 * 60_000;
/** `Transfer` log requests: blocks per request between these (doubles after a full-width success, halves on a refused range). */
const HOLDERS_CHUNK_MIN = 100n;
const HOLDERS_CHUNK_MAX = 500_000n;
const HOLDERS_LOOKBACK_BLOCKS = 1_000_000n;
const MAX_HOLDER_CACHE = 20_000;
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO_ROOT = /^0x0{64}$/i;

export type PriceFetcher = () => Promise<{ price: string; value: number }>;

export interface MintServiceDeps {
  store: SiteStore;
  /** The chain access (null while the chain is off). */
  client: () => EvmClient | null;
  /** The registered NFT (null while none). */
  nft: () => { address: string; txHash: string | null } | null;
  chainId: () => number | null;
  /** The chain's state directory (`DATA_DIR/chains/<id>`): the allowlist snapshot; null: memory only. */
  stateDir: string | null;
  /** Imported testnet emblem holders (`site/holder-wl.json`): part of the allowlist. */
  holderWl?: () => string[];
  usdCents: number;
  /** HYPE/USD feed (default: Hyperliquid's info API at `HYPE_PRICE_URL`). */
  fetchPrice: PriceFetcher;
  logChunkBlocks: number;
  log?: (m: string) => void;
  now?: () => number;
}

/** The default feed: Hyperliquid's `allMids` at `url`. */
export const hyperliquidPrice =
  (url: string): PriceFetcher =>
  () =>
    fetchHypeUsd({ url, timeoutMs: 10_000 });

/**
 * The mint side of the site: the NFT's state, HYPE/USD and the $1 price, holders (for the game gate
 * and the mint page), the allowlist snapshot and its Merkle proofs, and the token metadata.
 */
export class MintService {
  private price: { price: string; value: number; at: number } | null = null;
  private priceFailedAt = -Infinity;
  private priceFetch: Promise<void> | null = null;
  private state: { nft: string; at: number; value: ChainMintState } | null = null;
  private stateFetch: Promise<ChainMintState | null> | null = null;
  /** When `minted()` last forced a fresh state read for an id above the cached supply. */
  private missReadAt = -Infinity;
  private readonly holderCache = new Map<string, { at: number; value: boolean }>();
  private holders: { nft: string; next: bigint | null; balances: Map<string, number>; at: number } | null = null;
  private holdersScan: Promise<number> | null = null;
  /** Holder scans failed in a row, and when the next may run. */
  private holdersFail = { n: 0, until: -Infinity };
  private holdersChunk: bigint;
  private stateFailedAt = -Infinity;
  /** Last good reads on disk (mint state, holder index), so a restart answers the page at once. */
  private readonly cache: ChainCache;
  private royaltyV: { nft: string; at: number; ttl: number; value: { bps: number; receiver: string } | null } | null = null;
  private royaltyFetch: Promise<{ bps: number; receiver: string } | null> | null = null;
  private snapshotV: AllowlistSnapshot | null = null;
  private tree: AllowlistTree | null = null;
  private readonly now: () => number;
  private readonly log: (m: string) => void;

  constructor(private readonly deps: MintServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    this.holdersChunk = BigInt(Math.max(Number(HOLDERS_CHUNK_MIN), deps.logChunkBlocks));
    this.cache = ChainCache.in(deps.stateDir, MINT_CACHE_FILE, this.log);
    this.loadSnapshot();
    this.loadCached();
  }

  /** The mint state and the holder index kept from before a restart (stale: refreshed in the background). */
  private loadCached(): void {
    const st = this.cache.get<{ nft: string; value: ChainMintState }>('state');
    if (st && typeof st.nft === 'string' && st.value && typeof st.value.totalSupply === 'number') this.state = { nft: st.nft, at: -Infinity, value: st.value };
    const h = this.cache.get<{ nft: string; next: bigint | null; balances: Record<string, number> }>('holders');
    if (h && typeof h.nft === 'string' && h.balances && typeof h.balances === 'object') {
      this.holders = { nft: h.nft, next: typeof h.next === 'bigint' ? h.next : null, balances: new Map(Object.entries(h.balances)), at: -Infinity };
    }
  }

  /** Writes the cached reads now (server stop). */
  flush(): void {
    this.cache.flush();
  }

  /* ---------------------------------------------------------------- */
  /* Allowlist                                                        */
  /* ---------------------------------------------------------------- */

  private get snapshotPath(): string | null {
    return this.deps.stateDir ? join(this.deps.stateDir, ALLOWLIST_FILE) : null;
  }

  private loadSnapshot(): void {
    const p = this.snapshotPath;
    if (!p || !existsSync(p)) return;
    try {
      const s = JSON.parse(readFileSync(p, 'utf8')) as AllowlistSnapshot;
      if (!s || !Array.isArray(s.wallets) || typeof s.root !== 'string') throw new Error('bad shape');
      const tree = buildMerkleTree(s.wallets);
      if (tree.root.toLowerCase() !== s.root.toLowerCase()) throw new Error('the root does not match the wallets');
      this.snapshotV = s;
      this.tree = tree;
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      this.log(`mint: ${p} is unreadable (${(err as Error).message}); moved to ${backup}`);
      try {
        renameSync(p, backup);
      } catch {
        /* ignore */
      }
    }
  }

  snapshot(): AllowlistSnapshot | null {
    return this.snapshotV ? structuredClone(this.snapshotV) : null;
  }

  /** The current approvals: approved WL wallets + submitted collab wallets + imported emblem holders (checksummed, unique, sorted). */
  currentAllowlist(): { wallets: string[]; wl: number; collab: number; holders: number } {
    const src = this.deps.store.allowlistSources();
    const holders = this.deps.holderWl?.() ?? [];
    return {
      wallets: normalizeAllowlist([...src.wl, ...src.collab, ...holders]),
      wl: normalizeAllowlist(src.wl).length,
      collab: normalizeAllowlist(src.collab).length,
      holders: normalizeAllowlist(holders).length,
    };
  }

  /** `POST /api/admin/mint/allowlist`: builds and stores a snapshot of the current approvals. */
  buildAllowlist(admin: string): AllowlistBuildResponse {
    const cur = this.currentAllowlist();
    if (cur.wallets.length === 0) throw new SiteFail(400, 'bad_request', 'The allowlist is empty: approve WL entries or collab lists (or import testnet holders) first.');
    const tree = buildMerkleTree(cur.wallets);
    const snap: AllowlistSnapshot = {
      root: tree.root,
      count: tree.count,
      wallets: tree.addresses,
      builtAt: this.now(),
      builtBy: admin,
      sources: { wl: cur.wl, collab: cur.collab, ...(cur.holders > 0 ? { holders: cur.holders } : {}) },
    };
    const p = this.snapshotPath;
    if (p) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(`${p}.tmp`, JSON.stringify(snap));
      renameSync(`${p}.tmp`, p);
    }
    this.snapshotV = snap;
    this.tree = tree;
    this.log(`mint: allowlist snapshot built by ${admin}: ${snap.count} wallet(s), root ${snap.root}`);
    return { root: snap.root, count: snap.count };
  }

  /** `GET /api/admin/mint/allowlist`. */
  async allowlistStatus(): Promise<AllowlistStatus> {
    const current = new Map(this.currentAllowlist().wallets.map((w) => [w.toLowerCase(), w]));
    const snap = this.snapshotV;
    const inSnap = new Map((snap?.wallets ?? []).map((w) => [w.toLowerCase(), w]));
    const added = [...current.entries()].filter(([k]) => !inSnap.has(k)).map(([, w]) => w);
    const removed = [...inSnap.entries()].filter(([k]) => !current.has(k)).map(([, w]) => w);
    const onchainRoot = await this.onchainRoot();
    return {
      snapshot: this.snapshot(),
      diff: { added, removed },
      onchainRoot,
      published: !!snap && !!onchainRoot && snap.root.toLowerCase() === onchainRoot.toLowerCase(),
    };
  }

  /** `GET /api/site/mint/proof?wallet=`. */
  async proof(rawWallet: string | null): Promise<MintProofResponse> {
    const wallet = userWallet(rawWallet ?? '', 'wallet', 'wallet must be an EVM address (0x…)');
    const proof = this.tree?.proof(wallet) ?? null;
    return { eligible: proof !== null, proof: proof ?? [], root: this.snapshotV?.root ?? null, onchainRoot: await this.onchainRoot() };
  }

  private async onchainRoot(): Promise<string | null> {
    const s = await this.chainState().catch(() => null);
    return s && !ZERO_ROOT.test(s.root) ? s.root : null;
  }

  /* ---------------------------------------------------------------- */
  /* Price                                                            */
  /* ---------------------------------------------------------------- */

  /** HYPE/USD, cached 60 s; null when the feed has not answered for 10 minutes. */
  async hypeUsd(): Promise<{ price: string; value: number; at: number } | null> {
    const now = this.now();
    // a failing feed is asked again at most every 15 s (requests never pile onto it)
    if ((!this.price || now - this.price.at >= PRICE_TTL_MS) && now - this.priceFailedAt >= PRICE_RETRY_MS) {
      const hadPrice = this.price !== null;
      this.priceFetch ??= this.deps
        .fetchPrice()
        .then((p) => {
          this.price = { ...p, at: this.now() };
        })
        .catch((err) => {
          this.priceFailedAt = this.now();
          this.log(`mint: HYPE/USD feed failed (${(err as Error).message})`);
        })
        .finally(() => (this.priceFetch = null));
      // stale-while-revalidate: a known price is answered now (re-read in the background)
      if (hadPrice) void this.priceFetch;
      else await atMost(this.priceFetch, FIRST_READ_WAIT_MS, undefined);
    }
    return this.price && this.now() - this.price.at < PRICE_MAX_AGE_MS ? { ...this.price } : null;
  }

  /** `GET /api/admin/mint/price`. */
  async priceQuote(): Promise<MintPriceQuote> {
    const p = await this.hypeUsd();
    return {
      hypeUsd: p?.value ?? null,
      targetUsdCents: this.deps.usdCents,
      priceWei: p ? usdCentsToWei(this.deps.usdCents, p.price).toString() : null,
      fetchedAt: p?.at ?? null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Contract state, holders                                          */
  /* ---------------------------------------------------------------- */

  /**
   * `mintState()` of the registered NFT; null without an NFT or a chain. Stale-while-revalidate: a cached
   * state (also one kept from before a restart) is answered at once and re-read in the background when
   * older than 30 s, so the mint page never waits on a slow or rate-limited RPC. With nothing cached the
   * first read is awaited at most `FIRST_READ_WAIT_MS`. `fresh` waits for a new read (the mint's own
   * checks after a transaction).
   */
  async chainState(fresh = false): Promise<ChainMintState | null> {
    const nft = this.deps.nft();
    const client = this.deps.client();
    if (!nft || !client) return null;
    const cached = this.state && this.state.nft === nft.address ? this.state : null;
    if (fresh) return this.readState(nft.address, client);
    if (cached) {
      if (this.now() - cached.at >= STATE_TTL_MS && this.now() - this.stateFailedAt >= STATE_RETRY_MS) void this.readState(nft.address, client);
      return cached.value;
    }
    if (this.now() - this.stateFailedAt < STATE_RETRY_MS) return null;
    return atMost(this.readState(nft.address, client), FIRST_READ_WAIT_MS, null);
  }

  /** One `mintState()` read at a time; resolves with the new state, else the cached one (or null). */
  private readState(nftAddress: string, client: EvmClient): Promise<ChainMintState | null> {
    this.stateFetch ??= withRpcPriority('normal', () => client.mintState(nftAddress as Address))
      .then((value) => {
        this.state = { nft: nftAddress, at: this.now(), value };
        this.stateFailedAt = -Infinity;
        this.cache.set('state', { nft: nftAddress, value });
        return value;
      })
      .catch((err) => {
        this.stateFailedAt = this.now();
        this.log(`mint: mintState of ${nftAddress} failed (${firstLine(err)})${this.state?.nft === nftAddress ? ' — serving the last good state' : ''}`);
        return this.state && this.state.nft === nftAddress ? this.state.value : null;
      })
      .finally(() => (this.stateFetch = null));
    return this.stateFetch;
  }

  /** Whether a wallet holds an Elymum NFT (`balanceOf > 0`), cached 15 s (`fresh` re-reads). False without an NFT. */
  async isHolder(wallet: string, fresh = false): Promise<boolean> {
    const nft = this.deps.nft();
    const client = this.deps.client();
    if (!nft || !client) return false;
    const key = `${nft.address}:${wallet.toLowerCase()}`;
    const hit = this.holderCache.get(key);
    // a "not a holder" answer is kept only briefly: the wallet may be minting right now, and the
    // mint page sends it straight to /play (a refused visit just before must not lock it out)
    if (!fresh && hit && this.now() - hit.at < (hit.value ? HOLDER_TTL_MS : HOLDER_MISS_TTL_MS)) return hit.value;
    let value: boolean;
    try {
      value = (await withRpcPriority('normal', () => client.nftBalance(nft.address as Address, getAddress(wallet)))) > 0n;
    } catch (err) {
      this.log(`mint: balanceOf failed (${(err as Error).message})`);
      return hit?.value ?? false;
    }
    if (this.holderCache.size >= MAX_HOLDER_CACHE) this.holderCache.delete(this.holderCache.keys().next().value!);
    this.holderCache.set(key, { at: this.now(), value });
    return value;
  }

  /**
   * Distinct holders, from the NFT's `Transfer` logs: indexed incrementally (low RPC priority) at most
   * every 2 minutes, in adaptive ranges (up to 500k blocks per request while catching up), stopping
   * when caught up; a failure backs off 1 → 15 min. The index is kept on disk, so a restart resumes
   * where it stopped. Stale-while-revalidate: the current count is answered at once; only the very
   * first scan (nothing indexed yet) is awaited, at most `FIRST_READ_WAIT_MS`.
   */
  async holdersCount(): Promise<number> {
    const nft = this.deps.nft();
    const client = this.deps.client();
    if (!nft || !client) return 0;
    if (this.holders?.nft !== nft.address) this.holders = { nft: nft.address, next: null, balances: new Map(), at: -Infinity };
    const h = this.holders;
    const due = this.now() - h.at >= HOLDERS_INDEX_TTL_MS && this.now() >= this.holdersFail.until;
    if (!due) return countHolders(h.balances);
    const scan = (this.holdersScan ??= withRpcPriority('low', () => this.scanHolders(nft, client, h)).finally(() => (this.holdersScan = null)));
    // a first-ever scan is worth a short wait; afterwards the page never waits for the index
    return h.next === null ? atMost(scan, FIRST_READ_WAIT_MS, countHolders(h.balances)) : countHolders(h.balances);
  }

  private async scanHolders(
    nft: { address: string; txHash: string | null },
    client: EvmClient,
    h: { nft: string; next: bigint | null; balances: Map<string, number>; at: number },
  ): Promise<number> {
    try {
      const latest = await client.blockNumber();
      if (h.next === null) {
        let start: bigint | null = null;
        if (nft.txHash) start = await client.txBlock(nft.txHash as Hash);
        start ??= await client.deployBlock(nft.address as Address);
        h.next = start ?? (latest > HOLDERS_LOOKBACK_BLOCKS ? latest - HOLDERS_LOOKBACK_BLOCKS : 0n);
      }
      while (h.next! <= latest) {
        const chunk = this.holdersChunk;
        const from: bigint = h.next!;
        const to: bigint = from + chunk - 1n < latest ? from + chunk - 1n : latest;
        let logs;
        try {
          logs = await client.transferLogs(nft.address as Address, from, to);
        } catch (err) {
          // a refused range (too wide / too many results) is halved; a rate limit is not the range's fault
          if (!isRateLimited(err) && chunk > HOLDERS_CHUNK_MIN) this.holdersChunk = chunk / 2n > HOLDERS_CHUNK_MIN ? chunk / 2n : HOLDERS_CHUNK_MIN;
          throw err;
        }
        for (const t of logs) {
          if (t.from !== ZERO) h.balances.set(t.from.toLowerCase(), (h.balances.get(t.from.toLowerCase()) ?? 0) - 1);
          if (t.to !== ZERO) h.balances.set(t.to.toLowerCase(), (h.balances.get(t.to.toLowerCase()) ?? 0) + 1);
        }
        if (to - from + 1n === chunk && chunk < HOLDERS_CHUNK_MAX) this.holdersChunk = chunk * 2n < HOLDERS_CHUNK_MAX ? chunk * 2n : HOLDERS_CHUNK_MAX;
        h.next = to + 1n;
      }
      h.at = this.now();
      this.holdersFail = { n: 0, until: -Infinity };
    } catch (err) {
      const n = this.holdersFail.n + 1;
      const wait = Math.min(HOLDERS_RETRY_MAX_MS, HOLDERS_RETRY_MS * 2 ** (n - 1));
      this.holdersFail = { n, until: this.now() + wait };
      this.log(`mint: holder index failed (${firstLine(err)}); next try in ${Math.round(wait / 1000)} s`);
    }
    // what is indexed so far is kept, also across restarts
    if (h.next !== null) this.cache.set('holders', { nft: h.nft, next: h.next, balances: Object.fromEntries(h.balances) });
    return countHolders(h.balances);
  }

  /** `GET /api/site/mint`. */
  async publicState(gameAccess: GameAccess): Promise<MintState> {
    const nft = this.deps.nft();
    const [s, p, holders] = await Promise.all([this.chainState(), this.hypeUsd(), this.holdersCount()]);
    const contract: MintContractState | null = s
      ? {
          phase: MINT_PHASE_NAMES[s.phase] ?? 'closed',
          priceWei: s.price.toString(),
          minPriceWei: s.minPrice.toString(),
          maxPriceWei: s.maxPrice.toString(),
          keeper: s.keeper ?? ZERO,
          merkleRoot: s.root,
          maxSupply: s.maxSupply,
          totalSupply: s.totalSupply,
          wlLimit: s.wlLimit,
          publicLimit: s.publicLimit,
          treasury: s.treasury,
          frozen: s.frozen,
        }
      : null;
    return {
      nftAddress: nft?.address ?? null,
      chainId: this.deps.chainId(),
      contract,
      hypeUsd: p?.value ?? null,
      priceUsd: s && p ? weiToUsdCents(s.price, p.price) / 100 : null,
      targetUsdCents: this.deps.usdCents,
      holders,
      soldOut: s?.soldOut ?? false,
      gameAccess,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Metadata                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Whether token `id` was minted (ids run from 1 to `totalSupply`). An id above the cached supply
   * (up to the max supply) re-reads the state: the mint page asks for the emblem of a token the
   * moment its receipt lands, often within a second of a read made while the mint was still
   * pending. Those re-reads are throttled on their own clock (at most one per 500 ms), not on the
   * age of the cached state, so a recent stale read cannot hide a fresh mint.
   */
  async minted(id: number): Promise<boolean> {
    if (!Number.isSafeInteger(id) || id < 1) return false;
    let s = await this.chainState();
    if (s && id > s.totalSupply && id <= s.maxSupply && this.now() - this.missReadAt >= 500) {
      this.missReadAt = this.now();
      // a read already in flight may have started before the mint landed: let it finish, then read again
      if (this.stateFetch) await this.stateFetch;
      s = await this.chainState(true);
    }
    return !!s && id <= s.totalSupply;
  }

  /** ERC-721 metadata JSON of a minted token. */
  metadata(id: number, baseUrl: string): Record<string, unknown> {
    const t = emblemTraits(id);
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    return {
      name: `Elymum No. ${id}`,
      description: 'An Elymum emblem: a coin of the ring. Holders play Elymum, the arena where the coins eat, on Elysium.',
      image: `${baseUrl}/api/nft/${id}.svg`,
      external_url: baseUrl,
      attributes: [
        { trait_type: 'Coin', value: cap(t.coin) },
        { trait_type: 'Ring', value: cap(t.ring) },
        { trait_type: 'Mood', value: cap(t.mood) },
        { trait_type: 'Feet', value: t.feet ? 'Yes' : 'No' },
        { trait_type: 'Sweat', value: t.sweat ? 'Yes' : 'No' },
      ],
    };
  }

  /** `royaltyInfo` of the NFT, cached 5 min (a failed read is retried after 30 s); one read in flight at a time. */
  private async royalty(nft: string, client: EvmClient): Promise<{ bps: number; receiver: string } | null> {
    const c = this.royaltyV;
    if (c && c.nft === nft && this.now() - c.at < c.ttl) return c.value;
    this.royaltyFetch ??= client
      .royalty(nft as Address)
      .then((value) => {
        this.royaltyV = { nft, at: this.now(), ttl: ROYALTY_TTL_MS, value };
        return value;
      })
      .catch(() => {
        const prev = c && c.nft === nft ? c.value : null;
        this.royaltyV = { nft, at: this.now(), ttl: ROYALTY_RETRY_MS, value: prev };
        return prev;
      })
      .finally(() => (this.royaltyFetch = null));
    return this.royaltyFetch;
  }

  /** The collection's `contractURI` JSON. */
  async contractMetadata(baseUrl: string): Promise<Record<string, unknown>> {
    const nft = this.deps.nft();
    const client = this.deps.client();
    const royalty = nft && client ? await this.royalty(nft.address, client) : null;
    return {
      name: 'Elymum',
      description: 'Elymum emblems: the coins of the ring. Holders play Elymum on Elysium.',
      image: `${baseUrl}/api/nft/1.svg`,
      external_link: baseUrl,
      ...(royalty && royalty.bps > 0 ? { seller_fee_basis_points: royalty.bps, fee_recipient: royalty.receiver } : {}),
    };
  }
}

const firstLine = (err: unknown): string => String((err as Error)?.message ?? err).split('\n')[0].slice(0, 240);

/** `p`, or `fallback` when it takes longer than `ms` (p keeps running). */
function atMost<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<F>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function countHolders(balances: Map<string, number>): number {
  let n = 0;
  for (const b of balances.values()) if (b > 0) n++;
  return n;
}

/** Parses `<id>` / `<id>.svg` of `/api/nft/…`; null when malformed. */
export function parseNftPath(rest: string): { id: number; svg: boolean } | null {
  const m = /^([1-9]\d{0,9})(\.svg)?$/.exec(rest);
  if (!m) return null;
  return { id: Number(m[1]), svg: !!m[2] };
}


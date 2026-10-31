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
import type { EvmClient } from '../chain/evm-client';
import { emblemTraits } from './emblem';
import type { SiteStore } from './store';
import { SiteFail, userWallet } from './validate';

/** The allowlist snapshot, inside the chain's state directory (`DATA_DIR/chains/<id>/allowlist.json`). */
export const ALLOWLIST_FILE = 'allowlist.json';
const PRICE_TTL_MS = 60_000;
const PRICE_RETRY_MS = 15_000;
/** A HYPE/USD reading older than this is not shown (the feed is down). */
const PRICE_MAX_AGE_MS = 10 * 60_000;
const STATE_TTL_MS = 15_000;
/** A holder check (`balanceOf`) is reused this long: the game gate re-checks at every arena ticket and round. */
export const HOLDER_TTL_MS = 15_000;
/** A negative holder check is reused only this long (a fresh mint must open /play at once). */
export const HOLDER_MISS_TTL_MS = 2_000;
/** `royaltyInfo` of the collection (`/api/nft/contract`, an unauthenticated route) is read at most this often. */
export const ROYALTY_TTL_MS = 5 * 60_000;
const ROYALTY_RETRY_MS = 30_000;
const HOLDERS_INDEX_TTL_MS = 30_000;
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
  private royaltyV: { nft: string; at: number; ttl: number; value: { bps: number; receiver: string } | null } | null = null;
  private royaltyFetch: Promise<{ bps: number; receiver: string } | null> | null = null;
  private snapshotV: AllowlistSnapshot | null = null;
  private tree: AllowlistTree | null = null;
  private readonly now: () => number;
  private readonly log: (m: string) => void;

  constructor(private readonly deps: MintServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    this.loadSnapshot();
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
      await this.priceFetch;
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

  /** `mintState()` of the registered NFT, cached 15 s (`fresh` re-reads); null without an NFT or a chain. */
  async chainState(fresh = false): Promise<ChainMintState | null> {
    const nft = this.deps.nft();
    const client = this.deps.client();
    if (!nft || !client) return null;
    const cached = this.state;
    if (!fresh && cached && cached.nft === nft.address && this.now() - cached.at < STATE_TTL_MS) return cached.value;
    this.stateFetch ??= client
      .mintState(nft.address as Address)
      .then((value) => {
        this.state = { nft: nft.address, at: this.now(), value };
        return value;
      })
      .catch((err) => {
        this.log(`mint: mintState of ${nft.address} failed (${(err as Error).message})`);
        return cached && cached.nft === nft.address ? cached.value : null;
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
      value = (await client.nftBalance(nft.address as Address, getAddress(wallet))) > 0n;
    } catch (err) {
      this.log(`mint: balanceOf failed (${(err as Error).message})`);
      return hit?.value ?? false;
    }
    if (this.holderCache.size >= MAX_HOLDER_CACHE) this.holderCache.delete(this.holderCache.keys().next().value!);
    this.holderCache.set(key, { at: this.now(), value });
    return value;
  }

  /** Distinct holders, from the NFT's `Transfer` logs (indexed incrementally, at most every 30 s). */
  async holdersCount(): Promise<number> {
    const nft = this.deps.nft();
    const client = this.deps.client();
    if (!nft || !client) return 0;
    if (this.holders?.nft !== nft.address) this.holders = { nft: nft.address, next: null, balances: new Map(), at: 0 };
    const h = this.holders;
    if (this.now() - h.at < HOLDERS_INDEX_TTL_MS) return countHolders(h.balances);
    this.holdersScan ??= (async () => {
      try {
        const latest = await client.blockNumber();
        if (h.next === null) {
          let start: bigint | null = null;
          if (nft.txHash) start = await client.txBlock(nft.txHash as Hash);
          start ??= await client.deployBlock(nft.address as Address);
          h.next = start ?? (latest > HOLDERS_LOOKBACK_BLOCKS ? latest - HOLDERS_LOOKBACK_BLOCKS : 0n);
        }
        const chunk = BigInt(this.deps.logChunkBlocks);
        while (h.next! <= latest) {
          const from: bigint = h.next!;
          const to: bigint = from + chunk - 1n < latest ? from + chunk - 1n : latest;
          for (const t of await client.transferLogs(nft.address as Address, from, to)) {
            if (t.from !== ZERO) h.balances.set(t.from.toLowerCase(), (h.balances.get(t.from.toLowerCase()) ?? 0) - 1);
            if (t.to !== ZERO) h.balances.set(t.to.toLowerCase(), (h.balances.get(t.to.toLowerCase()) ?? 0) + 1);
          }
          h.next = to + 1n;
        }
        h.at = this.now();
      } catch (err) {
        this.log(`mint: holder index failed (${(err as Error).message})`);
      }
      return countHolders(h.balances);
    })().finally(() => (this.holdersScan = null));
    return this.holdersScan;
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


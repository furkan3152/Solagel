import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ELYSIUM_TESTNET_CHAIN_ID, isChainId, type HolderWlEntry, type HolderWlView } from '@elymum/shared';
import { getAddress, isAddress, type Address, type Hash } from 'viem';
import type { HolderReader } from '../chain/evm-client';
import { SiteFail, bad } from './validate';

/** Imported testnet emblem holders (off-chain: they carry over to mainnet, like the WL). */
export const HOLDER_WL_FILE = join('site', 'holder-wl.json');
const ZERO = '0x0000000000000000000000000000000000000000';
const LOOKBACK_BLOCKS = 1_000_000n;
const READ_CONCURRENCY = 8;

interface HolderWlFile {
  version: 1;
  importedAt: number | null;
  importedFrom: number | null;
  entries: HolderWlEntry[];
}

/**
 * `DATA_DIR/site/holder-wl.json`: wallets that held a testnet emblem at the last import
 * (`POST /api/admin/mint/import-holders`). The allowlist builder includes them (de-duplicated with
 * the WL and collab wallets). An import replaces the entries of the same source chain.
 */
export class HolderWlStore {
  private data: HolderWlFile = { version: 1, importedAt: null, importedFrom: null, entries: [] };

  constructor(
    private readonly dataDir: string | null,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.load();
  }

  private get path(): string | null {
    return this.dataDir ? join(this.dataDir, HOLDER_WL_FILE) : null;
  }

  private load(): void {
    const p = this.path;
    if (!p || !existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as HolderWlFile;
      if (!raw || !Array.isArray(raw.entries)) throw new Error('bad shape');
      const entries = raw.entries
        .filter((e) => typeof e?.wallet === 'string' && isAddress(e.wallet, { strict: false }) && isChainId(e.chainId))
        .map((e) => ({ wallet: getAddress(e.wallet), source: 'testnet-emblem' as const, chainId: e.chainId, tokenIds: Array.isArray(e.tokenIds) ? e.tokenIds.map(String) : [] }));
      this.data = { version: 1, importedAt: Number(raw.importedAt) || null, importedFrom: isChainId(raw.importedFrom) ? raw.importedFrom : null, entries };
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      try {
        renameSync(p, backup);
      } catch {
        /* ignore */
      }
      this.log(`site: ${HOLDER_WL_FILE} is unreadable (${(err as Error).message}); moved to ${backup}`);
    }
  }

  private save(): void {
    const p = this.path;
    if (!p) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(`${p}.tmp`, JSON.stringify(this.data, null, 2));
    renameSync(`${p}.tmp`, p);
  }

  entries(): HolderWlEntry[] {
    return structuredClone(this.data.entries);
  }

  /** The imported wallets (EIP-55), for the allowlist builder. */
  wallets(): string[] {
    return this.data.entries.map((e) => e.wallet);
  }

  /** Replaces every entry imported from `chainId` with `entries`. */
  replace(chainId: number, entries: HolderWlEntry[], now: number): void {
    this.data = {
      version: 1,
      importedAt: now,
      importedFrom: chainId,
      entries: [...this.data.entries.filter((e) => e.chainId !== chainId), ...entries].sort((a, b) => (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1)),
    };
    this.save();
  }

  /** The admin view; `onAllowlist` tells whether a wallet is also an approved WL / collab wallet. */
  view(onAllowlist: (wallet: string) => boolean): HolderWlView {
    const entries = this.entries();
    return {
      entries,
      counts: {
        wallets: entries.length,
        tokens: entries.reduce((n, e) => n + e.tokenIds.length, 0),
        alsoWl: entries.filter((e) => onAllowlist(e.wallet)).length,
      },
      importedAt: this.data.importedAt,
      importedFrom: this.data.importedFrom,
    };
  }
}

/**
 * The current holders of an NFT from its `Transfer` logs (from the deploy block on, in chunks):
 * owner → token ids. Each owner's `balanceOf` is checked once more, so a reorg or a skipped chunk
 * cannot list a wallet that holds nothing.
 */
export async function readNftHolders(
  reader: HolderReader,
  nft: { address: string; txHash: string | null },
  chunkBlocks: number,
): Promise<Map<Address, bigint[]>> {
  const address = getAddress(nft.address);
  const latest = await reader.blockNumber();
  let start: bigint | null = null;
  if (nft.txHash) start = await reader.txBlock(nft.txHash as Hash);
  start ??= await reader.deployBlock(address);
  let next = start ?? (latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n);
  const ownerOf = new Map<bigint, Address>();
  const chunk = BigInt(Math.max(1, chunkBlocks));
  while (next <= latest) {
    const to = next + chunk - 1n < latest ? next + chunk - 1n : latest;
    for (const t of await reader.transferLogs(address, next, to)) {
      if (t.to === ZERO) ownerOf.delete(t.tokenId);
      else ownerOf.set(t.tokenId, getAddress(t.to));
    }
    next = to + 1n;
  }
  const byOwner = new Map<Address, bigint[]>();
  for (const [id, owner] of ownerOf) byOwner.set(owner, [...(byOwner.get(owner) ?? []), id]);
  const owners = [...byOwner.keys()];
  for (let i = 0; i < owners.length; i += READ_CONCURRENCY) {
    await Promise.all(
      owners.slice(i, i + READ_CONCURRENCY).map(async (o) => {
        if ((await reader.nftBalance(address, o)) === 0n) byOwner.delete(o);
      }),
    );
  }
  for (const ids of byOwner.values()) ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return byOwner;
}

export interface ImportHoldersDeps {
  store: HolderWlStore;
  /** The NFT registered on `chainId` (its chain-keyed registry); null when none. */
  nftOf: (chainId: number) => { address: string; txHash: string | null } | null;
  /** A reader on `chainId` (the server's own client, or `TESTNET_RPC_URL`); null when unreachable. */
  readerFor: (chainId: number) => HolderReader | null;
  chunkBlocks: number;
  now: number;
  log?: (m: string) => void;
}

/** `POST /api/admin/mint/import-holders { fromChainId? }` (default: Elysium Testnet). */
export async function importHolders(deps: ImportHoldersDeps, body: Record<string, unknown>, admin: string): Promise<number> {
  const from = body.fromChainId === undefined || body.fromChainId === null ? ELYSIUM_TESTNET_CHAIN_ID : body.fromChainId;
  if (!isChainId(from)) throw bad('fromChainId', 'fromChainId must be a chain id');
  const nft = deps.nftOf(from);
  if (!nft) throw new SiteFail(409, 'wrong_state', `No NFT is registered for chain ${from} on this server (its registry is DATA_DIR/chains/${from}/contracts.json).`);
  const reader = deps.readerFor(from);
  if (!reader) throw new SiteFail(503, 'chain_off', `The server cannot reach chain ${from} (set TESTNET_RPC_URL).`);
  let holders: Map<Address, bigint[]>;
  try {
    const id = await reader.getChainId();
    if (id !== from) throw new SiteFail(502, 'chain_off', `The RPC for chain ${from} answers chain ${id}.`);
    holders = await readNftHolders(reader, nft, deps.chunkBlocks);
  } catch (err) {
    if (err instanceof SiteFail) throw err;
    throw new SiteFail(502, 'chain_off', `Reading the holders of ${nft.address} on chain ${from} failed: ${(err as Error).message.split('\n')[0]}`);
  }
  const entries: HolderWlEntry[] = [...holders].map(([wallet, ids]) => ({ wallet, source: 'testnet-emblem', chainId: from, tokenIds: ids.map(String) }));
  deps.store.replace(from, entries, deps.now);
  deps.log?.(`mint: ${admin} imported ${entries.length} emblem holder(s) of ${nft.address} on chain ${from} into the allowlist sources`);
  return entries.length;
}

import { utils } from '@anchor-lang/core';
import type { Connection } from '@solana/web3.js';
import { CORE_KEY_ASSET_V1, MPL_CORE_ID, parseCoreAsset, passNumberFromName } from './core';
import { toBase58, type Address } from './program';

export interface OwnedPass {
  /** Core asset address. */
  asset: string;
  /** Pass number from the asset name (`Slana Pass #<n>`). */
  number: number;
}

export interface ListPassesOptions {
  /** `fetch` used for the DAS request (defaults to the global one). */
  fetch?: typeof fetch;
  /** Skip DAS and use getProgramAccounts directly. */
  skipDas?: boolean;
}

const DAS_PAGE = 1000;
const MAX_DAS_PAGES = 10;

interface DasAsset {
  id?: string;
  burnt?: boolean;
  content?: { metadata?: { name?: string } };
  grouping?: { group_key?: string; group_value?: string }[];
}

async function viaDas(endpoint: string, owner: string, collection: string, fetchFn: typeof fetch): Promise<OwnedPass[]> {
  const out: OwnedPass[] = [];
  for (let page = 1; page <= MAX_DAS_PAGES; page++) {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'slana-passes', method: 'getAssetsByOwner', params: { ownerAddress: owner, page, limit: DAS_PAGE } }),
    });
    if (!res.ok) throw new Error(`DAS HTTP ${res.status}`);
    const body = (await res.json()) as { error?: { message?: string }; result?: { items?: DasAsset[] } };
    if (body.error || !body.result || !Array.isArray(body.result.items)) throw new Error(`DAS unavailable: ${body.error?.message ?? 'no result'}`);
    const items = body.result.items;
    for (const item of items) {
      if (!item.id || item.burnt) continue;
      const inCollection = (item.grouping ?? []).some((g) => g.group_key === 'collection' && g.group_value === collection);
      if (!inCollection) continue;
      const n = passNumberFromName(item.content?.metadata?.name ?? '');
      if (n !== null) out.push({ asset: item.id, number: n });
    }
    if (items.length < DAS_PAGE) break;
  }
  return out;
}

async function viaProgramAccounts(connection: Connection, owner: string, collection: string): Promise<OwnedPass[]> {
  const bs58 = utils.bytes.bs58;
  const accounts = await connection.getProgramAccounts(MPL_CORE_ID, {
    commitment: 'confirmed',
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode([CORE_KEY_ASSET_V1]) } },
      { memcmp: { offset: 1, bytes: owner } },
      { memcmp: { offset: 33, bytes: bs58.encode([2]) } }, // update authority = Collection
      { memcmp: { offset: 34, bytes: collection } },
    ],
  });
  const out: OwnedPass[] = [];
  for (const { pubkey, account } of accounts) {
    const asset = parseCoreAsset(account.data);
    if (!asset || asset.owner !== owner || asset.collection !== collection) continue;
    const n = passNumberFromName(asset.name);
    if (n !== null) out.push({ asset: pubkey.toBase58(), number: n });
  }
  return out;
}

/**
 * Slana Passes (Core assets of `collection`) owned by `owner`, sorted by number. Uses the DAS
 * `getAssetsByOwner` API when the RPC supports it and falls back to `getProgramAccounts`
 * on the Core program with memcmp filters (key, owner, collection) otherwise.
 */
export async function listOwnedPasses(connection: Connection, owner: Address, collection: Address, opts: ListPassesOptions = {}): Promise<OwnedPass[]> {
  const o = toBase58(owner);
  const c = toBase58(collection);
  let passes: OwnedPass[] | null = null;
  // wrapped so the global is always called with its own `this` (browsers throw otherwise)
  const fetchFn: typeof fetch | undefined = opts.fetch ?? (typeof fetch === 'function' ? (input, init) => fetch(input, init) : undefined);
  if (!opts.skipDas && fetchFn) {
    try {
      passes = await viaDas(connection.rpcEndpoint, o, c, fetchFn);
    } catch {
      passes = null;
    }
  }
  passes ??= await viaProgramAccounts(connection, o, c);
  return passes.sort((a, b) => a.number - b.number || a.asset.localeCompare(b.asset));
}

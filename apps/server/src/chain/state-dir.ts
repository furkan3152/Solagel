import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ELYSIUM_TESTNET_CHAIN_ID, LOCALNET_CHAIN_ID, isChainId, isMainnet } from '@elymum/shared';
import type { ServerConfig } from '../config';
import { readChainId } from './evm-client';

/**
 * Chain-keyed state (2026-10-31 spec, section 1). Everything that belongs to one chain lives under
 * `DATA_DIR/chains/<chainId>/`:
 *
 * - `contracts.json`  the contracts registry (arena, NFT, token),
 * - `journal.json`    the money journal (live tickets, pending settlements, floor loot),
 * - `bots.json`       the testnet staked-bot wallets (addresses only; keys are re-derived),
 * - `allowlist.json`  the allowlist snapshots (Merkle root + wallets) of that chain's NFT.
 *
 * Off-chain records (WL, collabs, tasks, site settings, bot settings, profiles, leaderboards,
 * integrity, the server key) stay where they are. Moving `EVM_RPC_URL` to another chain starts a
 * clean state for it and keeps the old chain's records for reference.
 */
export const CHAINS_DIR = 'chains';
/** The RPC → chain id memo (so a boot with the RPC down still finds its state). */
export const RPC_IDS_FILE = join(CHAINS_DIR, 'rpc-ids.json');

/** File names inside a chain directory. */
export const CHAIN_FILES = { contracts: 'contracts.json', journal: 'journal.json', bots: 'bots.json', allowlist: 'allowlist.json' } as const;

/** The legacy (pre chain-keyed) locations, relative to `DATA_DIR`. */
export const LEGACY_FILES = { contracts: 'contracts.json', journal: 'journal.json', allowlist: join('site', 'allowlist.json') } as const;

/** `DATA_DIR/chains/<chainId>`. */
export function chainDir(dataDir: string, chainId: number): string {
  return join(dataDir, CHAINS_DIR, String(chainId));
}

/**
 * Where this boot keeps its chain state: `DATA_DIR/chains/<id>` when the chain id is known, else
 * `DATA_DIR` itself (no chain, the dev fake chain, or a first boot that could not reach the RPC):
 * nothing there is touched, and the next boot that knows the chain id migrates it.
 */
export function stateDir(dataDir: string, chainId: number | null): string {
  return chainId === null ? dataDir : chainDir(dataDir, chainId);
}

/** Chain ids with a stored state directory, ascending. */
export function storedChains(dataDir: string): number[] {
  try {
    return readdirSync(join(dataDir, CHAINS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{1,12}$/.test(d.name))
      .map((d) => Number(d.name))
      .filter(isChainId)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Staked bots and the faucet run on the Elysium testnet and the localnet only. */
export function isTestChain(chainId: number | null | undefined): boolean {
  return chainId === ELYSIUM_TESTNET_CHAIN_ID || chainId === LOCALNET_CHAIN_ID;
}

const rpcKey = (rpcUrl: string): string => createHash('sha256').update(rpcUrl.trim().replace(/\/+$/, '')).digest('hex').slice(0, 16);

function readRpcIds(dataDir: string): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, RPC_IDS_FILE), 'utf8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Remembers the chain id an RPC answered (keyed by a hash: an RPC URL may hold an API key). */
export function rememberChainId(dataDir: string, rpcUrl: string, chainId: number): void {
  const ids = readRpcIds(dataDir);
  if (ids[rpcKey(rpcUrl)] === chainId) return;
  ids[rpcKey(rpcUrl)] = chainId;
  const p = join(dataDir, RPC_IDS_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(ids, null, 2));
  renameSync(`${p}.tmp`, p);
}

export function rememberedChainId(dataDir: string, rpcUrl: string): number | null {
  const id = readRpcIds(dataDir)[rpcKey(rpcUrl)];
  return isChainId(id) ? id : null;
}

/**
 * The chain id this boot keys its state on: `eth_chainId` of `EVM_RPC_URL` (remembered per RPC),
 * the remembered id when the RPC does not answer, else null. Null without a real chain configured
 * (and for the dev fake chain, which keeps its own files in `DATA_DIR`).
 */
export async function resolveStateChainId(
  cfg: ServerConfig,
  opts: { persist: boolean; log: (m: string) => void; readId?: (rpcUrl: string) => Promise<number> },
): Promise<number | null> {
  if (cfg.devFakeChain || !cfg.chain.rpcUrl || !cfg.chain.serverKey) return null;
  const rpcUrl = cfg.chain.rpcUrl;
  try {
    const id = await (opts.readId ?? readChainId)(rpcUrl);
    if (opts.persist) rememberChainId(cfg.dataDir, rpcUrl, id);
    return id;
  } catch (err) {
    const remembered = opts.persist ? rememberedChainId(cfg.dataDir, rpcUrl) : null;
    if (remembered !== null) {
      opts.log(`chain: RPC unreachable at boot (${(err as Error).message.split('\n')[0]}); using the state of chain ${remembered} (last seen on this RPC)`);
      return remembered;
    }
    opts.log(
      `!!! chain: RPC unreachable at boot and this RPC was never seen before: the chain id is unknown, so arena money stays OFF until a restart with the RPC up (practice works)`,
    );
    return null;
  }
}

/** The chain the legacy (pre chain-keyed) files belong to. */
function legacyChainId(dataDir: string, bootChainId: number): number {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, LEGACY_FILES.contracts), 'utf8')) as Record<string, { chainId?: unknown } | null>;
    for (const kind of ['arena', 'nft', 'token']) {
      const id = Number(raw?.[kind]?.chainId);
      if (isChainId(id)) return id;
    }
  } catch {
    /* no registry: decide below */
  }
  // the records before this layout were made on the testnet (production) or a localnet (development)
  return isMainnet(bootChainId) ? ELYSIUM_TESTNET_CHAIN_ID : bootChainId;
}

/**
 * Moves the legacy chain files (`DATA_DIR/contracts.json`, `journal.json` with its quarantined
 * copies, `site/allowlist.json`) into `DATA_DIR/chains/<id>/`, where `<id>` is the chain they were
 * made on (the registry's records say; else the testnet). Idempotent: a file whose target already
 * exists stays where it is (logged), so nothing is ever overwritten. Returns the moved paths.
 */
export function migrateLegacyState(dataDir: string, bootChainId: number, log: (m: string) => void = () => {}): string[] {
  const present = Object.values(LEGACY_FILES).some((f) => existsSync(join(dataDir, f)));
  if (!present) return [];
  const target = legacyChainId(dataDir, bootChainId);
  const dir = chainDir(dataDir, target);
  const moves: [string, string][] = [
    [LEGACY_FILES.contracts, CHAIN_FILES.contracts],
    [LEGACY_FILES.journal, CHAIN_FILES.journal],
    [LEGACY_FILES.allowlist, CHAIN_FILES.allowlist],
  ];
  try {
    for (const f of readdirSync(dataDir)) if (f.startsWith(`${LEGACY_FILES.journal}.corrupt-`)) moves.push([f, f]);
  } catch {
    /* ignore */
  }
  const moved: string[] = [];
  for (const [from, to] of moves) {
    const src = join(dataDir, from);
    if (!existsSync(src)) continue;
    const dst = join(dir, to);
    if (existsSync(dst)) {
      log(`!!! state: ${from} was not moved: ${join(CHAINS_DIR, String(target), to)} already exists (review both by hand)`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    renameSync(src, dst);
    moved.push(from);
  }
  if (moved.length > 0) log(`state: moved ${moved.join(', ')} into ${join(CHAINS_DIR, String(target))}/ (chain-keyed state)`);
  return moved;
}

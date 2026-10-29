import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONTRACT_KINDS, type ContractKind, type ContractRecord, type ContractsRegistry } from '@elymum/shared';
import { getAddress, isAddress, type Address, type Hash } from 'viem';
import type { EvmClient } from '../chain/evm-client';
import type { ContractsView } from '../chain/evm';
import type { Journal } from '../stake/journal';
import { SiteFail, bad } from './validate';

export const CONTRACTS_FILE = 'contracts.json';

const empty = (): ContractsRegistry => ({ arena: null, nft: null, token: null });

/**
 * The contracts registry: the arena, NFT and token addresses the admin registered after deploying them
 * from `/admin` (`DATA_DIR/contracts.json`, write-to-temp + rename). `ARENA_ADDRESS` / `NFT_ADDRESS`
 * override it. Listeners hear every change (the chain gateway picks a new arena up at once).
 */
export class ContractsStore {
  private data: ContractsRegistry = empty();
  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly dataDir: string | null,
    private readonly overrides: { arena: string | null; nft: string | null } = { arena: null, nft: null },
    private readonly log: (m: string) => void = () => {},
  ) {
    this.load();
  }

  private get path(): string | null {
    return this.dataDir ? join(this.dataDir, CONTRACTS_FILE) : null;
  }

  private load(): void {
    const p = this.path;
    if (!p || !existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
      const next = empty();
      for (const kind of CONTRACT_KINDS) {
        const r = raw?.[kind] as ContractRecord | null | undefined;
        if (r && typeof r.address === 'string' && isAddress(r.address, { strict: false })) {
          next[kind] = {
            address: getAddress(r.address),
            txHash: typeof r.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(r.txHash) ? r.txHash : null,
            chainId: Number(r.chainId) || 0,
            registeredAt: Number(r.registeredAt) || 0,
            registeredBy: typeof r.registeredBy === 'string' ? r.registeredBy : '',
          };
        }
      }
      this.data = next;
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      this.log(`contracts: ${p} is unreadable (${(err as Error).message}); moved to ${backup}`);
      try {
        renameSync(p, backup);
      } catch {
        /* ignore */
      }
    }
  }

  private save(): void {
    const p = this.path;
    if (!p) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(`${p}.tmp`, JSON.stringify(this.data, null, 2));
    renameSync(`${p}.tmp`, p);
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        this.log(`contracts: listener failed: ${(err as Error).message}`);
      }
    }
  }

  /** The stored registry (without the env overrides). */
  stored(): ContractsRegistry {
    return structuredClone(this.data);
  }

  /** The effective registry: env overrides (`registeredBy: "env"`) win over stored records. */
  effective(chainId: number | null): ContractsRegistry {
    const out = this.stored();
    for (const kind of ['arena', 'nft'] as const) {
      const env = this.overrides[kind];
      if (env && isAddress(env, { strict: false })) {
        const address = getAddress(env);
        const same = out[kind]?.address === address;
        out[kind] = { address, txHash: same ? (out[kind]!.txHash ?? null) : null, chainId: chainId ?? 0, registeredAt: same ? out[kind]!.registeredAt : 0, registeredBy: 'env' };
      }
    }
    return out;
  }

  /** What the chain gateway works with. */
  view(): ContractsView {
    const r = this.effective(null);
    return { arena: r.arena?.address ?? null, arenaTx: r.arena?.txHash ?? null, nft: r.nft?.address ?? null };
  }

  /** The kind is fixed by an env var (`ARENA_ADDRESS` / `NFT_ADDRESS`): registering it has no effect. */
  overridden(kind: ContractKind): boolean {
    return kind !== 'token' && !!this.overrides[kind];
  }

  set(kind: ContractKind, record: ContractRecord): void {
    this.data[kind] = { ...record };
    this.save();
    this.log(`contracts: ${kind} registered at ${record.address} by ${record.registeredBy}`);
    this.changed();
  }

  clear(kind: ContractKind): boolean {
    if (!this.data[kind]) return false;
    this.data[kind] = null;
    this.save();
    this.log(`contracts: ${kind} cleared`);
    this.changed();
    return true;
  }
}

export interface RegisterDeps {
  client: EvmClient | null;
  chainId: number | null;
  /** The server key's address (the arena's server authority must be it). */
  serverKey: string | null;
  journal: Journal | null;
  store: ContractsStore;
  now: number;
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * `POST /api/admin/contracts`: checks the contract on chain and stores it. The code hash must be the
 * bundled artifact's; the owner must be the signed-in admin; an arena's server authority must be the
 * server key. A token is either the bundled TestToken (owned by the admin) or the token the registered
 * arena was set to. An arena is refused while the journal still owes money on another one.
 */
export async function registerContract(deps: RegisterDeps, body: Record<string, unknown>, admin: string): Promise<ContractRecord> {
  const kind = body.kind;
  if (typeof kind !== 'string' || !(CONTRACT_KINDS as readonly string[]).includes(kind)) throw bad('kind', `kind must be one of ${CONTRACT_KINDS.join(', ')}`);
  const k = kind as ContractKind;
  if (typeof body.address !== 'string' || !isAddress(body.address.trim(), { strict: false }) || /^0x0{40}$/i.test(body.address.trim())) {
    throw bad('address', 'address must be a contract address (0x…)');
  }
  const address = getAddress(body.address.trim()) as Address;
  const txHash = body.txHash === undefined || body.txHash === null || body.txHash === '' ? null : body.txHash;
  if (txHash !== null && (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash))) throw bad('txHash', 'txHash must be a transaction hash (0x + 64 hex digits)');
  const { client, chainId } = deps;
  if (!client || chainId === null) throw new SiteFail(503, 'chain_off', 'The server has no chain (EVM_RPC_URL unset or unreachable).');
  if (deps.store.overridden(k)) throw new SiteFail(409, 'wrong_state', `${k === 'arena' ? 'ARENA_ADDRESS' : 'NFT_ADDRESS'} is set on the server: it overrides the registry.`);

  const code = await client.codeCheck(address, k);
  if (k === 'token' && code !== 'ok') {
    // a real game token is not the TestToken: accept it only when the registered arena uses it
    const arena = deps.store.effective(chainId).arena?.address;
    const arenaToken = arena ? (await client.arenaConfig(arena as Address).catch(() => null))?.token : null;
    if (!(await client.hasCode(address))) throw new SiteFail(400, 'code_mismatch', `${address} holds no code on chain ${chainId}.`, 'address');
    if (!same(arenaToken, address)) throw new SiteFail(400, 'code_mismatch', `${address} is not the bundled TestToken and not the arena's game token.`, 'address');
  } else if (code !== 'ok') {
    throw new SiteFail(400, 'code_mismatch', code === 'missing' ? `${address} holds no code on chain ${chainId}.` : `${address} is not the bundled ${k === 'arena' ? 'ElymumArena' : k === 'nft' ? 'ElymumNFT' : 'TestToken'} (code hash differs).`, 'address');
  } else {
    const owner = k === 'arena' ? (await client.arenaConfig(address)).admin : await client.ownerOf(address);
    if (!same(owner, admin)) throw new SiteFail(403, 'not_owner', `The contract owner is ${owner}, not the signed-in admin ${admin}.`, 'address');
  }
  if (k === 'arena') {
    const config = await client.arenaConfig(address);
    if (!same(config.serverAuthority, deps.serverKey)) {
      throw new SiteFail(400, 'wrong_authority', `The arena's server authority is ${config.serverAuthority}, not this server's key ${deps.serverKey ?? '(none)'}.`, 'address');
    }
    const j = deps.journal;
    if (j && j.contract && !same(j.contract, address) && !j.isIdle()) {
      throw new SiteFail(409, 'wrong_state', `The journal still owes money on arena ${j.contract}; register it again or settle the journal first.`);
    }
  }
  const record: ContractRecord = { address, txHash: (txHash as Hash | null) ?? null, chainId, registeredAt: deps.now, registeredBy: admin };
  deps.store.set(k, record);
  return record;
}

/** `DELETE /api/admin/contracts?kind=`: refused for the arena while the journal owes money on it. */
export function clearContract(deps: Pick<RegisterDeps, 'journal' | 'store'>, kind: string | null): boolean {
  if (!kind || !(CONTRACT_KINDS as readonly string[]).includes(kind)) throw bad('kind', `kind must be one of ${CONTRACT_KINDS.join(', ')}`);
  const k = kind as ContractKind;
  if (k === 'arena' && deps.journal && !deps.journal.isIdle()) {
    throw new SiteFail(409, 'wrong_state', 'The journal still owes money on the registered arena (pending settlements, live tickets or floor loot).');
  }
  return deps.store.clear(k);
}

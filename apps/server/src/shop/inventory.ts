import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BOOST_KINDS, emptyBoostCounts, type BoostCounts, type BoostKind } from '@elymum/shared';
import { getAddress } from 'viem';

/** One credited purchase (the audit trail and the replay guard). */
export interface PurchaseRecord {
  /** Transaction hash, lower-case 0x hex. */
  tx: string;
  /** EIP-55 wallet. */
  wallet: string;
  kind: BoostKind;
  charges: number;
  /** Raw base units paid (decimal string). */
  paid: string;
  /** Unix ms. */
  at: number;
}

interface InventoryFile {
  version: 1;
  wallets: { wallet: string; charges: Partial<BoostCounts> }[];
  purchases: PurchaseRecord[];
}

/** Why a credit was refused. */
export class InventoryError extends Error {
  constructor(
    readonly code: 'tx_used' | 'bad_request',
    message: string,
  ) {
    super(message);
  }
}

const nat = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
};

/**
 * Power-up charges per wallet and every purchase ever credited (its tx hash is never credited
 * twice). Money is involved, so every change is written at once (write-to-temp + rename) before
 * the call returns: a credit and its "used" mark land in the same write. Lives under
 * `DATA_DIR/chains/<chainId>/` (per chain); `path` null keeps it in memory (tests).
 */
export class BoostInventory {
  private readonly charges = new Map<string, BoostCounts>();
  private readonly purchases: PurchaseRecord[] = [];
  private readonly used = new Set<string>();

  constructor(
    private readonly path: string | null,
    private readonly log: (m: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as InventoryFile;
      if (!data || data.version !== 1 || !Array.isArray(data.wallets) || !Array.isArray(data.purchases)) throw new Error('bad shape');
      for (const w of data.wallets) {
        if (typeof w?.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(w.wallet)) continue;
        const c = emptyBoostCounts();
        for (const k of BOOST_KINDS) c[k] = nat(w.charges?.[k]);
        this.charges.set(w.wallet.toLowerCase(), c);
      }
      for (const p of data.purchases) {
        if (typeof p?.tx !== 'string' || !/^0x[0-9a-f]{64}$/.test(p.tx)) continue;
        this.purchases.push(p);
        this.used.add(p.tx);
      }
    } catch (err) {
      // never start over silently: a lost file would let old transactions be credited again
      throw new Error(`boosts: ${this.path} is unreadable (${(err as Error).message}); fix or move it before starting`);
    }
  }

  private save(): void {
    if (!this.path) return;
    const data: InventoryFile = {
      version: 1,
      wallets: [...this.charges.entries()].map(([wallet, charges]) => ({ wallet, charges })),
      purchases: this.purchases,
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }

  /** The wallet's charges (zeros for unknown wallets). */
  get(wallet: string): BoostCounts {
    return { ...(this.charges.get(wallet.toLowerCase()) ?? emptyBoostCounts()) };
  }

  /** The transaction was credited already. */
  isUsed(tx: string): boolean {
    return this.used.has(tx.toLowerCase());
  }

  /** Credits a verified purchase: marks `tx` used and adds the charges (one write). Throws `tx_used` on a replay. */
  credit(wallet: string, kind: BoostKind, charges: number, tx: string, paid: bigint): BoostCounts {
    const hash = tx.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash) || !Number.isInteger(charges) || charges <= 0) throw new InventoryError('bad_request', 'bad purchase');
    if (this.used.has(hash)) throw new InventoryError('tx_used', 'This transaction was already used for a purchase.');
    const key = wallet.toLowerCase();
    const c = this.charges.get(key) ?? emptyBoostCounts();
    c[kind] += charges;
    this.charges.set(key, c);
    this.used.add(hash);
    this.purchases.push({ tx: hash, wallet: getAddress(wallet), kind, charges, paid: paid.toString(), at: this.now() });
    try {
      this.save();
    } catch (err) {
      // not on disk: roll back so a retry after the disk is fixed still credits it once
      c[kind] -= charges;
      this.used.delete(hash);
      this.purchases.pop();
      throw err;
    }
    this.log(`boosts: ${getAddress(wallet)} bought ${charges} ${kind} (tx ${hash})`);
    return { ...c };
  }

  /** Takes one charge; false when there is none. */
  consume(wallet: string, kind: BoostKind): boolean {
    const c = this.charges.get(wallet.toLowerCase());
    if (!c || c[kind] <= 0) return false;
    c[kind] -= 1;
    try {
      this.save();
    } catch (err) {
      this.log(`boosts: could not save a used charge (${(err as Error).message})`);
    }
    return true;
  }

  /** Purchases, newest first (admin view). */
  recent(limit = 50): PurchaseRecord[] {
    return this.purchases.slice(-Math.max(1, limit)).reverse();
  }

  get purchaseCount(): number {
    return this.purchases.length;
  }
}

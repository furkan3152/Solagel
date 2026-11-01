import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CUSTOM_PAYMENT_MAX_AGE_MS } from '@elymum/shared';
import { createPublicClient, getAddress, type Hash, type PublicClient } from 'viem';
import { budgetTransport } from './evm-client';
import { isTransientRpcError, withRpcPriority } from './rpc-budget';

/**
 * A native HYPE transfer as the chain reports it (`eth_getTransactionByHash` +
 * `eth_getTransactionReceipt` + the block's timestamp).
 */
export interface NativeTransfer {
  hash: string;
  /** Sender (EIP-55). */
  from: string;
  /** Receiver (EIP-55); null for a contract creation. */
  to: string | null;
  /** Value, wei. */
  value: bigint;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  /** Unix ms of the block. */
  timestamp: number;
}

/**
 * Reads payment transactions. `transfer` resolves null while the transaction is not mined (or
 * unknown), and throws `PaymentChainBusy` when the RPC cannot be read right now.
 */
export interface PaymentReader {
  /**
   * `expect` is what the caller wants to see (the dev fake chain answers it for its fake hashes, so
   * the whole flow can be driven without a node); real readers ignore it.
   */
  transfer(hash: string, expect: { from: string; to: string; minWei: bigint }): Promise<NativeTransfer | null>;
}

export class PaymentChainBusy extends Error {
  constructor(cause?: unknown) {
    super('The chain cannot be read right now.');
    this.cause = cause;
  }
}

/**
 * Payment reads on the server's RPC, through the process-wide RPC budget. Three calls per check
 * (transaction, receipt, block) at `normal` priority: room creation is rare and user-initiated,
 * and must never queue in front of paid joins and settlements (`high`).
 */
export function viemPaymentReader(rpcUrl: string): PaymentReader {
  const client = createPublicClient({ transport: budgetTransport(rpcUrl, { batch: true }) }) as PublicClient;
  return {
    transfer: (hash) =>
      withRpcPriority('normal', async () => {
        try {
          const h = hash as Hash;
          const [tx, receipt] = await Promise.all([client.getTransaction({ hash: h }).catch(notFound), client.getTransactionReceipt({ hash: h }).catch(notFound)]);
          if (!tx || !receipt) return null;
          const block = await client.getBlock({ blockNumber: receipt.blockNumber });
          return {
            hash: h,
            from: getAddress(tx.from),
            to: tx.to ? getAddress(tx.to) : null,
            value: tx.value,
            status: receipt.status,
            blockNumber: receipt.blockNumber,
            timestamp: Number(block.timestamp) * 1000,
          };
        } catch (err) {
          if (isTransientRpcError(err)) throw new PaymentChainBusy(err);
          throw err;
        }
      }),
  };
}

/** viem's "not found" errors mean "not mined (yet)"; anything else is rethrown. */
function notFound(err: unknown): null {
  const name = (err as { name?: string })?.name ?? '';
  if (/NotFound/.test(name)) return null;
  throw err;
}

/** The dev fake chain's hashes (`fakeHash` in the web's devFake.ts): `0xde7fa4e0…`. */
export const isDevFakeHash = (h: string): boolean => /^0xde7fa4e0[0-9a-f]{56}$/i.test(h);

/**
 * DEV ONLY (`DEV_FAKE_CHAIN=1`): every fake hash is a payment of exactly what was expected, mined
 * now. Any other hash is unknown.
 */
export function devFakePaymentReader(now: () => number = Date.now): PaymentReader {
  return {
    transfer: async (hash, expect) =>
      isDevFakeHash(hash)
        ? { hash, from: expect.from, to: expect.to, value: expect.minWei, status: 'success', blockNumber: 1n, timestamp: now() }
        : null,
  };
}

export type PaymentCheck =
  | { ok: true; transfer: NativeTransfer }
  | { ok: false; code: 'payment_invalid' | 'payment_pending' | 'payment_stale' | 'payment_low' | 'payment_used'; message: string };

export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Checks a room payment: a successful native transfer from `from` to `to` of at least `minWei`,
 * mined within `CUSTOM_PAYMENT_MAX_AGE_MS`, whose hash was never used. Throws `PaymentChainBusy`.
 */
export async function checkPayment(
  reader: PaymentReader,
  used: UsedPayments,
  p: { hash: string; from: string; to: string; minWei: bigint; now: number },
): Promise<PaymentCheck> {
  if (!TX_HASH_RE.test(p.hash)) return { ok: false, code: 'payment_invalid', message: 'That is not a transaction hash.' };
  if (used.has(p.hash)) return { ok: false, code: 'payment_used', message: 'This payment already opened a room.' };
  const t = await reader.transfer(p.hash, { from: p.from, to: p.to, minWei: p.minWei });
  if (!t) return { ok: false, code: 'payment_pending', message: 'The payment is not confirmed yet. Try again in a few seconds.' };
  if (t.status !== 'success') return { ok: false, code: 'payment_invalid', message: 'The payment transaction failed on chain.' };
  if (t.from.toLowerCase() !== p.from.toLowerCase()) return { ok: false, code: 'payment_invalid', message: 'The payment was sent from another wallet. Pay from the wallet you signed in with.' };
  if (!t.to || t.to.toLowerCase() !== p.to.toLowerCase()) return { ok: false, code: 'payment_invalid', message: 'The payment did not go to the Elymum treasury.' };
  if (t.value < p.minWei) return { ok: false, code: 'payment_low', message: 'The payment is less than the room price.' };
  if (p.now - t.timestamp > CUSTOM_PAYMENT_MAX_AGE_MS) return { ok: false, code: 'payment_stale', message: 'This payment is too old to open a room.' };
  return { ok: true, transfer: t };
}

interface UsedFile {
  v: 1;
  /** Lower-case hash → when it was used, who used it and for which room. */
  used: Record<string, { at: number; wallet: string; code: string }>;
}

/**
 * Payment hashes that already opened a room, persisted per chain (`DATA_DIR/chains/<id>/room-payments.json`,
 * atomic write) so a restart can never let one payment open two rooms. Also holds hashes being checked
 * right now (`claim`), so two requests with the same hash cannot both pass.
 */
export class UsedPayments {
  private readonly used = new Map<string, { at: number; wallet: string; code: string }>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly file: string | null,
    private readonly log: (m: string) => void = () => {},
  ) {
    if (!file || !existsSync(file)) return;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as UsedFile;
      for (const [h, e] of Object.entries(raw.used ?? {})) if (TX_HASH_RE.test(h)) this.used.set(h.toLowerCase(), e);
      if (this.used.size > 0) this.log(`room payments: ${this.used.size} used payment(s) loaded`);
    } catch (err) {
      // never start over silently: a lost file would let old payments open rooms again
      throw new Error(`room payments: ${file} is unreadable (${(err as Error).message}); fix or remove it by hand`);
    }
  }

  get size(): number {
    return this.used.size;
  }

  /** The hash already opened a room. */
  has(hash: string): boolean {
    return this.used.has(hash.toLowerCase());
  }

  /** Reserves a hash while it is being checked; false when it is used or already being checked. */
  claim(hash: string): boolean {
    const h = hash.toLowerCase();
    if (this.used.has(h) || this.inFlight.has(h)) return false;
    this.inFlight.add(h);
    return true;
  }

  release(hash: string): void {
    this.inFlight.delete(hash.toLowerCase());
  }

  /** Marks a hash used for good (written before the room opens). */
  markUsed(hash: string, e: { at: number; wallet: string; code: string }): void {
    const h = hash.toLowerCase();
    this.used.set(h, e);
    this.inFlight.delete(h);
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const body: UsedFile = { v: 1, used: Object.fromEntries(this.used) };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body));
    renameSync(tmp, this.file);
  }
}

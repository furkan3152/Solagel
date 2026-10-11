import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

export interface AdminRecoveryContext {
  wallet: string;
  programId: string;
  rpcUrl: string;
  cluster: string;
}

/** Public transaction metadata only; wallet credentials and admin tokens never enter storage. */
export interface PendingAdminMetadata extends AdminRecoveryContext {
  signature: string;
  lastValidBlockHeight: number;
  genesisHash: string;
  title: string;
  createdAt: number;
}

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'solagel.admin.pending.v1:';

export function adminRecoveryKey(context: AdminRecoveryContext): string {
  return PREFIX + JSON.stringify([context.wallet, context.programId, context.rpcUrl, context.cluster]);
}

function validate(raw: unknown, expected: AdminRecoveryContext): PendingAdminMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid saved transaction recovery data.');
  const value = raw as Record<string, unknown>;
  if (value.wallet !== expected.wallet || value.programId !== expected.programId || value.rpcUrl !== expected.rpcUrl || value.cluster !== expected.cluster) {
    throw new Error('Saved transaction recovery data does not match this wallet, program and network.');
  }
  try {
    new PublicKey(expected.wallet);
    new PublicKey(expected.programId);
    const rpc = new URL(expected.rpcUrl);
    if (rpc.protocol !== 'http:' && rpc.protocol !== 'https:') throw new Error();
    if (typeof value.signature !== 'string' || value.signature.length > 90 || bs58.decode(value.signature).length !== 64) throw new Error();
    if (typeof value.genesisHash !== 'string' || value.genesisHash.length > 50 || bs58.decode(value.genesisHash).length !== 32) throw new Error();
    if (!Number.isSafeInteger(value.lastValidBlockHeight) || Number(value.lastValidBlockHeight) <= 0) throw new Error();
    if (!Number.isSafeInteger(value.createdAt) || Number(value.createdAt) <= 0) throw new Error();
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new Error();
  } catch {
    throw new Error('Invalid saved transaction recovery data. Check the transaction in your wallet before clearing browser storage.');
  }
  return {
    wallet: expected.wallet,
    programId: expected.programId,
    rpcUrl: expected.rpcUrl,
    cluster: expected.cluster,
    signature: value.signature as string,
    genesisHash: value.genesisHash as string,
    lastValidBlockHeight: value.lastValidBlockHeight as number,
    title: value.title as string,
    createdAt: value.createdAt as number,
  };
}

export function loadPendingAdmin(storage: RecoveryStorage, context: AdminRecoveryContext): PendingAdminMetadata | null {
  const raw = storage.getItem(adminRecoveryKey(context));
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved transaction recovery data is unreadable. Check your wallet transaction before clearing browser storage.'); }
  return validate(parsed, context);
}

export function savePendingAdmin(storage: RecoveryStorage, metadata: PendingAdminMetadata): void {
  const safe = validate(metadata, metadata);
  // Explicit projection from validate excludes injected or accidental bearer tokens.
  storage.setItem(adminRecoveryKey(safe), JSON.stringify(safe));
}

/** A late completion must never remove the recovery lock for a newer transaction. */
export function clearPendingAdmin(storage: RecoveryStorage, context: AdminRecoveryContext, signature: string): void {
  const saved = loadPendingAdmin(storage, context);
  if (saved?.signature === signature) storage.removeItem(adminRecoveryKey(context));
}

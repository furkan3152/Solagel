import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { Commitment, Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { toPublicKey, type Address } from './program';

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };

/** Associated token account of `owner` for `mint` under `tokenProgram` (PDA owners allowed). */
export function ata(owner: Address, mint: Address, tokenProgram: Address): PublicKey {
  return getAssociatedTokenAddressSync(toPublicKey(mint), toPublicKey(owner), true, toPublicKey(tokenProgram), ASSOCIATED_TOKEN_PROGRAM_ID);
}

/** Creates `ata(owner, mint, tokenProgram)` unless it already exists (`payer` pays the rent). */
export function createAtaIdempotentIx(payer: Address, owner: Address, mint: Address, tokenProgram: Address): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    toPublicKey(payer),
    ata(owner, mint, tokenProgram),
    toPublicKey(owner),
    toPublicKey(mint),
    toPublicKey(tokenProgram),
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** Amount (u64 LE at offset 64) of an SPL Token / Token-2022 token account; same layout in both. */
export function tokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < 72) throw new RangeError(`not a token account (${data.length} bytes)`);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

/** Balance of `owner`'s associated token account in base units (0 when it does not exist). */
export async function fetchTokenBalance(
  connection: Connection,
  owner: Address,
  mint: Address,
  tokenProgram: Address,
  commitment: Commitment = 'confirmed',
): Promise<bigint> {
  const info = await connection.getAccountInfo(ata(owner, mint, tokenProgram), commitment);
  if (!info || info.data.length < 72) return 0n;
  return tokenAccountAmount(info.data);
}

/**
 * Throws `RangeError` when a raw (base-unit) supply exceeds `Number.MAX_SAFE_INTEGER`: the
 * server and web handle amounts as JS numbers, so such a mint is not supported.
 */
export function assertSafeSupply(rawSupply: bigint): void {
  if (rawSupply < 0n) throw new RangeError(`supply ${rawSupply} is negative`);
  if (rawSupply > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`token supply ${rawSupply} (base units) exceeds Number.MAX_SAFE_INTEGER; this mint is not supported`);
  }
}

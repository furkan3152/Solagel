import { confirmSignature, describeError, type DescribedError, type SlanaClient } from '@slana/sdk';
import type { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

export type AdminPhase = 'signing' | 'sending' | 'confirming';

export type AdminTxResult = { ok: true; signature: string } | { ok: false; error: DescribedError; logs: string[] };

/** The parts of the wallet adapter state the panel signs with. */
export interface AdminSigner {
  publicKey: PublicKey | null;
  signTransaction?: (<T extends Transaction>(tx: T) => Promise<T>) | undefined;
  sendTransaction?: (tx: Transaction, connection: Connection, opts?: { preflightCommitment?: 'confirmed'; maxRetries?: number }) => Promise<string>;
}

/**
 * Builds the admin transaction (fresh blockhash, `SetComputeUnitPrice` first, the wallet pays),
 * has the wallet sign it, sends it with preflight and confirms it by polling (the same
 * `buildTransaction` / `confirmSignature` steps as the game's `sendTx`). Signing and sending
 * are separate so a Ledger behind Phantom or Solflare only signs and the panel reports the
 * simulation logs itself; wallets without `signTransaction` fall back to `sendTransaction`.
 * Never throws.
 */
export async function sendAdminTx(
  client: SlanaClient,
  connection: Connection,
  wallet: AdminSigner,
  ixs: TransactionInstruction[],
  opts: { priorityMicroLamports: number; onPhase?: (phase: AdminPhase, signature?: string) => void },
): Promise<AdminTxResult> {
  if (!wallet.publicKey) return { ok: false, error: { code: null, name: 'NoWallet', message: 'Connect the admin wallet first.' }, logs: [] };
  try {
    const { tx, lastValidBlockHeight } = await client.buildTransaction(ixs, wallet.publicKey, { priorityMicroLamports: opts.priorityMicroLamports });
    opts.onPhase?.('signing');
    let signature: string;
    if (wallet.signTransaction) {
      const signed = await wallet.signTransaction(tx);
      opts.onPhase?.('sending');
      signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed', maxRetries: 4 });
    } else if (wallet.sendTransaction) {
      signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: 'confirmed', maxRetries: 4 });
    } else {
      return { ok: false, error: { code: null, name: 'NoWallet', message: 'This wallet cannot sign transactions.' }, logs: [] };
    }
    opts.onPhase?.('confirming', signature);
    await confirmSignature(connection, signature, lastValidBlockHeight);
    return { ok: true, signature };
  } catch (err) {
    const logs = (err as { logs?: unknown }).logs;
    if (describeError(err).name !== 'UserRejected') console.warn('admin tx failed', err);
    return { ok: false, error: describeError(err), logs: Array.isArray(logs) ? logs.map(String) : [] };
  }
}

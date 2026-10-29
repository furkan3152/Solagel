import { confirmSignature, describeError, type DescribedError, type SlanaClient } from '@elymum/sdk';
import bs58 from 'bs58';
import type { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

export type AdminPhase = 'signing' | 'sending' | 'confirming';

/** A signed transaction whose outcome may still be open: its signature and the last block height it can land in. */
export interface SentTx {
  signature: string;
  lastValidBlockHeight: number;
}

export type AdminTxResult = { ok: true; signature: string } | { ok: false; error: DescribedError; logs: string[]; sent: SentTx | null };

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
  if (!wallet.publicKey) return { ok: false, error: { code: null, name: 'NoWallet', message: 'Connect the admin wallet first.' }, logs: [], sent: null };
  let sent: SentTx | null = null;
  try {
    const { tx, lastValidBlockHeight } = await client.buildTransaction(ixs, wallet.publicKey, { priorityMicroLamports: opts.priorityMicroLamports });
    opts.onPhase?.('signing');
    let signature: string;
    if (wallet.signTransaction) {
      const signed = await wallet.signTransaction(tx);
      opts.onPhase?.('sending');
      const raw = signed.serialize();
      // from here on the transaction may land even if the send call fails: remember it
      if (signed.signature) sent = { signature: bs58.encode(signed.signature), lastValidBlockHeight };
      signature = await connection.sendRawTransaction(raw, { preflightCommitment: 'confirmed', maxRetries: 4 });
    } else if (wallet.sendTransaction) {
      signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: 'confirmed', maxRetries: 4 });
    } else {
      return { ok: false, error: { code: null, name: 'NoWallet', message: 'This wallet cannot sign transactions.' }, logs: [], sent: null };
    }
    sent = { signature, lastValidBlockHeight };
    opts.onPhase?.('confirming', signature);
    await confirmSignature(connection, signature, lastValidBlockHeight);
    return { ok: true, signature };
  } catch (err) {
    const logs = (err as { logs?: unknown }).logs;
    if (describeError(err).name !== 'UserRejected') console.warn('admin tx failed', err);
    // a preflight (simulation) failure never reached the cluster
    const simulated = /simulation failed/i.test((err as Error)?.message ?? '');
    return { ok: false, error: describeError(err), logs: Array.isArray(logs) ? logs.map(String) : [], sent: simulated ? null : sent };
  }
}

export type PreviousOutcome = 'landed' | 'failed' | 'expired' | 'pending';

/**
 * What became of a transaction whose outcome was unknown (timeout, RPC error after the send):
 * landed, failed on chain, expired (can never land: safe to sign again) or still pending.
 */
export async function previousOutcome(connection: Connection, sent: SentTx): Promise<PreviousOutcome> {
  const status = (await connection.getSignatureStatuses([sent.signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) return 'failed';
  if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return 'landed';
  const height = await connection.getBlockHeight('confirmed');
  return height > sent.lastValidBlockHeight && !status ? 'expired' : 'pending';
}

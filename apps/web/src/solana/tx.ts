import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection, Signer, TransactionInstruction } from '@solana/web3.js';
import { confirmSignature, describeError, type DescribeContext, type DescribedError, type SlanaClient } from '@slana/sdk';
import { t } from '../i18n';
import { toast, useUi } from '../store';
import { explorerTx } from './links';
import { PRIORITY_MICRO_LAMPORTS } from './ticket';

export type TxPhase = 'signing' | 'confirming';

export type TxResult = { ok: true; signature: string } | { ok: false; error: DescribedError };

/**
 * Builds the transaction, asks the wallet to sign and send it, then confirms
 * it by polling (works behind proxies and with HTTP-only RPCs). Never throws
 * and never toasts: the caller shows the outcome where the player is looking.
 */
export async function sendTx(
  client: SlanaClient,
  connection: Connection,
  wallet: WalletContextState,
  ixs: TransactionInstruction[],
  opts: {
    onPhase?: (phase: TxPhase, signature?: string) => void;
    describe?: DescribeContext;
    computeUnits?: number;
    /**
     * Extra keypairs that co-sign (the fresh asset of a Pass mint). The wallet signs first
     * (`signTransaction`), then these partial-sign, then the raw transaction is sent: wallets
     * such as Phantom ask dapps to let them sign before any other signer.
     */
    signers?: Signer[];
  } = {},
): Promise<TxResult> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    return { ok: false, error: { code: null, name: 'NoWallet', message: t('tf.err.NoWallet') } };
  }
  try {
    const { tx, lastValidBlockHeight } = await client.buildTransaction(ixs, wallet.publicKey, {
      priorityMicroLamports: PRIORITY_MICRO_LAMPORTS,
      computeUnits: opts.computeUnits,
    });
    opts.onPhase?.('signing');
    if (opts.signers?.length && wallet.signTransaction) {
      // wallet first, then the extra signers, then send the raw bytes ourselves
      const signed = await wallet.signTransaction(tx);
      signed.partialSign(...opts.signers);
      const signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed', maxRetries: 4 });
      opts.onPhase?.('confirming', signature);
      await confirmSignature(connection, signature, lastValidBlockHeight);
      return { ok: true, signature };
    }
    // no signTransaction on this adapter: it signs and sends, adding the extra signers itself
    const signature = await wallet.sendTransaction(tx, connection, {
      preflightCommitment: 'confirmed',
      maxRetries: 4,
      ...(opts.signers?.length ? { signers: opts.signers } : {}),
    });
    opts.onPhase?.('confirming', signature);
    await confirmSignature(connection, signature, lastValidBlockHeight);
    return { ok: true, signature };
  } catch (err) {
    const error = describeError(err, opts.describe);
    if (error.name !== 'UserRejected') console.warn('tx failed', err);
    return { ok: false, error };
  }
}

/** Translated, player-facing text for a failed transaction (SDK English as the fallback). */
export function txErrorText(error: DescribedError): string {
  const key = `tf.err.${error.name ?? ''}`;
  const text = t(key as 'tf.err.NoWallet');
  return text === key ? error.message : text;
}

/**
 * `sendTx` with toasts for every outcome (profile edits, account creation).
 * Resolves to the signature or null.
 */
export async function sendWalletTx(
  client: SlanaClient,
  connection: Connection,
  wallet: WalletContextState,
  ixs: TransactionInstruction[],
  opts: { success?: string } = {},
): Promise<string | null> {
  const res = await sendTx(client, connection, wallet, ixs);
  const cluster = useUi.getState().chain?.cluster ?? 'devnet';
  if (res.ok) {
    toast('success', opts.success ?? t('tx.confirmed'), { href: explorerTx(res.signature, cluster), label: t('tf.viewTx') });
    return res.signature;
  }
  toast(res.error.name === 'UserRejected' ? 'warn' : 'error', `${t('tx.failed')}: ${txErrorText(res.error)}`, undefined, 7000);
  return null;
}

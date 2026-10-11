import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection, TransactionInstruction } from '@solana/web3.js';
import { confirmSignature, describeError, type SolagelClient } from '@solagel/sdk';
import { t } from '../i18n';
import { toast, useUi } from '../store';
import { explorerTx } from './links';

/**
 * Builds, signs (wallet), sends and confirms a transaction. Shows toasts for
 * every outcome and never leaves the UI hanging: always resolves to the
 * signature or null.
 */
export async function sendWalletTx(
  client: SolagelClient,
  connection: Connection,
  wallet: WalletContextState,
  ixs: TransactionInstruction[],
  opts: { success?: string; beforeSign?: () => Promise<void> } = {},
): Promise<string | null> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    toast('error', t('stakes.needWallet'));
    return null;
  }
  let submittedSignature: string | null = null;
  const cluster = useUi.getState().chain?.cluster ?? 'devnet';
  try {
    const { tx, lastValidBlockHeight } = await client.buildTransaction(ixs, wallet.publicKey, { priorityMicroLamports: 20_000 });
    await opts.beforeSign?.();
    const signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: 'confirmed', maxRetries: 4 });
    submittedSignature = signature;
    toast('info', t('tx.sent'), { href: explorerTx(signature, cluster), label: 'Explorer' }, 4000);
    // polling (not WebSocket) confirmation: works behind proxies and with HTTP-only RPCs
    await confirmSignature(connection, signature, lastValidBlockHeight);
    toast('success', opts.success ?? t('tx.confirmed'), { href: explorerTx(signature, cluster), label: 'Explorer' });
    return signature;
  } catch (err) {
    const info = describeError(err);
    if (info.name !== 'UserRejected') console.warn('tx failed', err);
    if (submittedSignature) {
      toast('warn', 'Transaction submitted; confirmation is unavailable. Check the transaction and refresh your tickets before retrying.',
        { href: explorerTx(submittedSignature, cluster), label: 'View transaction' }, 15_000);
      return null;
    }
    toast(info.name === 'UserRejected' ? 'warn' : 'error', `${t('tx.failed')}: ${info.message}`, undefined, 7000);
    return null;
  }
}

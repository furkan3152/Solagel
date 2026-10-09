import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection, TransactionInstruction } from '@solana/web3.js';
import { describeError, type SolagelClient } from '@solagel/sdk';
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
  opts: { success?: string } = {},
): Promise<string | null> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    toast('error', t('stakes.needWallet'));
    return null;
  }
  try {
    const { tx, blockhash, lastValidBlockHeight } = await client.buildTransaction(ixs, wallet.publicKey, { priorityMicroLamports: 20_000 });
    const signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: 'confirmed', maxRetries: 4 });
    const cluster = useUi.getState().chain?.cluster ?? 'devnet';
    toast('info', t('tx.sent'), { href: explorerTx(signature, cluster), label: 'Explorer' }, 4000);
    const { value } = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (value.err) throw Object.assign(new Error(`Transaction failed: ${JSON.stringify(value.err)}`), { signature });
    toast('success', opts.success ?? t('tx.confirmed'), { href: explorerTx(signature, cluster), label: 'Explorer' });
    return signature;
  } catch (err) {
    const info = describeError(err);
    if (info.name !== 'UserRejected') console.warn('tx failed', err);
    toast(info.name === 'UserRejected' ? 'warn' : 'error', `${t('tx.failed')}: ${info.message}`, undefined, 7000);
    return null;
  }
}

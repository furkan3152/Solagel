// @vitest-environment node
// (jsdom typed arrays break web3.js signing; this file renders nothing)
import type { SlanaClient } from '@slana/sdk';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { Keypair, SystemProgram, Transaction, TransactionInstruction, type Connection } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTx } from '../src/solana/tx';

const BLOCKHASH = '11111111111111111111111111111111';

function setup(withSignTransaction: boolean) {
  const order: string[] = [];
  const payer = Keypair.generate();
  const asset = Keypair.generate();
  const ix = new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: asset.publicKey, isSigner: true, isWritable: true },
    ],
    data: Buffer.alloc(0),
  });
  const client = {
    buildTransaction: async () => {
      const tx = new Transaction({ feePayer: payer.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 });
      tx.add(ix);
      return { tx, blockhash: BLOCKHASH, lastValidBlockHeight: 100 };
    },
  } as unknown as SlanaClient;
  // record the real partialSign calls, in order
  const realPartial = Transaction.prototype.partialSign;
  vi.spyOn(Transaction.prototype, 'partialSign').mockImplementation(function (this: Transaction, ...signers) {
    for (const s of signers) order.push(s.publicKey.equals(payer.publicKey) ? 'wallet-sign' : s.publicKey.equals(asset.publicKey) ? 'asset-sign' : 'other-sign');
    return realPartial.apply(this, signers);
  });
  let sent: Buffer | null = null;
  const connection = {
    sendRawTransaction: async (raw: Buffer) => {
      order.push('send-raw');
      sent = raw;
      return 'SIG';
    },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }),
    getBlockHeight: async () => 1,
  } as unknown as Connection;
  const wallet = {
    publicKey: payer.publicKey,
    sendTransaction: vi.fn(async () => {
      order.push('wallet-send');
      return 'SIG';
    }),
    ...(withSignTransaction
      ? {
          signTransaction: async (tx: Transaction) => {
            tx.partialSign(payer);
            return tx;
          },
        }
      : {}),
  } as unknown as WalletContextState;
  return { order, client, connection, wallet, asset, ix, sent: () => sent };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendTx with co-signers (Pass mint)', () => {
  it('lets the wallet sign first, then the asset partial-signs, then sends the raw transaction', async () => {
    const s = setup(true);
    const phases: string[] = [];
    const res = await sendTx(s.client, s.connection, s.wallet, [s.ix], { signers: [s.asset], onPhase: (p) => phases.push(p) });
    expect(res).toEqual({ ok: true, signature: 'SIG' });
    expect(s.order).toEqual(['wallet-sign', 'asset-sign', 'send-raw']);
    expect(s.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(phases).toEqual(['signing', 'confirming']);
    // both signatures are on the bytes that were sent
    const tx = Transaction.from(s.sent()!);
    expect(tx.signatures.every((x) => x.signature !== null)).toBe(true);
    expect(tx.verifySignatures()).toBe(true);
  });

  it('falls back to sendTransaction (with the signers) when the adapter cannot signTransaction', async () => {
    const s = setup(false);
    const res = await sendTx(s.client, s.connection, s.wallet, [s.ix], { signers: [s.asset] });
    expect(res.ok).toBe(true);
    expect(s.order).toEqual(['wallet-send']);
    expect(s.wallet.sendTransaction).toHaveBeenCalledWith(expect.any(Transaction), s.connection, expect.objectContaining({ signers: [s.asset] }));
  });
});

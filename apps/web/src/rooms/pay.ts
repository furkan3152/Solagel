import type { ChainStatus } from '@elymum/shared';
import type { Address, Hash } from 'viem';
import { isDevFake, loadDevFake } from '../wallet/devFakeLoader';
import { sendWithWallet, txErrorText, type TxPhase } from '../wallet/tx';

export type PayResult = { ok: true; hash: Hash } | { ok: false; message: string; rejected: boolean; hash: Hash | null };

/**
 * Sends the room fee: one native HYPE transfer of exactly `wei` from the connected wallet to the
 * treasury `to`, on the server's chain (the wallet is switched first), and waits for its receipt.
 * On a DEV_FAKE_CHAIN server the transfer is simulated (the server accepts the fake hash).
 */
export async function payRoomFee(chain: ChainStatus, to: Address, wei: bigint, onPhase: (p: TxPhase, hash?: Hash) => void): Promise<PayResult> {
  if (isDevFake(chain)) {
    const fake = await loadDevFake();
    if (fake) {
      const r = await fake.fakeHypePayment(wei, onPhase);
      if (r.ok) return r;
      return { ok: false, rejected: r.name === 'UserRejected', hash: null, message: r.name === 'InsufficientFunds' ? 'Not enough HYPE in this wallet for the room fee and gas.' : 'The payment did not go through.' };
    }
  }
  const res = await sendWithWallet((wallet, from) => wallet.sendTransaction({ account: from, to, value: wei, chain: wallet.chain ?? null }), { chain, onPhase });
  if (res.ok) return { ok: true, hash: res.hash };
  return { ok: false, rejected: res.error.kind === 'rejected', hash: res.hash, message: txErrorText(res.error) };
}

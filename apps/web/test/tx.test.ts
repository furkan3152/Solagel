import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import type { SolagelClient } from '@solagel/sdk';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn(), send: vi.fn(), build: vi.fn() }));
vi.mock('@solagel/sdk', () => ({
  confirmSignature: mocks.confirm,
  describeError: (error: Error) => ({ name: error.message === 'rejected' ? 'UserRejected' : 'Unknown', message: error.message }),
}));
vi.mock('../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../src/store', () => ({ toast: mocks.toast, useUi: { getState: () => ({ chain: { cluster: 'devnet' } }) } }));
vi.mock('../src/solana/links', () => ({ explorerTx: (signature: string) => `https://explorer.solana.com/tx/${signature}` }));
import { sendWalletTx } from '../src/solana/tx';

const client = { buildTransaction: mocks.build } as unknown as SolagelClient;
const wallet = { publicKey: {}, sendTransaction: mocks.send } as unknown as WalletContextState;
const connection = {} as Connection;

describe('wallet transaction outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.build.mockResolvedValue({ tx: {}, lastValidBlockHeight: 100 });
    mocks.send.mockResolvedValue('signed-receipt');
    mocks.confirm.mockResolvedValue(undefined);
  });

  it('only returns a signature as success after confirmation', async () => {
    expect(await sendWalletTx(client, connection, wallet, [], { success: 'Ticket ready' })).toBe('signed-receipt');
    expect(mocks.confirm).toHaveBeenCalledWith(connection, 'signed-receipt', 100);
    expect(mocks.toast).toHaveBeenCalledWith('success', 'Ticket ready', expect.objectContaining({ href: expect.stringContaining('signed-receipt') }));
  });

  it('retains an explorer link and reports uncertainty after a submitted transaction times out', async () => {
    mocks.confirm.mockRejectedValueOnce(new Error('RPC timeout'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendWalletTx(client, connection, wallet, [])).toBeNull();
    expect(mocks.toast).toHaveBeenLastCalledWith('warn', expect.stringContaining('confirmation is unavailable'),
      expect.objectContaining({ href: expect.stringContaining('signed-receipt') }), 15_000);
    expect(mocks.toast.mock.calls.some(([kind]) => kind === 'success')).toBe(false);
    warning.mockRestore();
  });

  it('wallet rejection never attempts confirmation or claims a payment exists', async () => {
    mocks.send.mockRejectedValueOnce(new Error('rejected'));
    expect(await sendWalletTx(client, connection, wallet, [])).toBeNull();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenLastCalledWith('warn', expect.stringContaining('rejected'), undefined, 7000);
  });

  it('checks admission again after transaction building and before asking the wallet to sign', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const beforeSign = vi.fn(async () => { throw new Error('New entries are paused'); });
    expect(await sendWalletTx(client, connection, wallet, [], { beforeSign })).toBeNull();
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(beforeSign).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    warning.mockRestore();
  });
});

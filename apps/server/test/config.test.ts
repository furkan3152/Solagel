import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_WALLET, loadConfig } from '../src/config';

describe('off-chain operator configuration', () => {
  it('defaults to the designated canonical public wallet when the override is absent', () => {
    expect(DEFAULT_ADMIN_WALLET).toBe('D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm');
    expect(new PublicKey(DEFAULT_ADMIN_WALLET).toBase58()).toBe(DEFAULT_ADMIN_WALLET);
    expect(new PublicKey(DEFAULT_ADMIN_WALLET).toBytes()).toHaveLength(32);
    expect(loadConfig({}).adminWallets).toEqual([DEFAULT_ADMIN_WALLET]);
  });

  it('replaces the default with the explicit public operator list', () => {
    const first = new PublicKey(new Uint8Array(32).fill(1)).toBase58();
    const second = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
    expect(loadConfig({ ADMIN_WALLETS: ` ${first}, , ${second} ` }).adminWallets).toEqual([first, second]);
  });

  it.each(['', '   ', ' , , '])('disables the default for an explicitly empty override %j', (override) => {
    expect(loadConfig({ ADMIN_WALLETS: override }).adminWallets).toEqual([]);
  });

  it('does not configure an on-chain program or signer from the public operator default', () => {
    const defaultConfig = loadConfig({});
    expect(defaultConfig.chain.programId).toBeNull();
    expect(defaultConfig.chain.serverKeypair).toBeNull();
    expect(defaultConfig.chain).toEqual(loadConfig({ ADMIN_WALLETS: '' }).chain);
  });
});

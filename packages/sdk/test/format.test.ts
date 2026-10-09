import { describe, expect, it } from 'vitest';
import {
  clusterDefaultRpc,
  explorerAddressUrl,
  explorerTxUrl,
  lamportsToSol,
  normalizeCluster,
  shortAddress,
  solToLamports,
} from '../src';

describe('format', () => {
  it('solToLamports is integer-safe', () => {
    expect(solToLamports(0.1)).toBe(100_000_000);
    expect(solToLamports(0.29)).toBe(290_000_000); // 0.29 * 1e9 = 289999999.99999994
    expect(solToLamports(1.1)).toBe(1_100_000_000); // 1.1 * 1e9 = 1100000000.0000002
    expect(solToLamports(0.01)).toBe(10_000_000);
    expect(solToLamports(0.05)).toBe(50_000_000);
    expect(solToLamports(0.000000001)).toBe(1);
    expect(solToLamports(1e-9)).toBe(1);
    expect(solToLamports(0)).toBe(0);
    expect(solToLamports(123.456789123)).toBe(123_456_789_123);
    expect(solToLamports('0.29')).toBe(290_000_000);
    expect(solToLamports(' 2 ')).toBe(2_000_000_000);
    expect(solToLamports(-0.5)).toBe(-500_000_000);
    for (let i = 0; i <= 1000; i++) {
      const sol = i / 100;
      expect(Number.isInteger(solToLamports(sol))).toBe(true);
      expect(solToLamports(sol)).toBe(i * 10_000_000);
    }
    expect(() => solToLamports(Number.NaN)).toThrow(RangeError);
    expect(() => solToLamports('abc')).toThrow(RangeError);
    expect(() => solToLamports(1e10)).toThrow(RangeError); // beyond 2^53 lamports
  });

  it('lamportsToSol', () => {
    expect(lamportsToSol(1_500_000_000)).toBe(1.5);
    expect(lamportsToSol(10_000_000n)).toBe(0.01);
  });

  it('explorer links', () => {
    expect(explorerTxUrl('SIG', 'mainnet-beta')).toBe('https://solscan.io/tx/SIG');
    expect(explorerTxUrl('SIG', 'mainnet')).toBe('https://solscan.io/tx/SIG');
    expect(explorerTxUrl('SIG', 'devnet')).toBe('https://solscan.io/tx/SIG?cluster=devnet');
    expect(explorerAddressUrl('ADDR', 'devnet')).toBe('https://solscan.io/account/ADDR?cluster=devnet');
    expect(explorerAddressUrl('ADDR', 'mainnet-beta')).toBe('https://solscan.io/account/ADDR');
    expect(explorerTxUrl('SIG', 'localnet')).toBe('https://explorer.solana.com/tx/SIG?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899');
    expect(explorerAddressUrl('ADDR', 'localnet')).toBe(
      'https://explorer.solana.com/address/ADDR?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899',
    );
    expect(explorerTxUrl('SIG', 'localnet', 'http://127.0.0.1:8899')).toContain('customUrl=http%3A%2F%2F127.0.0.1%3A8899');
  });

  it('clusters', () => {
    expect(clusterDefaultRpc('localnet')).toBe('http://127.0.0.1:8899');
    expect(clusterDefaultRpc('devnet')).toBe('https://api.devnet.solana.com');
    expect(clusterDefaultRpc('mainnet-beta')).toBe('https://api.mainnet-beta.solana.com');
    expect(normalizeCluster('Mainnet')).toBe('mainnet-beta');
    expect(normalizeCluster(undefined)).toBe('localnet');
    expect(shortAddress('5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472')).toBe('5skf…7472');
  });
});

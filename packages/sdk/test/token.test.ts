import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { TokenNotSetError, assertSafeSupply, ata, createAtaIdempotentIx, createFeeWalletAtaIx, feeWalletAta, fetchTokenBalance, tokenAccountAmount } from '../src';

describe('token helpers', () => {
  it('assertSafeSupply', () => {
    expect(() => assertSafeSupply(10n ** 15n)).not.toThrow(); // pump.fun: 1B tokens × 10^6 base units
    expect(() => assertSafeSupply(BigInt(Number.MAX_SAFE_INTEGER))).not.toThrow();
    expect(() => assertSafeSupply(10n ** 16n)).toThrow(RangeError);
    expect(() => assertSafeSupply(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });

  it('ata differs for SPL Token and Token-2022', () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const spl = ata(owner, mint, TOKEN_PROGRAM_ID);
    const t22 = ata(owner, mint, TOKEN_2022_PROGRAM_ID);
    expect(spl.equals(t22)).toBe(false);
    const expected = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
    expect(t22.equals(expected)).toBe(true);
    expect(ata(owner.toBase58(), mint.toBase58(), TOKEN_PROGRAM_ID.toBase58()).equals(spl)).toBe(true);
    // PDA owners (vaults, config) are allowed
    const pda = PublicKey.findProgramAddressSync([Buffer.from('x')], TOKEN_PROGRAM_ID)[0];
    expect(() => ata(pda, mint, TOKEN_PROGRAM_ID)).not.toThrow();
  });

  it('createAtaIdempotentIx', () => {
    const payer = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const ix = createAtaIdempotentIx(payer, owner, mint, TOKEN_2022_PROGRAM_ID);
    expect(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect([...ix.data]).toEqual([1]); // CreateIdempotent
    expect(ix.keys[1].pubkey.equals(ata(owner, mint, TOKEN_2022_PROGRAM_ID))).toBe(true);
    expect(ix.keys.some((k) => k.pubkey.equals(TOKEN_2022_PROGRAM_ID))).toBe(true);
  });

  it('fetchTokenBalance reads the ATA amount (0 when missing)', async () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(123_456_789_012n, 64);
    expect(tokenAccountAmount(data)).toBe(123_456_789_012n);
    const seen: string[] = [];
    const conn = {
      getAccountInfo: async (k: PublicKey) => {
        seen.push(k.toBase58());
        return seen.length === 1 ? { data, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false } : null;
      },
    } as unknown as Connection;
    expect(await fetchTokenBalance(conn, owner, mint, TOKEN_PROGRAM_ID)).toBe(123_456_789_012n);
    expect(seen[0]).toBe(ata(owner, mint, TOKEN_PROGRAM_ID).toBase58());
    expect(await fetchTokenBalance(conn, owner, mint, TOKEN_PROGRAM_ID)).toBe(0n);
  });

  it('feeWalletAta: the fee wallet ATA of the game mint; throws while the mint is unset', () => {
    const feeWallet = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const config = { feeWallet: feeWallet.toBase58(), tokenMint: mint.toBase58(), tokenProgram: program.toBase58() };
      expect(feeWalletAta(config).equals(ata(feeWallet, mint, program))).toBe(true);
      const ix = createFeeWalletAtaIx(feeWallet, config);
      expect([...ix.data]).toEqual([1]);
      expect(ix.keys[1].pubkey.equals(ata(feeWallet, mint, program))).toBe(true);
    }
    const unset = { feeWallet, tokenMint: null, tokenProgram: null };
    expect(() => feeWalletAta(unset)).toThrow(TokenNotSetError);
    expect(() => createFeeWalletAtaIx(feeWallet, unset)).toThrow(TokenNotSetError);
  });
});

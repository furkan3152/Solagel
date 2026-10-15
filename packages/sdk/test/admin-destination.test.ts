import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { resolveWithdrawDestination } from '../src/admin-destination';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ata } from '../src/token';

const mint = Keypair.generate().publicKey;
const game = { tokenMint: mint, tokenProgram: TOKEN_PROGRAM_ID };
const SYSTEM = new PublicKey('11111111111111111111111111111111');

/** A token account (165-byte base) of `forMint`, optionally with Token-2022 extensions. */
function tokenAccount(forMint: PublicKey, ext = false): Uint8Array {
  const data = new Uint8Array(ext ? 170 : 165);
  data.set(forMint.toBytes(), 0);
  if (ext) data[165] = 2; // AccountType::Account
  return data;
}

describe('withdraw-treasury --to (I4)', () => {
  it('uses a token account of the game mint directly', () => {
    const to = Keypair.generate().publicKey;
    const r = resolveWithdrawDestination(to, { owner: TOKEN_PROGRAM_ID, data: tokenAccount(mint) }, game);
    expect(r).toMatchObject({ ok: true, createAta: null });
    expect(r.ok && r.destination.equals(to)).toBe(true);
    // Token-2022 account with extensions
    const g22 = { tokenMint: mint, tokenProgram: TOKEN_2022_PROGRAM_ID };
    expect(resolveWithdrawDestination(to, { owner: TOKEN_2022_PROGRAM_ID, data: tokenAccount(mint, true) }, g22).ok).toBe(true);
  });

  it('refuses other token-program accounts: another mint, a mint, a multisig', () => {
    const to = Keypair.generate().publicKey;
    const other = resolveWithdrawDestination(to, { owner: TOKEN_PROGRAM_ID, data: tokenAccount(Keypair.generate().publicKey) }, game);
    expect(other).toMatchObject({ ok: false, error: expect.stringMatching(/another mint/) });
    expect(resolveWithdrawDestination(mint, { owner: TOKEN_PROGRAM_ID, data: new Uint8Array(82) }, game)).toMatchObject({ ok: false, error: expect.stringMatching(/mint/) });
    expect(resolveWithdrawDestination(to, { owner: TOKEN_PROGRAM_ID, data: new Uint8Array(355) }, game)).toMatchObject({ ok: false, error: expect.stringMatching(/multisig/) });
    // a game-mint account under the wrong token program
    expect(resolveWithdrawDestination(to, { owner: TOKEN_2022_PROGRAM_ID, data: tokenAccount(mint, true) }, game).ok).toBe(false);
  });

  it("pays a wallet's associated token account, created idempotently", () => {
    const owner = Keypair.generate().publicKey;
    for (const account of [null, { owner: SYSTEM, data: new Uint8Array(0) }]) {
      const r = resolveWithdrawDestination(owner, account, game);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.destination.equals(ata(owner, mint, TOKEN_PROGRAM_ID))).toBe(true);
        expect(r.createAta?.owner.equals(owner)).toBe(true);
      }
    }
  });

  it('refuses an off-curve owner unless --allow-off-curve', () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], TOKEN_PROGRAM_ID);
    expect(resolveWithdrawDestination(pda, null, game)).toMatchObject({ ok: false, error: expect.stringMatching(/off the ed25519 curve/) });
    expect(resolveWithdrawDestination(pda, null, game, true).ok).toBe(true);
  });
});

describe('pass-seed file mode (I4)', () => {
  it('an overwritten (--force) seed file is 0600 even if it was world-readable', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, statSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, resolve } = await import('node:path');
    const file = join(mkdtempSync(join(tmpdir(), 'slana-seed-')), 'seed.json');
    writeFileSync(file, '[]', { mode: 0o644 });
    const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
    execFileSync(tsx, ['src/admin.ts', 'pass-seed', '--new', '--force', '--seed-file', file], { stdio: 'pipe' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  }, 30_000);
});

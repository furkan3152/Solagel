import { readFileSync } from 'node:fs';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, type PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import * as constants from '../src/constants';
import { PROGRAM_ID, SlanaClient, ata, feeWalletAta, pdas } from '../src';

/** A connection that records every method call: builders must make none. */
function spyConnection(): { connection: Connection; calls: string[] } {
  const calls: string[] = [];
  const real = new Connection('http://127.0.0.1:1', 'confirmed');
  const connection = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { connection, calls };
}

const { connection, calls } = spyConnection();
const client = new SlanaClient(connection);
const b58 = (ks: PublicKey[]) => ks.map((k) => k.toBase58());
const keys = (ix: TransactionInstruction) => ix.keys.map((k) => k.pubkey.toBase58());
const meta = (ix: TransactionInstruction, key: PublicKey) => ix.keys.find((k) => k.pubkey.equals(key));
const disc = (ix: TransactionInstruction) => [...ix.data.subarray(0, 8)];

const server = Keypair.generate().publicKey;
const admin = Keypair.generate().publicKey;
const player = Keypair.generate().publicKey;
const feeWallet = Keypair.generate().publicKey;
const tokenMint = Keypair.generate().publicKey;
const token = { tokenMint, tokenProgram: TOKEN_2022_PROGRAM_ID };
const feeWalletToken = feeWalletAta({ feeWallet, ...token });

describe('instruction builders (no RPC)', () => {
  it('initialize: no mint, fee wallet in the args', async () => {
    const init = await client.ix.initialize(admin, { serverAuthority: server, feeWallet, feeBps: 500, settleFeeLamports: 20_000 });
    expect(keys(init)).toEqual(b58([admin, pdas.config(), PROGRAM_ID, pdas.programData(), SystemProgram.programId]));
    expect(meta(init, admin)).toMatchObject({ isSigner: true, isWritable: true });
    // disc | fee_bps u16 | settle_fee_lamports u64 | server_authority 32 | fee_wallet 32
    expect(init.data.length).toBe(8 + 2 + 8 + 32 + 32);
    expect(init.data.readUInt16LE(8)).toBe(500);
    expect(init.data.readBigUInt64LE(10)).toBe(20_000n);
    expect(init.data.subarray(18, 50).equals(server.toBuffer())).toBe(true);
    expect(init.data.subarray(50, 82).equals(feeWallet.toBuffer())).toBe(true);
  });

  it('setTokenMint: admin, config, mint, token program', async () => {
    const ix = await client.ix.setTokenMint(admin, { tokenMint, tokenProgram: TOKEN_PROGRAM_ID });
    expect(keys(ix)).toEqual(b58([admin, pdas.config(), tokenMint, TOKEN_PROGRAM_ID]));
    expect(meta(ix, admin)).toMatchObject({ isSigner: true, isWritable: false });
    expect(meta(ix, pdas.config())).toMatchObject({ isSigner: false, isWritable: true });
    expect(meta(ix, tokenMint)).toMatchObject({ isSigner: false, isWritable: false });
    expect(disc(ix)).toEqual([204, 233, 179, 83, 12, 31, 139, 120]);
    expect(ix.data.length).toBe(8);
  });

  it('updateConfig encodes six options (fee wallet third)', async () => {
    const none = await client.ix.updateConfig(admin, {});
    expect(none.data.length).toBe(8 + 6);
    expect(keys(none)).toEqual(b58([admin, pdas.config()]));
    const fw = await client.ix.updateConfig(admin, { feeWallet });
    // admin None, server None, fee_wallet Some(pubkey), fee None, settle None, paused None
    expect([...fw.data.subarray(8, 11)]).toEqual([0, 0, 1]);
    expect(fw.data.subarray(11, 43).equals(feeWallet.toBuffer())).toBe(true);
    expect([...fw.data.subarray(43)]).toEqual([0, 0, 0]);
    const all = await client.ix.updateConfig(admin, { feeBps: 300, settleFeeLamports: 7n, paused: true });
    expect([...all.data.subarray(8)]).toEqual([0, 0, 0, 1, 0x2c, 0x01, 1, 7, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('createArena and updateArena: no Pass flag', async () => {
    const arena = pdas.arena(9);
    const create = await client.ix.createArena(admin, { id: 9, entryFee: 1_000_000_000n, maxSessions: 300, ...token });
    expect(keys(create)).toEqual(b58([admin, pdas.config(), arena, pdas.vault(arena), tokenMint, TOKEN_2022_PROGRAM_ID, SystemProgram.programId]));
    expect(create.data.length).toBe(8 + 2 + 8 + 2);
    expect(create.data.readUInt16LE(8)).toBe(9);
    expect(create.data.readBigUInt64LE(10)).toBe(1_000_000_000n);
    expect(create.data.readUInt16LE(18)).toBe(300);

    const upd = await client.ix.updateArena(admin, 9, { enabled: false, entryFee: 5n });
    expect(keys(upd)).toEqual(b58([admin, pdas.config(), arena]));
    // Some(false) | None | Some(5u64)
    expect([...upd.data.subarray(8)]).toEqual([1, 0, 0, 1, 5, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('joinArena passes every account explicitly', async () => {
    const ix = await client.ix.joinArena(player, { arenaId: 2, ...token, maxFeeBps: 500, maxEntryFee: 50_000_000_000n, maxSettleFee: 20_000 });
    const arena = pdas.arena(2);
    expect(keys(ix)).toEqual(
      b58([player, pdas.config(), pdas.profile(player), arena, pdas.vault(arena), pdas.session(arena, player), ata(player, tokenMint, TOKEN_2022_PROGRAM_ID), tokenMint, TOKEN_2022_PROGRAM_ID, SystemProgram.programId]),
    );
    expect(meta(ix, player)).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.data.length).toBe(8 + 2 + 8 + 8);
    expect(ix.data.readUInt16LE(8)).toBe(500);
    expect(ix.data.readBigUInt64LE(10)).toBe(50_000_000_000n);
    expect(ix.data.readBigUInt64LE(18)).toBe(20_000n);
    expect(() => client.ix.joinArena(player, { arenaId: 2, ...token, maxFeeBps: 70_000, maxEntryFee: 1, maxSettleFee: 1 })).toThrow(RangeError);
    expect(() => client.ix.joinArena(player, { arenaId: 2, ...token, maxFeeBps: 500, maxEntryFee: -1, maxSettleFee: 1 })).toThrow(RangeError);
  });

  it('settleSession takes the fee wallet token account explicitly', async () => {
    const params = { player, arenaId: 2, sessionId: 41, payout: 123_000_000n, score: 900, kills: 3, xp: 120, feeWalletToken, ...token };
    const ix = await client.ix.settleSession(server, params);
    const arena = pdas.arena(2);
    expect(keys(ix)).toEqual(
      b58([
        server,
        pdas.config(),
        arena,
        pdas.vault(arena),
        pdas.session(arena, player),
        player,
        ata(player, tokenMint, TOKEN_2022_PROGRAM_ID),
        pdas.profile(player),
        feeWalletToken,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
      ]),
    );
    expect(meta(ix, server)).toMatchObject({ isSigner: true, isWritable: true });
    expect(meta(ix, feeWalletToken)).toMatchObject({ isSigner: false, isWritable: true });
    expect(meta(ix, tokenMint)).toMatchObject({ isWritable: false }); // no burn at settle
    // discriminator + session_id u64 + payout u64 + score u32 + kills u16 + xp u32
    expect(ix.data.length).toBe(8 + 8 + 8 + 4 + 2 + 4);
    expect(ix.data.readBigUInt64LE(8)).toBe(41n);
    expect(ix.data.readBigUInt64LE(16)).toBe(123_000_000n);
    expect(ix.data.readUInt32LE(24)).toBe(900);
    expect(ix.data.readUInt16LE(28)).toBe(3);
    expect(ix.data.readUInt32LE(30)).toBe(120);

    // R24: playerToken null settles without a token account (finalize with owed).
    const finalize = await client.ix.settleSession(server, { ...params, playerToken: null });
    expect(keys(finalize)[6]).toBe(PROGRAM_ID.toBase58());
    expect(keys(finalize)[8]).toBe(feeWalletToken.toBase58());
    // any token account of the fee wallet may be passed
    const other = Keypair.generate().publicKey;
    expect(keys(await client.ix.settleSession(server, { ...params, feeWalletToken: other }))[8]).toBe(other.toBase58());
  });

  it('refundSession takes the token accounts (no lock)', async () => {
    const arena = pdas.arena(1);
    const ix = await client.ix.refundSession(player, { arenaId: 1, tokenMint, tokenProgram: TOKEN_PROGRAM_ID });
    expect(keys(ix)).toEqual(b58([player, pdas.config(), arena, pdas.vault(arena), pdas.session(arena, player), ata(player, tokenMint, TOKEN_PROGRAM_ID), tokenMint, TOKEN_PROGRAM_ID]));
  });

  it('sweepArena pays the fee wallet; sweepLoot burns (mint writable)', async () => {
    const arena = pdas.arena(9);
    const sweep = await client.ix.sweepArena(admin, { id: 9, feeWalletToken, ...token });
    expect(keys(sweep)).toEqual(b58([admin, pdas.config(), arena, pdas.vault(arena), feeWalletToken, tokenMint, TOKEN_2022_PROGRAM_ID]));
    expect(meta(sweep, feeWalletToken)).toMatchObject({ isWritable: true });
    expect(sweep.data.length).toBe(8);

    const loot = await client.ix.sweepLoot(server, { id: 9, amount: 123_456_789n, ...token });
    expect(keys(loot)).toEqual(b58([server, pdas.config(), arena, pdas.vault(arena), tokenMint, TOKEN_2022_PROGRAM_ID]));
    expect(meta(loot, server)).toMatchObject({ isSigner: true, isWritable: false });
    expect(meta(loot, pdas.vault(arena))).toMatchObject({ isSigner: false, isWritable: true });
    expect(meta(loot, tokenMint)).toMatchObject({ isSigner: false, isWritable: true });
    // sha256("global:sweep_loot")[..8] + amount (u64 LE)
    expect(disc(loot)).toEqual([221, 67, 119, 145, 176, 100, 54, 6]);
    expect(loot.data.length).toBe(8 + 8);
    expect(loot.data.readBigUInt64LE(8)).toBe(123_456_789n);
  });

  it('profile builders', async () => {
    for (const ix of await Promise.all([client.ix.registerPlayer(player, 'gm_gummy', 3), client.ix.updateProfile(player, { skin: 2 })])) {
      expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    }
    const reg = await client.ix.registerPlayer(player, 'gm_gummy', 3);
    expect(keys(reg)).toEqual(b58([player, pdas.config(), pdas.profile(player), SystemProgram.programId]));
  });

  it('honours a custom program id', async () => {
    const other = Keypair.generate().publicKey;
    const c = new SlanaClient(connection, other.toBase58());
    const ix = await c.ix.joinArena(player, { arenaId: 1, ...token, maxFeeBps: 500, maxEntryFee: 1n, maxSettleFee: 1n });
    expect(ix.programId.equals(other)).toBe(true);
    expect(keys(ix)[3]).toBe(pdas.arena(1, other).toBase58());
    const settle = await c.ix.settleSession(server, { player, arenaId: 1, sessionId: 1, payout: 0, score: 0, kills: 0, xp: 0, feeWalletToken, ...token, playerToken: null });
    expect(keys(settle)[6]).toBe(other.toBase58()); // optional player_token = None (the program id)
    const set = await c.ix.setTokenMint(admin, token);
    expect(keys(set)[1]).toBe(pdas.config(other).toBase58());
  });

  it('builders made zero RPC calls', () => {
    expect(calls).toEqual([]);
  });

  it('buildTransaction prepends ComputeBudget instructions', async () => {
    const c = new SlanaClient(new Connection('http://127.0.0.1:1', 'confirmed'));
    (c.connection as unknown as { getLatestBlockhash: () => Promise<unknown> }).getLatestBlockhash = async () => ({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 99,
    });
    const ix = await c.ix.updateProfile(player, { skin: 1 });
    const { tx, lastValidBlockHeight } = await c.buildTransaction([ix], server, { priorityMicroLamports: 5000, computeUnits: 200_000 });
    expect(lastValidBlockHeight).toBe(99);
    expect(tx.instructions.map((i) => i.programId.toBase58())).toEqual([ComputeBudgetProgram.programId.toBase58(), ComputeBudgetProgram.programId.toBase58(), PROGRAM_ID.toBase58()]);
    const plain = await c.buildTransaction([ix], server);
    expect(plain.tx.instructions).toHaveLength(1);
    expect(plain.tx.feePayer?.equals(server)).toBe(true);
  });
});

describe('constants', () => {
  it('match the IDL constants', () => {
    const idl = JSON.parse(readFileSync(new URL('../src/idl/slana.json', import.meta.url), 'utf8')) as {
      constants: { name: string; value: string }[];
    };
    const value = (name: string) => JSON.parse(idl.constants.find((c) => c.name === name)!.value) as unknown;
    expect(value('MAX_NAME_LEN')).toBe(constants.MAX_NAME_BYTES);
    expect(value('BPS')).toBe(constants.BPS);
    expect(value('MAX_FEE_BPS')).toBe(constants.MAX_FEE_BPS);
    expect(value('MAX_SETTLE_FEE_LAMPORTS')).toBe(constants.MAX_SETTLE_FEE_LAMPORTS);
    expect(value('MIN_ARENA_SESSIONS')).toBe(constants.MIN_ARENA_SESSIONS);
    expect(value('MAX_ARENA_SESSIONS')).toBe(constants.MAX_ARENA_SESSIONS);
    expect(value('SESSION_REFUND_TIMEOUT_SECS')).toBe(constants.SESSION_REFUND_TIMEOUT_SECS);
    expect(value('MAX_XP_PER_GAME')).toBe(constants.MAX_XP_PER_GAME);
    expect(value('MAX_SCORE_PER_GAME')).toBe(constants.MAX_SCORE_PER_GAME);
    expect(value('BASIC_SKINS')).toBe(constants.BASIC_SKINS);
    expect(value('XP_LEVEL_DIVISOR')).toBe(constants.XP_LEVEL_DIVISOR);
    // nothing Pass or season-related is left in the program
    expect(idl.constants.map((c) => c.name).filter((n) => /PASS|SEASON|PRIZE|TREASURY|LEADERBOARD|ENTROPY|CLAIM/.test(n))).toEqual([]);
    expect(constants.DEFAULT_FEE_BPS).toBeLessThanOrEqual(constants.MAX_FEE_BPS);
  });
});

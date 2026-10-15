import { readFileSync } from 'node:fs';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ComputeBudgetProgram, Connection, Keypair, SYSVAR_SLOT_HASHES_PUBKEY, SystemProgram, type PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import * as constants from '../src/constants';
import { MPL_CORE_ID, PROGRAM_ID, SlanaClient, ata, pdas } from '../src';

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

const server = Keypair.generate().publicKey;
const admin = Keypair.generate().publicKey;
const player = Keypair.generate().publicKey;
const tokenMint = Keypair.generate().publicKey;
const passAsset = Keypair.generate().publicKey;
const collection = Keypair.generate().publicKey;
const token = { tokenMint, tokenProgram: TOKEN_2022_PROGRAM_ID };

describe('instruction builders (no RPC)', () => {
  it('joinArena passes every account explicitly', async () => {
    const ix = await client.ix.joinArena(player, { arenaId: 2, ...token, maxFeeBps: 500, maxEntryFee: 50_000_000_000n, maxSettleFee: 20_000 });
    const arena = pdas.arena(2);
    expect(keys(ix)).toEqual(
      b58([
        player,
        pdas.config(),
        pdas.profile(player),
        arena,
        pdas.vault(arena),
        pdas.session(arena, player),
        ata(player, tokenMint, TOKEN_2022_PROGRAM_ID),
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        SystemProgram.programId,
      ]),
    );
    expect(meta(ix, player)).toMatchObject({ isSigner: true, isWritable: true });
    // discriminator + max_fee_bps (u16 LE) + max_entry_fee (u64) + max_settle_fee (u64)
    expect(ix.data.length).toBe(8 + 2 + 8 + 8);
    expect(ix.data.readUInt16LE(8)).toBe(500);
    expect(ix.data.readBigUInt64LE(10)).toBe(50_000_000_000n);
    expect(ix.data.readBigUInt64LE(18)).toBe(20_000n);
    expect(() => client.ix.joinArena(player, { arenaId: 2, ...token, maxFeeBps: 70_000, maxEntryFee: 1, maxSettleFee: 1 })).toThrow(RangeError);
    expect(() => client.ix.joinArena(player, { arenaId: 2, ...token, maxFeeBps: 500, maxEntryFee: -1, maxSettleFee: 1 })).toThrow(RangeError);
  });

  it('joinArenaWithPass includes passLock = PDA(asset)', async () => {
    const ix = await client.ix.joinArenaWithPass(player, { arenaId: 3, passAsset, ...token, maxFeeBps: 200, maxEntryFee: 7n, maxSettleFee: 9n });
    expect(ix.data.readUInt16LE(8)).toBe(200);
    expect(ix.data.readBigUInt64LE(10)).toBe(7n);
    expect(ix.data.readBigUInt64LE(18)).toBe(9n);
    const k = keys(ix);
    expect(k[9]).toBe(passAsset.toBase58());
    expect(k[10]).toBe(pdas.passLock(passAsset).toBase58());
    expect(k).toHaveLength(12);
    expect(meta(ix, pdas.passLock(passAsset))).toMatchObject({ isSigner: false, isWritable: true });
  });

  it('settleSession includes passLock only when hasPass', async () => {
    const params = { player, arenaId: 2, sessionId: 41, payout: 123_000_000n, score: 900, kills: 3, xp: 120, currentSeason: 4, ...token };
    const plain = await client.ix.settleSession(server, { ...params, hasPass: false });
    const arena = pdas.arena(2);
    expect(keys(plain)).toEqual(
      b58([
        server,
        pdas.config(),
        arena,
        pdas.vault(arena),
        pdas.session(arena, player),
        player,
        ata(player, tokenMint, TOKEN_2022_PROGRAM_ID),
        pdas.profile(player),
        pdas.season(4),
        pdas.treasuryVault(),
        pdas.seasonVault(),
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        PROGRAM_ID, // optional pass_lock = None
      ]),
    );
    expect(keys(plain)).not.toContain(pdas.passLock(passAsset).toBase58());
    expect(meta(plain, server)).toMatchObject({ isSigner: true, isWritable: true });
    expect(meta(plain, tokenMint)).toMatchObject({ isWritable: true }); // burn
    // discriminator + session_id u64 + payout u64 + score u32 + kills u16 + xp u32
    expect(plain.data.length).toBe(8 + 8 + 8 + 4 + 2 + 4);
    expect(plain.data.readBigUInt64LE(8)).toBe(41n);
    expect(plain.data.readBigUInt64LE(16)).toBe(123_000_000n);
    expect(plain.data.readUInt32LE(24)).toBe(900);
    expect(plain.data.readUInt16LE(28)).toBe(3);
    expect(plain.data.readUInt32LE(30)).toBe(120);

    const withPass = await client.ix.settleSession(server, { ...params, hasPass: true, passAsset });
    expect(keys(withPass)[13]).toBe(pdas.passLock(passAsset).toBase58());
    expect(() => client.ix.settleSession(server, { ...params, hasPass: true })).toThrow(/passAsset/);

    // R24: playerToken null settles without a token account (finalize with owed).
    const finalize = await client.ix.settleSession(server, { ...params, hasPass: false, playerToken: null });
    expect(keys(finalize)[6]).toBe(PROGRAM_ID.toBase58());
    expect(keys(finalize)).not.toContain(ata(player, tokenMint, TOKEN_2022_PROGRAM_ID).toBase58());
  });

  it('refundSession takes the token accounts and the optional lock', async () => {
    const arena = pdas.arena(1);
    const ix = await client.ix.refundSession(player, { arenaId: 1, tokenMint, tokenProgram: TOKEN_PROGRAM_ID });
    expect(keys(ix)).toEqual(
      b58([player, pdas.config(), arena, pdas.vault(arena), pdas.session(arena, player), ata(player, tokenMint, TOKEN_PROGRAM_ID), tokenMint, TOKEN_PROGRAM_ID, PROGRAM_ID]),
    );
    const locked = await client.ix.refundSession(player, { arenaId: 1, tokenMint, tokenProgram: TOKEN_PROGRAM_ID, passAsset });
    expect(keys(locked)[8]).toBe(pdas.passLock(passAsset).toBase58());
    // A finalized session's lock is already closed: collect passes none.
    const collect = await client.ix.refundSession(player, { arenaId: 1, tokenMint, tokenProgram: TOKEN_PROGRAM_ID, passAsset, finalized: true });
    expect(keys(collect)[8]).toBe(PROGRAM_ID.toBase58());
  });

  it('mintPass: asset co-signs, minter token is optional', async () => {
    const ix = await client.ix.mintPass(player, { asset: passAsset, collection });
    expect(keys(ix)).toEqual(
      b58([player, passAsset, pdas.config(), collection, pdas.passAuthority(), pdas.passMinted(player), PROGRAM_ID, MPL_CORE_ID, SystemProgram.programId]),
    );
    expect(meta(ix, passAsset)).toMatchObject({ isSigner: true, isWritable: true });
    const withToken = await client.ix.mintPass(player, { asset: passAsset, collection, minterToken: ata(player, tokenMint, TOKEN_PROGRAM_ID) });
    expect(keys(withToken)[6]).toBe(ata(player, tokenMint, TOKEN_PROGRAM_ID).toBase58());
  });

  it('claimSeasonReward, sweepArena, withdrawTreasury, createArena', async () => {
    const claim = await client.ix.claimSeasonReward(player, { seasonId: 3, ...token });
    expect(keys(claim)).toEqual(
      b58([player, pdas.config(), pdas.season(3), pdas.seasonVault(), ata(player, tokenMint, TOKEN_2022_PROGRAM_ID), tokenMint, TOKEN_2022_PROGRAM_ID]),
    );
    expect(meta(claim, player)).toMatchObject({ isSigner: true, isWritable: false });
    expect(claim.data.readUInt32LE(8)).toBe(3);

    const arena = pdas.arena(9);
    const sweep = await client.ix.sweepArena(admin, { id: 9, currentSeason: 5, ...token });
    expect(keys(sweep)).toEqual(b58([admin, pdas.config(), arena, pdas.vault(arena), pdas.season(5), pdas.seasonVault(), tokenMint, TOKEN_2022_PROGRAM_ID]));

    const dest = Keypair.generate().publicKey;
    const withdraw = await client.ix.withdrawTreasury(admin, { amount: 10n ** 15n, destination: dest, ...token });
    expect(keys(withdraw)).toEqual(b58([admin, pdas.config(), pdas.treasuryVault(), dest, tokenMint, TOKEN_2022_PROGRAM_ID]));
    expect(withdraw.data.readBigUInt64LE(8)).toBe(10n ** 15n);

    const create = await client.ix.createArena(admin, { id: 9, entryFee: 1_000_000_000n, maxSessions: 300, requiresPass: true, ...token });
    expect(keys(create)).toEqual(b58([admin, pdas.config(), arena, pdas.vault(arena), tokenMint, TOKEN_2022_PROGRAM_ID, SystemProgram.programId]));
    expect(create.data.readUInt16LE(8)).toBe(9);
    expect(create.data.readBigUInt64LE(10)).toBe(1_000_000_000n);
    expect(create.data.readUInt16LE(18)).toBe(300);
    expect(create.data[20]).toBe(1);
  });

  it('initialize and updateConfig encode their args', async () => {
    const init = await client.ix.initialize(admin, {
      serverAuthority: server,
      ...token,
      feeBps: 500,
      passFeeBps: 200,
      split: [5_000, 3_000, 2_000],
      settleFeeLamports: 10_000,
    });
    expect(keys(init)).toEqual(
      b58([admin, pdas.config(), pdas.season(1), tokenMint, TOKEN_2022_PROGRAM_ID, pdas.treasuryVault(), pdas.seasonVault(), PROGRAM_ID, pdas.programData(), SystemProgram.programId]),
    );
    // disc | server 32 | fee u16 | pass fee u16 | treasury u16 | season u16 | burn u16 | settle fee u64
    expect(init.data.length).toBe(8 + 32 + 2 * 5 + 8);
    expect([init.data.readUInt16LE(40), init.data.readUInt16LE(42), init.data.readUInt16LE(44), init.data.readUInt16LE(46), init.data.readUInt16LE(48)]).toEqual([
      500, 200, 5_000, 3_000, 2_000,
    ]);
    expect(init.data.readBigUInt64LE(50)).toBe(10_000n);

    const none = await client.ix.updateConfig(admin, {});
    expect(none.data.length).toBe(8 + 13); // 13 × Option::None
    const split = await client.ix.updateConfig(admin, { split: [4_000, 4_000, 2_000] });
    // admin None, server None, fee None, pass fee None, split Some([u16;3]) …
    expect([...split.data.subarray(8, 8 + 4 + 1 + 6)]).toEqual([0, 0, 0, 0, 1, 0xa0, 0x0f, 0xa0, 0x0f, 0xd0, 0x07]);
    const uri = await client.ix.updateConfig(admin, { passBaseUri: 'https://x.io/p/', passMintOpen: true, passMintStartTs: 1_760_000_000, passMinTokens: 5n });
    expect(uri.data.includes(Buffer.from('https://x.io/p/'))).toBe(true);
    expect(() => client.ix.updateConfig(admin, { passBaseUri: 'https://x.io/p' })).toThrow(/end with/);
  });

  it('pass admin, season and profile builders', async () => {
    const setCollection = await client.ix.setPassCollection(admin, collection);
    expect(keys(setCollection)).toEqual(b58([admin, pdas.config(), collection, pdas.passAuthority()]));
    const hash = new Uint8Array(32).fill(0xab);
    const setHash = await client.ix.setPassSeedHash(admin, hash);
    expect([...setHash.data.subarray(8)]).toEqual([...hash]);
    const reveal = await client.ix.revealPass(admin, new Uint8Array(32).fill(1));
    expect(reveal.data.length).toBe(40);
    const close = await client.ix.closePassMint(admin);
    expect(keys(close)).toEqual(b58([admin, pdas.config()]));
    // permissionless: any signer (here the player) captures the entropy
    const capture = await client.ix.capturePassEntropy(player);
    expect(keys(capture)).toEqual(b58([player, pdas.config(), SYSVAR_SLOT_HASHES_PUBKEY]));
    expect(meta(capture, player)).toMatchObject({ isSigner: true, isWritable: false });
    expect(meta(capture, SYSVAR_SLOT_HASHES_PUBKEY)).toMatchObject({ isSigner: false, isWritable: false });
    expect(() => client.ix.setPassSeedHash(admin, new Uint8Array(31))).toThrow(RangeError);

    const end = await client.ix.endSeason(admin, 5);
    expect(keys(end)).toEqual(b58([admin, pdas.config(), pdas.season(5), pdas.season(6), SystemProgram.programId]));
    const roll = await client.ix.rolloverSeason(admin, 2, 5);
    expect(keys(roll)).toEqual(b58([admin, pdas.config(), pdas.season(2), pdas.season(5)]));
    const upd = await client.ix.updateArena(admin, 9, { enabled: false, entryFee: 5n, requiresPass: true });
    expect(keys(upd)).toEqual(b58([admin, pdas.config(), pdas.arena(9)]));

    for (const ix of await Promise.all([client.ix.registerPlayer(player, 'gm_gummy', 3), client.ix.updateProfile(player, { skin: 2 })])) {
      expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('honours a custom program id', async () => {
    const other = Keypair.generate().publicKey;
    const c = new SlanaClient(connection, other.toBase58());
    const ix = await c.ix.joinArena(player, { arenaId: 1, ...token, maxFeeBps: 500, maxEntryFee: 1n, maxSettleFee: 1n });
    expect(ix.programId.equals(other)).toBe(true);
    expect(keys(ix)[3]).toBe(pdas.arena(1, other).toBase58());
    const settle = await c.ix.settleSession(server, { player, arenaId: 1, sessionId: 1, payout: 0, score: 0, kills: 0, xp: 0, currentSeason: 1, hasPass: false, ...token });
    expect(keys(settle)[13]).toBe(other.toBase58());
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
    expect(tx.instructions.map((i) => i.programId.toBase58())).toEqual([
      ComputeBudgetProgram.programId.toBase58(),
      ComputeBudgetProgram.programId.toBase58(),
      PROGRAM_ID.toBase58(),
    ]);
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
    expect(value('LEADERBOARD_SIZE')).toBe(constants.LEADERBOARD_SIZE);
    expect(value('PRIZE_RANKS')).toBe(constants.PRIZE_RANKS);
    expect(value('PRIZE_SHARES_BPS')).toEqual(constants.PRIZE_SHARES_BPS);
    expect(value('BPS')).toBe(constants.BPS);
    expect(value('MAX_FEE_BPS')).toBe(constants.MAX_FEE_BPS);
    expect(value('MAX_SETTLE_FEE_LAMPORTS')).toBe(constants.MAX_SETTLE_FEE_LAMPORTS);
    expect(value('MIN_ARENA_SESSIONS')).toBe(constants.MIN_ARENA_SESSIONS);
    expect(value('MAX_ARENA_SESSIONS')).toBe(constants.MAX_ARENA_SESSIONS);
    expect(value('MAX_BASE_URI_LEN')).toBe(constants.MAX_BASE_URI_LEN);
    expect(value('MAX_PASS_SUPPLY')).toBe(constants.MAX_PASS_SUPPLY);
    expect(value('MAX_PASS_PER_WALLET')).toBe(constants.MAX_PASS_PER_WALLET);
    expect(value('DEFAULT_PASS_SUPPLY')).toBe(constants.DEFAULT_PASS_SUPPLY);
    expect(value('DEFAULT_PASS_PER_WALLET')).toBe(constants.DEFAULT_PASS_PER_WALLET);
    expect(value('SESSION_REFUND_TIMEOUT_SECS')).toBe(constants.SESSION_REFUND_TIMEOUT_SECS);
    expect(value('CLAIM_WINDOW_SECS')).toBe(constants.CLAIM_WINDOW_SECS);
    expect(value('ENTROPY_DELAY_SLOTS')).toBe(constants.ENTROPY_DELAY_SLOTS);
    expect(value('MAX_XP_PER_GAME')).toBe(constants.MAX_XP_PER_GAME);
    expect(value('MAX_SCORE_PER_GAME')).toBe(constants.MAX_SCORE_PER_GAME);
    expect(value('FIRST_SEASON')).toBe(constants.FIRST_SEASON);
    expect(value('BASIC_SKINS')).toBe(constants.BASIC_SKINS);
    expect(value('XP_LEVEL_DIVISOR')).toBe(constants.XP_LEVEL_DIVISOR);
  });
});

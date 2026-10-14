import { readFileSync } from 'node:fs';
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, type PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import * as constants from '../src/constants';
import { PROGRAM_ID, SlanaClient, pdas } from '../src';

// Port 1 refuses connections: these tests prove the builders never touch the RPC.
const connection = new Connection('http://127.0.0.1:1', 'confirmed');
const client = new SlanaClient(connection);
const keys = (ix: TransactionInstruction) => ix.keys.map((k) => k.pubkey.toBase58());
const meta = (ix: TransactionInstruction, key: PublicKey) => ix.keys.find((k) => k.pubkey.equals(key));

describe('instruction builders (no RPC)', () => {
  const server = Keypair.generate().publicKey;
  const player = Keypair.generate().publicKey;
  const treasury = Keypair.generate().publicKey;

  it('settleSession passes every account explicitly', async () => {
    const ix = await client.ix.settleSession(server, {
      player,
      arenaId: 2,
      sessionId: 41,
      payout: 123_000_000,
      score: 900,
      kills: 3,
      xp: 120,
      currentSeason: 4,
      treasury,
    });
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    const arena = pdas.arena(2);
    expect(keys(ix)).toEqual(
      [server, pdas.config(), arena, pdas.session(arena, player), player, pdas.profile(player), pdas.season(4), treasury].map((k) => k.toBase58()),
    );
    expect(meta(ix, server)).toMatchObject({ isSigner: true, isWritable: false });
    expect(meta(ix, player)).toMatchObject({ isSigner: false, isWritable: true });
    // discriminator + session_id u64 + payout u64 + score u32 + kills u16 + xp u32
    expect(ix.data.length).toBe(8 + 8 + 8 + 4 + 2 + 4);
    expect(ix.data.readBigUInt64LE(8)).toBe(41n);
    expect(ix.data.readBigUInt64LE(16)).toBe(123_000_000n);
    expect(ix.data.readUInt32LE(24)).toBe(900);
    expect(ix.data.readUInt16LE(28)).toBe(3);
    expect(ix.data.readUInt32LE(30)).toBe(120);
  });

  it('recordGame, initialize, endSeason and friends', async () => {
    const record = await client.ix.recordGame(server, { player, currentSeason: 3, score: 10, kills: 1, xp: 2 });
    expect(keys(record)).toEqual([server, pdas.config(), pdas.profile(player), pdas.season(3)].map((k) => k.toBase58()));

    const init = await client.ix.initialize(server, { serverAuthority: server, treasury, feeBps: 500, seasonShareBps: 5000, skinPrice: 50_000_000 });
    expect(keys(init)).toEqual(
      [server, pdas.config(), pdas.season(1), PROGRAM_ID, pdas.programData(), SystemProgram.programId].map((k) => k.toBase58()),
    );

    const end = await client.ix.endSeason(server, 5);
    expect(keys(end)).toEqual([server, pdas.config(), pdas.season(5), pdas.season(6), SystemProgram.programId].map((k) => k.toBase58()));

    const roll = await client.ix.rolloverSeason(server, 2, 5);
    expect(keys(roll)).toEqual([server, pdas.config(), pdas.season(2), pdas.season(5)].map((k) => k.toBase58()));

    const join = await client.ix.joinArena(player, 1);
    expect(keys(join)[4]).toBe(pdas.session(pdas.arena(1), player).toBase58());
    expect(meta(join, player)).toMatchObject({ isSigner: true, isWritable: true });

    for (const ix of await Promise.all([
      client.ix.registerPlayer(player, 'gm_gummy', 3),
      client.ix.updateProfile(player, { skin: 2 }),
      client.ix.buySkin(player, 18, treasury),
      client.ix.refundSession(player, 1),
      client.ix.claimSeasonReward(player, 1),
      client.ix.fundSeason(player, 1, 1_000_000),
      client.ix.updateConfig(server, { paused: true, skinPrice: 1n }),
      client.ix.createArena(server, 9, 10_000_000, 20),
      client.ix.updateArena(server, 9, { enabled: false }),
      client.ix.sweepArena(server, 9, treasury),
    ])) {
      expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    }
  });

  it('honours a custom program id', async () => {
    const other = Keypair.generate().publicKey;
    const c = new SlanaClient(connection, other.toBase58());
    const ix = await c.ix.joinArena(player, 1);
    expect(ix.programId.equals(other)).toBe(true);
    expect(keys(ix)[3]).toBe(pdas.arena(1, other).toBase58());
  });

  it('buildTransaction prepends ComputeBudget instructions', async () => {
    const c = new SlanaClient(connection);
    (c.connection as unknown as { getLatestBlockhash: () => Promise<unknown> }).getLatestBlockhash = async () => ({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 99,
    });
    const ix = await c.ix.recordGame(server, { player, currentSeason: 1, score: 1, kills: 0, xp: 1 });
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
    expect(value('MIN_BUY_IN')).toBe(constants.MIN_BUY_IN_LAMPORTS);
    expect(value('MIN_ARENA_PLAYERS')).toBe(constants.MIN_ARENA_PLAYERS);
    expect(value('MAX_ARENA_PLAYERS')).toBe(constants.MAX_ARENA_PLAYERS);
    expect(value('SESSION_REFUND_TIMEOUT_SECS')).toBe(constants.SESSION_REFUND_TIMEOUT_SECS);
    expect(value('CLAIM_WINDOW_SECS')).toBe(constants.CLAIM_WINDOW_SECS);
    expect(value('MAX_XP_PER_GAME')).toBe(constants.MAX_XP_PER_GAME);
    expect(value('MAX_SCORE_PER_GAME')).toBe(constants.MAX_SCORE_PER_GAME);
    expect(value('FIRST_SEASON')).toBe(constants.FIRST_SEASON);
    expect(value('SKIN_COUNT')).toBe(constants.SKIN_COUNT);
    expect(value('FREE_SKINS')).toBe(constants.FREE_SKINS);
    expect(value('PREMIUM_SKIN_START')).toBe(constants.PREMIUM_SKIN_START);
    expect(value('XP_LEVEL_DIVISOR')).toBe(constants.XP_LEVEL_DIVISOR);
  });
});

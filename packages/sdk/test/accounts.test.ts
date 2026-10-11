import { BorshAccountsCoder } from '@anchor-lang/core';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAMES,
  IDL,
  LEADERBOARD_SIZE,
  SolagelClient,
  computeSettlement,
  decodeName,
  levelFromXp,
  prizeAmount,
  toProfileView,
  toSeasonView,
  toSessionView,
  type RawProfile,
  type RawSeason,
  type RawSession,
} from '../src';

// No RPC is touched: only the coder is used.
const client = new SolagelClient(new Connection('http://127.0.0.1:1'));
const coder = client.program.coder.accounts as BorshAccountsCoder;

/**
 * `BorshAccountsCoder.encode` uses a fixed 1000-byte scratch buffer, which is too small for a
 * Season (8 + 1273 bytes). Fall back to the coder's own layout with a larger buffer.
 */
async function encode(name: string, value: unknown): Promise<Buffer> {
  try {
    return await coder.encode(name, value);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    const layout = (coder as unknown as { accountLayouts: Map<string, { layout: { encode(v: unknown, b: Buffer): number } }> }).accountLayouts.get(name)!;
    const buf = Buffer.alloc(4096);
    const len = layout.layout.encode(value, buf);
    return Buffer.concat([coder.accountDiscriminator(name), buf.subarray(0, len)]);
  }
}

const nameBytes = (s: string): number[] => {
  const b = [...new TextEncoder().encode(s)];
  return [...b, ...new Array(16 - b.length).fill(0)];
};

function rawProfile(owner: PublicKey, name: string, xp: number): RawProfile {
  return {
    owner,
    name: nameBytes(name),
    nameLen: new TextEncoder().encode(name).length,
    skin: 17,
    premiumSkins: 0b11,
    xp: new BN(xp),
    gamesPlayed: 12,
    kills: 34,
    bestScore: 5_678,
    totalScore: new BN(123_456),
    season: 2,
    seasonPoints: new BN('9007199254740991'), // 2^53 - 1 still exact
    stakeGames: 3,
    totalStaked: new BN(300_000_000),
    totalWon: new BN(450_000_000),
    createdAt: new BN(1_760_000_000),
    lastPlayed: new BN(1_760_000_500),
    bump: 254,
  };
}

describe('account decoding', () => {
  it('round-trips the activated flag in the new session layout', async () => {
    const player = Keypair.generate().publicKey;
    const arena = Keypair.generate().publicKey;
    const raw: RawSession = { player, arena, arenaId: 1, buyIn: new BN(10_000_000), openedAt: new BN(123), id: new BN(42), activated: true, bump: 254 };
    const data = await encode(ACCOUNT_NAMES.session, raw);
    expect(data.length).toBe(8 + 32 + 32 + 2 + 8 + 8 + 8 + 1 + 1);
    const view = toSessionView('session', coder.decode<RawSession>(ACCOUNT_NAMES.session, data));
    expect(view).toMatchObject({ activated: true, id: 42, buyIn: 10_000_000, player: player.toBase58() });
  });
  it('profile round-trips through the Anchor coder (UTF-8 name, numbers, level)', async () => {
    const owner = Keypair.generate().publicKey;
    const data = await encode(ACCOUNT_NAMES.profile, rawProfile(owner, 'Çağrı🚀', 800));
    expect(data.length).toBe(8 + 32 + 16 + 1 + 1 + 4 + 8 + 4 + 4 + 4 + 8 + 4 + 8 + 4 + 8 + 8 + 8 + 8 + 1);
    const decoded = coder.decode<RawProfile>(ACCOUNT_NAMES.profile, data);
    const view = toProfileView('ProfilePda1111111111111111111111111111111111', decoded);
    expect(view).toEqual({
      address: 'ProfilePda1111111111111111111111111111111111',
      owner: owner.toBase58(),
      name: 'Çağrı🚀',
      skin: 17,
      premiumSkins: 3,
      xp: 800,
      level: 5,
      gamesPlayed: 12,
      kills: 34,
      bestScore: 5_678,
      totalScore: 123_456,
      season: 2,
      seasonPoints: 9_007_199_254_740_991,
      stakeGames: 3,
      totalStaked: 300_000_000,
      totalWon: 450_000_000,
      createdAt: 1_760_000_000,
      lastPlayed: 1_760_000_500,
    });
  });

  it('name is cut at name_len (garbage after it is ignored)', async () => {
    const raw = rawProfile(Keypair.generate().publicKey, 'bob', 0);
    raw.name = [...new TextEncoder().encode('bobXXXXXXXXXXXXX')];
    const view = toProfileView(PublicKey.default, coder.decode(ACCOUNT_NAMES.profile, await encode(ACCOUNT_NAMES.profile, raw)));
    expect(view.name).toBe('bob');
    expect(view.level).toBe(1);
    expect(decodeName(nameBytes('abcdefghijklmnop'), 16)).toBe('abcdefghijklmnop');
    expect(decodeName(nameBytes('x'), 0)).toBe('');
    expect(decodeName(nameBytes('x'), 99)).toBe('x' + '\0'.repeat(15));
  });

  it('season round-trips; only `count` entries are returned and the pool excludes rent', async () => {
    const players = Array.from({ length: 3 }, () => Keypair.generate().publicKey);
    const empty = { player: PublicKey.default, points: new BN(0), bestScore: 0, name: nameBytes(''), nameLen: 0, skin: 0 };
    const entries = Array.from({ length: LEADERBOARD_SIZE }, (_, i) =>
      i < 3
        ? { player: players[i], points: new BN(3_000 - i * 1_000), bestScore: 900 - i, name: nameBytes(`p${i}`), nameLen: 2, skin: i }
        : // stale bytes beyond `count` must not leak into the view
          { ...empty, player: Keypair.generate().publicKey, points: new BN(1) },
    );
    const raw: RawSeason = {
      id: 7,
      startedAt: new BN(1_760_000_000),
      endedAt: new BN(1_762_000_000),
      finalized: true,
      prizePool: new BN(5_000_000_000),
      claimedMask: 0b101,
      count: 3,
      bump: 253,
      entries,
    };
    const data = await encode(ACCOUNT_NAMES.season, raw);
    expect(data.length).toBe(8 + 4 + 8 + 8 + 1 + 8 + 2 + 1 + 1 + LEADERBOARD_SIZE * (32 + 8 + 4 + 16 + 1 + 1));
    const view = toSeasonView('SeasonPda', coder.decode<RawSeason>(ACCOUNT_NAMES.season, data), 6_000_000_000, 9_806_160);
    expect(view.id).toBe(7);
    expect(view.finalized).toBe(true);
    expect(view.prizePool).toBe(5_000_000_000);
    expect(view.claimedMask).toBe(5);
    expect(view.pool).toBe(6_000_000_000 - 9_806_160);
    expect(view.endedAt).toBe(1_762_000_000);
    expect(view.entries).toEqual([
      { player: players[0].toBase58(), name: 'p0', points: 3_000, bestScore: 900, skin: 0 },
      { player: players[1].toBase58(), name: 'p1', points: 2_000, bestScore: 899, skin: 1 },
      { player: players[2].toBase58(), name: 'p2', points: 1_000, bestScore: 898, skin: 2 },
    ]);

    // count = 0 → no entries; a pool below rent never goes negative
    const none = toSeasonView('SeasonPda', coder.decode<RawSeason>(ACCOUNT_NAMES.season, await encode(ACCOUNT_NAMES.season, { ...raw, count: 0 })), 5, 10);
    expect(none.entries).toEqual([]);
    expect(none.pool).toBe(0);
  });

  it('IDL account names match the coder', () => {
    for (const name of Object.values(ACCOUNT_NAMES)) expect(() => coder.accountDiscriminator(name)).not.toThrow();
    expect(IDL.address).toBe(client.programId.toBase58());
  });
});

describe('math mirrors the program', () => {
  it('levelFromXp = 1 + isqrt(xp / 50), integer exact', () => {
    const cases: [number | bigint, number][] = [
      [0, 1],
      [49, 1],
      [50, 2],
      [199, 2],
      [200, 3],
      [799, 4],
      [800, 5],
      [18_049, 19],
      [18_050, 20],
      [18_446_744_073_709_551_615n, 607_400_100],
    ];
    for (const [xp, level] of cases) expect(levelFromXp(xp)).toBe(level);
    expect(levelFromXp(new BN(50 * 99 * 99))).toBe(100);
    expect(levelFromXp(new BN(50 * 99 * 99 - 1))).toBe(99);
    for (let xp = 0; xp < 20_000; xp += 7) {
      const q = Math.floor(xp / 50);
      const root = levelFromXp(xp) - 1;
      expect(root * root <= q && (root + 1) * (root + 1) > q).toBe(true);
    }
  });

  it('settlement split and prizes', () => {
    expect(computeSettlement(150_000_000, 100_000_000, 500, 5_000)).toEqual({
      fee: 2_500_000,
      seasonCut: 1_250_000,
      treasuryCut: 1_250_000,
      playerAmount: 147_500_000,
    });
    expect(computeSettlement(50_000_000, 100_000_000, 500, 5_000).fee).toBe(0);
    expect(computeSettlement(1_199, 1_000, 500, 5_000)).toEqual({ fee: 9, seasonCut: 4, treasuryCut: 5, playerAmount: 1_190 });
    expect(prizeAmount(1_000_000, 0)).toBe(300_000);
    expect(prizeAmount(1_000_000, 9)).toBe(20_000);
    expect(prizeAmount(1_000_000, 10)).toBe(0);
  });
});

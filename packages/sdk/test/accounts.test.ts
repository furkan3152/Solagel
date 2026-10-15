import { BorshAccountsCoder } from '@anchor-lang/core';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAMES,
  ACCOUNT_BYTES,
  IDL,
  LEADERBOARD_SIZE,
  SlanaClient,
  decodeName,
  toArenaView,
  toConfigView,
  toProfileView,
  toSeasonView,
  toSessionView,
  type RawArena,
  type RawConfig,
  type RawProfile,
  type RawSeason,
  type RawSession,
} from '../src';

// No RPC is touched: only the coder is used.
const client = new SlanaClient(new Connection('http://127.0.0.1:1'));
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
    skin: 5,
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
  it('profile round-trips through the Anchor coder (UTF-8 name, numbers, level)', async () => {
    const owner = Keypair.generate().publicKey;
    const data = await encode(ACCOUNT_NAMES.profile, rawProfile(owner, 'Çağrı🚀', 800));
    expect(data.length).toBe(8 + 32 + 16 + 1 + 1 + 8 + 4 + 4 + 4 + 8 + 4 + 8 + 4 + 8 + 8 + 8 + 8 + 1);
    const decoded = coder.decode<RawProfile>(ACCOUNT_NAMES.profile, data);
    const view = toProfileView('ProfilePda1111111111111111111111111111111111', decoded);
    expect(view).toEqual({
      address: 'ProfilePda1111111111111111111111111111111111',
      owner: owner.toBase58(),
      name: 'Çağrı🚀',
      skin: 5,
      xp: 800,
      level: 5,
      gamesPlayed: 12,
      kills: 34,
      bestScore: 5_678,
      totalScore: 123_456,
      season: 2,
      seasonPoints: 9_007_199_254_740_991,
      stakeGames: 3,
      totalStaked: 300_000_000n,
      totalWon: 450_000_000n,
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

  it('season round-trips; only `count` entries are returned; pool and prize pool are bigint', async () => {
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
      pool: new BN('12000000000000000'),
      claimedMask: 0b101,
      count: 3,
      bump: 253,
      entries,
    };
    const data = await encode(ACCOUNT_NAMES.season, raw);
    expect(data.length).toBe(8 + 4 + 8 + 8 + 1 + 8 + 8 + 2 + 1 + 1 + LEADERBOARD_SIZE * (32 + 8 + 4 + 16 + 1 + 1));
    const view = toSeasonView('SeasonPda', coder.decode<RawSeason>(ACCOUNT_NAMES.season, data));
    expect(view.id).toBe(7);
    expect(view.finalized).toBe(true);
    expect(view.prizePool).toBe(5_000_000_000n);
    expect(view.claimedMask).toBe(5);
    expect(view.pool).toBe(12_000_000_000_000_000n);
    expect(view.endedAt).toBe(1_762_000_000);
    expect(view.entries).toEqual([
      { player: players[0].toBase58(), name: 'p0', points: 3_000, bestScore: 900, skin: 0 },
      { player: players[1].toBase58(), name: 'p1', points: 2_000, bestScore: 899, skin: 1 },
      { player: players[2].toBase58(), name: 'p2', points: 1_000, bestScore: 898, skin: 2 },
    ]);

    // count = 0 → no entries
    const none = toSeasonView('SeasonPda', coder.decode<RawSeason>(ACCOUNT_NAMES.season, await encode(ACCOUNT_NAMES.season, { ...raw, count: 0 })));
    expect(none.entries).toEqual([]);
  });

  it('config round-trips into ConfigView (bigint amounts, pass fields, hex seed)', async () => {
    const k = () => Keypair.generate().publicKey;
    const [admin, server, mint, program, collection] = [k(), k(), k(), k(), k()];
    const uri = 'https://slana.example/pass/';
    const uriBytes = [...new TextEncoder().encode(uri)];
    const raw: RawConfig = {
      admin,
      serverAuthority: server,
      tokenMint: mint,
      tokenProgram: program,
      tokenDecimals: 6,
      feeBps: 500,
      passFeeBps: 200,
      treasuryBps: 5_000,
      seasonBps: 3_000,
      burnBps: 2_000,
      settleFeeLamports: new BN(10_000),
      currentSeason: 3,
      paused: false,
      passCollection: collection,
      passBaseUri: [...uriBytes, ...new Array(96 - uriBytes.length).fill(0)],
      passBaseUriLen: uriBytes.length,
      passSupply: 3_333,
      passMinted: 12,
      passPerWallet: 1,
      passMinTokens: new BN('100000000000'),
      passMintOpen: true,
      passMintStartTs: new BN(1_760_000_000),
      passMintOpened: true,
      passMintEnded: false,
      passSeedHash: new Array(32).fill(0xab),
      passSeed: new Array(32).fill(0),
      passRevealed: false,
      passSeedRevealed: false,
      passEntropyTargetSlot: new BN(0),
      passEntropyCaptured: false,
      passEntropy: new Array(32).fill(0),
      passEntropySlot: new BN(0),
      passFinalSeed: new Array(32).fill(0),
      bump: 255,
      treasuryVaultBump: 254,
      seasonVaultBump: 253,
      totalPlayers: new BN(7),
      totalGames: new BN(70),
      totalSessions: new BN(42),
      totalStaked: new BN('9000000000000000'),
      totalPaidOut: new BN(5),
    };
    const view = toConfigView(coder.decode<RawConfig>(ACCOUNT_NAMES.config, await encode(ACCOUNT_NAMES.config, raw)));
    expect(view).toEqual({
      admin: admin.toBase58(),
      serverAuthority: server.toBase58(),
      tokenMint: mint.toBase58(),
      tokenProgram: program.toBase58(),
      tokenDecimals: 6,
      feeBps: 500,
      passFeeBps: 200,
      treasuryBps: 5_000,
      seasonBps: 3_000,
      burnBps: 2_000,
      settleFeeLamports: 10_000,
      currentSeason: 3,
      paused: false,
      passCollection: collection.toBase58(),
      passBaseUri: uri,
      passSupply: 3_333,
      passMinted: 12,
      passPerWallet: 1,
      passMinTokens: 100_000_000_000n,
      passMintOpen: true,
      passMintStartTs: 1_760_000_000,
      passMintOpened: true,
      passMintEnded: false,
      passSeedHash: 'ab'.repeat(32),
      passSeed: null,
      passSeedRevealed: false,
      passRevealed: false,
      passEntropyTargetSlot: 0,
      passEntropyCaptured: false,
      passEntropy: null,
      passEntropySlot: 0,
      passFinalSeed: null,
      totals: { players: 7, games: 70, sessions: 42, staked: 9_000_000_000_000_000n, paidOut: 5n },
    });
    const unset = toConfigView({ ...raw, passCollection: PublicKey.default, passSeedHash: new Array(32).fill(0), passSeed: new Array(32).fill(1), passSeedRevealed: true });
    expect(unset.passCollection).toBeNull();
    expect(unset.passSeedHash).toBeNull();
    expect(unset.passSeed).toBe('01'.repeat(32));
    // the seed is public once reveal_pass ran, before the traits are (capture_pass_entropy)
    expect([unset.passSeedRevealed, unset.passRevealed, unset.passFinalSeed]).toEqual([true, false, null]);
    // After the reveal the final seed (what traits derive from) is separate from the admin seed.
    const revealed = toConfigView({
      ...raw,
      passMintOpen: false,
      passMintEnded: true,
      passEntropyTargetSlot: new BN(70),
      passEntropyCaptured: true,
      passEntropy: new Array(32).fill(0x5a),
      passEntropySlot: new BN(77),
      passSeed: new Array(32).fill(7),
      passFinalSeed: new Array(32).fill(0xfe),
      passSeedRevealed: true,
      passRevealed: true,
    });
    expect(revealed).toMatchObject({ passMintEnded: true, passEntropyTargetSlot: 70, passEntropyCaptured: true, passEntropy: '5a'.repeat(32), passEntropySlot: 77, passSeed: '07'.repeat(32), passFinalSeed: 'fe'.repeat(32) });
    // Ended, not captured: no entropy yet. Captured, not revealed: the entropy is public, the final seed is not.
    const ended = toConfigView({ ...raw, passMintEnded: true, passEntropyTargetSlot: new BN(9), passEntropy: new Array(32).fill(1) });
    expect([ended.passEntropyTargetSlot, ended.passEntropy]).toEqual([9, null]);
    const captured = toConfigView({ ...raw, passMintEnded: true, passEntropyCaptured: true, passEntropy: new Array(32).fill(1), passFinalSeed: new Array(32).fill(9) });
    expect([captured.passEntropy, captured.passFinalSeed]).toEqual(['01'.repeat(32), null]);
  });

  it('arena and session views', async () => {
    const vault = Keypair.generate().publicKey;
    const rawArena: RawArena = {
      id: 3,
      entryFee: new BN('50000000000'),
      requiresPass: true,
      maxSessions: 300,
      openSessions: 4,
      enabled: true,
      vault,
      vaultBump: 250,
      totalDeposited: new BN(1),
      totalPaidOut: new BN(2),
      bump: 251,
    };
    const arena = toArenaView('ArenaPda', coder.decode<RawArena>(ACCOUNT_NAMES.arena, await encode(ACCOUNT_NAMES.arena, rawArena)), 777n);
    expect(arena).toEqual({
      address: 'ArenaPda',
      id: 3,
      entryFee: 50_000_000_000n,
      requiresPass: true,
      maxSessions: 300,
      openSessions: 4,
      enabled: true,
      vault: vault.toBase58(),
      pot: 777n,
    });

    const player = Keypair.generate().publicKey;
    const asset = Keypair.generate().publicKey;
    const rawSession: RawSession = {
      id: new BN(41),
      player,
      arena: vault,
      arenaId: 3,
      entryFee: new BN('50000000000'),
      openedAt: new BN(1_760_000_000),
      hasPass: true,
      passAsset: asset,
      settleFee: new BN(10_000),
      feeBps: 200,
      bump: 1,
      finalized: true,
      owed: new BN('123456789012'),
    };
    const session = toSessionView('SessionPda', coder.decode<RawSession>(ACCOUNT_NAMES.session, await encode(ACCOUNT_NAMES.session, rawSession)));
    expect(session).toEqual({
      address: 'SessionPda',
      id: 41,
      player: player.toBase58(),
      arena: vault.toBase58(),
      arenaId: 3,
      entryFee: 50_000_000_000n,
      openedAt: 1_760_000_000,
      hasPass: true,
      passAsset: asset.toBase58(),
      settleFee: 10_000,
      feeBps: 200,
      finalized: true,
      owed: 123_456_789_012n,
    });
    expect(toSessionView('S', { ...rawSession, hasPass: false, passAsset: PublicKey.default }).passAsset).toBeNull();
  });

  it('ACCOUNT_BYTES match the IDL account layouts', () => {
    type Ty = string | { array?: [Ty, number]; defined?: { name: string }; option?: Ty };
    const types = new Map((IDL as unknown as { types: { name: string; type: { kind: string; fields?: { type: Ty }[] } }[] }).types.map((t) => [t.name, t.type]));
    const prim: Record<string, number> = { u8: 1, bool: 1, u16: 2, u32: 4, u64: 8, i64: 8, pubkey: 32 };
    const size = (t: Ty): number => {
      if (typeof t === 'string') return prim[t] ?? NaN;
      if (t.array) return size(t.array[0]) * t.array[1];
      if (t.defined) return (types.get(t.defined.name)!.fields ?? []).reduce((n, f) => n + size(f.type), 0);
      return NaN;
    };
    const bytes = (name: string) => 8 + size({ defined: { name } });
    expect(ACCOUNT_BYTES).toEqual({
      playerProfile: bytes('PlayerProfile'),
      session: bytes('Session'),
      passLock: bytes('PassLock'),
      mintCounter: bytes('MintCounter'),
    });
  });

  it('IDL account names match the coder', () => {
    for (const name of Object.values(ACCOUNT_NAMES)) expect(() => coder.accountDiscriminator(name)).not.toThrow();
    expect(IDL.address).toBe(client.programId.toBase58());
  });
});

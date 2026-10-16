import { BorshAccountsCoder } from '@anchor-lang/core';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_BYTES,
  ACCOUNT_NAMES,
  IDL,
  SlanaClient,
  TokenNotSetError,
  decodeName,
  isTokenSet,
  requireToken,
  toArenaView,
  toConfigView,
  toProfileView,
  toSessionView,
  type RawArena,
  type RawConfig,
  type RawProfile,
  type RawSession,
} from '../src';

// No RPC is touched: only the coder is used.
const client = new SlanaClient(new Connection('http://127.0.0.1:1'));
const coder = client.program.coder.accounts as BorshAccountsCoder;
const encode = (name: string, value: unknown): Promise<Buffer> => coder.encode(name, value);

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
    totalScore: new BN('9007199254740991'), // 2^53 - 1 still exact
    stakeGames: 3,
    totalStaked: new BN(300_000_000),
    totalWon: new BN(450_000_000),
    createdAt: new BN(1_760_000_000),
    lastPlayed: new BN(1_760_000_500),
    bump: 254,
  };
}

const k = () => Keypair.generate().publicKey;

function rawConfig(tokenMint: PublicKey, tokenProgram: PublicKey, tokenDecimals: number): RawConfig {
  return {
    admin: k(),
    serverAuthority: k(),
    feeWallet: k(),
    tokenMint,
    tokenProgram,
    tokenDecimals,
    feeBps: 500,
    settleFeeLamports: new BN(20_000),
    paused: false,
    bump: 255,
    totalPlayers: new BN(7),
    totalGames: new BN(70),
    totalSessions: new BN(42),
    totalStaked: new BN('9000000000000000'),
    totalPaidOut: new BN(5),
  };
}

describe('account decoding', () => {
  it('profile round-trips through the Anchor coder (UTF-8 name, numbers, level)', async () => {
    const owner = k();
    const data = await encode(ACCOUNT_NAMES.profile, rawProfile(owner, 'Renée🚀', 800));
    expect(data.length).toBe(ACCOUNT_BYTES.playerProfile);
    const view = toProfileView('ProfilePda1111111111111111111111111111111111', coder.decode<RawProfile>(ACCOUNT_NAMES.profile, data));
    expect(view).toEqual({
      address: 'ProfilePda1111111111111111111111111111111111',
      owner: owner.toBase58(),
      name: 'Renée🚀',
      skin: 5,
      xp: 800,
      level: 5,
      gamesPlayed: 12,
      kills: 34,
      bestScore: 5_678,
      totalScore: 9_007_199_254_740_991,
      stakeGames: 3,
      totalStaked: 300_000_000n,
      totalWon: 450_000_000n,
      createdAt: 1_760_000_000,
      lastPlayed: 1_760_000_500,
    });
  });

  it('name is cut at name_len (garbage after it is ignored)', async () => {
    const raw = rawProfile(k(), 'bob', 0);
    raw.name = [...new TextEncoder().encode('bobXXXXXXXXXXXXX')];
    const view = toProfileView(PublicKey.default, coder.decode(ACCOUNT_NAMES.profile, await encode(ACCOUNT_NAMES.profile, raw)));
    expect(view.name).toBe('bob');
    expect(view.level).toBe(1);
    expect(decodeName(nameBytes('abcdefghijklmnop'), 16)).toBe('abcdefghijklmnop');
    expect(decodeName(nameBytes('x'), 0)).toBe('');
    expect(decodeName(nameBytes('x'), 99)).toBe('x' + '\0'.repeat(15));
  });

  it('config with the token set round-trips into ConfigView', async () => {
    const [mint, program] = [k(), k()];
    const raw = rawConfig(mint, program, 6);
    const data = await encode(ACCOUNT_NAMES.config, raw);
    expect(data.length).toBe(ACCOUNT_BYTES.config);
    const view = toConfigView(coder.decode<RawConfig>(ACCOUNT_NAMES.config, data));
    expect(view).toEqual({
      admin: raw.admin.toBase58(),
      serverAuthority: raw.serverAuthority.toBase58(),
      feeWallet: raw.feeWallet.toBase58(),
      tokenMint: mint.toBase58(),
      tokenProgram: program.toBase58(),
      tokenDecimals: 6,
      feeBps: 500,
      settleFeeLamports: 20_000,
      paused: false,
      totals: { players: 7, games: 70, sessions: 42, staked: 9_000_000_000_000_000n, paidOut: 5n },
    });
    expect(isTokenSet(view)).toBe(true);
    expect(requireToken(view)).toEqual({ tokenMint: mint.toBase58(), tokenProgram: program.toBase58(), tokenDecimals: 6 });
  });

  it('an unset token (default keys) reads as null', async () => {
    const raw = rawConfig(PublicKey.default, PublicKey.default, 0);
    const view = toConfigView(coder.decode<RawConfig>(ACCOUNT_NAMES.config, await encode(ACCOUNT_NAMES.config, raw)));
    expect([view.tokenMint, view.tokenProgram, view.tokenDecimals]).toEqual([null, null, 0]);
    expect(isTokenSet(view)).toBe(false);
    expect(() => requireToken(view)).toThrow(TokenNotSetError);
    // mint and program are set together; a half-set pair counts as unset
    expect(toConfigView({ ...raw, tokenProgram: k() }).tokenProgram).toBeNull();
  });

  it('arena and session views', async () => {
    const vault = k();
    const rawArena: RawArena = {
      id: 3,
      entryFee: new BN('50000000000'),
      maxSessions: 300,
      openSessions: 4,
      enabled: true,
      vault,
      vaultBump: 250,
      totalDeposited: new BN(1),
      totalPaidOut: new BN(2),
      bump: 251,
    };
    const arenaData = await encode(ACCOUNT_NAMES.arena, rawArena);
    expect(arenaData.length).toBe(ACCOUNT_BYTES.arena);
    expect(toArenaView('ArenaPda', coder.decode<RawArena>(ACCOUNT_NAMES.arena, arenaData), 777n)).toEqual({
      address: 'ArenaPda',
      id: 3,
      entryFee: 50_000_000_000n,
      maxSessions: 300,
      openSessions: 4,
      enabled: true,
      vault: vault.toBase58(),
      pot: 777n,
    });

    const player = k();
    const rawSession: RawSession = {
      id: new BN(41),
      player,
      arena: vault,
      arenaId: 3,
      entryFee: new BN('50000000000'),
      openedAt: new BN(1_760_000_000),
      settleFee: new BN(10_000),
      feeBps: 500,
      bump: 1,
      finalized: true,
      owed: new BN('123456789012'),
    };
    const sessionData = await encode(ACCOUNT_NAMES.session, rawSession);
    expect(sessionData.length).toBe(ACCOUNT_BYTES.session);
    expect(toSessionView('SessionPda', coder.decode<RawSession>(ACCOUNT_NAMES.session, sessionData))).toEqual({
      address: 'SessionPda',
      id: 41,
      player: player.toBase58(),
      arena: vault.toBase58(),
      arenaId: 3,
      entryFee: 50_000_000_000n,
      openedAt: 1_760_000_000,
      settleFee: 10_000,
      feeBps: 500,
      finalized: true,
      owed: 123_456_789_012n,
    });
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
    expect(ACCOUNT_BYTES).toEqual({ config: bytes('Config'), playerProfile: bytes('PlayerProfile'), arena: bytes('Arena'), session: bytes('Session') });
    // the sizes documented in DEPLOY.md
    expect(ACCOUNT_BYTES).toEqual({ config: 221, playerProfile: 123, arena: 73, session: 118 });
  });

  it('IDL account names match the coder; no Pass/season accounts remain', () => {
    for (const name of Object.values(ACCOUNT_NAMES)) expect(() => coder.accountDiscriminator(name)).not.toThrow();
    expect(IDL.accounts.map((a) => a.name).sort()).toEqual(['Arena', 'Config', 'PlayerProfile', 'Session']);
    expect(IDL.address).toBe(client.programId.toBase58());
  });
});

import { describe, expect, it } from 'vitest';
import {
  EntityKind,
  PROTOCOL_VERSION,
  PlayerFlag,
  parseJoinTarget,
  type ChainStatus,
  type ClientMessage,
  type ErrorCode,
  type JoinTarget,
  type RoomInfo,
  type ServerMessage,
} from '../src';

describe('protocol v6 constants', () => {
  it('pins the wire values (v6: isBot on player-facing messages, feed left lines)', () => {
    expect(PROTOCOL_VERSION).toBe(6);
    expect(EntityKind.Loot).toBe(6);
    expect(PlayerFlag).toEqual({ Bot: 1, Verified: 2, Staker: 4 });
  });

  it('keeps entity kinds and player flags distinct', () => {
    expect(new Set(Object.values(EntityKind)).size).toBe(Object.keys(EntityKind).length);
    const bits = Object.values(PlayerFlag);
    expect(new Set(bits).size).toBe(bits.length);
    expect(bits.reduce((a, b) => a | b, 0)).toBeLessThanOrEqual(0xff); // flags travel as a u8
  });
});

describe('parseJoinTarget', () => {
  it('parses practice', () => {
    expect(parseJoinTarget('practice')).toEqual({ mode: 'practice' });
  });

  it('parses arena targets', () => {
    expect(parseJoinTarget('arena:3')).toEqual({ mode: 'arena', arenaId: 3 });
    expect(parseJoinTarget('arena:0')).toEqual({ mode: 'arena', arenaId: 0 });
    expect(parseJoinTarget('arena:65535')).toEqual({ mode: 'arena', arenaId: 65535 });
  });

  it('rejects malformed arena ids', () => {
    for (const bad of ['arena:', 'arena:-1', 'arena:x', 'arena:1.5', 'arena:65536', 'arena: 3', 'arena:0x10', 'arena:1e2', 'arena:+3']) {
      expect(parseJoinTarget(bad), bad).toBeNull();
    }
  });

  it('parses private targets and normalises the code', () => {
    expect(parseJoinTarget('private:abcde')).toEqual({ mode: 'private', code: 'ABCDE' });
    expect(parseJoinTarget('private:ab12c')).toEqual({ mode: 'private', code: 'AB12C' });
    expect(parseJoinTarget('private:new')).toEqual({ mode: 'private', code: null });
    expect(parseJoinTarget('private:toolong')).toBeNull();
    expect(parseJoinTarget('private:abcd')).toBeNull();
    expect(parseJoinTarget('private:')).toBeNull();
  });

  it('no longer knows the v1 names', () => {
    expect(parseJoinTarget('stake:1')).toBeNull();
    expect(parseJoinTarget('free')).toBeNull();
    expect(parseJoinTarget('nope')).toBeNull();
    expect(parseJoinTarget('')).toBeNull();
  });
});

/**
 * Compile-time checks of the v2 message shapes. They run under `tsc --noEmit`
 * (pnpm typecheck): a wrong shape, or a removed member that is still accepted
 * (`@ts-expect-error` without an error), fails the build.
 */
describe('v2 message shapes', () => {
  it('type-checks the lobby and chain payloads', () => {
    const chain: ChainStatus = {
      enabled: true,
      chainId: 99801,
      chainName: 'Elysium Testnet',
      rpcUrl: 'https://testnet-rpc.elysium.kinetiq.xyz',
      explorerUrl: 'https://explorer-elysium-testnet.t.conduit.xyz',
      arenaAddress: '0x1111111111111111111111111111111111111111',
      nftAddress: null,
      arenasEnabled: true,
      tokenReady: true,
      token: { address: '0x2222222222222222222222222222222222222222', symbol: '$ELYMUM', decimals: 18 },
      feeBps: 500,
      serverKey: '0x3333333333333333333333333333333333333333',
    };
    // deployed and initialized, token not set yet: practice only, arenas "opening soon"
    const opening: ChainStatus = { ...chain, arenasEnabled: false, tokenReady: false, token: null };
    const offline: ChainStatus = { ...chain, enabled: false, arenasEnabled: false, tokenReady: false, token: null, feeBps: null };
    // @ts-expect-error the Pass status is gone
    const pass: ChainStatus = { ...chain, pass: null };
    // @ts-expect-error seasons are gone
    const season: ChainStatus = { ...chain, currentSeason: 1 };
    // @ts-expect-error clusters are gone (chainId)
    const cluster: ChainStatus = { ...chain, cluster: 'devnet' };
    // @ts-expect-error the token is an ERC-20 address, not a mint
    const mint: ChainStatus = { ...chain, token: { mint: 'x', symbol: '$ELYMUM', decimals: 18 } };
    const pushed: ServerMessage = { t: 'chain', chain };
    expect([opening.tokenReady, pass, season, cluster, mint, pushed.t]).toHaveLength(6);
    const arena: RoomInfo = {
      id: 'arena-1-1',
      mode: 'arena',
      name: 'Asphodel Meadow',
      width: 6400,
      height: 6400,
      players: 3,
      bots: 20,
      maxPlayers: 50,
      arenaId: 1,
      entryFee: 1_000_000_000,
      instance: 1,
      loot: 250_000_000,
    };
    const practice: RoomInfo = { id: 'practice-rookie-1', mode: 'practice', league: 'rookie', name: 'Coin Pond', width: 5600, height: 5600, players: 1, bots: 19, maxPlayers: 40 };
    const priv: RoomInfo = { id: 'priv-ABCDE', mode: 'private', name: 'Private', width: 4600, height: 4600, players: 1, bots: 7, maxPlayers: 20, code: 'ABCDE' };
    // @ts-expect-error the v1 room mode is gone
    const stake: RoomInfo['mode'] = 'stake';
    // @ts-expect-error the v1 room mode is gone
    const free: RoomInfo['mode'] = 'free';
    expect([chain.arenasEnabled, offline.token, arena.entryFee, practice.league, priv.code, stake, free]).toHaveLength(7);
  });

  it('type-checks the client messages', () => {
    const targets: JoinTarget[] = ['practice', 'private:ABCDE', 'arena:1'];
    // @ts-expect-error v1 join target
    const old: JoinTarget = 'stake:1';
    const joins: ClientMessage[] = [
      { t: 'join', room: 'practice', name: 'gm', skin: 0 },
      { t: 'join', room: 'arena:3', name: 'gm', skin: 0 },
    ];
    // @ts-expect-error joins carry no pass
    const withPass: ClientMessage = { t: 'join', room: 'arena:3', name: 'gm', skin: 0, pass: 'x' };
    const auth: ClientMessage = { t: 'auth', address: '0x1111111111111111111111111111111111111111', message: 'm', signature: '0xsig' };
    // @ts-expect-error auth carries an EVM address
    const noAddress: ClientMessage = { t: 'auth', message: 'm', signature: 's' };
    expect([targets, old, joins, withPass, auth, noAddress]).toHaveLength(6);
  });

  it('type-checks the server messages', () => {
    const msgs: ServerMessage[] = [
      { t: 'joined', room: { id: 'x', mode: 'arena', name: 'x', width: 1, height: 1, players: 1, bots: 0, maxPlayers: 50 }, playerId: 1, name: 'n', skin: 0, value: 1000, entryFee: 1000 },
      { t: 'value', value: 1500, delta: 500, reason: 'eat' },
      { t: 'value', value: 1500, delta: 250, reason: 'loot' },
      { t: 'value', value: 0, delta: -1500, reason: 'eaten' },
      { t: 'value', value: 750, delta: -750, reason: 'spill' },
      {
        t: 'death',
        stats: { aliveMs: 1, finalMass: 1, maxMass: 1, foodEaten: 0, cellsEaten: 0, playersEaten: 0, bestRank: 1, valueLost: 1500, byBot: true, lootSpilled: 1500 },
        killer: 'Bot',
        killerSkin: 1,
      },
      { t: 'settled', kind: 'payout', session: '1:0xabc:7', arenaId: 1, txHash: '0xhash', payout: 1950, fee: 50, net: 1950 },
      { t: 'settled', kind: 'death', txHash: '0xhash', payout: 0 },
      { t: 'settled', kind: 'refund', txHash: '0xhash', payout: 1000, collect: true },
      { t: 'authed', address: '0x1111111111111111111111111111111111111111', token: 't', profile: null },
    ];
    // @ts-expect-error the on-chain record kind is gone
    const record: ServerMessage = { t: 'settled', kind: 'record', txHash: '0xhash', payout: 0 };
    // @ts-expect-error payout is now always present
    const noPayout: ServerMessage = { t: 'settled', kind: 'payout', txHash: '0xhash' };
    // @ts-expect-error settlements carry a txHash now
    const sig: ServerMessage = { t: 'settled', kind: 'payout', signature: 'sig', payout: 0 };
    expect([msgs, record, noPayout, sig]).toHaveLength(4);
  });

  it('has the v2 error codes and drops stake_disabled', () => {
    const codes: ErrorCode[] = ['arenas_disabled', 'token_not_set', 'round_closed', 'round_ended'];
    // @ts-expect-error renamed to arenas_disabled
    const gone: ErrorCode = 'stake_disabled';
    // @ts-expect-error the Pass error codes are gone
    const pass: ErrorCode = 'pass_required';
    expect([codes, gone, pass]).toHaveLength(3);
  });
});

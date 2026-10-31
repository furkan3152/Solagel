import { describe, expect, it } from 'vitest';
import { USAGE, formatStatus, parseAddressList, parseArgs, parsePhaseArg, parsePrivateKey, tokens, UsageError } from '../src/admin-lib';
import {
  AdminInputError,
  confirmTypedAddress,
  createArenaRefusal,
  holderPerksRefusal,
  holderPerksWarnings,
  holdersOnlyRefusal,
  ownerRefusal,
  parseAddressInput,
  parseBoolInput,
  parseIntInput,
  planDefaultArenas,
  setFaucetRefusal,
  setTokenRefusal,
  sweepArenaRefusal,
  testTokenRefusal,
  updateArenaRefusal,
  type StatusSnapshot,
} from '../src/ops';
import { chainInfo } from '@elymum/shared';

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('admin CLI parsing', () => {
  it('parses commands, positionals and options', () => {
    const p = parseArgs(['nft:phase', 'allowlist', '--dry-run', '--rpc', 'http://x', '--id=3']);
    expect(p.command).toBe('nft:phase');
    expect(p.positional).toEqual(['allowlist']);
    expect(p.opts.get('dry-run')).toBe(true);
    expect(p.opts.get('rpc')).toBe('http://x');
    expect(p.opts.get('id')).toBe('3');
    expect(() => parseArgs(['a', 'b', 'c'])).toThrow(UsageError);
    expect(tokens(new Map([['fee', '1_000']]), 'fee', 18)).toBe(1000n * 10n ** 18n);
    expect(parsePhaseArg('wl')).toBe('allowlist');
    expect(() => parsePhaseArg('open')).toThrow(UsageError);
    for (const cmd of ['status', 'deploy-arena', 'deploy-nft', 'deploy-test-token', 'set-token', 'create-arena', 'update-arena', 'fee', 'pause', 'unpause', 'server-key', 'sweep-arena', 'nft:phase', 'nft:root', 'nft:price', 'nft:keeper', 'nft:bounds', 'nft:withdraw', 'holder-perks', 'holders-only', 'token:minter', 'token:holder-nft', 'token:faucet']) {
      expect(USAGE).toContain(cmd);
    }
  });

  it('loads a private key from hex or a file', () => {
    expect(parsePrivateKey(KEY)).toBe(KEY);
    expect(parsePrivateKey(KEY.slice(2))).toBe(KEY);
    expect(parsePrivateKey('/key', () => `${KEY}\n`)).toBe(KEY);
    expect(parsePrivateKey('/key', () => JSON.stringify({ privateKey: KEY }))).toBe(KEY);
    expect(() => parsePrivateKey('/key', () => 'nope')).toThrow(UsageError);
    expect(() =>
      parsePrivateKey('/missing', () => {
        throw new Error('ENOENT');
      }),
    ).toThrow(UsageError);
  });

  it('reads address lists', () => {
    expect(parseAddressList(`# wl\n${A}\n\n0xabc,\n`)).toEqual([A, '0xabc']);
    expect(parseAddressList(JSON.stringify([A, { wallet: '0x1' }, { address: '0x2' }]))).toEqual([A, '0x1', '0x2']);
  });
});

describe('ops (shared with the admin panel)', () => {
  it('parses fields', () => {
    expect(parseAddressInput('to', A.toLowerCase())).toBe(A);
    expect(() => parseAddressInput('to', A.replace('C8', 'c8'))).toThrow(/checksum/);
    expect(() => parseAddressInput('to', '0x0000000000000000000000000000000000000000')).toThrow(AdminInputError);
    expect(parseAddressInput('to', '0x0000000000000000000000000000000000000000', { allowZero: true })).toMatch(/^0x0+$/);
    expect(parseIntInput('n', '1_000', 0, 2000)).toBe(1000);
    expect(() => parseIntInput('n', '-1', 0, 2)).toThrow(AdminInputError);
    expect(parseBoolInput('b', 'yes')).toBe(true);
  });

  it('set-token needs the address twice', () => {
    expect(confirmTypedAddress('token', A, A.toLowerCase())).toBe(A);
    expect(() => confirmTypedAddress('token', A, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC')).toThrow(/differ/);
  });

  it('refusals mirror the contract', () => {
    expect(setTokenRefusal({ token: A }, A, true)).toMatch(/already set/);
    expect(setTokenRefusal({ token: null }, A, false)).toMatch(/not a contract/);
    expect(setTokenRefusal({ token: null }, A, true)).toBeNull();
    expect(createArenaRefusal({ token: null }, { id: 1, entryFee: 1n, maxSessions: 2 }, [])).toMatch(/token/);
    expect(createArenaRefusal({ token: A }, { id: 1, entryFee: 1n, maxSessions: 2 }, [1])).toMatch(/exists/);
    expect(updateArenaRefusal({ id: 1, exists: true, entryFee: 5n, openSessions: 2 }, 6n)).toMatch(/open tickets/);
    expect(updateArenaRefusal({ id: 1, exists: true, entryFee: 5n, openSessions: 2 }, 5n)).toBeNull();
    expect(sweepArenaRefusal({ id: 1, exists: true, enabled: true, openSessions: 0 })).toMatch(/disable/);
    expect(sweepArenaRefusal({ id: 1, exists: true, enabled: false, openSessions: 0 })).toBeNull();
    expect(ownerRefusal(A, A.toLowerCase() as `0x${string}`)).toBeNull();
    expect(ownerRefusal(A, null)).toMatch(/connect/);
    expect(testTokenRefusal(4242)).toMatch(/testnet/);
    expect(testTokenRefusal(99801)).toBeNull();
    expect(planDefaultArenas(18, [2])).toMatchObject({ skip: [2] });
    expect(planDefaultArenas(18, [2]).create.map((a) => a.id)).toEqual([1, 3, 4]);
  });

  it('formats the status report', () => {
    const s: StatusSnapshot = {
      chain: chainInfo(31337),
      mainnet: false,
      block: 12n,
      account: { address: A, balance: 10n ** 18n },
      arena: null,
      nft: null,
    };
    const lines = formatStatus(s, 'http://127.0.0.1:8545');
    expect(lines[0]).toContain('Localnet');
    expect(lines.join('\n')).toContain('1 HYPE');
    expect(lines.join('\n')).toContain('ARENA_ADDRESS');
  });

  it('holder perks and faucet refusals', () => {
    expect(holderPerksRefusal(A, true, 300)).toBeNull();
    expect(holderPerksRefusal(null, false, 0)).toBeNull();
    expect(holderPerksRefusal(A, false, 300)).toMatch(/not a contract/);
    expect(holderPerksRefusal(A, true, 1001)).toMatch(/holder fee/);
    expect(holderPerksWarnings({ nft: A, holderFeeBps: 500, feeBps: 500, holdersOnlyIds: [] })[0]).toMatch(/no discount/);
    expect(holderPerksWarnings({ nft: null, holderFeeBps: 0, feeBps: 500, holdersOnlyIds: [4] })[0]).toMatch(/#4/);
    expect(holderPerksWarnings({ nft: A, holderFeeBps: 300, feeBps: 500, holdersOnlyIds: [4] })).toEqual([]);
    expect(holdersOnlyRefusal({ id: 4, exists: true }, true, { holderNft: A })).toBeNull();
    expect(holdersOnlyRefusal({ id: 4, exists: true }, true, { holderNft: null })).toMatch(/holder NFT first/);
    expect(holdersOnlyRefusal({ id: 4, exists: true }, false, { holderNft: null })).toBeNull();
    expect(holdersOnlyRefusal({ id: 9, exists: false }, true, { holderNft: A })).toMatch(/does not exist/);
    expect(setFaucetRefusal({ amount: 1n, holderAmount: 2n, cooldownSecs: 3600 })).toBeNull();
    expect(setFaucetRefusal({ amount: 0n, holderAmount: 2n, cooldownSecs: 3600 })).toMatch(/greater than zero/);
    expect(setFaucetRefusal({ amount: 3n, holderAmount: 2n, cooldownSecs: 3600 })).toMatch(/holder amount/);
    expect(setFaucetRefusal({ amount: 1n, holderAmount: 2n, cooldownSecs: -1 })).toMatch(/cooldown/);
  });

  it('formats holder perks and the TestToken in the status report', () => {
    const T = 10n ** 18n;
    const s: StatusSnapshot = {
      chain: chainInfo(31337),
      mainnet: false,
      block: 12n,
      account: null,
      arena: {
        address: A,
        code: 'ok',
        config: {
          address: A,
          admin: A,
          pendingAdmin: null,
          serverAuthority: A,
          feeWallet: A,
          token: A,
          decimals: 18,
          feeBps: 500,
          paused: false,
          holderNft: A,
          holderFeeBps: 300,
          totals: { sessions: 0n, games: 0n, staked: 0n, paidOut: 0n, fees: 0n, burned: 0n },
        },
        token: null,
        arenas: [
          { id: 4, entryFee: T, vault: 0n, owed: 0n, maxSessions: 300, openSessions: 0, enabled: true, exists: true, totalDeposited: 0n, totalPaidOut: 0n, totalBurned: 0n, lastSweepId: 0n, holdersOnly: true },
        ],
        serverBalance: null,
      },
      nft: null,
      testToken: {
        address: A,
        code: 'ok',
        faucet: { address: A, owner: A, amount: 1_000_000n * T, holderAmount: 2_000_000n * T, cooldownSecs: 3600, holderNft: null },
        serverIsMinter: false,
        accountIsMinter: null,
      },
    };
    const text = formatStatus(s, 'http://127.0.0.1:8545').join('\n');
    expect(text).toMatch(/holder perks: +0x70997970C51812dc3A010C7d01b50e0d17dc79C8 {2}\(holders pay 3.00 %\)/);
    expect(text).toContain('HOLDERS ONLY');
    expect(text).toMatch(/faucet: .*every 3600 s/);
    expect(text).toContain('token:minter');
  });
});

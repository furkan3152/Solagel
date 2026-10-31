import { elymumArenaAbi, elymumNFTAbi, testTokenAbi } from '@elymum/contracts';
import { decodeFunctionData, erc20Abi, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  approveCall,
  chunkSettlements,
  createArenaCall,
  createDefaultArenaCalls,
  defaultArenaParams,
  deployArenaParams,
  effectiveFeeBps,
  getFaucetInfo,
  getTestTokenFaucet,
  joinCall,
  planJoin,
  refundCall,
  rescueCall,
  sessionRefundState,
  setArenaHoldersOnlyCall,
  setFeeBpsCall,
  setHolderPerksCall,
  setTokenCall,
  settleCall,
  settleCalls,
  sweepLootCall,
  testTokenMintCall,
  testTokenSetFaucetCall,
  testTokenSetHolderNftCall,
  testTokenSetMinterCall,
  updateArenaFrom,
} from '../src/arena';
import { describeCall, describeCallLine, encodeCall } from '../src/call';
import * as C from '../src/constants';
import {
  deployNftParams,
  mintAllowlistCall,
  mintPublicCall,
  mintRefusal,
  mintValue,
  parseMintPhase,
  setMerkleRootCall,
  setPhaseCall,
  setPriceBoundsCall,
  setPriceKeeperCall,
  setRoyaltyCall,
} from '../src/nft';

const ARENA = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address;
const NFT = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address;
const TOKEN = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

describe('constants mirror the contracts', () => {
  it('public constants exist in the ABI', () => {
    const names = elymumArenaAbi.filter((x) => x.type === 'function').map((x) => (x as { name: string }).name);
    for (const n of ['BPS', 'MAX_FEE_BPS', 'DEFAULT_FEE_BPS', 'MIN_ARENA_SESSIONS', 'MAX_ARENA_SESSIONS', 'REFUND_DELAY', 'BURN_ADDRESS']) expect(names).toContain(n);
    expect(C.BURN_ADDRESS.toLowerCase()).toBe('0x000000000000000000000000000000000000dead');
  });
});

describe('arena calls', () => {
  it('builds player calls', () => {
    expect(joinCall(ARENA, 1)).toMatchObject({ address: ARENA, functionName: 'join', args: [1] });
    expect(refundCall(ARENA, 4)).toMatchObject({ functionName: 'refund', args: [4] });
    expect(() => joinCall(ARENA, 0)).toThrow(RangeError);
    expect(() => joinCall(ARENA, 70_000)).toThrow(RangeError);
    const a = approveCall(TOKEN, ARENA, 5n);
    expect(a.abi).toBe(erc20Abi);
    expect(decodeFunctionData({ abi: erc20Abi, data: encodeCall(a).data }).args).toEqual([ARENA, 5n]);
  });

  it('settle batches validate and chunk at 40', () => {
    const items = Array.from({ length: 95 }, (_, i) => ({ arenaId: 1, player: P1, sessionId: BigInt(i + 1), payout: 10n }));
    expect(chunkSettlements(items).map((c) => c.length)).toEqual([40, 40, 15]);
    expect(chunkSettlements(items, 50).map((c) => c.length)).toEqual([50, 45]);
    const calls = settleCalls(ARENA, items);
    expect(calls).toHaveLength(3);
    const decoded = decodeFunctionData({ abi: elymumArenaAbi, data: encodeCall(calls[0]).data });
    expect(decoded.functionName).toBe('settle');
    expect((decoded.args![0] as unknown[]).length).toBe(40);
    expect(() => settleCall(ARENA, [])).toThrow(RangeError);
    expect(() => settleCall(ARENA, [{ arenaId: 1, player: P1, sessionId: 0n, payout: 1n }])).toThrow(RangeError);
    expect(() => settleCall(ARENA, [{ arenaId: 1, player: P1, sessionId: 1n, payout: -1n }])).toThrow(RangeError);
    expect(() => settleCall(ARENA, [{ arenaId: 1, player: '0x12' as Address, sessionId: 1n, payout: 1n }])).toThrow(TypeError);
    expect(() => chunkSettlements(items, 0)).toThrow(RangeError);
  });

  it('sweepLoot needs a positive sweep id', () => {
    expect(sweepLootCall(ARENA, 2, 7n, 100n).args).toEqual([2, 7n, 100n]);
    expect(() => sweepLootCall(ARENA, 2, 0n, 1n)).toThrow(RangeError);
  });

  it('builds owner calls with the contract limits', () => {
    expect(setTokenCall(ARENA, TOKEN.toLowerCase() as Address).args).toEqual([TOKEN]);
    expect(() => setTokenCall(ARENA, '0x0000000000000000000000000000000000000000')).toThrow(RangeError);
    expect(setFeeBpsCall(ARENA, 1000).args).toEqual([1000]);
    expect(() => setFeeBpsCall(ARENA, 1001)).toThrow(RangeError);
    expect(() => createArenaCall(ARENA, { id: 1, entryFee: 0n, maxSessions: 10 })).toThrow(RangeError);
    expect(() => createArenaCall(ARENA, { id: 1, entryFee: 1n, maxSessions: 1 })).toThrow(RangeError);
    expect(() => createArenaCall(ARENA, { id: 1, entryFee: 1n, maxSessions: 2001 })).toThrow(RangeError);
    expect(updateArenaFrom(ARENA, { id: 3, entryFee: 5n, maxSessions: 10, enabled: true }, { enabled: false }).args).toEqual([3, 5n, 10, false]);
    expect(rescueCall(ARENA, { token: null, to: P1, amount: 1n }).args[0]).toBe('0x0000000000000000000000000000000000000000');
  });

  it('default arenas come from the shared table', () => {
    const p = defaultArenaParams(18);
    expect(p.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    expect(p[0].entryFee).toBe(1000n * 10n ** 18n);
    expect(p[3].entryFee).toBe(250_000n * 10n ** 18n);
    expect(createDefaultArenaCalls(ARENA, 18, [1, 3]).map((c) => c.args[0])).toEqual([2, 4]);
  });

  it('deploy params validate addresses', () => {
    const d = deployArenaParams({ admin: P1, serverAuthority: P1, feeWallet: P1 });
    expect(d.args).toEqual([P1, P1, P1]);
    expect(d.bytecode.startsWith('0x6080')).toBe(true);
    expect(() => deployArenaParams({ admin: P1, serverAuthority: '0x0000000000000000000000000000000000000000', feeWallet: P1 })).toThrow(RangeError);
  });

  it('refund state', () => {
    const base = { id: 3n, finalized: false, openedAt: 1000, owed: 0n, entryFee: 50n };
    expect(sessionRefundState({ ...base, id: 0n }, 0)).toEqual({ kind: 'none' });
    expect(sessionRefundState({ ...base, finalized: true, owed: 9n }, 0)).toEqual({ kind: 'collect', amount: 9n });
    expect(sessionRefundState(base, 1000 + 86_399)).toEqual({ kind: 'wait', availableAt: 1000 + 86_400 });
    expect(sessionRefundState(base, 1000 + 86_400)).toEqual({ kind: 'refund', amount: 50n });
  });

  it('planJoin approves only when the allowance is short (exact amount)', async () => {
    const reads = (allowance: bigint, balance = 10n ** 30n) => ({
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case 'getArena':
            return { id: 1, entryFee: 1000n, vault: 0n, owed: 0n, maxSessions: 10, openSessions: 0, enabled: true, exists: true, totalDeposited: 0n, totalPaidOut: 0n, totalBurned: 0n, lastSweepId: 0n };
          case 'allowance':
            return allowance;
          case 'balanceOf':
            return balance;
          default:
            throw new Error(functionName);
        }
      },
    });
    const short = await planJoin(reads(999n) as never, { arena: ARENA, arenaId: 1, player: P1, token: TOKEN });
    expect(short.calls.map((c) => c.functionName)).toEqual(['approve', 'join']);
    expect(short.approve!.args).toEqual([ARENA, 1000n]);
    const enough = await planJoin(reads(1000n) as never, { arena: ARENA, arenaId: 1, player: P1, token: TOKEN });
    expect(enough.calls.map((c) => c.functionName)).toEqual(['join']);
    await expect(planJoin(reads(0n, 5n) as never, { arena: ARENA, arenaId: 1, player: P1, token: TOKEN })).rejects.toThrow(/balance/);
  });
});

describe('holder perks', () => {
  const ZERO = '0x0000000000000000000000000000000000000000';

  it('builds the owner calls', () => {
    const c = setHolderPerksCall(ARENA, NFT.toLowerCase() as Address, 300);
    expect(c).toMatchObject({ functionName: 'setHolderPerks', args: [NFT, 300] });
    expect(decodeFunctionData({ abi: elymumArenaAbi, data: encodeCall(c).data }).args).toEqual([NFT, 300]);
    expect(setHolderPerksCall(ARENA, null, 0).args).toEqual([ZERO, 0]);
    expect(() => setHolderPerksCall(ARENA, NFT, 1001)).toThrow(RangeError);
    expect(() => setHolderPerksCall(ARENA, '0x12' as Address, 300)).toThrow(TypeError);
    expect(setArenaHoldersOnlyCall(ARENA, 4, true)).toMatchObject({ functionName: 'setArenaHoldersOnly', args: [4, true] });
    expect(() => setArenaHoldersOnlyCall(ARENA, 0, true)).toThrow(RangeError);
    expect(describeCall(setHolderPerksCall(ARENA, NFT, 300)).signature).toBe('setHolderPerks(address,uint16)');
  });

  it('effective fee: min(fee, holder fee) for holders while the perks are on', () => {
    const on = { feeBps: 500, holderNft: NFT, holderFeeBps: 300 };
    expect(effectiveFeeBps(on, true)).toBe(300);
    expect(effectiveFeeBps(on, false)).toBe(500);
    expect(effectiveFeeBps({ ...on, holderFeeBps: 800 }, true)).toBe(500);
    expect(effectiveFeeBps({ ...on, holderNft: null }, true)).toBe(500);
  });

  /** A full read client: the arena (holders-only or not), its config with the perks, the holder check. */
  const chain = (o: { holder: boolean; holdersOnly?: boolean; balance?: bigint }) => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'getArena':
          return { id: 4, entryFee: 1000n, vault: 0n, owed: 0n, maxSessions: 10, openSessions: 0, enabled: true, exists: true, totalDeposited: 0n, totalPaidOut: 0n, totalBurned: 0n, lastSweepId: 0n, holdersOnly: o.holdersOnly ?? false };
        case 'config':
          return { admin: P1, pendingAdmin: ZERO, serverAuthority: P1, feeWallet: P1, token: TOKEN, decimals: 18, feeBps: 500, paused: false, totalSessions: 0n, totalGames: 0n, totalStaked: 0n, totalPaidOut: 0n, totalFees: 0n, totalBurned: 0n, holderNft: NFT, holderFeeBps: 300 };
        case 'isHolder':
          return o.holder;
        case 'allowance':
          return 0n;
        case 'balanceOf':
          return o.balance ?? 10n ** 30n;
        default:
          throw new Error(functionName);
      }
    },
  });

  it('planJoin reports the holder discount', async () => {
    const h = await planJoin(chain({ holder: true }) as never, { arena: ARENA, arenaId: 4, player: P1 });
    expect(h).toMatchObject({ feeBps: 300, standardFeeBps: 500, holder: true, holderDiscount: true, holdersOnly: false });
    const n = await planJoin(chain({ holder: false }) as never, { arena: ARENA, arenaId: 4, player: P1 });
    expect(n).toMatchObject({ feeBps: 500, standardFeeBps: 500, holder: false, holderDiscount: false });
    expect(n.approve!.address).toBe(TOKEN);
  });

  it('planJoin refuses a holders-only arena early for a wallet without an emblem', async () => {
    await expect(planJoin(chain({ holder: false, holdersOnly: true, balance: 0n }) as never, { arena: ARENA, arenaId: 4, player: P1 })).rejects.toThrow(/holders only/);
    const ok = await planJoin(chain({ holder: true, holdersOnly: true }) as never, { arena: ARENA, arenaId: 4, player: P1 });
    expect(ok).toMatchObject({ holdersOnly: true, feeBps: 300 });
  });
});

describe('TestToken calls', () => {
  it('builds owner and minter calls', () => {
    const m = testTokenSetMinterCall(TOKEN, P1.toLowerCase() as Address, true);
    expect(m).toMatchObject({ abi: testTokenAbi, functionName: 'setMinter', args: [P1, true] });
    expect(() => testTokenSetMinterCall(TOKEN, '0x0000000000000000000000000000000000000000', true)).toThrow(RangeError);
    expect(testTokenSetHolderNftCall(TOKEN, NFT).args).toEqual([NFT]);
    expect(testTokenSetHolderNftCall(TOKEN, null).args).toEqual(['0x0000000000000000000000000000000000000000']);
    const f = testTokenSetFaucetCall(TOKEN, { amount: 1n, holderAmount: 2n, cooldownSecs: 3600 });
    expect(decodeFunctionData({ abi: testTokenAbi, data: encodeCall(f).data }).args).toEqual([1n, 2n, 3600n]);
    expect(() => testTokenSetFaucetCall(TOKEN, { amount: 0n, holderAmount: 2n, cooldownSecs: 1 })).toThrow(RangeError);
    expect(() => testTokenSetFaucetCall(TOKEN, { amount: 3n, holderAmount: 2n, cooldownSecs: 1 })).toThrow(RangeError);
    expect(() => testTokenSetFaucetCall(TOKEN, { amount: 1n, holderAmount: 2n, cooldownSecs: 1.5 })).toThrow(RangeError);
    expect(testTokenMintCall(TOKEN, P1, 5n).args).toEqual([P1, 5n]);
    expect(() => testTokenMintCall(TOKEN, P1, -1n)).toThrow(RangeError);
  });

  it('reads the faucet settings and a wallet\'s faucet state', async () => {
    const reads = {
      readContract: async ({ functionName }: { functionName: string }) =>
        ({
          faucetAmount: 1n,
          holderFaucetAmount: 2n,
          faucetCooldown: 3600n,
          holderNft: '0x0000000000000000000000000000000000000000',
          owner: P1,
          faucetInfo: [2n, 5000n],
        })[functionName],
    } as never;
    expect(await getTestTokenFaucet(reads, TOKEN)).toEqual({ address: TOKEN, owner: P1, amount: 1n, holderAmount: 2n, cooldownSecs: 3600, holderNft: null });
    expect(await getFaucetInfo(reads, TOKEN, P1, 4000)).toEqual({ amount: 2n, nextClaimAt: 5000, canClaim: false, waitSecs: 1000 });
    expect(await getFaucetInfo(reads, TOKEN, P1, 5000)).toMatchObject({ canClaim: true, waitSecs: 0 });
  });
});

describe('nft calls', () => {
  it('mint value = price × qty + 1 % buffer (rounded up)', () => {
    expect(mintValue(25_000_000_000_000_000n, 2)).toBe(50_500_000_000_000_000n);
    expect(mintValue(3n, 1)).toBe(4n);
    expect(mintValue(100n, 1, 0)).toBe(100n);
    expect(mintValue(0n, 3)).toBe(0n);
    expect(() => mintValue(1n, 0)).toThrow(RangeError);
    const proof = [`0x${'11'.repeat(32)}`] as const;
    const c = mintAllowlistCall(NFT, { qty: 2, proof: [...proof], price: 100n });
    expect(c).toMatchObject({ functionName: 'mintAllowlist', args: [2n, [...proof]], value: 202n });
    expect(decodeFunctionData({ abi: elymumNFTAbi, data: encodeCall(c).data }).functionName).toBe('mintAllowlist');
    expect(mintPublicCall(NFT, { qty: 1, price: 100n, bufferBps: 500 }).value).toBe(105n);
  });

  it('phases', () => {
    expect(parseMintPhase('allowlist')).toBe(C.MintPhase.Allowlist);
    expect(parseMintPhase('WL')).toBe(1);
    expect(parseMintPhase(2)).toBe(2);
    expect(() => parseMintPhase('open')).toThrow(RangeError);
    expect(setPhaseCall(NFT, 'public').args).toEqual([2]);
  });

  it('owner calls validate', () => {
    expect(() => setMerkleRootCall(NFT, '0x12')).toThrow(TypeError);
    expect(() => setPriceBoundsCall(NFT, 0n, 1n)).toThrow(RangeError);
    expect(() => setPriceBoundsCall(NFT, 2n, 1n)).toThrow(RangeError);
    expect(setPriceKeeperCall(NFT, null).args).toEqual(['0x0000000000000000000000000000000000000000']);
    expect(() => setRoyaltyCall(NFT, P1, 1001)).toThrow(RangeError);
    expect(deployNftParams({ owner: P1, maxSupply: 100, mintPrice: 1n, wlLimit: 2, publicLimit: 3, baseURI: 'x/', treasury: P1 }).args).toEqual([P1, 100, 1n, 2, 3, 'x/', P1]);
  });

  it('mint refusals mirror the contract', () => {
    const s = { phase: C.MintPhase.Allowlist, maxSupply: 10, totalSupply: 9, wlLimit: 2, publicLimit: 1 } as const;
    expect(mintRefusal(s, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1, eligible: true })).toBeNull();
    expect(mintRefusal(s, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 2 })).toBe('only 1 left');
    expect(mintRefusal(s, { wl: 2, pub: 0 }, { kind: 'allowlist', qty: 1 })).toMatch(/limit/);
    expect(mintRefusal(s, { wl: 0, pub: 0 }, { kind: 'public', qty: 1 })).toMatch(/not open/);
    expect(mintRefusal({ ...s, phase: 0 }, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1 })).toMatch(/closed/);
    expect(mintRefusal(s, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1, eligible: false })).toMatch(/allowlist/);
  });
});

describe('describeCall', () => {
  it('names arguments from the ABI', () => {
    const d = describeCall(setFeeBpsCall(ARENA, 300));
    expect(d.signature).toBe('setFeeBps(uint16)');
    expect(d.args).toEqual([{ name: 'bps', type: 'uint16', value: '300' }]);
    expect(d.valueText).toBeNull();
    const m = describeCall(mintPublicCall(NFT, { qty: 1, price: 10n ** 16n, bufferBps: 0 }));
    expect(m.valueText).toBe('0.01 HYPE');
    expect(describeCallLine(createArenaCall(ARENA, { id: 1, entryFee: 5n, maxSessions: 10 }))).toBe(`createArena(id=1, entryFee=5, maxSessions=10) → ${ARENA}`);
  });
});

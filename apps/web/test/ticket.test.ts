import { elymumArenaAbi, planJoin, refundCall, sessionRefundState } from '@elymum/sdk';
import type { RoomInfo } from '@elymum/shared';
import { erc20Abi, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { openSessionOf } from '../src/wallet/chain';
import {
  buildTickets,
  feeBps,
  ledgerToBase,
  planErrorName,
  quickPlayTarget,
  sessionKey,
  sessionsToCollect,
  ticketGate,
  ticketSteps,
  type GateInput,
  type TicketModel,
} from '../src/wallet/ticket';
import { ALICE, ONE } from './evm-helpers';

const ARENA = '0x00000000000000000000000000000000000a4e4a' as Address;
const TOKEN = '0x0000000000000000000000000000000000007e57' as Address;
/** One whole token in ledger units (the server's wire amounts: 6 decimals). */
const L = 1_000_000;

/** A read client for `planJoin`: the arena, its config, the allowance and the balance. */
function reader(o: { entryFee?: bigint; enabled?: boolean; exists?: boolean; open?: number; allowance?: bigint; balance?: bigint } = {}) {
  return {
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      switch (functionName) {
        case 'getArena':
          return {
            id: args![0],
            entryFee: o.entryFee ?? 1000n * ONE,
            vault: 0n,
            owed: 0n,
            maxSessions: 300,
            openSessions: o.open ?? 0,
            enabled: o.enabled ?? true,
            exists: o.exists ?? true,
            totalDeposited: 0n,
            totalPaidOut: 0n,
            totalBurned: 0n,
            lastSweepId: 0n,
          };
        case 'allowance':
          return o.allowance ?? 0n;
        case 'balanceOf':
          return o.balance ?? 12_450n * ONE;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  } as never;
}

describe('the ticket calls (approve, then join)', () => {
  it('asks for an exact-amount approve only when the allowance is short', async () => {
    const plan = await planJoin(reader(), { arena: ARENA, arenaId: 3, player: ALICE, token: TOKEN });
    expect(plan.calls.map((c) => c.functionName)).toEqual(['approve', 'join']);
    // exactly the entry fee, to the arena: never an unlimited approval
    expect(plan.approve!.abi).toBe(erc20Abi);
    expect(plan.approve!.args).toEqual([ARENA, 1000n * ONE]);
    expect(plan.approve!.address).toBe(TOKEN);
    expect(plan.join).toMatchObject({ address: ARENA, functionName: 'join', args: [3] });
    const enough = await planJoin(reader({ allowance: 1000n * ONE }), { arena: ARENA, arenaId: 3, player: ALICE, token: TOKEN });
    expect(enough.calls.map((c) => c.functionName)).toEqual(['join']);
  });

  it('ticketSteps mirrors it (an unknown allowance asks for the approval)', () => {
    expect(ticketSteps(0n, 1000n * ONE)).toEqual(['approve', 'join']);
    expect(ticketSteps(null, 1000n * ONE)).toEqual(['approve', 'join']);
    expect(ticketSteps(5000n * ONE, 1000n * ONE)).toEqual(['join']);
  });

  it('refuses a full or closed arena and a short balance before anything is signed', async () => {
    await expect(planJoin(reader({ open: 300 }), { arena: ARENA, arenaId: 1, player: ALICE, token: TOKEN })).rejects.toThrow(/is full/);
    await expect(planJoin(reader({ enabled: false }), { arena: ARENA, arenaId: 1, player: ALICE, token: TOKEN })).rejects.toThrow(/is closed/);
    await expect(planJoin(reader({ balance: 10n }), { arena: ARENA, arenaId: 1, player: ALICE, token: TOKEN })).rejects.toThrow(/balance too low/);
    expect(planErrorName('arena #1 is full')).toBe('ArenaFull');
    expect(planErrorName('arena #1 is closed')).toBe('ArenaDisabled');
    expect(planErrorName('balance too low for the ticket (need 1, have 0 base units)')).toBe('InsufficientBalance');
    expect(planErrorName('the arena contract has no game token yet')).toBe('TokenNotSet');
  });

  it('collect and refund are the same refund(arenaId) call; the session state decides which', () => {
    const call = refundCall(ARENA, 2);
    expect(call.abi).toBe(elymumArenaAbi);
    expect(call).toMatchObject({ functionName: 'refund', args: [2] });
    const s = { id: 7n, finalized: false, openedAt: 1_000, owed: 0n, entryFee: 1000n * ONE };
    expect(sessionRefundState(s, 1_000 + 3600)).toEqual({ kind: 'wait', availableAt: 1_000 + 86_400 });
    expect(sessionRefundState(s, 1_000 + 86_400)).toEqual({ kind: 'refund', amount: 1000n * ONE });
    expect(sessionRefundState({ ...s, finalized: true, owed: 2150n * ONE })).toEqual({ kind: 'collect', amount: 2150n * ONE });
    expect(sessionRefundState({ ...s, id: 0n })).toEqual({ kind: 'none' });
  });

  it('keys a session the way the server journals it', () => {
    expect(sessionKey(3, ALICE, 12n)).toBe(`3:${ALICE.toLowerCase()}:12`);
    const open = openSessionOf({ arenaId: 3, player: ALICE, id: 12n, entryFee: ONE, openedAt: 5, feeBps: 500, finalized: false, owed: 0n });
    expect(open).toMatchObject({ key: `3:${ALICE.toLowerCase()}:12`, id: 12n, openedAt: 5 });
    expect(openSessionOf({ arenaId: 3, player: ALICE, id: 0n, entryFee: 0n, openedAt: 0, feeBps: 0, finalized: false, owed: 0n })).toBeNull();
  });

  it("the fee shown is the server's feeBps, then the loaded config, then the 5 % default", () => {
    expect(feeBps(450, { feeBps: 300 })).toBe(450);
    expect(feeBps(null, { feeBps: 300 })).toBe(300);
    expect(feeBps(undefined)).toBe(500);
  });
});

const room = (o: Partial<RoomInfo>): RoomInfo => ({ id: 'x', mode: 'arena', name: 'x', width: 1, height: 1, players: 0, bots: 0, maxPlayers: 50, ...o });
// entry fees and loot on the wire are ledger units (6 decimals of an 18-decimal token)
const ROOMS: RoomInfo[] = [
  room({ id: 'practice-rookie-1', mode: 'practice', players: 3, bots: 19 }),
  room({ id: 'practice-pro-1', mode: 'practice', players: 1, bots: 20 }),
  room({ id: 'arena-1-1', arenaId: 1, entryFee: 1000 * L, players: 20, bots: 10, loot: 5 * L, instance: 1 }),
  room({ id: 'arena-1-2', arenaId: 1, entryFee: 1000 * L, players: 3, bots: 6, loot: 1 * L, instance: 2 }),
  room({ id: 'arena-3-1', arenaId: 3, entryFee: 50_000 * L, players: 9, bots: 4 }),
  room({ id: 'arena-2-1', arenaId: 2, entryFee: 10_000 * L, players: 0, bots: 16 }),
];

describe('buildTickets', () => {
  it('sums instances per arena, converts wire prices to base units and sorts by price after practice', () => {
    const list = buildTickets(ROOMS, []);
    expect(list.map((t) => t.key)).toEqual(['practice', 'arena:1', 'arena:2', 'arena:3']);
    expect(list[0]).toMatchObject({ humans: 4, bots: 39 });
    // loot stays in ledger units (display), the price is base units (it meets chain balances)
    expect(list[1]).toMatchObject({ humans: 23, bots: 16, loot: 6 * L, entryFee: 1000n * ONE });
    expect(list.some((t) => t.soon)).toBe(false);
    expect(ledgerToBase(1000 * L, 18)).toBe(1000n * ONE);
    expect(ledgerToBase(1000, 6)).toBe(1000n);
    expect(ledgerToBase(undefined, 18)).toBe(0n);
  });

  it('token not set: practice plus the four default arenas, "Opening soon", priced from DEFAULT_ARENAS', () => {
    const list = buildTickets(ROOMS, [], [], { enabled: true, tokenReady: false, decimals: 18 });
    expect(list.map((t) => t.key)).toEqual(['practice', 'arena:1', 'arena:2', 'arena:3', 'arena:4']);
    expect(list[0]).toMatchObject({ humans: 4, bots: 39, open: true });
    expect(list.slice(1).every((t) => t.soon === true && t.open === false)).toBe(true);
    expect(list.slice(1).map((t) => t.entryFee)).toEqual([1000n * ONE, 10_000n * ONE, 50_000n * ONE, 250_000n * ONE]);
    expect(buildTickets(ROOMS, [], [], { enabled: false, tokenReady: false, decimals: 18 }).some((t) => t.soon)).toBe(false);
  });

  it('takes the price from the chain (what the player signs) and drops arenas the chain does not know', () => {
    const list = buildTickets(ROOMS, [
      { id: 1, entryFee: 1200n * ONE, enabled: true },
      { id: 3, entryFee: 50_000n * ONE, enabled: false },
      { id: 9, entryFee: ONE, enabled: true, exists: false },
    ]);
    expect(list.map((t) => t.key)).toEqual(['practice', 'arena:1', 'arena:3']);
    expect(list[1].entryFee).toBe(1200n * ONE);
    expect(list[2].open).toBe(false);
  });

  it('R20: marks arenas the server keeps closed (vault short of its journal)', () => {
    const list = buildTickets(ROOMS, [{ id: 1, entryFee: 1000n * ONE, enabled: true }, { id: 2, entryFee: 5000n * ONE, enabled: true }], [2, 99]);
    expect(list.find((t) => t.arenaId === 2)?.blocked).toBe(true);
    expect(list.find((t) => t.arenaId === 1)?.blocked).toBeFalsy();
    expect(quickPlayTarget({ tickets: list, lastArena: 2, walletConnected: true, balance: 12_450n * ONE })).toBe('arena:1');
  });
});

describe('quickPlay', () => {
  const tickets = buildTickets(ROOMS, []);
  const base = { tickets, lastArena: null };

  it('picks practice without balance', () => {
    expect(quickPlayTarget({ ...base, walletConnected: false, balance: null })).toBe('practice');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 0n })).toBe('practice');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: null })).toBe('practice');
  });

  it('picks the last arena when affordable, else the cheapest affordable one', () => {
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 12_450n * ONE, lastArena: 2 })).toBe('arena:2');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 5_000n * ONE, lastArena: 2 })).toBe('arena:1');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 60_000n * ONE, lastArena: 3 })).toBe('arena:3');
    const soon = buildTickets(ROOMS, [], [], { enabled: true, tokenReady: false, decimals: 18 });
    expect(quickPlayTarget({ tickets: soon, lastArena: 1, walletConnected: true, balance: 60_000n * ONE })).toBe('practice');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 10n * ONE })).toBe('practice');
  });

  it('prefers an open ticket (no transaction)', () => {
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 0n, openSessions: [2] })).toBe('arena:2');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 12_450n * ONE, lastArena: 1, openSessions: [2] })).toBe('arena:2');
  });
});

describe('ticketGate', () => {
  const arena: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * ONE, humans: 0, bots: 0, loot: 0, open: true };
  const KEY = `1:${ALICE.toLowerCase()}:9`;
  const g = (o: Partial<GateInput> = {}): GateInput => ({
    ticket: arena,
    arenasEnabled: true,
    walletConnected: true,
    verified: true,
    balance: 12_450n * ONE,
    session: null,
    pending: [],
    nowS: 1_000_000,
    ...o,
  });

  it('walks connect → verify → buy, and blocks short balances', () => {
    expect(ticketGate(g({ walletConnected: false })).kind).toBe('connect');
    expect(ticketGate(g({ verified: false })).kind).toBe('verify');
    expect(ticketGate(g()).kind).toBe('buy');
    expect(ticketGate(g({ balance: 400n * ONE }))).toEqual({ kind: 'insufficient', missing: 600n * ONE });
    expect(ticketGate(g({ arenasEnabled: false })).kind).toBe('offline');
  });

  it('token not set: an "Opening soon" arena sells nothing, whatever the wallet holds', () => {
    const soon = { ...arena, open: false, soon: true };
    expect(ticketGate(g({ ticket: soon })).kind).toBe('soon');
    expect(ticketGate(g({ ticket: soon, walletConnected: false })).kind).toBe('soon');
    expect(ticketGate(g({ ticket: { key: 'practice', arenaId: null, entryFee: 0n, humans: 0, bots: 0, loot: 0, open: true } })).kind).toBe('practice');
  });

  it('a blocked arena is "under maintenance"; a payout or an open ticket there keeps its path', () => {
    const blocked = { ...arena, blocked: true };
    expect(ticketGate(g({ ticket: blocked })).kind).toBe('maintenance');
    expect(ticketGate(g({ ticket: blocked, walletConnected: false })).kind).toBe('maintenance');
    expect(ticketGate(g({ ticket: blocked, arenasEnabled: false })).kind).toBe('offline');
    expect(ticketGate(g({ ticket: blocked, pending: [{ key: KEY, arenaId: 1, payout: 5 }] }))).toEqual({ kind: 'settling', payout: 5 });
    const fin = { key: KEY, id: 9n, openedAt: 1, finalized: true, owed: 7n };
    expect(ticketGate(g({ ticket: blocked, session: fin }))).toEqual({ kind: 'collect', owed: 7n });
    const session = { key: KEY, id: 9n, openedAt: 1_000_000 - 3600 };
    expect(ticketGate(g({ ticket: blocked, session })).kind).toBe('resume');
    expect(ticketGate(g({ ticket: blocked, session: { ...session, openedAt: 1_000_000 - 86_400 } })).kind).toBe('refund');
    expect(ticketGate(g({ ticket: blocked, session, verified: false })).kind).toBe('verify');
  });

  it('matches a pending payout by its journal key', () => {
    const session = { key: KEY, id: 9n, openedAt: 1_000_000 - 60 };
    expect(ticketGate(g({ session, pending: [{ key: KEY, arenaId: null, payout: 2150 * L }] }))).toEqual({ kind: 'settling', payout: 2150 * L });
    expect(ticketGate(g({ session, pending: [{ key: '2:0xother:1', arenaId: 2, payout: 1 }] })).kind).toBe('resume');
  });

  it('a finalized session asks to collect first, even offline, and never resumes or refunds', () => {
    const fin = { key: KEY, id: 9n, openedAt: 1_000_000 - 90_000, finalized: true, owed: 2150n * ONE };
    expect(ticketGate(g({ session: fin }))).toEqual({ kind: 'collect', owed: 2150n * ONE });
    expect(ticketGate(g({ session: fin, arenasEnabled: false }))).toEqual({ kind: 'collect', owed: 2150n * ONE });
    expect(ticketGate(g({ session: fin, verified: false })).kind).toBe('collect');
    expect(ticketGate(g({ session: fin, walletConnected: false })).kind).toBe('connect');
    expect(sessionsToCollect({ 1: fin, 2: null, 3: { ...fin, finalized: false } })).toEqual([{ arenaId: 1, owed: 2150n * ONE }]);
  });
});

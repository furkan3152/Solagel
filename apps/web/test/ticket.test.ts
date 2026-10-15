// @vitest-environment node
// (jsdom typed arrays break PDA derivation in web3.js; this file renders nothing)
import { ASSOCIATED_TOKEN_PROGRAM_ID, IDL, PROGRAM_ID, SlanaClient, TOKEN_PROGRAM_ID, ata, pdas } from '@slana/sdk';
import type { RoomInfo } from '@slana/shared';
import { Connection, Keypair, type TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_BYTES,
  buildCloseTx,
  buildTicketTx,
  buildTickets,
  cashoutMsOf,
  closeSolCost,
  passPowerOf,
  quickPlayTarget,
  sessionsToCollect,
  ticketGate,
  ticketSolCost,
  ticketSteps,
  type GateInput,
  type TicketModel,
} from '../src/solana/ticket';

// instruction builders never touch the network; the connection only has to exist
const client = new SlanaClient(new Connection('http://127.0.0.1:1'), PROGRAM_ID);
const player = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const token = { tokenMint: mint, tokenProgram: TOKEN_PROGRAM_ID };
const passAsset = Keypair.generate().publicKey.toBase58();
const M = 1_000_000n;

const disc = (name: string) =>
  Buffer.from((IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }).instructions.find((i) => i.name === name)!.discriminator);
const isIx = (ix: TransactionInstruction, name: string) => ix.programId.equals(PROGRAM_ID) && Buffer.from(ix.data.subarray(0, 8)).equals(disc(name));
const isAta = (ix: TransactionInstruction) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID);

describe('buildTicketTx', () => {
  it('includes ATA create when missing, register when no profile, joinArenaWithPass when pass selected', async () => {
    const { steps, ixs } = await buildTicketTx(client.ix, { player, arenaId: 3, token, ataExists: false, register: { name: 'Defne', skin: 4 }, passAsset, maxFeeBps: 200, maxEntryFee: 50_000n * M, maxSettleFee: 20_000 });
    expect(steps).toEqual(['ata', 'register', 'joinWithPass']);
    expect(ixs).toHaveLength(3);
    expect(isAta(ixs[0])).toBe(true);
    // the player pays the rent and owns the account
    expect(ixs[0].keys[0].pubkey.equals(player)).toBe(true);
    expect(ixs[0].keys[1].pubkey.equals(ata(player, mint, TOKEN_PROGRAM_ID))).toBe(true);
    expect(isIx(ixs[1], 'register_player')).toBe(true);
    expect(isIx(ixs[2], 'join_arena_with_pass')).toBe(true);
    // the Pass asset and its lock PDA are in the join
    const keys = ixs[2].keys.map((k) => k.pubkey.toBase58());
    expect(keys).toContain(passAsset);
    expect(keys).toContain(pdas.passLock(passAsset, PROGRAM_ID).toBase58());
    // the session belongs to this arena
    expect(keys).toContain(pdas.session(pdas.arena(3, PROGRAM_ID), player, PROGRAM_ID).toBase58());
    // the bounds the player was shown ride in the instruction (M3): fee bps u16, entry fee u64, deposit u64
    expect(ixs[2].data.readUInt16LE(8)).toBe(200);
    expect(ixs[2].data.readBigUInt64LE(10)).toBe(50_000n * M);
    expect(ixs[2].data.readBigUInt64LE(18)).toBe(20_000n);
  });

  it('is a plain joinArena when the account and profile exist and no Pass is used', async () => {
    const { steps, ixs } = await buildTicketTx(client.ix, { player, arenaId: 1, token, ataExists: true, register: null, passAsset: null, maxFeeBps: 500, maxEntryFee: 1000n * M, maxSettleFee: 20_000 });
    expect(steps).toEqual(['join']);
    expect(ixs[0].data.readUInt16LE(8)).toBe(500);
    expect(ixs).toHaveLength(1);
    expect(isIx(ixs[0], 'join_arena')).toBe(true);
    expect(ixs.some(isAta)).toBe(false);
    expect(ixs.some((ix) => isIx(ix, 'register_player'))).toBe(false);
  });

  it('creates the token account idempotently when its existence is unknown', () => {
    expect(ticketSteps({ ataExists: null, register: null, passAsset: null })).toEqual(['ata', 'join']);
  });

  it('R24: collect is [player-paid ATA idempotent create] + refund_session without a Pass lock', async () => {
    const { steps, ixs } = await buildCloseTx(client.ix, { player, arenaId: 2, token, finalized: true, passAsset });
    expect(steps).toEqual(['ata', 'collect']);
    expect(ixs).toHaveLength(2);
    expect(isAta(ixs[0])).toBe(true);
    expect(ixs[0].keys[0].pubkey.equals(player)).toBe(true);
    expect(ixs[0].data[0]).toBe(1); // CreateIdempotent
    expect(isIx(ixs[1], 'refund_session')).toBe(true);
    const keys = ixs[1].keys.map((k) => k.pubkey.toBase58());
    expect(keys).not.toContain(pdas.passLock(passAsset, PROGRAM_ID).toBase58());
    expect(keys.at(-1)).toBe(PROGRAM_ID.toBase58()); // pass_lock = None
    // an unsettled refund passes its lock
    const refund = await buildCloseTx(client.ix, { player, arenaId: 2, token, finalized: false, passAsset });
    expect(refund.steps).toEqual(['ata', 'refund']);
    expect(refund.ixs[1].keys.map((k) => k.pubkey.toBase58())).toContain(pdas.passLock(passAsset, PROGRAM_ID).toBase58());
  });

  it('closeSolCost: ATA rent only when missing, plus bounded fees; the session rent comes back', () => {
    const rent = (b: number) => b * 1000;
    const fees = 5_000 + 2_000; // base + 100k CU × 20 000 µL
    expect(closeSolCost({ ataExists: true, token2022: false, finalized: true, settleFeeLamports: 20_000, rent })).toEqual({ total: fees, back: ACCOUNT_BYTES.session * 1000 });
    expect(closeSolCost({ ataExists: false, token2022: true, finalized: false, settleFeeLamports: 20_000, rent })).toEqual({
      total: ACCOUNT_BYTES.ata2022 * 1000 + fees,
      back: ACCOUNT_BYTES.session * 1000 + 20_000,
    });
  });

  it('I3: Pass power comes from the server status, RULES as fallback', () => {
    expect(passPowerOf({ startMassMul: 1.25, cashoutMs: 1_500 })).toEqual({ startPct: 25, cashoutS: 1.5 });
    expect(passPowerOf(null)).toEqual({ startPct: 15, cashoutS: 2 });
    expect(cashoutMsOf({ passPower: { startMassMul: 1, cashoutMs: 900 } }, true)).toBe(900);
    expect(cashoutMsOf({ passPower: { startMassMul: 1, cashoutMs: 900 } }, false)).toBe(3_000);
    expect(cashoutMsOf(null, true)).toBe(2_000);
  });
});

const room = (o: Partial<RoomInfo>): RoomInfo => ({ id: 'x', mode: 'arena', name: 'x', width: 1, height: 1, players: 0, bots: 0, maxPlayers: 50, ...o });
const ROOMS: RoomInfo[] = [
  room({ id: 'practice-rookie-1', mode: 'practice', players: 3, bots: 19 }),
  room({ id: 'practice-pro-1', mode: 'practice', players: 1, bots: 20 }),
  room({ id: 'arena-1-1', arenaId: 1, entryFee: 1000e6, players: 20, bots: 10, loot: 5e6, instance: 1 }),
  room({ id: 'arena-1-2', arenaId: 1, entryFee: 1000e6, players: 3, bots: 6, loot: 1e6, instance: 2 }),
  room({ id: 'arena-3-1', arenaId: 3, entryFee: 50_000e6, requiresPass: true, players: 9, bots: 4 }),
  room({ id: 'arena-2-1', arenaId: 2, entryFee: 10_000e6, players: 0, bots: 16 }),
];

describe('buildTickets', () => {
  it('sums instances per arena and sorts by price after practice', () => {
    const list = buildTickets(ROOMS, []);
    expect(list.map((t) => t.key)).toEqual(['practice', 'arena:1', 'arena:2', 'arena:3']);
    expect(list[0]).toMatchObject({ humans: 4, bots: 39 });
    expect(list[1]).toMatchObject({ humans: 23, bots: 16, loot: 6e6, entryFee: 1000n * M });
    expect(list[3].requiresPass).toBe(true);
  });

  it('takes the price from the chain (what the player signs) and drops arenas the chain does not know', () => {
    const list = buildTickets(ROOMS, [
      { id: 1, entryFee: 1200n * M, requiresPass: false, enabled: true },
      { id: 3, entryFee: 50_000n * M, requiresPass: true, enabled: false },
    ]);
    expect(list.map((t) => t.key)).toEqual(['practice', 'arena:1', 'arena:3']);
    expect(list[1].entryFee).toBe(1200n * M);
    expect(list[2].open).toBe(false);
  });

  it('R20: marks arenas the server keeps closed (vault short of its journal)', () => {
    const list = buildTickets(ROOMS, [{ id: 1, entryFee: 1000n * M, requiresPass: false, enabled: true }, { id: 2, entryFee: 5000n * M, requiresPass: false, enabled: true }], [2, 99]);
    expect(list.find((t) => t.arenaId === 2)?.blocked).toBe(true);
    expect(list.find((t) => t.arenaId === 1)?.blocked).toBeFalsy();
    // Quick Play never picks a blocked arena, even the last one played
    expect(quickPlayTarget({ tickets: list, hasFreePass: false, lastArena: 2, walletConnected: true, balance: 12_450n * M })).toBe('arena:1');
  });
});

describe('quickPlay', () => {
  const tickets = buildTickets(ROOMS, []);
  const base = { tickets, hasFreePass: false, lastArena: null };

  it('quickPlay picks practice without balance', () => {
    expect(quickPlayTarget({ ...base, walletConnected: false, balance: null })).toBe('practice');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 0n })).toBe('practice');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: null })).toBe('practice');
  });

  it('picks the last arena when affordable, else the cheapest affordable one', () => {
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 12_450n * M, lastArena: 2 })).toBe('arena:2');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 5_000n * M, lastArena: 2 })).toBe('arena:1');
    // a Pass arena only with a free Pass
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 60_000n * M, lastArena: 3 })).toBe('arena:1');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 60_000n * M, lastArena: 3, hasFreePass: true })).toBe('arena:3');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 10n * M })).toBe('practice');
  });

  it('prefers an open ticket (no transaction)', () => {
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 0n, openSessions: [2] })).toBe('arena:2');
    expect(quickPlayTarget({ ...base, walletConnected: true, balance: 12_450n * M, lastArena: 1, openSessions: [2] })).toBe('arena:2');
  });
});

describe('ticketGate', () => {
  const arena: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * M, requiresPass: false, humans: 0, bots: 0, loot: 0, open: true };
  const g = (o: Partial<GateInput> = {}): GateInput => ({
    ticket: arena,
    arenasEnabled: true,
    walletConnected: true,
    verified: true,
    balance: 12_450n * M,
    session: null,
    pending: [],
    freePasses: 0,
    nowS: 1_000_000,
    ...o,
  });

  it('walks connect → verify → buy, and blocks short balances', () => {
    expect(ticketGate(g({ walletConnected: false })).kind).toBe('connect');
    expect(ticketGate(g({ verified: false })).kind).toBe('verify');
    expect(ticketGate(g()).kind).toBe('buy');
    expect(ticketGate(g({ balance: 400n * M }))).toEqual({ kind: 'insufficient', missing: 600n * M });
    expect(ticketGate(g({ ticket: { ...arena, requiresPass: true } })).kind).toBe('needPass');
    expect(ticketGate(g({ ticket: { ...arena, requiresPass: true }, freePasses: 1 })).kind).toBe('buy');
    expect(ticketGate(g({ arenasEnabled: false })).kind).toBe('offline');
  });

  it('R20: a blocked arena is "under maintenance" and sells nothing, whatever the wallet holds', () => {
    const blocked = { ...arena, blocked: true };
    expect(ticketGate(g({ ticket: blocked })).kind).toBe('maintenance');
    expect(ticketGate(g({ ticket: blocked, walletConnected: false })).kind).toBe('maintenance');
    expect(ticketGate(g({ ticket: blocked, arenasEnabled: false })).kind).toBe('offline');
    // a payout owed in that arena takes priority (settling, or R24 collect)
    const owed = [{ key: 'S', arenaId: 1, payout: 5 }];
    expect(ticketGate(g({ ticket: blocked, pending: owed }))).toEqual({ kind: 'settling', payout: 5 });
    const fin = { address: 'S', openedAt: 1, hasPass: false, passAsset: null, finalized: true, owed: 7n };
    expect(ticketGate(g({ ticket: blocked, session: fin }))).toEqual({ kind: 'collect', owed: 7n });
    // an open ticket in a blocked arena keeps resume and, after 24 h, the self-refund
    const session = { address: 'S', openedAt: 1_000_000 - 3600, hasPass: false, passAsset: null };
    expect(ticketGate(g({ ticket: blocked, session })).kind).toBe('resume');
    expect(ticketGate(g({ ticket: blocked, session: { ...session, openedAt: 1_000_000 - 86_400 } })).kind).toBe('refund');
    expect(ticketGate(g({ ticket: blocked, session, verified: false })).kind).toBe('verify');
  });

  it('resumes an open ticket without a transaction and offers a refund after 24 h', () => {
    const session = { address: 'S', openedAt: 1_000_000 - 3600, hasPass: false, passAsset: null };
    expect(ticketGate(g({ session })).kind).toBe('resume');
    expect(ticketGate(g({ session: { ...session, openedAt: 1_000_000 - 86_400 } })).kind).toBe('refund');
  });

  it('shows the pending payout instead of a raw "still being settled" error', () => {
    const session = { address: 'S', openedAt: 1_000_000 - 60, hasPass: false, passAsset: null };
    expect(ticketGate(g({ session, pending: [{ key: 'S', arenaId: 1, payout: 2150 }] }))).toEqual({ kind: 'settling', payout: 2150 });
  });

  it('R24: a finalized session asks to collect first, even offline, and never resumes or refunds', () => {
    const fin = { address: 'S', openedAt: 1_000_000 - 90_000, hasPass: true, passAsset: 'P', finalized: true, owed: 2150n };
    expect(ticketGate(g({ session: fin }))).toEqual({ kind: 'collect', owed: 2150n });
    expect(ticketGate(g({ session: fin, arenasEnabled: false }))).toEqual({ kind: 'collect', owed: 2150n });
    expect(ticketGate(g({ session: fin, verified: false })).kind).toBe('collect');
    expect(ticketGate(g({ session: fin, walletConnected: false })).kind).toBe('connect');
    expect(sessionsToCollect({ 1: fin, 2: null, 3: { ...fin, finalized: false } })).toEqual([{ arenaId: 1, owed: 2150n }]);
  });
});

describe('ticketSolCost', () => {
  const rent = (b: number) => b * 1000;
  it('counts session (+ Pass lock) rent as refundable, profile and ATA rent as kept, plus deposit and bounded fees', () => {
    const fees = 5_000 + 3_000; // base + 150k CU × 20 000 µL
    const plain = ticketSolCost(['join'], { settleFeeLamports: 20_000, token2022: false, rent });
    expect(plain).toEqual({ refundable: ACCOUNT_BYTES.session * 1000, total: ACCOUNT_BYTES.session * 1000 + 20_000 + fees });
    const full = ticketSolCost(['ata', 'register', 'joinWithPass'], { settleFeeLamports: 20_000, token2022: true, rent });
    expect(full.refundable).toBe((ACCOUNT_BYTES.session + ACCOUNT_BYTES.passLock) * 1000);
    expect(full.total).toBe((ACCOUNT_BYTES.session + ACCOUNT_BYTES.passLock + ACCOUNT_BYTES.profile + ACCOUNT_BYTES.ata2022) * 1000 + 20_000 + fees);
  });
});

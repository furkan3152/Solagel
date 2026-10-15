// @vitest-environment node
// (jsdom typed arrays break PDA derivation in web3.js; this file renders nothing)
import { ASSOCIATED_TOKEN_PROGRAM_ID, IDL, PROGRAM_ID, SlanaClient, TOKEN_PROGRAM_ID, ata, pdas } from '@slana/sdk';
import type { RoomInfo } from '@slana/shared';
import { Connection, Keypair, type TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_BYTES,
  buildAtaTx,
  buildTicketTx,
  buildTickets,
  payoutsNeedingAta,
  quickPlayTarget,
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
    const { steps, ixs } = await buildTicketTx(client.ix, { player, arenaId: 3, token, ataExists: false, register: { name: 'Defne', skin: 4 }, passAsset, maxFeeBps: 200 });
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
    // the fee bound the player was shown rides in the instruction (u16 after the discriminator)
    expect(ixs[2].data.readUInt16LE(8)).toBe(200);
  });

  it('is a plain joinArena when the account and profile exist and no Pass is used', async () => {
    const { steps, ixs } = await buildTicketTx(client.ix, { player, arenaId: 1, token, ataExists: true, register: null, passAsset: null, maxFeeBps: 500 });
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

  it('R10: the payout-unblocking transaction is only the player-paid ATA create', () => {
    const ixs = buildAtaTx(player, token);
    expect(ixs).toHaveLength(1);
    expect(isAta(ixs[0])).toBe(true);
    expect(ixs[0].keys[0].pubkey.equals(player)).toBe(true);
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
    // a payout owed in that arena takes priority (settling, or the R10 token-account CTA)
    const owed = [{ key: 'S', arenaId: 1, payout: 5, needsTokenAccount: false }];
    expect(ticketGate(g({ ticket: blocked, pending: owed }))).toEqual({ kind: 'settling', payout: 5 });
    expect(ticketGate(g({ ticket: blocked, pending: [{ ...owed[0], needsTokenAccount: true }], ataExists: false }))).toEqual({ kind: 'needAta', payout: 5 });
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

  it('shows the pending payout instead of a raw "still being settled" error (R10 CTA when the account is missing)', () => {
    const session = { address: 'S', openedAt: 1_000_000 - 60, hasPass: false, passAsset: null };
    expect(ticketGate(g({ session, pending: [{ key: 'S', arenaId: 1, payout: 2150, needsTokenAccount: false }] }))).toEqual({ kind: 'settling', payout: 2150 });
    expect(ticketGate(g({ session, pending: [{ key: 'S', arenaId: 1, payout: 2150, needsTokenAccount: true }] }))).toEqual({ kind: 'needAta', payout: 2150 });
  });

  it('R10: once the token account exists, a queued payout is shown as settling (no create-account CTA)', () => {
    const session = { address: 'S', openedAt: 1_000_000 - 60, hasPass: false, passAsset: null };
    const pending = [{ key: 'S', arenaId: 1, payout: 2150, needsTokenAccount: true }];
    expect(ticketGate(g({ session, pending, ataExists: true }))).toEqual({ kind: 'settling', payout: 2150 });
    expect(payoutsNeedingAta(pending, true)).toEqual([]);
    expect(payoutsNeedingAta([...pending, { key: 'T', arenaId: 2, payout: 5, needsTokenAccount: false }], false)).toHaveLength(1);
  });
});

describe('ticketSolCost', () => {
  const rent = (b: number) => b * 1000;
  it('counts session (+ Pass lock) rent as refundable, profile and ATA rent as kept, plus deposit and bounded fees', () => {
    const fees = 5_000 + 6_000; // base + 300k CU × 20 000 µL
    const plain = ticketSolCost(['join'], { settleFeeLamports: 20_000, token2022: false, rent });
    expect(plain).toEqual({ refundable: ACCOUNT_BYTES.session * 1000, total: ACCOUNT_BYTES.session * 1000 + 20_000 + fees });
    const full = ticketSolCost(['ata', 'register', 'joinWithPass'], { settleFeeLamports: 20_000, token2022: true, rent });
    expect(full.refundable).toBe((ACCOUNT_BYTES.session + ACCOUNT_BYTES.passLock) * 1000);
    expect(full.total).toBe((ACCOUNT_BYTES.session + ACCOUNT_BYTES.passLock + ACCOUNT_BYTES.profile + ACCOUNT_BYTES.ata2022) * 1000 + 20_000 + fees);
  });
});

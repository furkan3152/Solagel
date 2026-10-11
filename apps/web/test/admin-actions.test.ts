import { Connection, Keypair } from '@solana/web3.js';
import { CLAIM_WINDOW_SECS, MAX_FEE_BPS, SolagelClient, pdas, type ArenaView, type ConfigView, type SeasonView } from '@solagel/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAdminSol, parseAdminSol, prepareAdminAction, type AdminAction } from '../src/admin/actions';

const admin = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const serverAuthority = Keypair.generate().publicKey.toBase58();
const config: ConfigView = { admin, treasury, serverAuthority, feeBps: 500, seasonShareBps: 5000, skinPrice: 0, currentSeason: 3, paused: false, totalPlayers: 0, totalGames: 0, totalSessions: 0, totalStaked: 0, totalPaidOut: 0 };
const arena: ArenaView = { address: pdas.arena(2).toBase58(), id: 2, buyIn: 10_000_000, maxPlayers: 40, enabled: true, openSessions: 0, pot: 5_000_000, totalDeposited: 0, totalPaidOut: 0 };
const season: SeasonView = { address: pdas.season(3).toBase58(), id: 3, startedAt: 1, endedAt: 0, finalized: false, prizePool: 0, claimedMask: 0, pool: 50_000_000, entries: [] };

describe('exact administration money input', () => {
  it('preserves SOL decimals exactly through instruction-safe lamport values', () => {
    expect(parseAdminSol('0.29')).toBe(290_000_000);
    expect(parseAdminSol(' 0.000000001 ')).toBe(1);
    expect(parseAdminSol('12.123456789')).toBe(12_123_456_789);
    expect(formatAdminSol(12_123_456_789)).toBe('12.123456789');
    expect(formatAdminSol(1_000_000_000)).toBe('1');
  });

  it.each(['0', '-1', '+1', '1e-3', '0.0000000009', '.1', '1.', 'NaN', 'Infinity', '9007199.254740992'])('rejects ambiguous, rounded or unsafe SOL: %s', (amount) => {
    expect(() => parseAdminSol(amount)).toThrow();
  });

  it('enforces the arena minimum before preparing any instruction', () => {
    expect(() => parseAdminSol('0.000999999', 1_000_000)).toThrow(/minimum/);
    expect(parseAdminSol('0.001', 1_000_000)).toBe(1_000_000);
  });
});

describe('wallet-signed administration instruction reviews', () => {
  let client: SolagelClient;
  beforeEach(() => {
    // All instructions are built offline. A mistaken network access would fail.
    client = new SolagelClient(new Connection('http://127.0.0.1:1', 'confirmed'));
    vi.spyOn(client, 'fetchConfig').mockResolvedValue({ ...config });
    vi.spyOn(client, 'fetchArena').mockResolvedValue({ ...arena });
    vi.spyOn(client, 'fetchSeason').mockResolvedValue({ ...season });
  });

  it('fetches the current on-chain administrator for every review, including funding', async () => {
    const action = { kind: 'fundSeason', seasonId: 3, amountSol: '0.29' } as const;
    const first = await prepareAdminAction(client, admin, action);
    expect(first.instruction.keys[0]).toMatchObject({ isSigner: true });
    expect(first.instruction.keys[0].pubkey.toBase58()).toBe(admin);
    vi.mocked(client.fetchConfig).mockResolvedValue({ ...config, admin: Keypair.generate().publicKey.toBase58() });
    await expect(prepareAdminAction(client, admin, action)).rejects.toThrow(/current on-chain administrator/);
    expect(client.fetchConfig).toHaveBeenCalledTimes(2);
  });

  it('encodes the reviewed funding amount and exact current season destination', async () => {
    const prepared = await prepareAdminAction(client, admin, { kind: 'fundSeason', seasonId: 3, amountSol: '0.29' });
    expect(prepared.instruction.data.readBigUInt64LE(8)).toBe(290_000_000n);
    expect(prepared.instruction.keys[2].pubkey.toBase58()).toBe(pdas.season(3).toBase58());
    expect(prepared.details).toContainEqual({ label: 'Transfer amount', value: '0.29 SOL (290000000 lamports)' });
    expect(prepared.details).toContainEqual({ label: 'Prize pool account', value: season.address });
  });

  it('rejects stale season actions instead of redirecting funds to a different season', async () => {
    await expect(prepareAdminAction(client, admin, { kind: 'fundSeason', seasonId: 2, amountSol: '1' })).rejects.toThrow(/season changed/);
    await expect(prepareAdminAction(client, admin, { kind: 'endSeason', seasonId: 2 })).rejects.toThrow(/season changed/);
  });

  it('enforces fee caps and exposes old and new money destinations', async () => {
    const action: AdminAction = { kind: 'config', paused: true, feeBps: String(MAX_FEE_BPS + 1), seasonShareBps: '5000', treasury, serverAuthority };
    await expect(prepareAdminAction(client, admin, action)).rejects.toThrow(/between 0 and 1000/);
    await expect(prepareAdminAction(client, admin, { ...action, feeBps: '1000', seasonShareBps: '10001' })).rejects.toThrow(/between 0 and 10000/);
    const newTreasury = Keypair.generate().publicKey.toBase58();
    const prepared = await prepareAdminAction(client, admin, { ...action, feeBps: '1000', treasury: newTreasury });
    expect(prepared.details).toContainEqual({ label: 'Current treasury', value: treasury });
    expect(prepared.details).toContainEqual({ label: 'New treasury', value: newTreasury });
    expect(prepared.notices.some((text) => text.includes('including sessions already open'))).toBe(true);
  });

  it('creates only new arena IDs with valid price and capacity', async () => {
    const action = { kind: 'createArena', id: '9', buyInSol: '0.001', maxPlayers: '40' } as const;
    await expect(prepareAdminAction(client, admin, action)).rejects.toThrow(/already exists/);
    vi.mocked(client.fetchArena).mockResolvedValue(null);
    await expect(prepareAdminAction(client, admin, { ...action, maxPlayers: '101' })).rejects.toThrow(/between 2 and 100/);
    await expect(prepareAdminAction(client, admin, { ...action, id: '65536' })).rejects.toThrow(/65535/);
    const prepared = await prepareAdminAction(client, admin, action);
    expect(prepared.instruction.data.readUInt16LE(8)).toBe(9);
    expect(prepared.instruction.data.readBigUInt64LE(10)).toBe(1_000_000n);
    expect(prepared.instruction.data.readUInt16LE(18)).toBe(40);
  });

  it('updates admissions without rewriting entry price and warns about retained live tickets', async () => {
    vi.mocked(client.fetchArena).mockResolvedValue({ ...arena, openSessions: 12 });
    const prepared = await prepareAdminAction(client, admin, { kind: 'updateArena', id: '2', enabled: false, maxPlayers: '10' });
    expect(prepared.details).toContainEqual({ label: 'Entry price, unchanged', value: '0.01 SOL' });
    expect(prepared.details).toContainEqual({ label: 'Currently open tickets', value: '12' });
    expect(prepared.notices.some((text) => text.includes('Open tickets exceed'))).toBe(true);
    // discriminator + Option<bool> + Option<u16>; no price argument.
    expect(prepared.instruction.data.length).toBe(13);
  });

  it('refuses sweeping any arena with open sessions', async () => {
    vi.mocked(client.fetchArena).mockResolvedValue({ ...arena, openSessions: 1 });
    await expect(prepareAdminAction(client, admin, { kind: 'sweepArena', id: '2' })).rejects.toThrow(/open sessions/);
    vi.mocked(client.fetchArena).mockResolvedValue(arena);
    const prepared = await prepareAdminAction(client, admin, { kind: 'sweepArena', id: '2' });
    expect(prepared.instruction.keys[3].pubkey.toBase58()).toBe(treasury);
    expect(prepared.details).toContainEqual({ label: 'Transfer amount', value: '0.005 SOL' });
  });

  it('requires a new review if the treasury or amount to sweep changed', async () => {
    const action = { kind: 'sweepArena', id: '2' } as const;
    const first = await prepareAdminAction(client, admin, action);
    vi.mocked(client.fetchConfig).mockResolvedValue({ ...config, treasury: Keypair.generate().publicKey.toBase58() });
    const next = await prepareAdminAction(client, admin, action);
    expect(next.fingerprint).not.toBe(first.fingerprint);
    vi.mocked(client.fetchArena).mockResolvedValue({ ...arena, pot: 6_000_000 });
    const increased = await prepareAdminAction(client, admin, action);
    expect(increased.fingerprint).not.toBe(next.fingerprint);
  });

  it('honors the strict on-chain reward claim deadline before rolling over', async () => {
    const old = { ...season, id: 1, address: pdas.season(1).toBase58(), finalized: true, endedAt: 100 };
    vi.mocked(client.fetchSeason).mockImplementation(async (id) => id === 1 ? old : season);
    const action = { kind: 'rolloverSeason', seasonId: '1', currentSeason: 3 } as const;
    await expect(prepareAdminAction(client, admin, action, 100 + CLAIM_WINDOW_SECS)).rejects.toThrow(/30-day claim window/);
    const prepared = await prepareAdminAction(client, admin, action, 101 + CLAIM_WINDOW_SECS);
    expect(prepared.instruction.keys[2].pubkey.toBase58()).toBe(old.address);
    expect(prepared.instruction.keys[3].pubkey.toBase58()).toBe(season.address);
  });
});

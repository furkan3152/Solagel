// @vitest-environment node
// (jsdom typed arrays break PDA derivation in web3.js; this file renders nothing)
import { passTraits } from '@slana/art';
import { IDL, PROGRAM_ID, SlanaClient, TOKEN_PROGRAM_ID, ata, pdas } from '@slana/sdk';
import type { PassStatus } from '@slana/shared';
import { Connection, Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  MINT_COUNTER_BYTES,
  buildMintTx,
  coreAssetBytes,
  mintGate,
  mintSolCost,
  passStatusOf,
  passView,
  previewTraits,
  type MintGateInput,
} from '../src/solana/pass';
import { CLAIM_WINDOW_S, buildClaimTx, claimState, prizeAmount } from '../src/solana/season';

const client = new SlanaClient(new Connection('http://127.0.0.1:1'), PROGRAM_ID);
const minter = Keypair.generate().publicKey;
const asset = Keypair.generate().publicKey;
const tokenMint = Keypair.generate().publicKey.toBase58();
const collection = Keypair.generate().publicKey.toBase58();
const tokenProgram = TOKEN_PROGRAM_ID.toBase58();
const SEED = 'ab'.repeat(32);

const disc = (name: string) =>
  Buffer.from((IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }).instructions.find((i) => i.name === name)!.discriminator);
/** Account order of `mint_pass` in the IDL. */
const MINT_ACCOUNTS = ['minter', 'asset', 'config', 'collection', 'pass_authority', 'mint_counter', 'minter_token', 'mpl_core_program', 'system_program'];

const status = (over: Partial<PassStatus> = {}): PassStatus => ({
  collection,
  supply: 3333,
  minted: 412,
  perWallet: 1,
  mintOpen: true,
  mintStartTs: 0,
  revealed: false,
  seed: null,
  ...over,
});

describe('buildMintTx', () => {
  const config = (passMinTokens: bigint) => ({ passCollection: collection, passMinTokens, tokenMint, tokenProgram });

  it('includes minterToken only when min tokens configured', async () => {
    const free = await buildMintTx(client.ix, { minter, asset, config: config(0n) });
    expect(free.minterToken).toBeNull();
    expect(free.ixs).toHaveLength(1);
    const ix = free.ixs[0];
    expect(ix.data.subarray(0, 8).equals(disc('mint_pass'))).toBe(true);
    expect(ix.keys).toHaveLength(MINT_ACCOUNTS.length);
    // an absent optional account is the program id (Anchor's "None")
    expect(ix.keys[MINT_ACCOUNTS.indexOf('minter_token')].pubkey.equals(PROGRAM_ID)).toBe(true);

    const gated = await buildMintTx(client.ix, { minter, asset, config: config(1_000_000n) });
    const expected = ata(minter, tokenMint, tokenProgram);
    expect(gated.minterToken).toBe(expected.toBase58());
    expect(gated.ixs[0].keys[MINT_ACCOUNTS.indexOf('minter_token')].pubkey.equals(expected)).toBe(true);
  });

  it('has the minter and the fresh asset sign, the collection and counter in place', async () => {
    const { ixs } = await buildMintTx(client.ix, { minter, asset, config: config(0n) });
    const k = (n: string) => ixs[0].keys[MINT_ACCOUNTS.indexOf(n)];
    expect(k('minter').pubkey.equals(minter) && k('minter').isSigner).toBe(true);
    expect(k('asset').pubkey.equals(asset) && k('asset').isSigner && k('asset').isWritable).toBe(true);
    expect(k('collection').pubkey.toBase58()).toBe(collection);
    expect(k('mint_counter').pubkey.equals(pdas.passMinted(minter, PROGRAM_ID))).toBe(true);
  });

  it('refuses without a collection', async () => {
    await expect(buildMintTx(client.ix, { minter, asset, config: { ...config(0n), passCollection: null } })).rejects.toThrow(/collection/);
  });
});

describe('passView', () => {
  it('sealed passport until revealed', () => {
    expect(passView({ number: 7 }, null)).toEqual({ sealed: true, traits: null });
    expect(passView({ number: 7 }, status())).toEqual({ sealed: true, traits: null });
    // a seed alone (e.g. a stale cache) does not open it: only the on-chain reveal does
    expect(passView({ number: 7 }, status({ revealed: false, seed: SEED }))).toEqual({ sealed: true, traits: null });
    // revealed but the seed not published (yet) is still sealed
    expect(passView({ number: 7 }, status({ revealed: true, seed: null }))).toEqual({ sealed: true, traits: null });
    const open = passView({ number: 7 }, status({ revealed: true, seed: SEED, mintOpen: false }));
    expect(open.sealed).toBe(false);
    expect(open.traits).toEqual(passTraits(SEED, 7, 3333));
    // outside the collection: never guess a look
    expect(passView({ number: 9999 }, status({ revealed: true, seed: SEED })).sealed).toBe(true);
  });

  it('takes the chain config over the server status and hides an unrevealed seed', () => {
    const server = status({ minted: 1 });
    expect(passStatusOf(null, server)).toBe(server);
    const cfg = {
      passCollection: collection,
      passSupply: 3333,
      passMinted: 500,
      passPerWallet: 2,
      passMintOpen: true,
      passMintStartTs: 10,
      passRevealed: false,
      passSeed: 'ff'.repeat(32),
    } as Parameters<typeof passStatusOf>[0];
    expect(passStatusOf(cfg, server)).toMatchObject({ minted: 500, perWallet: 2, mintStartTs: 10, seed: null });
  });
});

describe('mintGate', () => {
  const base: MintGateInput = { status: status(), walletConnected: true, mintedByMe: 0, minTokens: 0n, tokenBalance: null, nowS: 1_000 };
  it('follows the program checks in order', () => {
    expect(mintGate({ ...base, status: null }).kind).toBe('unavailable');
    expect(mintGate({ ...base, status: status({ revealed: true, seed: SEED }) }).kind).toBe('closed');
    expect(mintGate({ ...base, status: status({ minted: 3333 }) }).kind).toBe('soldOut');
    expect(mintGate({ ...base, status: status({ mintOpen: false }) }).kind).toBe('closed');
    expect(mintGate({ ...base, status: status({ mintStartTs: 5_000 }) })).toEqual({ kind: 'notStarted', startsAt: 5_000 });
    expect(mintGate({ ...base, walletConnected: false }).kind).toBe('connect');
    expect(mintGate({ ...base, mintedByMe: null }).kind).toBe('loading');
    expect(mintGate({ ...base, mintedByMe: 1 })).toEqual({ kind: 'limit', perWallet: 1 });
    expect(mintGate(base).kind).toBe('ready');
  });
  it('asks for the minimum balance only when one is set', () => {
    expect(mintGate({ ...base, minTokens: 100n, tokenBalance: null }).kind).toBe('loading');
    expect(mintGate({ ...base, minTokens: 100n, tokenBalance: 99n })).toEqual({ kind: 'needTokens', min: 100n });
    expect(mintGate({ ...base, minTokens: 100n, tokenBalance: 100n }).kind).toBe('ready');
  });
});

describe('mintSolCost', () => {
  it('is the asset rent (+ the first counter) and two signatures, nothing else', () => {
    const rent = (b: number) => b * 10;
    const first = mintSolCost({ number: 413, baseUri: 'https://slana.example/pass/', counterExists: false, rent });
    const assetBytes = coreAssetBytes(413, 'https://slana.example/pass/');
    // key + owner + Collection(ua) + "Slana Pass #413" + uri + seq
    expect(assetBytes).toBe(1 + 32 + 33 + 4 + 15 + 4 + 'https://slana.example/pass/413.json'.length + 1);
    expect(first.rent).toBe(assetBytes * 10 + MINT_COUNTER_BYTES * 10);
    expect(first.total).toBe(first.rent + first.fees);
    expect(first.fees).toBeGreaterThanOrEqual(10_000);
    const again = mintSolCost({ number: 413, baseUri: 'https://slana.example/pass/', counterExists: true, rent });
    expect(again.rent).toBe(assetBytes * 10);
  });
});

describe('previewTraits', () => {
  it('rolls looks from the preview seed without the 1/1s', () => {
    const a = previewTraits('01'.repeat(16), 24);
    expect(a).toHaveLength(24);
    expect(a.some((t) => t.special?.startsWith('oneOfOne'))).toBe(false);
    expect(previewTraits('01'.repeat(16), 24)).toEqual(a);
    expect(previewTraits('02'.repeat(16), 24)).not.toEqual(a);
  });
});

describe('season claims', () => {
  const me = Keypair.generate().publicKey.toBase58();
  const others = Array.from({ length: 12 }, () => ({ player: Keypair.generate().publicKey.toBase58() }));
  const season = (rank: number, mask = 0, endedAt = 1_000) => {
    const entries = [...others];
    if (rank >= 0) entries.splice(rank, 0, { player: me });
    return { id: 3, prizePool: 84_200_000_000, endedAt, entries, claimedMask: mask };
  };
  it('pays the top ten by the program shares', () => {
    expect(prizeAmount(10_000n, 0)).toBe(3_000n);
    expect(prizeAmount(10_000n, 9)).toBe(200n);
    expect(prizeAmount(10_000n, 10)).toBe(0n);
    expect(claimState(season(1), me, 2_000)).toEqual({ kind: 'claimable', seasonId: 3, rank: 1, amount: 16_840_000_000n, closesAt: 1_000 + CLAIM_WINDOW_S });
    expect(claimState(season(10), me, 2_000).kind).toBe('none');
    expect(claimState(season(-1), me, 2_000).kind).toBe('none');
    expect(claimState(season(1, 0b10), me, 2_000).kind).toBe('claimed');
    expect(claimState(season(1, 0b01), me, 2_000).kind).toBe('claimable');
    expect(claimState(season(1), me, 1_000 + CLAIM_WINDOW_S + 1).kind).toBe('expired');
    expect(claimState(null, me, 0).kind).toBe('none');
    expect(claimState(season(1), null, 0).kind).toBe('none');
  });
  it('creates the token account first when the wallet has none', async () => {
    const token = { tokenMint, tokenProgram };
    const without = await buildClaimTx(client.ix, { claimer: me, seasonId: 3, token, ataExists: false });
    expect(without).toHaveLength(2);
    expect(without[1].data.subarray(0, 8).equals(disc('claim_season_reward'))).toBe(true);
    const withAta = await buildClaimTx(client.ix, { claimer: me, seasonId: 3, token, ataExists: true });
    expect(withAta).toHaveLength(1);
    expect(withAta[0].keys.some((k) => k.pubkey.equals(ata(me, tokenMint, tokenProgram)))).toBe(true);
  });
});

import { passCollection, passTraits, type PassTraits } from '@slana/art';
import { ACCOUNT_BYTES, ata, type ConfigView, type OwnedPass, type SlanaInstructions } from '@slana/sdk';
import type { PassStatus } from '@slana/shared';
import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { BASE_FEE_LAMPORTS, PRIORITY_MICRO_LAMPORTS } from './ticket';

/**
 * Slana Pass on the web (spec §4.1, §7.2.6): the free-mint transaction, what
 * it costs in SOL, whether this wallet can mint now, and how an owned Pass
 * looks (sealed until the collection seed is revealed). Pure functions; the
 * Pass page and the mint sheet render them.
 */

/**
 * Compute-unit limit of the mint transaction (Core `CreateV2` CPI + counter init). The localnet
 * e2e measured 25k–26k on the deployed lean program (34k–37k on the Anchor reference); 100k keeps more than 2× headroom.
 */
export const MINT_COMPUTE_UNITS = 100_000;
/** `MintCounter`: discriminator 8 + count 1 + bump 1 (from the SDK, checked against the IDL). */
export const MINT_COUNTER_BYTES = ACCOUNT_BYTES.mintCounter;
/** The minter and the fresh asset keypair both sign. */
export const MINT_SIGNATURES = 2;

/** Bytes of the Core `AssetV1` the mint creates (`key | owner | Collection(ua) | name | uri | seq`). */
export function coreAssetBytes(number: number, baseUri: string): number {
  const enc = new TextEncoder();
  const name = enc.encode(`Slana Pass #${number}`).length;
  const uri = enc.encode(`${baseUri}${number}.json`).length;
  return 1 + 32 + (1 + 32) + (4 + name) + (4 + uri) + 1;
}

export interface MintCost {
  /** Everything the wallet pays in SOL (lamports). */
  total: number;
  /** Rent of the new asset (and of the first mint's counter): it stays with the NFT, it does not come back. */
  rent: number;
  /** Network fees (two signatures + the priority fee). */
  fees: number;
}

/** SOL a mint moves. Nothing in $SLANA: the Pass itself is free. */
export function mintSolCost(opts: { number: number; baseUri: string; counterExists: boolean; rent: (bytes: number) => number }): MintCost {
  const rent = opts.rent(coreAssetBytes(opts.number, opts.baseUri)) + (opts.counterExists ? 0 : opts.rent(MINT_COUNTER_BYTES));
  const fees = MINT_SIGNATURES * BASE_FEE_LAMPORTS + Math.ceil((MINT_COMPUTE_UNITS * PRIORITY_MICRO_LAMPORTS) / 1_000_000);
  return { total: rent + fees, rent, fees };
}

export interface MintTxInput {
  minter: string | PublicKey;
  /** Address of the fresh asset keypair (it co-signs). */
  asset: string | PublicKey;
  config: Pick<ConfigView, 'passCollection' | 'passMinTokens' | 'tokenMint' | 'tokenProgram'>;
}

/**
 * One instruction, `mintPass`. The minter's game-token account rides along
 * only when the program asks for a minimum balance (`passMinTokens > 0`);
 * otherwise the optional account stays empty.
 */
export async function buildMintTx(ix: SlanaInstructions, p: MintTxInput): Promise<{ ixs: TransactionInstruction[]; minterToken: string | null }> {
  if (!p.config.passCollection) throw new Error('The Pass collection is not set up yet');
  const minterToken = p.config.passMinTokens > 0n ? ata(p.minter, p.config.tokenMint, p.config.tokenProgram).toBase58() : null;
  const mint = await ix.mintPass(p.minter, { asset: p.asset, collection: p.config.passCollection, minterToken });
  return { ixs: [mint], minterToken };
}

/** The Pass collection state: the chain config when it is loaded (fresher), else the server's view. */
export function passStatusOf(config: ConfigView | null, server: PassStatus | null): PassStatus | null {
  if (!config || !config.passCollection) return server;
  return {
    collection: config.passCollection,
    supply: config.passSupply,
    minted: config.passMinted,
    perWallet: config.passPerWallet,
    mintOpen: config.passMintOpen,
    mintStartTs: config.passMintStartTs,
    revealed: config.passRevealed && !!config.passFinalSeed,
    seedRevealed: config.passSeedRevealed,
    entropyTargetSlot: config.passEntropyTargetSlot,
    // traits derive from the final seed sha256(seed || entropy), never the admin seed
    seed: config.passRevealed ? config.passFinalSeed : null,
  };
}

export type MintGate =
  /** No collection (chain off or not set up), or the trait seed is not committed yet. */
  | { kind: 'unavailable' }
  | { kind: 'connect' }
  /** Opens at `startsAt` (unix seconds). */
  | { kind: 'notStarted'; startsAt: number }
  | { kind: 'closed' }
  | { kind: 'soldOut' }
  /** This wallet minted its allowance. */
  | { kind: 'limit'; perWallet: number }
  /** The program wants `min` tokens in the wallet. */
  | { kind: 'needTokens'; min: bigint }
  /** Wallet data still loading. */
  | { kind: 'loading' }
  | { kind: 'ready' };

export interface MintGateInput {
  status: PassStatus | null;
  walletConnected: boolean;
  /** Passes this wallet minted (its `MintCounter`); null = unknown yet. */
  mintedByMe: number | null;
  minTokens: bigint;
  tokenBalance: bigint | null;
  nowS: number;
  /** `Config.passSeedHash` is set (the program refuses with `SeedNotSet` otherwise); unknown counts as set. */
  seedCommitted?: boolean;
}

/** What the mint button does for this wallet right now. Mirrors the program's checks, in its order. */
export function mintGate(i: MintGateInput): MintGate {
  const s = i.status;
  // program order: CollectionNotSet, SeedNotSet, MintClosed (open, started, not ended/revealed), MintSoldOut, MintLimit, MintMinTokens.
  // Selling out ends the mint on chain (mintOpen turns false); it is still shown as sold out.
  if (!s || !s.collection) return { kind: 'unavailable' };
  if (i.seedCommitted === false) return { kind: 'unavailable' };
  if (!s.revealed && !s.mintOpen && s.minted >= s.supply) return { kind: 'soldOut' };
  if (s.revealed || !s.mintOpen) return { kind: 'closed' };
  if (s.mintStartTs > i.nowS) return { kind: 'notStarted', startsAt: s.mintStartTs };
  if (s.minted >= s.supply) return { kind: 'soldOut' };
  if (!i.walletConnected) return { kind: 'connect' };
  if (i.mintedByMe === null) return { kind: 'loading' };
  if (i.mintedByMe >= s.perWallet) return { kind: 'limit', perWallet: s.perWallet };
  if (i.minTokens > 0n) {
    if (i.tokenBalance === null) return { kind: 'loading' };
    if (i.tokenBalance < i.minTokens) return { kind: 'needTokens', min: i.minTokens };
  }
  return { kind: 'ready' };
}

export type PassView = { sealed: true; traits: null } | { sealed: false; traits: PassTraits };

/**
 * How an owned Pass is shown: sealed (closed passport, wax seal, sleepy red
 * coin) until the collection seed is revealed on chain, then its real traits.
 * A number outside the collection also stays sealed rather than guessing.
 */
export function passView(pass: Pick<OwnedPass, 'number'>, status: PassStatus | null): PassView {
  if (!status?.revealed || !status.seed) return { sealed: true, traits: null };
  try {
    return { sealed: false, traits: passTraits(status.seed, pass.number, status.supply) };
  } catch {
    return { sealed: true, traits: null };
  }
}

/** A random client-side seed for the rolling preview (never the collection's real seed). */
export function previewSeed(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Looks for the "what might I get" preview: a small collection rolled from
 * the preview seed, without the hand-made 1/1s (those stay a surprise).
 */
export function previewTraits(seed: string, count = 24): PassTraits[] {
  return passCollection(seed, Math.max(count * 2, 60))
    .filter((t) => !t.special?.startsWith('oneOfOne'))
    .slice(0, count);
}

/** `4` → `0004`. */
export const passNo = (n: number) => String(n).padStart(4, '0');

/** Seconds → `{ d, h, m, s }` for the mint countdown. */
export function splitDuration(totalS: number): { d: number; h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(totalS));
  return { d: Math.floor(t / 86_400), h: Math.floor((t % 86_400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/* ── completing the reveal (ruling R23) ──────────────────────────────────── */

/** Compute-unit limit of `capture_pass_entropy` (a full 512-entry SlotHashes scan is ~18k CU on the Anchor reference; the localnet e2e measured 4k on the deployed lean program, 10k on the reference). */
export const CAPTURE_COMPUTE_UNITS = 60_000;

/** SOL the "Complete the reveal" transaction costs: one signature plus the priority fee. Nothing else moves. */
export const captureFeeLamports = (): number => BASE_FEE_LAMPORTS + Math.ceil((CAPTURE_COMPUTE_UNITS * PRIORITY_MICRO_LAMPORTS) / 1_000_000);

export type RevealStage =
  /** The seed is secret (mint running or ended, `reveal_pass` not sent yet). */
  | { kind: 'sealed' }
  /** The seed is public; the target slot has not passed yet (or the current slot is unknown). */
  | { kind: 'waiting'; targetSlot: number; slotsLeft: number | null }
  /** The target slot passed: anyone (the server, any wallet) can complete the reveal. */
  | { kind: 'completable'; targetSlot: number }
  | { kind: 'revealed' };

/** Where the reveal stands for `status` at `slot` (null = current slot unknown). */
export function revealStage(status: PassStatus | null, slot: number | null): RevealStage {
  if (!status) return { kind: 'sealed' };
  if (status.revealed && status.seed) return { kind: 'revealed' };
  if (!status.seedRevealed) return { kind: 'sealed' };
  const targetSlot = status.entropyTargetSlot ?? 0;
  if (slot === null) return { kind: 'waiting', targetSlot, slotsLeft: null };
  if (slot <= targetSlot) return { kind: 'waiting', targetSlot, slotsLeft: targetSlot - slot + 1 };
  return { kind: 'completable', targetSlot };
}

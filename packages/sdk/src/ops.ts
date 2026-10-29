/**
 * Admin operations shared by the admin CLI (`admin.ts`, signed by a keypair file) and the web
 * admin panel (`/admin`, signed by the browser wallet): input validation, the mint check the
 * program applies in `set_token_mint`, the status read, the instruction plans and a decoder that
 * shows what a transaction will do.
 *
 * Browser-safe (no Node built-ins). Imported as `@elymum/sdk/ops`; it is deliberately not
 * re-exported from the SDK entry point, so the game bundle does not carry the admin code.
 */
import { DEFAULT_ARENAS, arenaMeta, formatToken, parseToken } from '@elymum/shared';
import { Buffer } from 'buffer';
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, type Connection } from '@solana/web3.js';
import BN from 'bn.js';
import type { ArenaView, ConfigView, GameToken } from './accounts';
import type { InitializeParams, SlanaClient, UpdateArenaParams, UpdateConfigParams } from './client';
import { DEFAULT_FEE_BPS, DEFAULT_SETTLE_FEE_LAMPORTS, MAX_ARENA_SESSIONS, MAX_FEE_BPS, MAX_SETTLE_FEE_LAMPORTS, MIN_ARENA_SESSIONS } from './constants';
import { lamportsToSol } from './format';
import { pdas } from './pda';
import { BPF_LOADER_UPGRADEABLE_ID, IDL, toPublicKey, type Address } from './program';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAtaIdempotentIx, createFeeWalletAtaIx, feeWalletAta, tokenAccountAmount } from './token';

/**
 * A refused input or precondition, found before anything is signed. The CLI prints it without a
 * stack (exit code 2, `UsageError` is this class); the panel shows it next to the field.
 */
export class AdminInputError extends Error {
  override name = 'AdminInputError';
}

/* -------------------------------------------------------------------- */
/* Field parsers. `label` names the field the way the user sees it:      */
/* `--fee-bps` in the CLI, "Fee (bps)" in the panel.                     */
/* -------------------------------------------------------------------- */

export function parsePubkeyInput(label: string, value: string): PublicKey {
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new AdminInputError(`${label}: not a valid public key: ${value}`);
  }
}

/** An integer in `[min, max]`; `_` separators are allowed (`1_000`). */
export function parseIntInput(label: string, value: string, min: number, max: number): number {
  const n = Number(value.replace(/_/g, ''));
  if (value.trim() === '' || !Number.isInteger(n) || n < min || n > max) throw new AdminInputError(`${label} must be an integer between ${min} and ${max}`);
  return n;
}

export function parseBoolInput(label: string, value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AdminInputError(`${label} must be true or false`);
}

/** Whole tokens (`1000`, `0.5`, `1_000`) → base units of a mint with `decimals`. */
export function parseTokenInput(label: string, value: string, decimals: number): bigint {
  try {
    return parseToken(value.replace(/_/g, ''), decimals);
  } catch (err) {
    throw new AdminInputError(`${label}: ${(err as Error).message}`);
  }
}

export function inferCluster(url: string): string {
  if (/devnet/i.test(url)) return 'devnet';
  if (/testnet/i.test(url)) return 'testnet';
  if (/mainnet/i.test(url)) return 'mainnet-beta';
  return 'localnet';
}

/* -------------------------------------------------------------------- */
/* Validated parameters                                                  */
/* -------------------------------------------------------------------- */

export type InitPlan = InitializeParams & { feeWallet: PublicKey; serverAuthority: PublicKey; feeBps: number; settleFeeLamports: number };

/**
 * `initialize` parameters with the defaults of `pnpm admin init`: the fee wallet defaults to the
 * admin signer, the fee to `DEFAULT_FEE_BPS`, the settle deposit to `DEFAULT_SETTLE_FEE_LAMPORTS`.
 */
export function initParams(
  input: { serverAuthority: PublicKey; feeWallet?: PublicKey; feeBps?: number; settleFeeLamports?: number },
  admin: PublicKey,
): InitPlan {
  const feeWallet = input.feeWallet ?? admin;
  if (feeWallet.equals(PublicKey.default) || input.serverAuthority.equals(PublicKey.default)) {
    throw new AdminInputError('the server and fee wallet must not be the default (all zero) key');
  }
  const feeBps = input.feeBps ?? DEFAULT_FEE_BPS;
  const settleFeeLamports = input.settleFeeLamports ?? DEFAULT_SETTLE_FEE_LAMPORTS;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) throw new AdminInputError(`the fee must be an integer between 0 and ${MAX_FEE_BPS} bps`);
  if (!Number.isInteger(settleFeeLamports) || settleFeeLamports < 0 || settleFeeLamports > MAX_SETTLE_FEE_LAMPORTS) {
    throw new AdminInputError(`the settle fee must be an integer between 0 and ${MAX_SETTLE_FEE_LAMPORTS} lamports`);
  }
  return { serverAuthority: input.serverAuthority, feeWallet, feeBps, settleFeeLamports };
}

/**
 * `update_config` changes with the omitted fields removed (an empty result means nothing to
 * change; the caller decides how to say so). Refuses the default key for the three keys.
 */
export function updateConfigParams(changes: UpdateConfigParams): UpdateConfigParams {
  const out: UpdateConfigParams = { ...changes };
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete (out as Record<string, unknown>)[k];
  for (const key of ['admin', 'serverAuthority', 'feeWallet'] as const) {
    const v = out[key];
    if (v !== undefined && toPublicKey(v).equals(PublicKey.default)) throw new AdminInputError(`${key} must not be the default (all zero) key`);
  }
  if (out.feeBps !== undefined && (!Number.isInteger(out.feeBps) || out.feeBps < 0 || out.feeBps > MAX_FEE_BPS)) {
    throw new AdminInputError(`the fee must be an integer between 0 and ${MAX_FEE_BPS} bps`);
  }
  return out;
}

/** The `create-arena --defaults` arenas in base units of a mint with `decimals`. */
export function defaultArenaParams(decimals: number): { id: number; entryFee: bigint; maxSessions: number }[] {
  const scale = 10n ** BigInt(decimals);
  return DEFAULT_ARENAS.map((a) => ({ id: a.id, entryFee: BigInt(a.entryTokens) * scale, maxSessions: a.maxSessions }));
}

/** The default arenas to create, and the ones skipped because an arena with that id exists. */
export function planDefaultArenas(decimals: number, existing: Pick<ArenaView, 'id'>[]) {
  const have = new Set(existing.map((a) => a.id));
  const all = defaultArenaParams(decimals);
  return { create: all.filter((a) => !have.has(a.id)), skipped: all.filter((a) => have.has(a.id)) };
}

/** Checks a custom arena (`create-arena --id --entry --max`); returns why it is refused, or null. */
export function createArenaRefusal(p: { id: number; entryFee: bigint; maxSessions: number }, existing: Pick<ArenaView, 'id'>[]): string | null {
  if (!Number.isInteger(p.id) || p.id < 0 || p.id > 65_535) return 'the arena id must be an integer between 0 and 65535';
  if (p.entryFee <= 0n) return 'the entry fee must be greater than zero';
  if (!Number.isInteger(p.maxSessions) || p.maxSessions < MIN_ARENA_SESSIONS || p.maxSessions > MAX_ARENA_SESSIONS) {
    return `max sessions must be between ${MIN_ARENA_SESSIONS} and ${MAX_ARENA_SESSIONS}`;
  }
  if (existing.some((a) => a.id === p.id)) return `arena #${p.id} already exists; update it instead`;
  return null;
}

/** Checks `update_arena` changes against the arena; returns why the program would refuse them, or null. */
export function updateArenaRefusal(arena: Pick<ArenaView, 'id' | 'openSessions'>, changes: UpdateArenaParams): string | null {
  if (changes.enabled === undefined && changes.maxSessions === undefined && changes.entryFee === undefined) return 'nothing to change';
  if (changes.maxSessions !== undefined && (!Number.isInteger(changes.maxSessions) || changes.maxSessions < MIN_ARENA_SESSIONS || changes.maxSessions > MAX_ARENA_SESSIONS)) {
    return `max sessions must be between ${MIN_ARENA_SESSIONS} and ${MAX_ARENA_SESSIONS}`;
  }
  if (changes.entryFee !== undefined) {
    if (BigInt(changes.entryFee.toString()) <= 0n) return 'the entry fee must be greater than zero';
    if (arena.openSessions > 0) return `arena #${arena.id} has ${arena.openSessions} open sessions; the program refuses entry fee changes until they settle`;
  }
  return null;
}

/**
 * Sanity checks of an admin transfer (`update_config` with `admin`, final and unconfirmed by the new
 * key): the new admin must be an on-curve wallet key (a PDA, the program, the config, the server key
 * or the current admin would leave the program without a usable admin). Returns why it is refused, or null.
 */
export function adminTransferRefusal(
  newAdmin: PublicKey,
  ctx: { programId: Address; currentAdmin: Address; serverKeys: (Address | null | undefined)[]; feeWallet?: Address },
): string | null {
  const is = (a: Address | null | undefined) => !!a && toPublicKey(a).equals(newAdmin);
  if (newAdmin.equals(PublicKey.default)) return 'the new admin must not be the default (all zero) key';
  if (is(ctx.currentAdmin)) return 'the new admin is the current admin';
  if (is(ctx.programId)) return 'the new admin is the program id';
  if (is(pdas.config(ctx.programId))) return 'the new admin is the config account';
  if (ctx.serverKeys.some(is)) return 'the new admin is the server key (a hot key on the game server)';
  if (!PublicKey.isOnCurve(newAdmin.toBytes())) return 'the new admin is not an on-curve wallet key (a program-derived address cannot sign)';
  return null;
}

/** `sweep_arena` preconditions (the program enforces them too); returns why it is refused, or null. */
export function sweepRefusal(arena: Pick<ArenaView, 'id' | 'enabled' | 'openSessions'>): string | null {
  if (arena.enabled) return `disable arena #${arena.id} first`;
  if (arena.openSessions > 0) return `arena #${arena.id} still has ${arena.openSessions} open sessions; wait until they settle or are refunded`;
  return null;
}

export const SWEEP_WARNING =
  "Sweep moves the arena's whole vault to the fee wallet. The game server may still hold journaled loot or pending payouts " +
  'for this arena that this tool cannot see: check the server log and journal first. A server that finds the vault short of ' +
  'its journal keeps the arena disabled. Never re-enable a swept arena.';

/**
 * Why the connected wallet cannot close the program (null: it can). Closing is a BPF upgradeable
 * loader `Close`, signed by the upgrade authority, not by the config admin.
 */
export function closeProgramRefusal(status: Pick<StatusSnapshot, 'deployed' | 'upgradeAuthority'>, signer: string): string | null {
  if (!status.deployed) return 'the program is not deployed (or already closed)';
  if (!status.upgradeAuthority) return 'the program has no upgrade authority (immutable): nobody can close it';
  if (status.upgradeAuthority !== signer) return `only the upgrade authority ${status.upgradeAuthority} can close the program`;
  return null;
}

export const CLOSE_PROGRAM_WARNING =
  'Closing deletes the program code for good and returns its rent to the recipient. It cannot be undone: the same program id ' +
  'can never be deployed again, and every account the program owns (config, arenas, sessions, profiles) and every vault its ' +
  'PDAs control is locked forever, tokens included. Sweep the arenas first. For a reversible emergency stop, use Pause.';

/** The tokens and open sessions that a close would lock in the arenas. */
export function closeProgramExposure(arenas: Pick<ArenaView, 'pot' | 'openSessions'>[]): { pot: bigint; openSessions: number } {
  return arenas.reduce((t, a) => ({ pot: t.pot + a.pot, openSessions: t.openSessions + a.openSessions }), { pot: 0n, openSessions: 0 });
}

const LOADER_CLOSE = 5;

/**
 * The BPF upgradeable loader `Close` of the program itself (`solana program close`): closes the
 * ProgramData account, sends its lamports to `recipient` and leaves the program unusable.
 */
export function buildCloseProgramIx(programId: Address, authority: PublicKey, recipient: PublicKey): TransactionInstruction {
  const program = toPublicKey(programId);
  const data = Buffer.alloc(4);
  data.writeUInt32LE(LOADER_CLOSE, 0);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_ID,
    keys: [
      { pubkey: pdas.programData(program), isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: true },
    ],
    data,
  });
}

/* -------------------------------------------------------------------- */
/* Token programs and the mint check                                     */
/* -------------------------------------------------------------------- */

export const isTokenProgram = (program: PublicKey): boolean => program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID);

export function tokenProgramName(program: string | PublicKey | null): string {
  if (program === null) return 'not set';
  const p = typeof program === 'string' ? program : program.toBase58();
  if (p === TOKEN_2022_PROGRAM_ID.toBase58()) return 'Token-2022';
  if (p === TOKEN_PROGRAM_ID.toBase58()) return 'SPL Token';
  return p;
}

/** Token-2022 `ExtensionType` names (spl-token-2022 numbering). */
export const EXTENSION_NAMES: Record<number, string> = {
  1: 'TransferFeeConfig',
  2: 'TransferFeeAmount',
  3: 'MintCloseAuthority',
  4: 'ConfidentialTransferMint',
  5: 'ConfidentialTransferAccount',
  6: 'DefaultAccountState',
  7: 'ImmutableOwner',
  8: 'MemoTransfer',
  9: 'NonTransferable',
  10: 'InterestBearingConfig',
  11: 'CpiGuard',
  12: 'PermanentDelegate',
  13: 'NonTransferableAccount',
  14: 'TransferHook',
  15: 'TransferHookAccount',
  16: 'ConfidentialTransferFeeConfig',
  17: 'ConfidentialTransferFeeAmount',
  18: 'MetadataPointer',
  19: 'TokenMetadata',
  20: 'GroupPointer',
  21: 'TokenGroup',
  22: 'GroupMemberPointer',
  23: 'TokenGroupMember',
  24: 'ConfidentialMintBurn',
  25: 'ScaledUiAmount',
  26: 'Pausable',
  27: 'PausableAccount',
};

/**
 * Mint extensions the program refuses in `set_token_mint` (`DENIED_MINT_EXTENSIONS` in
 * programs/slana-lean/src/token.rs and programs/slana-ref/src/token.rs).
 */
export const DENIED_MINT_EXTENSIONS: readonly number[] = [1, 3, 4, 6, 9, 12, 14, 16, 24, 26];

/** Highest extension type the deployed program knows (`MAX_EXTENSION_TYPE`); a higher one is refused. */
export const MAX_KNOWN_EXTENSION_TYPE = 27;

const MINT_LEN = 82;
const ACCOUNT_LEN = 165;
const MULTISIG_LEN = 355;
const ACCOUNT_TYPE_MINT = 1;

export interface MintExtension {
  type: number;
  name: string;
  /** The program refuses a mint carrying it. */
  denied: boolean;
}

export interface MintInspection {
  address: string;
  exists: boolean;
  /** Program owning the account (null when it does not exist). */
  owner: string | null;
  /** 'SPL Token', 'Token-2022' or the owner address. */
  ownerName: string | null;
  decimals: number | null;
  /** Base units. */
  supply: bigint | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: MintExtension[];
  /** Why `set_token_mint` (or the SDK's supply rule) refuses this mint; empty = accepted. */
  refusals: string[];
  /** Best effort (Token-2022 metadata, else Metaplex); filled by `inspectMint`. */
  symbol: string | null;
}

/** spl-token `COption<Pubkey>` at `off`: null for None, undefined when malformed. */
function readCOptionKey(d: Uint8Array, off: number): string | null | undefined {
  const tag = d.subarray(off, off + 4);
  if (tag.length < 4 || tag[1] !== 0 || tag[2] !== 0 || tag[3] !== 0 || tag[0] > 1) return undefined;
  return tag[0] === 0 ? null : new PublicKey(d.subarray(off + 4, off + 36)).toBase58();
}

/**
 * The extension types of a Token-2022 mint's TLV data, walked like the program's
 * `mint_extensions` (type u16, length u16, value); null where the program fails to parse it.
 */
export function mintExtensionTypes(data: Uint8Array): number[] | null {
  if (data.length <= MINT_LEN) return [];
  const tlv = data.subarray(ACCOUNT_LEN + 1);
  const view = new DataView(tlv.buffer, tlv.byteOffset, tlv.byteLength);
  const out: number[] = [];
  let at = 0;
  while (at < tlv.length) {
    if (at + 2 > tlv.length) break;
    const ty = view.getUint16(at, true);
    if (ty === 0) break;
    if (ty > MAX_KNOWN_EXTENSION_TYPE) return null;
    if (at + 4 > tlv.length) return null;
    const end = at + 4 + view.getUint16(at + 2, true);
    if (end > tlv.length) return null;
    if (!out.includes(ty)) out.push(ty);
    at = end;
  }
  return out;
}

/**
 * The mint check of `set_token_mint` (the program's `validate_mint`), run on an account read
 * beforehand: a token program owns it, it unpacks as an initialized mint, it has no freeze
 * authority and no denied Token-2022 extension. Adds the SDK rule that the supply fits a JS
 * number (`assertSafeSupply`).
 */
export function inspectMintAccount(address: Address, info: { owner: PublicKey; data: Uint8Array } | null): MintInspection {
  const base: MintInspection = {
    address: toPublicKey(address).toBase58(),
    exists: !!info,
    owner: info ? info.owner.toBase58() : null,
    ownerName: info ? tokenProgramName(info.owner) : null,
    decimals: null,
    supply: null,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: [],
    refusals: [],
    symbol: null,
  };
  if (!info) return { ...base, refusals: ['no account exists at this address on this cluster'] };
  if (!isTokenProgram(info.owner)) return { ...base, refusals: [`not an SPL Token / Token-2022 mint (owner ${info.owner.toBase58()})`] };
  const d = info.data;
  const refusals: string[] = [];
  const malformed = d.length === MULTISIG_LEN || d.length < MINT_LEN;
  const mintAuthority = malformed ? undefined : readCOptionKey(d, 0);
  const freezeAuthority = malformed ? undefined : readCOptionKey(d, 46);
  const initialized = malformed ? null : d[45];
  if (malformed || mintAuthority === undefined || freezeAuthority === undefined || (initialized !== 0 && initialized !== 1)) {
    return { ...base, refusals: ['the account is not a mint'] };
  }
  if (initialized !== 1) refusals.push('the mint is not initialized');
  if (d.length > MINT_LEN) {
    const padOk = d.subarray(MINT_LEN, ACCOUNT_LEN).every((b) => b === 0) && d[ACCOUNT_LEN] === ACCOUNT_TYPE_MINT;
    if (!padOk) return { ...base, refusals: ['the account is not a mint'] };
  }
  const supply = new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(36, true);
  const decimals = d[44];
  if (freezeAuthority) refusals.push(`the mint has a freeze authority (${freezeAuthority}); the program refuses it`);
  let extensions: MintExtension[] = [];
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const types = mintExtensionTypes(d);
    if (types === null) {
      refusals.push(`the mint's extension data cannot be read, or carries an extension type above ${MAX_KNOWN_EXTENSION_TYPE} the program does not know`);
    } else {
      extensions = types.map((type) => ({ type, name: EXTENSION_NAMES[type] ?? `Extension ${type}`, denied: DENIED_MINT_EXTENSIONS.includes(type) }));
      const denied = extensions.filter((e) => e.denied).map((e) => e.name);
      if (denied.length) refusals.push(`the program refuses these Token-2022 extensions: ${denied.join(', ')}`);
    }
  }
  if (supply > BigInt(Number.MAX_SAFE_INTEGER)) refusals.push(`the supply ${supply} (base units) exceeds 2^53 - 1; the server and web cannot handle this mint`);
  return { ...base, decimals, supply, mintAuthority, freezeAuthority, extensions, refusals };
}

/** Reads and checks a mint (plus its symbol, best effort). */
export async function inspectMint(connection: Connection, mint: Address): Promise<MintInspection> {
  const key = toPublicKey(mint);
  const info = await connection.getAccountInfo(key, 'confirmed');
  const out = inspectMintAccount(key, info);
  if (info && isTokenProgram(info.owner) && out.decimals !== null) out.symbol = await fetchTokenSymbol(connection, key, info.owner);
  return out;
}

/* -------------------------------------------------------------------- */
/* Token symbol (Token-2022 metadata, else Metaplex)                     */
/* -------------------------------------------------------------------- */

/** Metaplex Token Metadata program (pump.fun and most SPL Token mints carry their symbol there). */
export const MPL_TOKEN_METADATA_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export function metaplexMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('metadata'), MPL_TOKEN_METADATA_ID.toBytes(), mint.toBytes()], MPL_TOKEN_METADATA_ID)[0];
}

/** Name and symbol of a Metaplex `MetadataV1` account (`key | update authority | mint | name | symbol | …`); null otherwise. */
export function parseMetaplexMetadata(data: Uint8Array): { name: string; symbol: string } | null {
  const KEY_METADATA_V1 = 4;
  if (data.length < 65 + 4 || data[0] !== KEY_METADATA_V1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 65;
  const read = (): string | null => {
    if (data.length < offset + 4) return null;
    const len = view.getUint32(offset, true);
    offset += 4;
    if (len > 200 || data.length < offset + len) return null;
    const s = new TextDecoder().decode(data.subarray(offset, offset + len));
    offset += len;
    return s.replace(/\0+$/, '').trim();
  };
  const name = read();
  const symbol = name === null ? null : read();
  return name === null || symbol === null ? null : { name, symbol };
}

/**
 * The symbol in a Token-2022 mint's own `TokenMetadata` extension (type 19: update authority,
 * mint, then borsh strings name, symbol, uri); null when absent. Parsed here rather than with
 * `@solana/spl-token`'s `getTokenMetadata`, which would pull its codec libraries into the game bundle.
 */
export function token2022Symbol(data: Uint8Array): string | null {
  if (data.length <= ACCOUNT_LEN + 1) return null;
  const tlv = data.subarray(ACCOUNT_LEN + 1);
  const view = new DataView(tlv.buffer, tlv.byteOffset, tlv.byteLength);
  for (let at = 0; at + 4 <= tlv.length; ) {
    const ty = view.getUint16(at, true);
    const len = view.getUint16(at + 2, true);
    if (ty === 0) return null;
    if (ty === 19) {
      let off = at + 4 + 64;
      const read = (): string | null => {
        if (off + 4 > tlv.length) return null;
        const n = view.getUint32(off, true);
        off += 4;
        if (off + n > tlv.length) return null;
        const s = new TextDecoder().decode(tlv.subarray(off, off + n));
        off += n;
        return s;
      };
      return read() === null ? null : read()?.trim() || null;
    }
    at += 4 + len;
  }
  return null;
}

const SYMBOL_MAX = 16;

/**
 * A self-declared token symbol made safe to show: control, bidi and zero-width characters
 * removed, whitespace collapsed, at most 16 characters. Null when nothing is left.
 */
export function sanitizeSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const chars = [...clean];
  return chars.length > SYMBOL_MAX ? `${chars.slice(0, SYMBOL_MAX).join('')}…` : clean;
}

/** Best effort: the mint's symbol from Token-2022 metadata or Metaplex metadata; null when none. */
export async function fetchTokenSymbol(connection: Connection, mint: PublicKey, tokenProgram: PublicKey): Promise<string | null> {
  try {
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      const info = await connection.getAccountInfo(mint, 'confirmed');
      const symbol = sanitizeSymbol(info ? token2022Symbol(info.data) : null);
      if (symbol) return symbol;
    }
    const info = await connection.getAccountInfo(metaplexMetadataPda(mint), 'confirmed');
    const parsed = info && info.owner.equals(MPL_TOKEN_METADATA_ID) ? parseMetaplexMetadata(info.data) : null;
    return sanitizeSymbol(parsed?.symbol);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- */
/* Status                                                                */
/* -------------------------------------------------------------------- */

/**
 * The program's upgrade authority from its ProgramData account
 * (`UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }`):
 * null when the program is immutable, missing or not upgradeable.
 */
export function parseUpgradeAuthority(data: Uint8Array): string | null {
  if (data.length < 45) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 3 || data[12] !== 1) return null;
  return new PublicKey(data.subarray(13, 45)).toBase58();
}

export async function fetchUpgradeAuthority(connection: Connection, programId: Address): Promise<string | null> {
  const info = await connection.getAccountInfo(pdas.programData(programId), 'confirmed');
  if (!info || !info.owner.equals(BPF_LOADER_UPGRADEABLE_ID)) return null;
  return parseUpgradeAuthority(info.data);
}

export interface MintSnapshot {
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  symbol: string | null;
}

/** Everything `pnpm admin status` prints and the panel shows. */
export interface StatusSnapshot {
  url: string;
  cluster: string;
  programId: string;
  deployed: boolean;
  /** The program's upgrade authority (null: immutable or unreadable). Read by `fetchStatus`. */
  upgradeAuthority?: string | null;
  configAddress: string;
  config: ConfigView | null;
  /** Lamports of the server authority. */
  serverBalance?: number;
  /** Fee wallet's associated token account (null while the token is unset). */
  feeWalletToken?: string | null;
  /** Its balance in base units; null when the account does not exist. */
  feeWalletBalance?: bigint | null;
  /** The mint account, null when unreadable or unset. */
  mint?: MintSnapshot | null;
  arenas?: ArenaView[];
}

/** Reads the whole admin status of the program behind `client`. */
export async function fetchStatus(client: SlanaClient, where: { url: string; cluster: string }): Promise<StatusSnapshot> {
  const { connection } = client;
  const snapshot: StatusSnapshot = {
    url: where.url,
    cluster: where.cluster,
    programId: client.programId.toBase58(),
    deployed: await client.isDeployed(),
    configAddress: pdas.config(client.programId).toBase58(),
    config: null,
  };
  if (!snapshot.deployed) return snapshot;
  const [config, upgradeAuthority] = await Promise.all([client.fetchConfig(), fetchUpgradeAuthority(connection, client.programId)]);
  snapshot.config = config;
  snapshot.upgradeAuthority = upgradeAuthority;
  if (!config) return snapshot;
  const [serverBalance, arenas] = await Promise.all([connection.getBalance(new PublicKey(config.serverAuthority), 'confirmed'), client.fetchArenas()]);
  snapshot.serverBalance = serverBalance;
  snapshot.arenas = arenas;
  if (config.tokenMint !== null && config.tokenProgram !== null) {
    const mint = new PublicKey(config.tokenMint);
    const program = new PublicKey(config.tokenProgram);
    const feeToken = feeWalletAta(config);
    const [mintInfo, symbol, feeInfo] = await Promise.all([
      connection.getAccountInfo(mint, 'confirmed').catch(() => null),
      fetchTokenSymbol(connection, mint, program),
      connection.getAccountInfo(feeToken, 'confirmed'),
    ]);
    const m = mintInfo ? inspectMintAccount(mint, mintInfo) : null;
    snapshot.mint = m && m.supply !== null ? { supply: m.supply, mintAuthority: m.mintAuthority, freezeAuthority: m.freezeAuthority, symbol } : null;
    snapshot.feeWalletToken = feeToken.toBase58();
    snapshot.feeWalletBalance = feeInfo && feeInfo.data.length >= 72 ? tokenAccountAmount(feeInfo.data) : null;
  }
  return snapshot;
}

export const fmtSol = (lamports: number): string => `◎${lamportsToSol(lamports).toLocaleString('en-US', { maximumFractionDigits: 9 })}`;
export const fmtPct = (bps: number): string => `${(bps / 100).toFixed(2)} %`;
export const fmtTok = (raw: bigint, decimals: number): string => formatToken(raw, decimals, { maxFrac: Math.min(decimals, 6) });
export const arenaName = (id: number): string => arenaMeta(id).name;

/* -------------------------------------------------------------------- */
/* Instruction plans                                                     */
/* -------------------------------------------------------------------- */

/**
 * The `set-token` transaction: create the fee wallet's associated token account idempotently
 * (the admin pays), then `set_token_mint`. `mintOwner` is the program owning the mint account,
 * which picks SPL Token or Token-2022. Refuses when the config already has a mint (the program
 * would fail with `TokenAlreadySet`) or the owner is not a token program.
 */
export async function buildSetTokenInstructions(
  client: SlanaClient,
  admin: PublicKey,
  config: Pick<ConfigView, 'tokenMint' | 'feeWallet'>,
  mint: PublicKey,
  mintOwner: PublicKey,
): Promise<TransactionInstruction[]> {
  if (config.tokenMint !== null) {
    throw new AdminInputError(`the game token is already set to ${config.tokenMint}; set_token_mint runs only once`);
  }
  if (!isTokenProgram(mintOwner)) {
    throw new AdminInputError(`${mint.toBase58()} is not an SPL Token / Token-2022 mint (owner ${mintOwner.toBase58()})`);
  }
  return [
    createFeeWalletAtaIx(admin, { feeWallet: config.feeWallet, tokenMint: mint, tokenProgram: mintOwner }),
    await client.ix.setTokenMint(admin, { tokenMint: mint, tokenProgram: mintOwner }),
  ];
}

/**
 * `update_config`, prefixed with the idempotent creation of the new fee wallet's token account
 * when the fee wallet changes after the token is set (it must exist before the next settlement).
 */
export async function buildUpdateConfigInstructions(
  client: SlanaClient,
  admin: PublicKey,
  config: Pick<ConfigView, 'tokenMint' | 'tokenProgram' | 'feeWallet'>,
  changes: UpdateConfigParams,
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  if (changes.feeWallet !== undefined && config.tokenMint !== null) ixs.push(createFeeWalletAtaIx(admin, { ...config, feeWallet: changes.feeWallet }));
  ixs.push(await client.ix.updateConfig(admin, changes));
  return ixs;
}

/** One `create_arena` per arena, in one transaction. */
export async function buildCreateArenasInstructions(
  client: SlanaClient,
  admin: PublicKey,
  token: GameToken,
  arenas: { id: number; entryFee: bigint; maxSessions: number }[],
): Promise<TransactionInstruction[]> {
  return Promise.all(arenas.map((a) => client.ix.createArena(admin, { ...a, tokenMint: token.tokenMint, tokenProgram: token.tokenProgram })));
}

/** `sweep_arena`, prefixed with the idempotent creation of the fee wallet's token account (like `pnpm admin sweep`). */
export async function buildSweepInstructions(
  client: SlanaClient,
  admin: PublicKey,
  config: Pick<ConfigView, 'feeWallet' | 'tokenMint' | 'tokenProgram'>,
  token: GameToken,
  id: number,
): Promise<TransactionInstruction[]> {
  return [
    createAtaIdempotentIx(admin, config.feeWallet, token.tokenMint, token.tokenProgram),
    await client.ix.sweepArena(admin, { id, feeWalletToken: feeWalletAta(config), tokenMint: token.tokenMint, tokenProgram: token.tokenProgram }),
  ];
}

/* -------------------------------------------------------------------- */
/* What a transaction does (for the confirmation screen)                 */
/* -------------------------------------------------------------------- */

export interface DescribedAccount {
  /** Role in the instruction (IDL account name), when known. */
  name: string;
  address: string;
  signer: boolean;
  writable: boolean;
}

export interface DescribedInstruction {
  /** "Slana", "Associated Token", "Compute Budget", or the program id. */
  program: string;
  programId: string;
  /** Instruction name (`initialize`, `createIdempotent`, `setComputeUnitPrice`, …). */
  name: string;
  /** Decoded arguments as display strings (`null` options read "unchanged"). */
  args: [string, string][];
  accounts: DescribedAccount[];
}

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function displayArg(v: unknown): string {
  if (v === null || v === undefined) return 'unchanged';
  if (v instanceof PublicKey) return v.toBase58();
  if (BN.isBN(v)) return (v as BN).toString();
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const ATA_ACCOUNTS = ['payer', 'associated_token_account', 'owner', 'mint', 'system_program', 'token_program'];

/**
 * Decodes an instruction of the Slana program (Anchor coder + IDL account names), the associated
 * token account program or the compute budget program. Anything else is listed raw.
 */
export function describeInstruction(client: SlanaClient, ix: TransactionInstruction): DescribedInstruction {
  const accounts = (names: string[]): DescribedAccount[] =>
    ix.keys.map((k, i) => ({ name: names[i] ?? `account ${i}`, address: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable }));
  const programId = ix.programId.toBase58();
  if (ix.programId.equals(client.programId)) {
    const coder = client.program.coder.instruction as unknown as { decode(data: typeof ix.data): { name: string; data: Record<string, unknown> } | null };
    const decoded = coder.decode(ix.data);
    const def = decoded ? (IDL as unknown as { instructions: { name: string; accounts: { name: string }[] }[] }).instructions.find((i) => snakeToCamel(i.name) === decoded.name) : undefined;
    const raw = decoded?.data ?? {};
    // single struct argument (`args`) is flattened
    const fields = Object.keys(raw).length === 1 && raw.args && typeof raw.args === 'object' && !(raw.args instanceof PublicKey) ? (raw.args as Record<string, unknown>) : raw;
    return {
      program: 'Slana',
      programId,
      name: decoded?.name ?? 'unknown',
      args: Object.entries(fields).map(([k, v]) => [k, displayArg(v)]),
      accounts: accounts(def ? def.accounts.map((a) => a.name) : []),
    };
  }
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    const tag = ix.data[0];
    return { program: 'Associated Token', programId, name: tag === 1 ? 'createIdempotent' : tag === undefined ? 'create' : `instruction ${tag}`, args: [], accounts: accounts(ATA_ACCOUNTS) };
  }
  if (ix.programId.equals(ComputeBudgetProgram.programId)) {
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    if (ix.data[0] === 3 && ix.data.length >= 9) return { program: 'Compute Budget', programId, name: 'setComputeUnitPrice', args: [['microLamports', view.getBigUint64(1, true).toString()]], accounts: [] };
    if (ix.data[0] === 2 && ix.data.length >= 5) return { program: 'Compute Budget', programId, name: 'setComputeUnitLimit', args: [['units', String(view.getUint32(1, true))]], accounts: [] };
  }
  if (ix.programId.equals(BPF_LOADER_UPGRADEABLE_ID)) {
    const tag = ix.data.length >= 4 ? new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getUint32(0, true) : -1;
    if (tag === LOADER_CLOSE) return { program: 'BPF Upgradeable Loader', programId, name: 'close', args: [], accounts: accounts(['program_data', 'recipient', 'authority', 'program']) };
    return { program: 'BPF Upgradeable Loader', programId, name: `instruction ${tag}`, args: [], accounts: accounts([]) };
  }
  const program = ix.programId.equals(SystemProgram.programId) ? 'System' : programId;
  return { program, programId, name: 'instruction', args: [['data', `${ix.data.length} bytes`]], accounts: accounts([]) };
}

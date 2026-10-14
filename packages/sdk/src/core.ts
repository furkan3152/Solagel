/**
 * Minimal Metaplex Core helpers (no mpl-core JS dependency): reading assets and creating the
 * Pass collection. Byte layouts follow the `mpl-core` 0.12.1 crate's generated types.
 */
import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { PASS_NAME_PREFIX } from './constants';
import { toPublicKey, type Address } from './program';

/** Metaplex Core program. */
export const MPL_CORE_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

/** `Key` enum of Core accounts (first byte). */
export const CORE_KEY_ASSET_V1 = 1;
export const CORE_KEY_COLLECTION_V1 = 5;
/** `UpdateAuthority` enum tags. */
const UA_NONE = 0;
const UA_ADDRESS = 1;
const UA_COLLECTION = 2;

/** `CreateCollectionV2` instruction discriminator. */
const CREATE_COLLECTION_V2 = 21;
/** `Plugin::Royalties` (variant 0 of `Plugin`). */
const PLUGIN_ROYALTIES = 0;
/** `RuleSet::None` (variant 0 of `RuleSet`). */
const RULE_SET_NONE = 0;

export interface CoreAsset {
  owner: string;
  /** Collection of the asset (update authority `Collection(..)`), null otherwise. */
  collection: string | null;
  name: string;
  uri: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Parses an `AssetV1` account: `key u8 (1) | owner | update authority (tag [+ pubkey]) | name |
 * uri | seq …`. Returns null for anything else (other keys, truncated data, bad UTF-8).
 */
export function parseCoreAsset(data: Uint8Array): CoreAsset | null {
  if (data.length < 34 || data[0] !== CORE_KEY_ASSET_V1) return null;
  const owner = new PublicKey(data.subarray(1, 33)).toBase58();
  let offset = 34;
  let collection: string | null = null;
  const tag = data[33];
  if (tag === UA_ADDRESS || tag === UA_COLLECTION) {
    if (data.length < offset + 32) return null;
    if (tag === UA_COLLECTION) collection = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
  } else if (tag !== UA_NONE) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readString = (): string | null => {
    if (data.length < offset + 4) return null;
    const len = view.getUint32(offset, true);
    offset += 4;
    if (data.length < offset + len) return null;
    try {
      const s = utf8.decode(data.subarray(offset, offset + len));
      offset += len;
      return s;
    } catch {
      return null;
    }
  };
  const name = readString();
  if (name === null) return null;
  const uri = readString();
  if (uri === null) return null;
  return { owner, collection, name, uri };
}

const PASS_NAME = /^Slana Pass #(\d{1,5})$/;

/** `Slana Pass #42` → 42; null for any other name. */
export function passNumberFromName(name: string): number | null {
  const m = PASS_NAME.exec(name);
  return m ? Number(m[1]) : null;
}

/** Name `mint_pass` gives Pass number `n`. */
export const passName = (n: number): string => `${PASS_NAME_PREFIX}${n}`;

export interface CreateCollectionParams {
  /** New collection account (a fresh keypair that signs the transaction). */
  collection: Address;
  /** Collection update authority (the program's `passAuthority` PDA for the Slana Pass). */
  updateAuthority: Address;
  payer: Address;
  name: string;
  uri: string;
  /** Royalty in basis points (0..=10 000). */
  royaltyBps: number;
  /** Single royalty creator (receives 100 % of royalties). */
  royaltyTo: Address;
}

class Writer {
  private readonly bytes: number[] = [];
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v: number): this {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  raw(b: Uint8Array): this {
    for (const x of b) this.bytes.push(x);
    return this;
  }
  string(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).raw(b);
  }
  done(): Buffer {
    return Buffer.from(this.bytes);
  }
}

/**
 * Core `CreateCollectionV2` with one plugin, `Royalties { basis_points, creators: [{ royaltyTo,
 * 100 }], rule_set: None }`, plugin authority None (Core's default) and no external adapters.
 * Accounts: collection (w, s), update authority, payer (w, s), system program.
 */
export function createCollectionIx(p: CreateCollectionParams): TransactionInstruction {
  if (!Number.isInteger(p.royaltyBps) || p.royaltyBps < 0 || p.royaltyBps > 10_000) {
    throw new RangeError(`royaltyBps must be an integer in 0..10000, got ${p.royaltyBps}`);
  }
  const data = new Writer()
    .u8(CREATE_COLLECTION_V2)
    .string(p.name)
    .string(p.uri)
    .u8(1) // plugins: Some(
    .u32(1) // vec len 1
    .u8(PLUGIN_ROYALTIES)
    .u16(p.royaltyBps)
    .u32(1) // creators len 1
    .raw(toPublicKey(p.royaltyTo).toBytes())
    .u8(100) // percentage
    .u8(RULE_SET_NONE)
    .u8(0) // authority: None )
    .u8(0) // external_plugin_adapters: None
    .done();
  return new TransactionInstruction({
    programId: MPL_CORE_ID,
    keys: [
      { pubkey: toPublicKey(p.collection), isSigner: true, isWritable: true },
      { pubkey: toPublicKey(p.updateAuthority), isSigner: false, isWritable: false },
      { pubkey: toPublicKey(p.payer), isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

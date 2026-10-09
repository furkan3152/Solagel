import { PublicKey } from '@solana/web3.js';
import { BPF_LOADER_UPGRADEABLE_ID, PROGRAM_ID, toPublicKey, type Address } from './program';

const utf8 = new TextEncoder();

/** PDA seed prefixes (see `constants.rs`). */
export const SEEDS = {
  config: utf8.encode('config'),
  profile: utf8.encode('profile'),
  arena: utf8.encode('arena'),
  session: utf8.encode('session'),
  season: utf8.encode('season'),
} as const;

/** Little-endian u16 (arena ids). */
export function u16le(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`expected a u16, got ${n}`);
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

/** Little-endian u32 (season ids). */
export function u32le(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new RangeError(`expected a u32, got ${n}`);
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

// findProgramAddressSync hashes and checks the curve for every bump it tries, so derived
// addresses are memoised (bounded; the server derives the same profiles/sessions often).
const MAX_CACHE = 20_000;
const cache = new Map<string, PublicKey>();

function derive(key: string, seeds: Uint8Array[], programId: PublicKey): PublicKey {
  const hit = cache.get(key);
  if (hit) return hit;
  const [address] = PublicKey.findProgramAddressSync(seeds, programId);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, address);
  return address;
}

/** Program-derived addresses, seeded exactly like the program. */
export const pdas = {
  /** `["config"]` */
  config(programId: Address = PROGRAM_ID): PublicKey {
    const pid = toPublicKey(programId);
    return derive(`${pid.toBase58()}:config`, [SEEDS.config], pid);
  },
  /** `["profile", owner]` */
  profile(owner: Address, programId: Address = PROGRAM_ID): PublicKey {
    const pid = toPublicKey(programId);
    const o = toPublicKey(owner);
    return derive(`${pid.toBase58()}:profile:${o.toBase58()}`, [SEEDS.profile, o.toBytes()], pid);
  },
  /** `["arena", id as u16 LE]` */
  arena(id: number, programId: Address = PROGRAM_ID): PublicKey {
    const pid = toPublicKey(programId);
    return derive(`${pid.toBase58()}:arena:${id}`, [SEEDS.arena, u16le(id)], pid);
  },
  /** `["session", arena PDA, player]` */
  session(arena: Address, player: Address, programId: Address = PROGRAM_ID): PublicKey {
    const pid = toPublicKey(programId);
    const a = toPublicKey(arena);
    const p = toPublicKey(player);
    return derive(`${pid.toBase58()}:session:${a.toBase58()}:${p.toBase58()}`, [SEEDS.session, a.toBytes(), p.toBytes()], pid);
  },
  /** `["season", id as u32 LE]` */
  season(id: number, programId: Address = PROGRAM_ID): PublicKey {
    const pid = toPublicKey(programId);
    return derive(`${pid.toBase58()}:season:${id}`, [SEEDS.season, u32le(id)], pid);
  },
  /** The program's ProgramData account (upgradeable loader PDA `[programId]`), needed by `initialize`. */
  programData(programId: Address = PROGRAM_ID): PublicKey {
    const pid = toPublicKey(programId);
    return derive(`${pid.toBase58()}:programdata`, [pid.toBytes()], BPF_LOADER_UPGRADEABLE_ID);
  },
};

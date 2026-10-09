import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { BPF_LOADER_UPGRADEABLE_ID, PROGRAM_ID, pdas, u16le, u32le } from '../src';

const pid = PROGRAM_ID;
const find = (seeds: (Buffer | Uint8Array)[], program = pid) => PublicKey.findProgramAddressSync(seeds, program)[0];

describe('pdas', () => {
  it('config = ["config"]', () => {
    expect(pdas.config().equals(find([Buffer.from('config')]))).toBe(true);
  });

  it('profile = ["profile", owner]', () => {
    const owner = Keypair.generate().publicKey;
    expect(pdas.profile(owner).equals(find([Buffer.from('profile'), owner.toBuffer()]))).toBe(true);
    // base58 strings work too
    expect(pdas.profile(owner.toBase58()).equals(pdas.profile(owner))).toBe(true);
  });

  it('arena = ["arena", u16 LE]', () => {
    for (const id of [0, 1, 3, 255, 256, 65_535]) {
      const le = Buffer.alloc(2);
      le.writeUInt16LE(id);
      expect(pdas.arena(id).equals(find([Buffer.from('arena'), le]))).toBe(true);
    }
    expect(() => pdas.arena(65_536)).toThrow(RangeError);
    expect(() => pdas.arena(-1)).toThrow(RangeError);
    expect(() => pdas.arena(1.5)).toThrow(RangeError);
  });

  it('session = ["session", arena, player]', () => {
    const player = Keypair.generate().publicKey;
    const arena = pdas.arena(2);
    expect(pdas.session(arena, player).equals(find([Buffer.from('session'), arena.toBuffer(), player.toBuffer()]))).toBe(true);
  });

  it('season = ["season", u32 LE]', () => {
    for (const id of [1, 2, 300, 70_000, 0xffff_ffff]) {
      const le = Buffer.alloc(4);
      le.writeUInt32LE(id);
      expect(pdas.season(id).equals(find([Buffer.from('season'), le]))).toBe(true);
    }
    expect(() => pdas.season(2 ** 32)).toThrow(RangeError);
  });

  it('respects a custom program id', () => {
    const other = Keypair.generate().publicKey;
    expect(pdas.config(other).equals(find([Buffer.from('config')], other))).toBe(true);
    expect(pdas.config(other).equals(pdas.config())).toBe(false);
    expect(pdas.arena(1, other.toBase58()).equals(find([Buffer.from('arena'), Buffer.from([1, 0])], other))).toBe(true);
  });

  it('programData = upgradeable loader PDA [programId]', () => {
    expect(pdas.programData().equals(find([pid.toBuffer()], BPF_LOADER_UPGRADEABLE_ID))).toBe(true);
  });

  it('little-endian helpers', () => {
    expect([...u16le(0x1234)]).toEqual([0x34, 0x12]);
    expect([...u32le(0x12345678)]).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect([...u32le(0xffff_ffff)]).toEqual([255, 255, 255, 255]);
  });
});

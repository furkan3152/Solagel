import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { BPF_LOADER_UPGRADEABLE_ID, PROGRAM_ID, SEEDS, pdas, u16le } from '../src';

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

  it('respects a custom program id', () => {
    const other = Keypair.generate().publicKey;
    expect(pdas.config(other).equals(find([Buffer.from('config')], other))).toBe(true);
    expect(pdas.config(other).equals(pdas.config())).toBe(false);
    expect(pdas.arena(1, other.toBase58()).equals(find([Buffer.from('arena'), Buffer.from([1, 0])], other))).toBe(true);
  });

  it('programData = upgradeable loader PDA [programId]', () => {
    expect(pdas.programData().equals(find([pid.toBuffer()], BPF_LOADER_UPGRADEABLE_ID))).toBe(true);
  });

  describe('seeds match the program constants (IDL)', () => {
    const idl = JSON.parse(readFileSync(new URL('../src/idl/slana.json', import.meta.url), 'utf8')) as {
      constants: { name: string; value: string }[];
    };
    const seed = (name: string) => Uint8Array.from(JSON.parse(idl.constants.find((c) => c.name === name)!.value) as number[]);

    it('config singleton', () => {
      expect(pdas.config().equals(find([seed('CONFIG_SEED')]))).toBe(true);
    });

    it('no Pass, season or treasury seeds remain', () => {
      expect(idl.constants.map((c) => c.name).filter((n) => n.endsWith('_SEED')).sort()).toEqual(['ARENA_SEED', 'CONFIG_SEED', 'PROFILE_SEED', 'SESSION_SEED', 'VAULT_SEED']);
      expect(Object.keys(SEEDS).sort()).toEqual(['arena', 'config', 'profile', 'session', 'vault']);
    });

    it('vault = ["vault", arena]', () => {
      const arena = pdas.arena(1);
      expect(arena.toBase58()).toBe('5WEHHv4eCVJ4Mq826NXxDauRxpACwWZN1wFot8YHfvCM');
      expect(pdas.vault(arena).equals(find([seed('VAULT_SEED'), arena.toBuffer()]))).toBe(true);
      expect(pdas.vault(arena).toBase58()).toBe('3R7CSk5rgGanAXpABcXKv5ZofiGcx12Kc3Zua8DRuoz7');
    });

    it('profile/arena/session seeds come from the IDL too', () => {
      const owner = Keypair.generate().publicKey;
      expect(pdas.profile(owner).equals(find([seed('PROFILE_SEED'), owner.toBuffer()]))).toBe(true);
      const arena = pdas.arena(4);
      expect(arena.equals(find([seed('ARENA_SEED'), Buffer.from([4, 0])]))).toBe(true);
      expect(pdas.session(arena, owner).equals(find([seed('SESSION_SEED'), arena.toBuffer(), owner.toBuffer()]))).toBe(true);
    });
  });

  it('little-endian helpers', () => {
    expect([...u16le(0x1234)]).toEqual([0x34, 0x12]);
  });
});

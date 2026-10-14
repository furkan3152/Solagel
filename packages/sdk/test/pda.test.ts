import { readFileSync } from 'node:fs';
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

  describe('v2 seeds match the program constants (IDL)', () => {
    const idl = JSON.parse(readFileSync(new URL('../src/idl/slana.json', import.meta.url), 'utf8')) as {
      constants: { name: string; value: string }[];
    };
    const seed = (name: string) => Uint8Array.from(JSON.parse(idl.constants.find((c) => c.name === name)!.value) as number[]);
    const asset = new PublicKey(new Uint8Array(32).fill(7));

    it('singletons', () => {
      expect(pdas.treasuryVault().equals(find([seed('TREASURY_VAULT_SEED')]))).toBe(true);
      expect(pdas.seasonVault().equals(find([seed('SEASON_VAULT_SEED')]))).toBe(true);
      expect(pdas.passAuthority().equals(find([seed('PASS_AUTHORITY_SEED')]))).toBe(true);
      expect(pdas.config().equals(find([seed('CONFIG_SEED')]))).toBe(true);
      // fixed vectors for the declared program id
      expect(pdas.treasuryVault().toBase58()).toBe('AhAr2F5LeG9mhcxycpuBxLVQpgUghKN2gdpPGNZENfeF');
      expect(pdas.seasonVault().toBase58()).toBe('AwJzatfsFozqosLRyE5VPP8wsfBmQzdiFFvxE8YtxjT2');
      expect(pdas.passAuthority().toBase58()).toBe('4eBtPucNkAYcPuCizaNZtdRCFCiJNubsfxPoiYuZJVap');
    });

    it('vault = ["vault", arena]', () => {
      const arena = pdas.arena(1);
      expect(arena.toBase58()).toBe('5WEHHv4eCVJ4Mq826NXxDauRxpACwWZN1wFot8YHfvCM');
      expect(pdas.vault(arena).equals(find([seed('VAULT_SEED'), arena.toBuffer()]))).toBe(true);
      expect(pdas.vault(arena).toBase58()).toBe('3R7CSk5rgGanAXpABcXKv5ZofiGcx12Kc3Zua8DRuoz7');
    });

    it('passLock = ["pass_lock", asset], passMinted = ["pass_minted", wallet]', () => {
      expect(pdas.passLock(asset).equals(find([seed('PASS_LOCK_SEED'), asset.toBuffer()]))).toBe(true);
      expect(pdas.passLock(asset.toBase58()).toBase58()).toBe('58A4nXxND4f6ki5SwweSRia7jQxYxZGY1ffkgAy4Aw58');
      expect(pdas.passMinted(asset).equals(find([seed('PASS_MINTED_SEED'), asset.toBuffer()]))).toBe(true);
      expect(pdas.passMinted(asset).toBase58()).toBe('Hj6ed2Btkspgkb4sioZaxrmZN6Pxiub9zg4pCtJd51aY');
    });

    it('profile/arena/session/season seeds come from the IDL too', () => {
      const owner = Keypair.generate().publicKey;
      expect(pdas.profile(owner).equals(find([seed('PROFILE_SEED'), owner.toBuffer()]))).toBe(true);
      expect(pdas.season(3).equals(find([seed('SEASON_SEED'), Buffer.from([3, 0, 0, 0])]))).toBe(true);
      const arena = pdas.arena(4);
      expect(arena.equals(find([seed('ARENA_SEED'), Buffer.from([4, 0])]))).toBe(true);
      expect(pdas.session(arena, owner).equals(find([seed('SESSION_SEED'), arena.toBuffer(), owner.toBuffer()]))).toBe(true);
    });
  });

  it('little-endian helpers', () => {
    expect([...u16le(0x1234)]).toEqual([0x34, 0x12]);
    expect([...u32le(0x12345678)]).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect([...u32le(0xffff_ffff)]).toEqual([255, 255, 255, 255]);
  });
});

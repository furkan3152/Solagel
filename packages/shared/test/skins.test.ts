import { describe, expect, it } from 'vitest';
import { EMOTES, SKINS, getSkin, isSkinUnlocked, sanitizeChat, sanitizeName, truncateUtf8, utf8Length } from '../src';

describe('skin catalog', () => {
  it('has 24 skins with sequential ids and the on-chain tier layout', () => {
    expect(SKINS).toHaveLength(24);
    SKINS.forEach((s, i) => {
      expect(s.id).toBe(i);
      const expected = i < 8 ? 'free' : i < 16 ? 'level' : 'premium';
      expect(s.tier).toBe(expected);
    });
    expect(SKINS.slice(8, 16).map((s) => s.level)).toEqual([2, 3, 5, 7, 10, 13, 16, 20]);
    expect(new Set(SKINS.map((s) => s.key)).size).toBe(24);
  });

  it('unlock rules mirror the program', () => {
    expect(isSkinUnlocked(0, null)).toBe(true);
    expect(isSkinUnlocked(8, null)).toBe(false);
    expect(isSkinUnlocked(10, { xp: 800, premiumMask: 0 })).toBe(true); // level 5
    expect(isSkinUnlocked(10, { xp: 799, premiumMask: 0 })).toBe(false);
    expect(isSkinUnlocked(17, { xp: 0, premiumMask: 1 << 1 })).toBe(true);
    expect(isSkinUnlocked(17, { xp: 1e9, premiumMask: 1 << 0 })).toBe(false);
    expect(isSkinUnlocked(24, { xp: 1e9, premiumMask: 0xffffffff })).toBe(false);
  });

  it('falls back to skin 0 for unknown ids', () => {
    expect(getSkin(999).id).toBe(0);
  });

  it('has 8 emotes', () => {
    expect(EMOTES).toHaveLength(8);
  });
});

describe('text sanitizing', () => {
  it('cleans names', () => {
    expect(sanitizeName('  hello   world  ')).toBe('hello world');
    expect(sanitizeName('‮evil\u0000')).toBe('evil');
    expect(sanitizeName('')).toBe('Coinie');
    expect(sanitizeName(42)).toBe('Coinie');
    expect(sanitizeName('abcdefghijklmnopqrstuvwxyz')).toHaveLength(16);
    expect(sanitizeName('🚀'.repeat(20))).toBe('🚀'.repeat(16));
  });

  it('cleans chat', () => {
    expect(sanitizeChat('  gm \n frens ')).toBe('gm frens');
    expect(sanitizeChat('x'.repeat(500))).toHaveLength(100);
    expect(sanitizeChat(null)).toBe('');
  });

  it('truncates utf8 safely', () => {
    expect(utf8Length('ğ')).toBe(2);
    expect(truncateUtf8('ğğğğğğğğğ', 16)).toBe('ğğğğğğğğ');
    expect(truncateUtf8('🚀🚀🚀🚀🚀', 16)).toBe('🚀🚀🚀🚀');
  });
});

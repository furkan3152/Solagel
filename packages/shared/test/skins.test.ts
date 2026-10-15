import { describe, expect, it } from 'vitest';
import {
  BASIC_SKINS,
  EMOTES,
  SKINS,
  getSkin,
  isBasicSkin,
  sanitizeChat,
  sanitizeName,
  truncateUtf8,
  utf8Length,
} from '../src';

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

  it('BASIC_SKINS are the 8 free skins, ids 0..7', () => {
    expect(BASIC_SKINS).toHaveLength(8);
    expect(BASIC_SKINS.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(BASIC_SKINS.every((s) => s.tier === 'free')).toBe(true);
    expect(BASIC_SKINS.every((s, i) => s === SKINS[i])).toBe(true);
  });

  it('isBasicSkin accepts exactly ids 0..7', () => {
    for (let id = 0; id < 8; id++) expect(isBasicSkin(id)).toBe(true);
    for (const id of [8, 9, 15, 16, 23, 24, 999, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(isBasicSkin(id), String(id)).toBe(false);
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
    expect(utf8Length('é')).toBe(2);
    expect(truncateUtf8('ééééééééé', 16)).toBe('éééééééé');
    expect(truncateUtf8('🚀🚀🚀🚀🚀', 16)).toBe('🚀🚀🚀🚀');
  });
});

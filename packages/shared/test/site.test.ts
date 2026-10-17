import { describe, expect, it } from 'vitest';
import { SITE_SETTINGS_DEFAULT, isXStatusUrl, normalizeXHandle, type ErrorCode } from '../src';

describe('site helpers', () => {
  it('normalises X handles', () => {
    expect(normalizeXHandle('@SlanaIO')).toBe('slanaio');
    expect(normalizeXHandle('  slana_io ')).toBe('slana_io');
    expect(normalizeXHandle('https://x.com/Slanaio')).toBe('slanaio');
    expect(normalizeXHandle('https://twitter.com/slanaio/')).toBe('slanaio');
    expect(normalizeXHandle('x.com/slanaio?s=21')).toBe('slanaio');
    expect(normalizeXHandle('')).toBeNull();
    expect(normalizeXHandle('@')).toBeNull();
    expect(normalizeXHandle('a'.repeat(16))).toBeNull();
    expect(normalizeXHandle('bad-handle')).toBeNull();
    expect(normalizeXHandle(42)).toBeNull();
  });

  it('accepts X status links only', () => {
    expect(isXStatusUrl('https://x.com/slanaio/status/1790000000000000000')).toBe(true);
    expect(isXStatusUrl('https://twitter.com/a_b/status/1?s=20')).toBe(true);
    expect(isXStatusUrl('http://x.com/slanaio/status/1')).toBe(false);
    expect(isXStatusUrl('https://x.com/slanaio')).toBe(false);
    expect(isXStatusUrl('https://evil.com/x.com/slanaio/status/1')).toBe(false);
    expect(isXStatusUrl('https://x.com/toolonghandle1234/status/1')).toBe(false);
    expect(isXStatusUrl('https://x.com/a/status/1 javascript:')).toBe(false);
  });

  it('defaults: WL open, collab and game closed', () => {
    expect(SITE_SETTINGS_DEFAULT).toEqual({ wlOpen: true, collabOpen: false, gamePublic: false, xHandle: 'slanaio', launchPostUrl: null });
  });

  it('has the game_closed error code', () => {
    const code: ErrorCode = 'game_closed';
    expect(code).toBe('game_closed');
  });
});

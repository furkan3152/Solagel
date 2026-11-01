import { describe, expect, it } from 'vitest';
import { CUSTOM_DEFAULTS, CUSTOM_SETTINGS_DEFAULT, customRoomPrice, inviteUrl, parseInviteCode, parseJoinTarget, validateCustomConfig } from '../src';

const ok = (o: Record<string, unknown> = {}) => validateCustomConfig({ ...CUSTOM_DEFAULTS, name: 'Friday Pond', ...o });

describe('custom room config', () => {
  it('accepts the defaults with a name and trims it', () => {
    const v = ok({ name: '  Friday   Pond ' });
    expect(v).toEqual({ ok: true, config: { ...CUSTOM_DEFAULTS, name: 'Friday Pond' } });
  });

  it('refuses every out-of-range choice, naming the field', () => {
    expect(ok({ name: 'x' })).toMatchObject({ ok: false, field: 'name' });
    expect(ok({ name: 'a'.repeat(25) })).toMatchObject({ ok: false, field: 'name' });
    expect(ok({ name: '<script>' })).toMatchObject({ ok: false, field: 'name' });
    expect(ok({ durationMin: 45 })).toMatchObject({ ok: false, field: 'durationMin' });
    expect(ok({ mapSize: 'XL' })).toMatchObject({ ok: false, field: 'mapSize' });
    expect(ok({ difficulty: 'insane' })).toMatchObject({ ok: false, field: 'difficulty' });
    expect(ok({ food: 'none' })).toMatchObject({ ok: false, field: 'food' });
    expect(ok({ bots: 13 })).toMatchObject({ ok: false, field: 'bots' });
    expect(ok({ bots: 1.5 })).toMatchObject({ ok: false, field: 'bots' });
    expect(ok({ maxPlayers: 1 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(ok({ maxPlayers: 21 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(ok({ powerUps: 'yes' })).toMatchObject({ ok: false, field: 'powerUps' });
    expect(validateCustomConfig(null)).toMatchObject({ ok: false, field: 'config' });
  });

  it('food and power-ups are optional (normal, on)', () => {
    const { food: _f, powerUps: _p, ...rest } = CUSTOM_DEFAULTS;
    expect(validateCustomConfig({ ...rest, name: 'Pond' })).toMatchObject({ ok: true, config: { food: 'normal', powerUps: true } });
  });
});

describe('invites', () => {
  it('parses codes in any case and builds the share link; the code is a private-room join target', () => {
    expect(parseInviteCode(' ab2cd ')).toBe('AB2CD');
    expect(parseInviteCode('AB0CD')).toBeNull(); // no 0 / O / 1 / I in codes
    expect(parseInviteCode('ABCDEF')).toBeNull();
    expect(parseInviteCode(null)).toBeNull();
    expect(inviteUrl('https://elymum.io/', 'AB2CD')).toBe('https://elymum.io/play?room=AB2CD');
    expect(parseJoinTarget('private:AB2CD')).toEqual({ mode: 'private', code: 'AB2CD' });
  });
});

describe('room price', () => {
  const price = 5n * 10n ** 16n;
  it('holders get the perk the admin picked', () => {
    const s = CUSTOM_SETTINGS_DEFAULT;
    expect(customRoomPrice(price, s, false, false)).toBe(price);
    expect(customRoomPrice(price, s, true, false)).toBe(price / 2n);
    expect(customRoomPrice(price, { ...s, holderDiscountPct: 100 }, true, false)).toBe(0n);
    expect(customRoomPrice(price, { ...s, holderPerk: 'free_daily' }, true, true)).toBe(0n);
    expect(customRoomPrice(price, { ...s, holderPerk: 'free_daily' }, true, false)).toBe(price);
    expect(customRoomPrice(price, { ...s, holderPerk: 'none' }, true, true)).toBe(price);
  });
  it('defaults: 0.05 HYPE, a 50 % holder discount, 6 live rooms, 2 per wallet', () => {
    expect(CUSTOM_SETTINGS_DEFAULT).toMatchObject({ priceHype: '0.05', holderPerk: 'discount', holderDiscountPct: 50, maxLive: 6, maxPerWallet: 2, treasury: null });
  });
});

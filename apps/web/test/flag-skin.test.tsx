import { COUNTRY_CODES, EntityKind, PlayerFlag, encodeSnapshot } from '@elymum/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/game/state';
import { DRAWN_FLAGS, flagArt } from '../src/render/flags';
import { FLAG_SKIN_BUCKETS, FlagSkinCache, flagMainColour, flagSkinBucket, flagSkinKind, paintFlagSkin } from '../src/render/flagskin';
import { LookCache } from '../src/render/looks';
import { adoptProfileCountry, mergeSettings, useUi, type Settings } from '../src/store';
import { CountryPicker } from '../src/ui/profile/CountryPicker';
import { wornFlag } from '../src/ui/profile/picture';

const initial = useUi.getState();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

/** A 2D context that counts what it was asked to draw (jsdom has no canvas). */
function countingContext() {
  const calls: Record<string, number> = {};
  const hit = (k: string) => () => void (calls[k] = (calls[k] ?? 0) + 1);
  const ctx = {
    fillStyle: '' as unknown,
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    fillRect: hit('fillRect'),
    arc: hit('arc'),
    beginPath: hit('beginPath'),
    moveTo: hit('moveTo'),
    lineTo: hit('lineTo'),
    closePath: hit('closePath'),
    fill: hit('fill'),
    stroke: hit('stroke'),
    clip: hit('clip'),
    save: hit('save'),
    restore: hit('restore'),
    translate: hit('translate'),
    scale: hit('scale'),
    createRadialGradient: () => ({ addColorStop: hit('stop') }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function withCanvas<T>(fn: (calls: Record<string, number>) => T): T {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const orig = proto.getContext;
  const { ctx, calls } = countingContext();
  proto.getContext = () => ctx;
  try {
    return fn(calls);
  } finally {
    proto.getContext = orig;
  }
}

describe('the flag table for flag skins', () => {
  it('draws the most populous and most crypto-active countries', () => {
    expect(DRAWN_FLAGS.length).toBeGreaterThanOrEqual(150);
    const big = ['TR', 'US', 'GB', 'BR', 'DE', 'FR', 'JP', 'KR', 'IN', 'RU', 'ES', 'IT', 'NG', 'AR', 'CA', 'CN', 'ID', 'PK', 'BD', 'MX', 'ET', 'PH', 'EG', 'VN', 'CD', 'IR', 'TH', 'TZ', 'ZA', 'KE', 'MM', 'CO', 'UG', 'SD', 'DZ', 'IQ', 'UA', 'PL', 'MA', 'UZ', 'SA', 'PE', 'AO', 'MY', 'MZ', 'GH', 'YE', 'NE', 'VE', 'AU', 'SG', 'AE', 'HK', 'TW', 'NL', 'CH'];
    for (const c of big) expect(flagArt(c), c).not.toBeNull();
    // territories that fly their country's flag borrow its art
    expect(flagArt('RE')).toBe(flagArt('FR'));
  });

  it('every allowlisted country gets a flag, its colours, or (a few) the normal coin', () => {
    const plain = COUNTRY_CODES.filter((c) => flagSkinKind(c) === null);
    expect(plain.length).toBeLessThan(12);
    expect(flagSkinKind('TR')).toBe('flag');
    expect(flagSkinKind('KY')).toBe('colours');
    expect(flagSkinKind(null)).toBeNull();
    expect(flagSkinKind('XX')).toBeNull();
  });

  it('finds the colour that covers most of the coin', () => {
    expect(flagMainColour('TR')).toBe('#E30A17');
    expect(flagMainColour('JP')).toBe('#FFFFFF');
    expect(flagMainColour('CA')).toBe('#FFFFFF');
    expect(flagMainColour('BR')).toBe('#009C3B');
    expect(flagMainColour('KY')).toBe('#012169');
    expect(flagMainColour('XX')).toBeNull();
  });
});

describe('the flag skin cache', () => {
  it('paints a flag, its colours, or nothing', () => {
    const { ctx, calls } = countingContext();
    expect(paintFlagSkin(ctx, 'TR', 64)).toBe(true);
    // clipped to the circle, then the light, shade, groove and highlight over it
    expect(calls.clip).toBe(1);
    expect(calls.stop).toBe(3);
    expect(paintFlagSkin(ctx, 'KY', 64)).toBe(true);
    expect(paintFlagSkin(ctx, 'TV', 64)).toBe(false);
  });

  it('caches one disc per country and size bucket, and nothing for a plain country', () => {
    withCanvas(() => {
      const cache = new FlagSkinCache();
      const a = cache.fill('TR', 60);
      expect(a).not.toBeNull();
      expect(a!.width).toBe(64);
      expect(cache.fill('TR', 50)).toBe(a);
      expect(cache.fill('TR', 70)).not.toBe(a);
      expect(cache.fill('TV', 60)).toBeNull();
      expect(cache.size).toBe(64 * 64 * 4 + 96 * 96 * 4);
      // huge coins use the largest bucket
      expect(flagSkinBucket(5000)).toBe(FLAG_SKIN_BUCKETS.length - 1);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  it('paints the player look in the flag main colour, once per look', () => {
    const cache = new FlagSkinCache();
    const base = new LookCache().lookFor(2);
    const tr = cache.look(base, 'TR');
    expect(tr.body).toBe('#E30A17');
    expect(tr.eyes).toBe(base.eyes);
    expect(cache.look(base, 'TR')).toBe(tr);
  });
});

describe('the flag skin setting', () => {
  it('is off by default and kept only as true', () => {
    expect(initial.settings.flagSkin).toBe(false);
    const defaults = { ...initial.settings } as Settings;
    expect(mergeSettings(defaults, { flagSkin: true }).flagSkin).toBe(true);
    expect(mergeSettings(defaults, { flagSkin: 'yes' as unknown as boolean }).flagSkin).toBe(false);
    expect(wornFlag({ flagSkin: true, country: 'TR' })).toBe('TR');
    expect(wornFlag({ flagSkin: true, country: '' })).toBeNull();
    expect(wornFlag({ flagSkin: false, country: 'TR' })).toBeNull();
  });

  it('a profile that saved it on turns it on here', () => {
    act(() => useUi.setState({ settings: { ...useUi.getState().settings, flagSkin: false } }));
    adoptProfileCountry({ flagSkin: false });
    expect(useUi.getState().settings.flagSkin).toBe(false);
    adoptProfileCountry({ flagSkin: true });
    expect(useUi.getState().settings.flagSkin).toBe(true);
  });

  it('the switch next to the country picker turns it on, and waits for a country', () => {
    act(() => useUi.setState({ settings: { ...useUi.getState().settings, country: '', countryAuto: false, flagSkin: false } }));
    {
      render(<CountryPicker />);
      const sw = screen.getByRole('switch', { name: 'Wear the flag on my coin' });
      expect(sw).toHaveProperty('disabled', true);
      expect(screen.getByText('Pick a country first')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('You play for'), { target: { value: 'TR' } });
      expect(sw).toHaveProperty('disabled', false);
      expect(sw.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(sw);
      expect(useUi.getState().settings).toMatchObject({ country: 'TR', flagSkin: true });
      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText('Your coin is painted with your flag, face and all')).toBeTruthy();
    }
  });
});

describe('the client world', () => {
  it('keeps the flag skin bit a snapshot carries (every split cell shares the player record)', () => {
    const world = new ClientWorld();
    world.applyBinary(
      encodeSnapshot({
        tick: 1,
        view: { x: 0, y: 0, h: 1000 },
        players: [{ id: 3, skin: 1, flags: PlayerFlag.Bot, isBot: true, name: 'bot', country: 'TR', flagSkin: true }],
        upserts: [
          { id: 9, kind: EntityKind.Cell, x: 1, y: 2, r: 30, playerId: 3, flags: 0 },
          { id: 10, kind: EntityKind.Cell, x: 80, y: 2, r: 30, playerId: 3, flags: 0 },
        ],
        removals: [],
      }),
      0,
    );
    const p = world.players.get(3)!;
    expect(p.flags & PlayerFlag.FlagSkin).toBe(PlayerFlag.FlagSkin);
    expect(p.country).toBe('TR');
    // the decoded path (tests, held-back snapshots) takes `flagSkin` as the bit
    const w2 = new ClientWorld();
    w2.apply({ tick: 1, view: { x: 0, y: 0, h: 1000 }, players: [{ id: 4, skin: 0, flags: 0, name: 'x', country: 'JP', flagSkin: true }], upserts: [], removals: [] }, 0);
    expect(w2.players.get(4)!.flags & PlayerFlag.FlagSkin).toBe(PlayerFlag.FlagSkin);
  });
});

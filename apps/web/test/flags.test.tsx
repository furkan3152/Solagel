import { EntityKind, PlayerFlag, encodeSnapshot, isCountryCode } from '@elymum/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/game/state';
import { DRAWN_FLAGS, FLAG_H, FLAG_W, FlagCache, flagArt, paintFlag } from '../src/render/flags';
import { adoptProfileCountry, mergeSettings, useUi, type Settings } from '../src/store';
import { CountryField, Flag, countryName } from '../src/ui/Flag';

const initial = useUi.getState();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

/** A 2D context that counts what it was asked to draw. */
function countingContext() {
  const calls: Record<string, number> = {};
  const hit = (k: string) => () => void (calls[k] = (calls[k] ?? 0) + 1);
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect: hit('fillRect'),
    arc: hit('arc'),
    beginPath: hit('beginPath'),
    moveTo: hit('moveTo'),
    lineTo: hit('lineTo'),
    closePath: hit('closePath'),
    fill: hit('fill'),
    stroke: hit('stroke'),
    roundRect: hit('roundRect'),
    clip: hit('clip'),
    save: hit('save'),
    restore: hit('restore'),
    translate: hit('translate'),
    scale: hit('scale'),
    fillText: hit('fillText'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('the flag table', () => {
  it('covers the common countries with allowlisted codes and well-formed shapes', () => {
    expect(DRAWN_FLAGS.length).toBeGreaterThanOrEqual(60);
    for (const c of ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'BR', 'MX', 'JP', 'KR', 'CN', 'IN', 'TR', 'RU', 'UA', 'PL', 'NL', 'SE']) expect(flagArt(c)).not.toBeNull();
    const arity: Record<string, number> = { r: 6, c: 5, s: 5, a: 7, l: 7 };
    for (const code of DRAWN_FLAGS) {
      expect(isCountryCode(code), code).toBe(true);
      const art = flagArt(code)!;
      expect(art.length, code).toBeGreaterThan(0);
      for (const op of art) {
        const kind = op[0] as string;
        expect(['h', 'v', 'r', 'c', 's', 'a', 'p', 'l', 'o'], `${code} ${kind}`).toContain(kind);
        if (kind in arity) expect(op.length, `${code} ${kind}`).toBe(arity[kind]);
        if (kind === 'h' || kind === 'v') expect(op.length).toBeGreaterThan(2);
        if (kind === 'p') expect((op.length - 2) % 2).toBe(0);
        if (kind === 'o') expect((op.length - 3) % 2).toBe(0);
        for (const v of op.slice(1)) {
          if (typeof v === 'string') expect(v, code).toMatch(/^#[0-9A-Fa-f]{6}$/);
          else expect(Number.isFinite(v), code).toBe(true);
        }
      }
    }
    // codes without art get a badge
    expect(flagArt('TV')).toBeNull();
  });

  it('paints every shape to canvas', () => {
    const { ctx, calls } = countingContext();
    for (const code of DRAWN_FLAGS) paintFlag(ctx, flagArt(code)!);
    expect(calls.fillRect).toBeGreaterThan(100);
    expect(calls.fill).toBeGreaterThan(50);
    expect(calls.stroke).toBeGreaterThan(5);
    expect(FLAG_W / FLAG_H).toBe(1.5);
  });

  it('caches one bitmap per code and pixel height', () => {
    // jsdom has no canvas: a counting context stands in
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const orig = proto.getContext;
    const { ctx, calls } = countingContext();
    proto.getContext = () => ctx;
    try {
      cacheChecks();
    } finally {
      proto.getContext = orig;
    }
    // drawn once per bitmap: the flag (or badge) and its ink edge
    expect(calls.stroke).toBeGreaterThanOrEqual(4);
    expect(calls.fillText).toBe(1);
  });

  function cacheChecks() {
    const cache = new FlagCache();
    const a = cache.get('DE', 12.2);
    expect(cache.get('DE', 11.8)).toBe(a);
    expect(a.h).toBe(12);
    expect(a.w).toBe(18);
    expect(cache.get('DE', 20)).not.toBe(a);
    // tiny sizes stay legible: at least 6 px
    expect(cache.get('FR', 2).h).toBe(6);
    // a code without art still draws (the code badge)
    expect(cache.get('TV', 14).w).toBe(21);
    expect(cache.size).toBe(4);
    cache.clear();
    expect(cache.size).toBe(0);
  }
});

describe('<Flag>', () => {
  it('draws a known flag as an SVG sticker named for the country, a badge for the rest, nothing for junk', () => {
    const { container, rerender } = render(<Flag code="DE" size={16} />);
    const de = screen.getByRole('img', { name: countryName('DE') });
    expect(de.querySelector('svg')).not.toBeNull();
    expect(de.getAttribute('style')).toContain('--flag-h: 16px');
    rerender(<Flag code="TV" />);
    expect(container.querySelector('.kb-flag.is-code')?.textContent).toBe('TV');
    rerender(<Flag code="XX" />);
    expect(container.querySelector('.kb-flag')).toBeNull();
    rerender(<Flag code={null} />);
    expect(container.querySelector('.kb-flag')).toBeNull();
    // decorative where the row says the country in words
    rerender(<Flag code="BR" label={false} />);
    expect(container.querySelector('.kb-flag')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the picker lists every country and "none", and reports the pick', () => {
    let picked = 'unset';
    render(<CountryField label="You play for" value="FR" noneLabel="No flag" onChange={(c) => (picked = c)} />);
    const select = screen.getByLabelText('You play for') as HTMLSelectElement;
    expect(select.value).toBe('FR');
    expect(select.options.length).toBe(250);
    expect(select.options[0].textContent).toBe('No flag');
    fireEvent.change(select, { target: { value: 'JP' } });
    expect(picked).toBe('JP');
    fireEvent.change(select, { target: { value: '' } });
    expect(picked).toBe('');
  });
});

describe('the country setting', () => {
  const defaults = { ...initial.settings, country: 'GB', countryAuto: true } as Settings;

  it('settings saved before countries existed take the guess; a saved pick stays; junk is cleared', () => {
    expect(mergeSettings(defaults, { name: 'x' })).toMatchObject({ name: 'x', country: 'GB', countryAuto: true });
    expect(mergeSettings(defaults, { country: 'BR', countryAuto: false })).toMatchObject({ country: 'BR', countryAuto: false });
    expect(mergeSettings(defaults, { country: '', countryAuto: false })).toMatchObject({ country: '', countryAuto: false });
    expect(mergeSettings(defaults, { country: 'XX', countryAuto: false })).toMatchObject({ country: '', countryAuto: false });
  });

  it("a signed-in profile's saved country replaces the guess, never a pick", () => {
    act(() => useUi.setState({ settings: { ...useUi.getState().settings, country: 'GB', countryAuto: true } }));
    adoptProfileCountry({ country: undefined });
    expect(useUi.getState().settings).toMatchObject({ country: 'GB', countryAuto: true });
    adoptProfileCountry({ country: 'JP' });
    expect(useUi.getState().settings).toMatchObject({ country: 'JP', countryAuto: false });
    adoptProfileCountry({ country: 'DE' });
    expect(useUi.getState().settings.country).toBe('JP');
    act(() => useUi.setState({ settings: { ...useUi.getState().settings, country: 'GB', countryAuto: true } }));
    adoptProfileCountry({ country: null });
    expect(useUi.getState().settings).toMatchObject({ country: '', countryAuto: false });
  });
});

describe('the client world', () => {
  it('keeps the country a snapshot carries, and drops it when it goes', () => {
    const world = new ClientWorld();
    const snap = (country?: string) =>
      encodeSnapshot({
        tick: 1,
        view: { x: 0, y: 0, h: 1000 },
        players: [{ id: 3, skin: 1, flags: PlayerFlag.Bot, isBot: true, name: 'bot', ...(country ? { country } : {}) }],
        upserts: [{ id: 9, kind: EntityKind.Cell, x: 1, y: 2, r: 30, playerId: 3, flags: 0 }],
        removals: [],
      });
    world.applyBinary(snap('CA'), 0);
    expect(world.players.get(3)?.country).toBe('CA');
    world.applyBinary(snap(), 10);
    expect(world.players.get(3)?.country).toBeUndefined();
  });
});

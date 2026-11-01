import { describe, expect, it } from 'vitest';
import {
  BOOST_KEYS,
  BOOST_KINDS,
  BOOST_RULES,
  CellFlag,
  EntityKind,
  PROTOCOL_VERSION,
  RULES,
  SHOP_DEFAULTS,
  decodeSnapshot,
  encodeSnapshot,
  isBoostKind,
  packPriceRaw,
  shockRange,
  type ClientMessage,
  type ServerMessage,
} from '../src';

describe('boosts: wire', () => {
  it('the shockwave flag round-trips in a snapshot together with the other cell flags', () => {
    const flags = CellFlag.Shock | CellFlag.Magnet | CellFlag.Pump | CellFlag.Shield;
    const snap = decodeSnapshot(
      encodeSnapshot({
        tick: 1,
        view: { x: 0, y: 0, h: 1000 },
        players: [{ id: 7, skin: 1, flags: 0, name: 'a' }],
        upserts: [{ id: 3, kind: EntityKind.Cell, x: 10, y: 10, r: 40, playerId: 7, flags }],
        removals: [],
      }),
    );
    expect(snap.upserts[0].flags).toBe(flags);
    expect(snap.upserts[0].flags! & CellFlag.Shock).toBe(32);
  });

  it('the flag is a new bit that fits the u8 and clashes with none', () => {
    const bits = Object.values(CellFlag);
    expect(new Set(bits).size).toBe(bits.length);
    expect(Math.max(...bits)).toBeLessThan(256);
  });

  it('the messages are additive (protocol v7 unchanged)', () => {
    expect(PROTOCOL_VERSION).toBe(7);
    const c: ClientMessage = { t: 'boost', kind: 'shock' };
    const s: ServerMessage[] = [
      { t: 'boost', kind: 'magnet', ok: true, ms: 8000 },
      { t: 'boost', kind: 'speed', ok: false, reason: 'round_limit' },
      {
        t: 'boosts',
        state: { usable: true, signedIn: true, charges: { magnet: 1, shock: 0, speed: 2 }, cooldownMs: { magnet: 0, shock: 0, speed: 0 }, arena: { left: 2, max: 2 } },
      },
    ];
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(s).toHaveLength(3);
  });
});

describe('boosts: rules', () => {
  it('kinds, keys and validation', () => {
    expect(BOOST_KINDS).toEqual(['magnet', 'shock', 'speed']);
    expect(isBoostKind('shock')).toBe(true);
    expect(isBoostKind('laser')).toBe(false);
    // no clash with Space split, E tip, WASD, Q spectate, Enter chat, 1-8 emotes
    const taken = ['Space', 'KeyE', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'Enter', ...Array.from({ length: 8 }, (_, i) => `Digit${i + 1}`)];
    for (const k of Object.values(BOOST_KEYS)) expect(taken).not.toContain(k);
    expect(new Set(Object.values(BOOST_KEYS)).size).toBe(3);
  });

  it('tuning stays modest: short effects, long cooldowns, a magnet no stronger than the map one', () => {
    expect(BOOST_RULES.magnet.durationMs).toBeLessThanOrEqual(RULES.magnetMs);
    expect(BOOST_RULES.speed.durationMs).toBeLessThan(RULES.pumpMs);
    for (const k of BOOST_KINDS) expect(BOOST_RULES[k].cooldownMs).toBeGreaterThanOrEqual(10_000);
    expect(BOOST_RULES.shock.massRatio).toBeLessThan(RULES.eatRatio);
    expect(shockRange(50)).toBeCloseTo(50 * BOOST_RULES.shock.rangeFactor + BOOST_RULES.shock.rangeBase);
  });

  it('pack prices in base units, with the holder discount rounded down', () => {
    expect(packPriceRaw('300', 18, 0)).toBe(300n * 10n ** 18n);
    expect(packPriceRaw('300', 18, 30)).toBe(210n * 10n ** 18n);
    expect(packPriceRaw('0.000001', 6, 30)).toBe(0n);
    expect(packPriceRaw('12.5', 6, 0)).toBe(12_500_000n);
    expect(() => packPriceRaw('abc', 18, 0)).toThrow();
    expect(SHOP_DEFAULTS).toMatchObject({ sink: 'burn', packSize: 3, holderDiscountPct: 30, arenaUsesPerRound: 2, holderExtraArenaUses: 1 });
  });
});

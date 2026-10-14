import { describe, expect, it } from 'vitest';
import {
  ClientOp,
  EntityKind,
  PlayerFlag,
  PowerUpType,
  decodeClientInput,
  decodeSnapshot,
  encodeEject,
  encodeSnapshot,
  encodeSplit,
  encodeTarget,
  type EntityRecord,
  type PlayerInfo,
  type SnapshotData,
} from '../src';

const sample: SnapshotData = {
  tick: 123456,
  view: { x: 1500.5, y: 2200.25, h: 1150 },
  players: [
    { id: 1, skin: 0, flags: 0, pass: 0, name: 'gm_gummy' },
    { id: 65000, skin: 23, flags: 3, pass: 3333, name: 'Çağrı🚀' },
  ],
  upserts: [
    { id: 1, kind: EntityKind.Cell, x: 10.5, y: 20.25, r: 44.72, playerId: 65000, flags: 5 },
    { id: 2, kind: EntityKind.Food, x: 100, y: 200, r: 10, variant: 7 },
    { id: 3, kind: EntityKind.Eject, x: 300.5, y: 400.5, r: 37.4, variant: 12 },
    { id: 4, kind: EntityKind.Virus, x: 500, y: 600, r: 100 },
    { id: 4294967295, kind: EntityKind.PowerUp, x: 700, y: 800, r: 40, variant: PowerUpType.Shield },
    { id: 5, kind: EntityKind.Loot, x: 900.5, y: 1000.25, r: 14, variant: 2 },
  ],
  removals: [
    { id: 9, eaterId: 1 },
    { id: 10, eaterId: 0 },
    { id: 11, eaterId: 4294967295 },
  ],
};

describe('snapshot codec', () => {
  it('round-trips every entity kind, unicode names and removals', () => {
    const decoded = decodeSnapshot(encodeSnapshot(sample));
    expect(decoded.tick).toBe(sample.tick);
    expect(decoded.view.x).toBeCloseTo(sample.view.x, 3);
    expect(decoded.view.y).toBeCloseTo(sample.view.y, 3);
    expect(decoded.view.h).toBeCloseTo(sample.view.h, 3);
    expect(decoded.players).toEqual(sample.players);
    expect(decoded.removals).toEqual(sample.removals);
    expect(decoded.upserts).toHaveLength(sample.upserts.length);
    decoded.upserts.forEach((e, i) => {
      const s = sample.upserts[i];
      expect(e.id).toBe(s.id);
      expect(e.kind).toBe(s.kind);
      expect(e.x).toBeCloseTo(s.x, 3);
      expect(e.y).toBeCloseTo(s.y, 3);
      expect(e.r).toBeCloseTo(s.r, 3);
      expect(e.playerId).toBe(s.playerId);
      expect(e.flags).toBe(s.flags);
      expect(e.variant).toBe(s.variant);
    });
  });

  it('handles empty snapshots', () => {
    const empty: SnapshotData = { tick: 0, view: { x: 0, y: 0, h: 0 }, players: [], upserts: [], removals: [] };
    expect(decodeSnapshot(encodeSnapshot(empty))).toEqual(empty);
  });

  it('grows the buffer for large snapshots', () => {
    const big: SnapshotData = {
      tick: 1,
      view: { x: 0, y: 0, h: 1 },
      players: [],
      upserts: Array.from({ length: 5000 }, (_, i) => ({ id: i, kind: EntityKind.Food, x: i, y: i, r: 10, variant: i % 8 })),
      removals: [],
    };
    const decoded = decodeSnapshot(encodeSnapshot(big));
    expect(decoded.upserts).toHaveLength(5000);
    expect(decoded.upserts[4999].x).toBe(4999);
  });

  it('truncates very long names on a UTF-8 boundary', () => {
    const name = '🚀'.repeat(100); // 400 bytes
    const decoded = decodeSnapshot(
      encodeSnapshot({ tick: 1, view: { x: 0, y: 0, h: 1 }, players: [{ id: 1, skin: 0, flags: 0, pass: 0, name }], upserts: [], removals: [] }),
    );
    expect(decoded.players[0].name).toBe('🚀'.repeat(63));
  });

  it('roundtrips players with pass numbers', () => {
    const players: PlayerInfo[] = [
      { id: 1, skin: 0, flags: 0, pass: 0, name: 'no pass' },
      { id: 2, skin: 3, flags: PlayerFlag.Verified | PlayerFlag.Pass, pass: 3333, name: 'Pass #3333' },
      { id: 3, skin: 7, flags: PlayerFlag.Staker | PlayerFlag.Pass, pass: 1, name: '' },
      { id: 65535, skin: 255, flags: 255, pass: 65535, name: 'Çağrı🚀' },
    ];
    const decoded = decodeSnapshot(encodeSnapshot({ tick: 9, view: { x: 1, y: 2, h: 3 }, players, upserts: [], removals: [] }));
    expect(decoded.players).toEqual(players);
    expect(decoded.players.map((p) => (p.flags & PlayerFlag.Pass) !== 0)).toEqual([false, true, true, true]);
  });

  it('roundtrips loot entities with variant', () => {
    const upserts: EntityRecord[] = [0, 1, 2, 3].map((variant) => ({
      id: 100 + variant,
      kind: EntityKind.Loot,
      x: 1000.5 + variant,
      y: 2000.25 - variant,
      r: 14,
      variant,
    }));
    // neighbours of other kinds prove the loot record consumes exactly one variant byte
    const mixed: EntityRecord[] = [{ id: 1, kind: EntityKind.Food, x: 1, y: 2, r: 10, variant: 5 }, ...upserts, { id: 2, kind: EntityKind.Virus, x: 3, y: 4, r: 100 }];
    const decoded = decodeSnapshot(
      encodeSnapshot({ tick: 1, view: { x: 0, y: 0, h: 1 }, players: [], upserts: mixed, removals: [{ id: 100, eaterId: 7 }] }),
    );
    expect(decoded.upserts).toHaveLength(mixed.length);
    decoded.upserts.forEach((e, i) => {
      const s = mixed[i];
      expect(e.kind).toBe(s.kind);
      expect(e.id).toBe(s.id);
      expect(e.x).toBeCloseTo(s.x, 3);
      expect(e.y).toBeCloseTo(s.y, 3);
      expect(e.r).toBeCloseTo(s.r, 3);
      expect(e.variant).toBe(s.variant);
    });
    const loot = decoded.upserts.filter((e) => e.kind === EntityKind.Loot);
    expect(loot.map((e) => e.variant)).toEqual([0, 1, 2, 3]);
    expect(loot.every((e) => e.playerId === undefined && e.flags === undefined)).toBe(true);
    expect(decoded.removals).toEqual([{ id: 100, eaterId: 7 }]);
  });

  it('writes the documented byte layout (pass sits between flags and name; loot carries a variant byte)', () => {
    const bytes = new Uint8Array(
      encodeSnapshot({
        tick: 1,
        view: { x: 0, y: 0, h: 0 },
        players: [{ id: 0x0102, skin: 5, flags: PlayerFlag.Pass, pass: 0x0d05, name: 'ab' }],
        upserts: [{ id: 7, kind: EntityKind.Loot, x: 0, y: 0, r: 0, variant: 3 }],
        removals: [],
      }),
    );
    // op u8 | tick u32 | view 3×f32 → 17 bytes, then nPlayers u8
    expect(Array.from(bytes.subarray(0, 5))).toEqual([1, 1, 0, 0, 0]);
    expect(bytes[17]).toBe(1);
    // player record: u16 id (LE) | u8 skin | u8 flags | u16 pass (LE) | str8 name
    expect(Array.from(bytes.subarray(18, 18 + 2 + 1 + 1 + 2 + 1 + 2))).toEqual([0x02, 0x01, 5, PlayerFlag.Pass, 0x05, 0x0d, 2, 0x61, 0x62]);
    // nUpserts u16 | u32 id | u8 kind | 3×f32 | u8 variant
    const up = 18 + 9;
    expect(Array.from(bytes.subarray(up, up + 2))).toEqual([1, 0]);
    expect(Array.from(bytes.subarray(up + 2, up + 7))).toEqual([7, 0, 0, 0, EntityKind.Loot]);
    expect(bytes[up + 7 + 12]).toBe(3);
    // nRemovals u16 closes the snapshot
    expect(Array.from(bytes.subarray(up + 7 + 12 + 1))).toEqual([0, 0]);
  });

  it('rejects unknown entity kinds', () => {
    const bytes = new Uint8Array(
      encodeSnapshot({ tick: 1, view: { x: 0, y: 0, h: 0 }, players: [], upserts: [{ id: 1, kind: EntityKind.Virus, x: 0, y: 0, r: 0 }], removals: [] }),
    );
    // players=0 → nUpserts at 18, then u32 id (20..23), then the kind byte
    bytes[24] = 99;
    expect(() => decodeSnapshot(bytes)).toThrow(/unknown entity kind 99/);
  });
});

describe('client input codec', () => {
  it('round-trips target / split / eject', () => {
    expect(decodeClientInput(encodeTarget(12.5, -3.25))).toEqual({ op: ClientOp.Target, x: 12.5, y: -3.25 });
    expect(decodeClientInput(encodeSplit())).toEqual({ op: ClientOp.Split });
    expect(decodeClientInput(encodeEject())).toEqual({ op: ClientOp.Eject });
  });

  it('rejects malformed input', () => {
    expect(decodeClientInput(new ArrayBuffer(0))).toBeNull();
    expect(decodeClientInput(new Uint8Array([ClientOp.Target, 1, 2]))).toBeNull();
    expect(decodeClientInput(new Uint8Array([99]))).toBeNull();
    expect(decodeClientInput(encodeTarget(Number.NaN, 1))).toBeNull();
    expect(decodeClientInput(encodeTarget(Number.POSITIVE_INFINITY, 1))).toBeNull();
  });
});

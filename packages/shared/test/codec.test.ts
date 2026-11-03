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
    { id: 1, skin: 0, flags: 0, name: 'gm_gummy' },
    { id: 65000, skin: 23, flags: 3, name: 'Renée🚀' },
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
    expect(decoded.players).toEqual(sample.players.map((p) => ({ ...p, isBot: (p.flags & PlayerFlag.Bot) !== 0 })));
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

  it('carries the bot flag: decoded players always say isBot, and isBot sets the flag bit', () => {
    const snap: SnapshotData = {
      tick: 1,
      view: { x: 0, y: 0, h: 1 },
      players: [
        { id: 1, skin: 2, flags: PlayerFlag.Bot, name: 'marco88' },
        { id: 2, skin: 3, flags: PlayerFlag.Verified, name: 'human' },
        { id: 3, skin: 4, flags: 0, name: 'jake_r', isBot: true },
      ],
      upserts: [],
      removals: [],
    };
    const players = decodeSnapshot(encodeSnapshot(snap)).players;
    expect(players.map((p) => p.isBot)).toEqual([true, false, true]);
    expect(players[2].flags & PlayerFlag.Bot).toBe(PlayerFlag.Bot);
    expect(players[1].flags).toBe(PlayerFlag.Verified);
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
      encodeSnapshot({ tick: 1, view: { x: 0, y: 0, h: 1 }, players: [{ id: 1, skin: 0, flags: 0, name }], upserts: [], removals: [] }),
    );
    expect(decoded.players[0].name).toBe('🚀'.repeat(63));
  });

  it('roundtrips players with their flags', () => {
    const players: PlayerInfo[] = [
      { id: 1, skin: 0, flags: 0, name: 'guest' },
      { id: 2, skin: 3, flags: PlayerFlag.Verified, name: 'verified' },
      { id: 3, skin: 7, flags: PlayerFlag.Staker | PlayerFlag.Verified, name: '' },
      { id: 65535, skin: 255, flags: 255, name: 'Renée🚀' },
    ];
    const decoded = decodeSnapshot(encodeSnapshot({ tick: 9, view: { x: 1, y: 2, h: 3 }, players, upserts: [], removals: [] }));
    // the Avatar and Country bits travel only with an avatar id / a country (a bare bit is dropped)
    expect(decoded.players).toEqual(
      players.map((p) => ({ ...p, flags: p.flags & ~PlayerFlag.Avatar & ~PlayerFlag.Country, isBot: (p.flags & PlayerFlag.Bot) !== 0, ...((p.flags & PlayerFlag.Holder) !== 0 ? { holder: true } : {}) })),
    );
    expect(decoded.players.map((p) => (p.flags & PlayerFlag.Staker) !== 0)).toEqual([false, false, true, true]);
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

  it('writes the documented byte layout (name follows flags; loot carries a variant byte)', () => {
    const bytes = new Uint8Array(
      encodeSnapshot({
        tick: 1,
        view: { x: 0, y: 0, h: 0 },
        players: [{ id: 0x0102, skin: 5, flags: PlayerFlag.Staker, name: 'ab' }],
        upserts: [{ id: 7, kind: EntityKind.Loot, x: 0, y: 0, r: 0, variant: 3 }],
        removals: [],
      }),
    );
    // op u8 | tick u32 | view 3×f32 → 17 bytes, then the extras u8 (v8; 0: no bounds), then nPlayers u8
    expect(Array.from(bytes.subarray(0, 5))).toEqual([1, 1, 0, 0, 0]);
    expect(bytes[17]).toBe(0);
    expect(bytes[18]).toBe(1);
    // player record: u16 id (LE) | u8 skin | u8 flags | str8 name
    expect(Array.from(bytes.subarray(19, 19 + 2 + 1 + 1 + 1 + 2))).toEqual([0x02, 0x01, 5, PlayerFlag.Staker, 2, 0x61, 0x62]);
    // nUpserts u16 | u32 id | u8 kind | 3×f32 | u8 variant
    const up = 19 + 7;
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
    // extras at 17, players=0 at 18 → nUpserts at 19, then u32 id (21..24), then the kind byte
    bytes[25] = 99;
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

describe('readSnapshot (streaming)', () => {
  it('hands the sink exactly what decodeSnapshot returns', async () => {
    const { readSnapshot, decodeUtf8, HAS_PLAYER, HAS_VARIANT, encodeSnapshot, decodeSnapshot, EntityKind } = await import('../src/index');
    const snap = {
      tick: 77,
      view: { x: 1200.5, y: 980.25, h: 1600 },
      players: [
        { id: 3, skin: 4, flags: 1, name: 'mochi_moon' },
        { id: 9, skin: 0, flags: 0, name: 'Däphne ☀' },
      ],
      upserts: [
        { id: 1, kind: EntityKind.Cell, x: 10.5, y: 20.25, r: 40, playerId: 3, flags: 2 },
        { id: 2, kind: EntityKind.Food, x: 1, y: 2, r: 10, variant: 7 },
        { id: 3, kind: EntityKind.Virus, x: 5, y: 6, r: 100 },
        { id: 4, kind: EntityKind.Loot, x: 7, y: 8, r: 16, variant: 3 },
      ],
      removals: [{ id: 11, eaterId: 1 }],
    };
    const buf = encodeSnapshot(snap);
    const ref = decodeSnapshot(buf);
    const got = { tick: 0, view: { x: 0, y: 0, h: 0 }, players: [] as { id: number; skin: number; flags: number; name: string }[], upserts: [] as Record<string, number>[], removals: [] as { id: number; eaterId: number }[] };
    readSnapshot(buf, {
      snapshotBegin: (tick, x, y, h) => Object.assign(got, { tick, view: { x, y, h } }),
      snapshotPlayer: (id, skin, flags, bytes, at, len, avatarAt) => {
        expect(avatarAt).toBe(-1);
        got.players.push({ id, skin, flags, name: decodeUtf8(bytes, at, len) });
      },
      snapshotUpsert: (id, kind, x, y, r, has, playerId, flags, variant) =>
        got.upserts.push({ id, kind, x, y, r, ...(has & HAS_PLAYER ? { playerId, flags } : {}), ...(has & HAS_VARIANT ? { variant } : {}) }),
      snapshotRemoval: (id, eaterId) => got.removals.push({ id, eaterId }),
    });
    expect(got.tick).toBe(ref.tick);
    expect(got.view).toEqual(ref.view);
    expect(got.players).toEqual(ref.players.map(({ id, skin, flags, name }) => ({ id, skin, flags, name })));
    expect(got.upserts).toEqual(ref.upserts);
    expect(got.removals).toEqual(ref.removals);
  });

  it('rejects what decodeSnapshot rejects', async () => {
    const { readSnapshot } = await import('../src/index');
    const noop = { snapshotBegin() {}, snapshotPlayer() {}, snapshotUpsert() {}, snapshotRemoval() {} };
    expect(() => readSnapshot(new Uint8Array([9, 0, 0, 0, 0]).buffer, noop)).toThrow(/not a snapshot/);
  });
});

describe('avatar ids in player records (v7)', () => {
  const base = (players: PlayerInfo[]): SnapshotData => ({ tick: 1, view: { x: 0, y: 0, h: 1000 }, players, upserts: [], removals: [] });

  it('round-trips an avatar id after the name and sets the Avatar flag', () => {
    const snap = base([
      { id: 7, skin: 3, flags: PlayerFlag.Verified, name: 'Pic ☀', avatar: '0123456789abcdef' },
      { id: 8, skin: 1, flags: 0, name: 'plain' },
      { id: 9, skin: 2, flags: PlayerFlag.Holder, name: 'laurel', holder: true, avatar: 'ffeeddccbbaa0099' },
    ]);
    const buf = encodeSnapshot(snap);
    const d = decodeSnapshot(buf);
    expect(d.players[0]).toEqual({ id: 7, skin: 3, flags: PlayerFlag.Verified | PlayerFlag.Avatar, name: 'Pic ☀', isBot: false, avatar: '0123456789abcdef' });
    expect(d.players[1]).toEqual({ id: 8, skin: 1, flags: 0, name: 'plain', isBot: false });
    expect(d.players[2]).toEqual({ id: 9, skin: 2, flags: PlayerFlag.Holder | PlayerFlag.Avatar, name: 'laurel', isBot: false, holder: true, avatar: 'ffeeddccbbaa0099' });
    // 8 bytes per avatar, nothing for the player without one
    const without = encodeSnapshot(base(snap.players.map(({ avatar: _a, ...p }) => p)));
    expect(buf.byteLength - without.byteLength).toBe(16);
  });

  it('never sends an avatar for a bot or a malformed id, and drops a stray Avatar bit', () => {
    const d = decodeSnapshot(
      encodeSnapshot(
        base([
          { id: 1, skin: 0, flags: 0, name: 'bot', isBot: true, avatar: '0123456789abcdef' },
          { id: 2, skin: 0, flags: PlayerFlag.Bot, name: 'bot2', avatar: '0123456789abcdef' },
          { id: 3, skin: 0, flags: 0, name: 'bad', avatar: 'NOT-HEX' },
          { id: 4, skin: 0, flags: PlayerFlag.Avatar, name: 'stray' },
        ]),
      ),
    );
    for (const p of d.players) {
      expect(p.avatar).toBeUndefined();
      expect(p.flags & PlayerFlag.Avatar).toBe(0);
    }
    expect(d.players[0].isBot).toBe(true);
    expect(d.players[1].isBot).toBe(true);
  });

  it('streams the avatar offset to the sink and rejects a truncated id', async () => {
    const { readSnapshot, avatarIdFromBytes, avatarIdEquals } = await import('../src/index');
    const buf = encodeSnapshot(base([{ id: 5, skin: 1, flags: 0, name: 'me', avatar: 'a1b2c3d4e5f60718' }]));
    let seen = '';
    readSnapshot(buf, {
      snapshotBegin() {},
      snapshotPlayer: (_id, _skin, flags, bytes, _at, _len, avatarAt) => {
        expect(flags & PlayerFlag.Avatar).toBe(PlayerFlag.Avatar);
        seen = avatarIdFromBytes(bytes, avatarAt);
        expect(avatarIdEquals('a1b2c3d4e5f60718', bytes, avatarAt)).toBe(true);
        expect(avatarIdEquals('a1b2c3d4e5f60719', bytes, avatarAt)).toBe(false);
        expect(avatarIdEquals(undefined, bytes, avatarAt)).toBe(false);
      },
      snapshotUpsert() {},
      snapshotRemoval() {},
    });
    expect(seen).toBe('a1b2c3d4e5f60718');
    // cut inside the avatar id: header (19 since v8's extras byte) + player (5 + 2 name bytes) + 4 of the 8 id bytes
    const cut = buf.slice(0, 19 + 7 + 4);
    const noop = { snapshotBegin() {}, snapshotPlayer() {}, snapshotUpsert() {}, snapshotRemoval() {} };
    expect(() => readSnapshot(cut, noop)).toThrow(RangeError);
    expect(() => decodeSnapshot(cut)).toThrow(RangeError);
  });
});

describe('country codes in player records (v9)', () => {
  const base = (players: PlayerInfo[]): SnapshotData => ({ tick: 1, view: { x: 0, y: 0, h: 1000 }, players, upserts: [], removals: [] });

  it('round-trips a country after the avatar id and sets the Country flag', () => {
    const snap = base([
      { id: 1, skin: 3, flags: 0, name: 'flag', country: 'DE' },
      { id: 2, skin: 1, flags: 0, name: 'both', avatar: '0123456789abcdef', country: 'BR' },
      { id: 3, skin: 2, flags: PlayerFlag.Bot, name: 'bot', isBot: true, country: 'US' },
      { id: 4, skin: 0, flags: 0, name: 'none' },
    ]);
    const d = decodeSnapshot(encodeSnapshot(snap));
    expect(d.players[0]).toEqual({ id: 1, skin: 3, flags: PlayerFlag.Country, name: 'flag', isBot: false, country: 'DE' });
    expect(d.players[1]).toEqual({ id: 2, skin: 1, flags: PlayerFlag.Avatar | PlayerFlag.Country, name: 'both', isBot: false, avatar: '0123456789abcdef', country: 'BR' });
    expect(d.players[2]).toEqual({ id: 3, skin: 2, flags: PlayerFlag.Bot | PlayerFlag.Country, name: 'bot', isBot: true, country: 'US' });
    expect(d.players[3]).toEqual({ id: 4, skin: 0, flags: 0, name: 'none', isBot: false });
    // two bytes per country
    const without = encodeSnapshot(base(snap.players.map(({ country: _c, ...p }) => p)));
    expect(encodeSnapshot(snap).byteLength - without.byteLength).toBe(6);
  });

  it('never writes a code off the allowlist and clears a stray Country flag', () => {
    const d = decodeSnapshot(
      encodeSnapshot(
        base([
          { id: 1, skin: 0, flags: 0, name: 'lower', country: 'de' },
          { id: 2, skin: 0, flags: 0, name: 'made up', country: 'XX' },
          { id: 3, skin: 0, flags: PlayerFlag.Country, name: 'stray' },
          { id: 4, skin: 0, flags: 0, name: 'long', country: 'USA' },
        ]),
      ),
    );
    for (const p of d.players) {
      expect(p.country).toBeUndefined();
      expect(p.flags & PlayerFlag.Country).toBe(0);
    }
  });

  it('streams the packed country to the sink, drops unknown codes on decode and rejects a truncated record', async () => {
    const { readSnapshot, unpackCountry, packCountry } = await import('../src/index');
    const buf = encodeSnapshot(base([{ id: 5, skin: 1, flags: 0, name: 'me', avatar: 'a1b2c3d4e5f60718', country: 'JP' }]));
    let seen = -1;
    readSnapshot(buf, {
      snapshotBegin() {},
      snapshotPlayer: (_id, _skin, flags, _bytes, _at, _len, avatarAt, country) => {
        expect(flags & PlayerFlag.Country).toBe(PlayerFlag.Country);
        expect(avatarAt).toBeGreaterThan(0);
        seen = country;
      },
      snapshotUpsert() {},
      snapshotRemoval() {},
    });
    expect(seen).toBe(packCountry('JP'));
    expect(unpackCountry(seen)).toBe('JP');

    // a hostile server spelling "ZZ": decoded as no country
    const bytes = new Uint8Array(encodeSnapshot(base([{ id: 6, skin: 0, flags: 0, name: 'x', country: 'FR' }])));
    const at = 19 + 5 + 1;
    expect(String.fromCharCode(bytes[at], bytes[at + 1])).toBe('FR');
    bytes[at] = 90;
    bytes[at + 1] = 90;
    expect(decodeSnapshot(bytes.buffer).players[0].country).toBeUndefined();

    // cut inside the country: header (19) + player (5 + 1 name byte) + 1 of the 2 bytes
    const cut = bytes.buffer.slice(0, 19 + 6 + 1);
    const noop = { snapshotBegin() {}, snapshotPlayer() {}, snapshotUpsert() {}, snapshotRemoval() {} };
    expect(() => readSnapshot(cut, noop)).toThrow(RangeError);
    expect(() => decodeSnapshot(cut)).toThrow(RangeError);
  });
});

describe('world bounds in snapshots (v8)', () => {
  const base = (bounds?: SnapshotData['bounds']): SnapshotData => ({ tick: 3, view: { x: 10, y: 20, h: 1000 }, ...(bounds ? { bounds } : {}), players: [], upserts: [], removals: [] });

  it('round-trips the bounds and costs 16 bytes only when sent', () => {
    const b = { x0: 4500, y0: 4500, x1: 7500, y1: 7500.5 };
    const withB = encodeSnapshot(base(b));
    const without = encodeSnapshot(base());
    expect(withB.byteLength - without.byteLength).toBe(16);
    expect(decodeSnapshot(withB).bounds).toEqual(b);
    expect(decodeSnapshot(without).bounds).toBeUndefined();
    expect('bounds' in decodeSnapshot(without)).toBe(false);
  });

  it('streams the bounds to the sink before any record, and refuses unknown extras bits', async () => {
    const { readSnapshot, SNAP_BOUNDS } = await import('../src/index');
    const order: string[] = [];
    const buf = encodeSnapshot({ ...base({ x0: 0, y0: 0, x1: 3000, y1: 3000 }), upserts: [{ id: 1, kind: EntityKind.Virus, x: 5, y: 6, r: 100 }] });
    readSnapshot(buf, {
      snapshotBegin: () => order.push('begin'),
      snapshotBounds: (x0, y0, x1, y1) => order.push(`bounds ${x0},${y0},${x1},${y1}`),
      snapshotPlayer() {},
      snapshotUpsert: () => order.push('upsert'),
      snapshotRemoval() {},
    });
    expect(order).toEqual(['begin', 'bounds 0,0,3000,3000', 'upsert']);
    // a sink without the hook still reads the rest
    const noop = { snapshotBegin() {}, snapshotPlayer() {}, snapshotUpsert() {}, snapshotRemoval() {} };
    expect(() => readSnapshot(buf, noop)).not.toThrow();
    const bad = new Uint8Array(encodeSnapshot(base()));
    bad[17] = SNAP_BOUNDS | 2;
    expect(() => decodeSnapshot(bad.buffer)).toThrow(/extras/);
    expect(() => readSnapshot(bad.buffer, noop)).toThrow(/extras/);
  });
});

import { ClientOp, EntityKind, PlayerFlag, ServerOp, type EntityRecord, type PlayerInfo, type SnapshotData } from './protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Growable little-endian binary writer. */
export class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  offset = 0;

  constructor(initialSize = 8192) {
    this.buf = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  private ensure(extra: number): void {
    if (this.offset + extra <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.offset + extra) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytes.subarray(0, this.offset));
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  /** u8-length-prefixed UTF-8 string, truncated to 255 bytes on a char boundary. */
  str8(s: string): void {
    let encoded = encoder.encode(s);
    if (encoded.length > 255) {
      let end = 255;
      // step back to a UTF-8 boundary
      while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
      encoded = encoded.subarray(0, end);
    }
    this.u8(encoded.length);
    this.ensure(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  /** Patch a u16 written earlier (used for counts known only afterwards). */
  patchU16(at: number, v: number): void {
    this.view.setUint16(at, v, true);
  }

  finish(): ArrayBuffer {
    return this.buf.slice(0, this.offset);
  }

  reset(): void {
    this.offset = 0;
  }
}

export class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  offset = 0;

  constructor(buf: ArrayBuffer | ArrayBufferView) {
    if (buf instanceof ArrayBuffer) {
      this.view = new DataView(buf);
      this.bytes = new Uint8Array(buf);
    } else {
      this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      this.bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  str8(): string {
    const len = this.u8();
    const s = decoder.decode(this.bytes.subarray(this.offset, this.offset + len));
    this.offset += len;
    return s;
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

/**
 * Layout (little endian):
 *   u8 op=1 | u32 tick | f32 viewX | f32 viewY | f32 viewH
 *   u8 nPlayers   { u16 id | u8 skin | u8 flags | str8 name }   (flags: PlayerFlag; Bot ⇒ `isBot`)
 *   u16 nUpserts  { u32 id | u8 kind | f32 x | f32 y | f32 r | kind data }
 *        Cell: u16 playerId | u8 flags ; Food/Eject/PowerUp/Loot: u8 variant ; Virus: –
 *   u16 nRemovals { u32 id | u32 eaterId }
 */
export function writeSnapshot(w: BinaryWriter, s: SnapshotData): void {
  w.u8(ServerOp.Snapshot);
  w.u32(s.tick);
  w.f32(s.view.x);
  w.f32(s.view.y);
  w.f32(s.view.h);

  const nPlayers = Math.min(s.players.length, 255);
  w.u8(nPlayers);
  for (let i = 0; i < nPlayers; i++) {
    const p = s.players[i];
    w.u16(p.id);
    w.u8(p.skin);
    w.u8((p.isBot ? p.flags | PlayerFlag.Bot : p.flags) | (p.holder ? PlayerFlag.Holder : 0));
    w.str8(p.name);
  }

  w.u16(s.upserts.length);
  for (const e of s.upserts) writeEntity(w, e);

  w.u16(s.removals.length);
  for (const r of s.removals) {
    w.u32(r.id);
    w.u32(r.eaterId);
  }
}

export function writeEntity(w: BinaryWriter, e: EntityRecord): void {
  w.u32(e.id);
  w.u8(e.kind);
  w.f32(e.x);
  w.f32(e.y);
  w.f32(e.r);
  switch (e.kind) {
    case EntityKind.Cell:
      w.u16(e.playerId ?? 0);
      w.u8(e.flags ?? 0);
      break;
    case EntityKind.Food:
    case EntityKind.Eject:
    case EntityKind.PowerUp:
    case EntityKind.Loot:
      w.u8(e.variant ?? 0);
      break;
    case EntityKind.Virus:
      break;
  }
}

export function encodeSnapshot(s: SnapshotData): ArrayBuffer {
  const w = new BinaryWriter(64 + s.upserts.length * 24 + s.removals.length * 8 + s.players.length * 32);
  writeSnapshot(w, s);
  return w.finish();
}

export function decodeSnapshot(buf: ArrayBuffer | ArrayBufferView): SnapshotData {
  const r = new BinaryReader(buf);
  const op = r.u8();
  if (op !== ServerOp.Snapshot) throw new Error(`not a snapshot (op ${op})`);
  const tick = r.u32();
  const view = { x: r.f32(), y: r.f32(), h: r.f32() };

  const nPlayers = r.u8();
  const players: PlayerInfo[] = new Array(nPlayers);
  for (let i = 0; i < nPlayers; i++) {
    const id = r.u16();
    const skin = r.u8();
    const flags = r.u8();
    players[i] = { id, skin, flags, name: r.str8(), isBot: (flags & PlayerFlag.Bot) !== 0, ...((flags & PlayerFlag.Holder) !== 0 ? { holder: true } : {}) };
  }

  const nUpserts = r.u16();
  const upserts: EntityRecord[] = new Array(nUpserts);
  for (let i = 0; i < nUpserts; i++) {
    const id = r.u32();
    const kind = r.u8() as EntityKind;
    const x = r.f32();
    const y = r.f32();
    const rad = r.f32();
    const e: EntityRecord = { id, kind, x, y, r: rad };
    switch (kind) {
      case EntityKind.Cell:
        e.playerId = r.u16();
        e.flags = r.u8();
        break;
      case EntityKind.Food:
      case EntityKind.Eject:
      case EntityKind.PowerUp:
      case EntityKind.Loot:
        e.variant = r.u8();
        break;
      case EntityKind.Virus:
        break;
      default:
        throw new Error(`unknown entity kind ${kind}`);
    }
    upserts[i] = e;
  }

  const nRemovals = r.u16();
  const removals = new Array(nRemovals);
  for (let i = 0; i < nRemovals; i++) removals[i] = { id: r.u32(), eaterId: r.u32() };

  return { tick, view, players, upserts, removals };
}

/**
 * Receives a snapshot record by record (`readSnapshot`): no intermediate objects. Cells always carry
 * `playerId` and `flags`; food, ejects, power-ups and loot a `variant`; thorn bushes neither (the
 * unused arguments are 0, `has` says which are set: `HAS_PLAYER` | `HAS_VARIANT`).
 */
export interface SnapshotSink {
  snapshotBegin(tick: number, viewX: number, viewY: number, viewH: number): void;
  /** `name` is the snapshot's bytes: the name is UTF-8 at `[nameAt, nameAt + nameLen)` (`decodeUtf8`). */
  snapshotPlayer(id: number, skin: number, flags: number, name: Uint8Array, nameAt: number, nameLen: number): void;
  snapshotUpsert(id: number, kind: EntityKind, x: number, y: number, r: number, has: number, playerId: number, flags: number, variant: number): void;
  snapshotRemoval(id: number, eaterId: number): void;
}
export const HAS_PLAYER = 1;
export const HAS_VARIANT = 2;

/** UTF-8 text inside a byte array. */
export function decodeUtf8(bytes: Uint8Array, at: number, len: number): string {
  return decoder.decode(bytes.subarray(at, at + len));
}

/**
 * Streaming `decodeSnapshot`: hands each record to `sink` as numbers, so a client applying 30
 * snapshots a second builds no garbage per record. Same wire format and the same errors.
 */
export function readSnapshot(buf: ArrayBuffer, sink: SnapshotSink): void {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  const op = v.getUint8(o++);
  if (op !== ServerOp.Snapshot) throw new Error(`not a snapshot (op ${op})`);
  const tick = v.getUint32(o, true);
  o += 4;
  sink.snapshotBegin(tick, v.getFloat32(o, true), v.getFloat32(o + 4, true), v.getFloat32(o + 8, true));
  o += 12;
  const nPlayers = v.getUint8(o++);
  for (let i = 0; i < nPlayers; i++) {
    const id = v.getUint16(o, true);
    const skin = v.getUint8(o + 2);
    const flags = v.getUint8(o + 3);
    const len = v.getUint8(o + 4);
    o += 5;
    if (o + len > bytes.length) throw new RangeError('snapshot truncated');
    sink.snapshotPlayer(id, skin, flags, bytes, o, len);
    o += len;
  }
  const nUpserts = v.getUint16(o, true);
  o += 2;
  for (let i = 0; i < nUpserts; i++) {
    const id = v.getUint32(o, true);
    const kind = v.getUint8(o + 4) as EntityKind;
    const x = v.getFloat32(o + 5, true);
    const y = v.getFloat32(o + 9, true);
    const r = v.getFloat32(o + 13, true);
    o += 17;
    switch (kind) {
      case EntityKind.Cell: {
        const pid = v.getUint16(o, true);
        const flags = v.getUint8(o + 2);
        o += 3;
        sink.snapshotUpsert(id, kind, x, y, r, HAS_PLAYER, pid, flags, 0);
        break;
      }
      case EntityKind.Food:
      case EntityKind.Eject:
      case EntityKind.PowerUp:
      case EntityKind.Loot:
        sink.snapshotUpsert(id, kind, x, y, r, HAS_VARIANT, 0, 0, v.getUint8(o++));
        break;
      case EntityKind.Virus:
        sink.snapshotUpsert(id, kind, x, y, r, 0, 0, 0, 0);
        break;
      default:
        throw new Error(`unknown entity kind ${kind}`);
    }
  }
  const nRemovals = v.getUint16(o, true);
  o += 2;
  for (let i = 0; i < nRemovals; i++) {
    sink.snapshotRemoval(v.getUint32(o, true), v.getUint32(o + 4, true));
    o += 8;
  }
}

/* ------------------------------------------------------------------ */
/* Client input                                                        */
/* ------------------------------------------------------------------ */

export type ClientInput =
  | { op: typeof ClientOp.Target; x: number; y: number }
  | { op: typeof ClientOp.Split }
  | { op: typeof ClientOp.Eject };

/** `out`: a 9-byte buffer to reuse (a WebSocket send copies it), sent 30 times a second. */
export function encodeTarget(x: number, y: number, out?: ArrayBuffer): ArrayBuffer {
  const buf = out ?? new ArrayBuffer(9);
  const v = new DataView(buf);
  v.setUint8(0, ClientOp.Target);
  v.setFloat32(1, x, true);
  v.setFloat32(5, y, true);
  return buf;
}

export const encodeSplit = (): ArrayBuffer => new Uint8Array([ClientOp.Split]).buffer;
export const encodeEject = (): ArrayBuffer => new Uint8Array([ClientOp.Eject]).buffer;

/** Returns null for malformed/unknown input so callers can ignore it. */
export function decodeClientInput(buf: ArrayBuffer | ArrayBufferView): ClientInput | null {
  const r = new BinaryReader(buf);
  if (r.remaining < 1) return null;
  const op = r.u8();
  switch (op) {
    case ClientOp.Target: {
      if (r.remaining < 8) return null;
      const x = r.f32();
      const y = r.f32();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { op: ClientOp.Target, x, y };
    }
    case ClientOp.Split:
      return { op: ClientOp.Split };
    case ClientOp.Eject:
      return { op: ClientOp.Eject };
    default:
      return null;
  }
}

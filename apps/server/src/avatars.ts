import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { AVATAR_LIMITS, isAvatarId, type AvatarType } from '@elymum/shared';

/**
 * Profile pictures: strict validation of uploaded images (`sanitizeAvatar`) and the content-addressed
 * file store (`AvatarStore`, `DATA_DIR/avatars/<id>.png|webp`).
 *
 * Only PNG and WebP squares are taken. A PNG is decoded completely and encoded again (only the pixels
 * survive: no metadata, no trailing bytes, no odd chunks). A WebP is checked chunk by chunk and its
 * container rebuilt from the bitstream chunks alone (`VP8 `/`VP8L`, `ALPH`): metadata (EXIF, XMP,
 * ICC) is dropped, animations are refused, and the bitstream dimensions must match.
 */

/** Why an image is refused. */
export class AvatarError extends Error {
  constructor(
    readonly code: 'bad_image' | 'body_too_large',
    message: string,
  ) {
    super(message);
  }
}

export interface CleanAvatar {
  bytes: Buffer;
  type: AvatarType;
  width: number;
  height: number;
}

/** Largest stored file (a re-encoded PNG can grow a little past the upload). */
export const AVATAR_STORED_MAX = 96 * 1024;

const bad = (m: string) => new AvatarError('bad_image', m);

/** Validates an upload and returns the cleaned file (re-encoded PNG, rebuilt WebP). Throws `AvatarError`. */
export function sanitizeAvatar(input: Uint8Array): CleanAvatar {
  if (input.length > AVATAR_LIMITS.maxBytes) throw new AvatarError('body_too_large', `The picture is larger than ${AVATAR_LIMITS.maxBytes / 1024} KB`);
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let out: CleanAvatar;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) out = cleanPng(buf);
  else if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') out = cleanWebp(buf);
  else throw bad('Upload a PNG or WebP picture');
  if (out.width !== out.height) throw bad('The picture must be square');
  if (out.width < AVATAR_LIMITS.minPx || out.width > AVATAR_LIMITS.maxPx) throw bad(`The picture must be ${AVATAR_LIMITS.minPx} to ${AVATAR_LIMITS.maxPx} px wide`);
  if (out.bytes.length > AVATAR_STORED_MAX) throw new AvatarError('body_too_large', 'The picture is too large');
  return out;
}

/** The id of a cleaned file: the first 16 hex digits of its SHA-256. */
export function avatarIdOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* PNG: full decode, then a canonical encode                           */
/* ------------------------------------------------------------------ */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bufs: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const b of bufs) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function cleanPng(buf: Buffer): CleanAvatar {
  let o = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  let first = true;
  let ended = false;
  let idatDone = false;
  while (o < buf.length) {
    if (o + 12 > buf.length) throw bad('The PNG is truncated');
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw bad('The PNG has a broken chunk');
    if (len > buf.length - o - 12) throw bad('The PNG is truncated');
    const data = buf.subarray(o + 8, o + 8 + len);
    if (crc32([buf.subarray(o + 4, o + 8), data]) !== buf.readUInt32BE(o + 8 + len)) throw bad('The PNG is corrupt (CRC)');
    o += 12 + len;
    if (first) {
      if (type !== 'IHDR' || len !== 13) throw bad('The PNG has no header');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8 || (color !== 2 && color !== 6)) throw bad('Only 8-bit RGB or RGBA PNG pictures are taken');
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw bad('Interlaced or unusual PNG pictures are not taken');
      if (width < 1 || height < 1 || width > AVATAR_LIMITS.maxPx || height > AVATAR_LIMITS.maxPx) throw bad(`The picture must be ${AVATAR_LIMITS.minPx} to ${AVATAR_LIMITS.maxPx} px wide`);
      channels = color === 6 ? 4 : 3;
      first = false;
      continue;
    }
    if (type === 'IDAT') {
      if (idatDone) throw bad('The PNG data is split');
      idat.push(data);
      continue;
    }
    if (idat.length > 0) idatDone = true;
    if (type === 'IEND') {
      ended = true;
      break;
    }
    // ancillary chunks (lower-case first letter) are dropped; PLTE is only a suggestion for RGB(A)
    if (type === 'PLTE' || (type.charCodeAt(0) & 0x20) !== 0) continue;
    throw bad(`The PNG has an unknown chunk (${type})`);
  }
  if (first || !ended || idat.length === 0) throw bad('The PNG is incomplete');
  if (o !== buf.length) throw bad('The PNG has data after its end');

  const stride = width * channels;
  const expected = height * (stride + 1);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    throw bad('The PNG data cannot be read');
  }
  if (raw.length !== expected) throw bad('The PNG data does not match its size');
  const px = unfilter(raw, height, stride, channels);
  return { bytes: encodePng(px, width, height, channels), type: 'image/png', width, height };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(raw: Buffer, height: number, stride: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = y > 0 && x >= bpp ? out[prev + x - bpp] : 0;
      let r: number;
      switch (f) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4:
          r = v + paeth(a, b, c);
          break;
        default:
          throw bad('The PNG uses an unknown filter');
      }
      out[dst + x] = r & 0xff;
    }
  }
  return out;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, crc]);
}

/** A plain PNG of the pixels: IHDR, one IDAT (per-row adaptive filter, deflate 9), IEND. */
export function encodePng(px: Uint8Array, width: number, height: number, channels: 3 | 4 | number): Buffer {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  const trial = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const v = px[row + x];
        const a = x >= channels ? px[row + x - channels] : 0;
        const b = y > 0 ? px[row - stride + x] : 0;
        const c = y > 0 && x >= channels ? px[row - stride + x - channels] : 0;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const d = (v - p) & 0xff;
        sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    for (let x = 0; x < stride; x++) {
      const v = px[row + x];
      const a = x >= channels ? px[row + x - channels] : 0;
      const b = y > 0 ? px[row - stride + x] : 0;
      const c = y > 0 && x >= channels ? px[row - stride + x - channels] : 0;
      const p = best === 0 ? 0 : best === 1 ? a : best === 2 ? b : best === 3 ? (a + b) >> 1 : paeth(a, b, c);
      trial[x] = (v - p) & 0xff;
    }
    trial.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ */
/* WebP: strict container check, rebuilt from the bitstream chunks     */
/* ------------------------------------------------------------------ */

interface RiffChunk {
  id: string;
  data: Buffer;
}

function vp8Size(d: Buffer): { w: number; h: number } {
  if (d.length < 10) throw bad('The WebP bitstream is truncated');
  const tag = d[0] | (d[1] << 8) | (d[2] << 16);
  if ((tag & 1) !== 0) throw bad('The WebP is not a key frame');
  const partition = tag >>> 5;
  if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw bad('The WebP bitstream is broken');
  if (partition > d.length - 10) throw bad('The WebP bitstream is truncated');
  return { w: d.readUInt16LE(6) & 0x3fff, h: d.readUInt16LE(8) & 0x3fff };
}

function vp8lSize(d: Buffer): { w: number; h: number; alpha: boolean } {
  if (d.length < 5 || d[0] !== 0x2f) throw bad('The WebP bitstream is broken');
  const bits = d.readUInt32LE(1);
  if (bits >>> 29 !== 0) throw bad('The WebP bitstream version is unknown');
  return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
}

function riff(chunks: RiffChunk[]): Buffer {
  const parts: Buffer[] = [];
  for (const c of chunks) {
    const head = Buffer.alloc(8);
    head.write(c.id, 0, 'latin1');
    head.writeUInt32LE(c.data.length, 4);
    parts.push(head, c.data);
    if (c.data.length & 1) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

function cleanWebp(buf: Buffer): CleanAvatar {
  const size = buf.readUInt32LE(4);
  if (size + 8 !== buf.length) throw bad('The WebP size does not match the file');
  const chunks: RiffChunk[] = [];
  let o = 12;
  while (o < buf.length) {
    if (o + 8 > buf.length) throw bad('The WebP is truncated');
    const id = buf.toString('latin1', o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    if (len > buf.length - o - 8) throw bad('The WebP is truncated');
    chunks.push({ id, data: buf.subarray(o + 8, o + 8 + len) });
    o += 8 + len + (len & 1);
  }
  if (o !== buf.length || chunks.length === 0) throw bad('The WebP is broken');

  const head = chunks[0];
  if (head.id === 'VP8 ' || head.id === 'VP8L') {
    if (chunks.length !== 1) throw bad('The WebP has extra data');
    const s = head.id === 'VP8 ' ? vp8Size(head.data) : vp8lSize(head.data);
    return { bytes: riff([{ id: head.id, data: Buffer.from(head.data) }]), type: 'image/webp', width: s.w, height: s.h };
  }
  if (head.id !== 'VP8X' || head.data.length !== 10) throw bad('The WebP has no image');
  const flags = head.data[0];
  if (flags & 0x02) throw bad('Animated pictures are not taken (the first frame is used: pick it again)');
  const cw = 1 + head.data.readUIntLE(4, 3);
  const ch = 1 + head.data.readUIntLE(7, 3);
  let alph: Buffer | null = null;
  let image: RiffChunk | null = null;
  for (const c of chunks.slice(1)) {
    switch (c.id) {
      case 'ANIM':
      case 'ANMF':
        throw bad('Animated pictures are not taken');
      case 'ALPH':
        if (alph || image) throw bad('The WebP alpha is misplaced');
        if (c.data.length < 1 || c.data[0] >> 6 !== 0 || (c.data[0] & 3) > 1) throw bad('The WebP alpha is broken');
        alph = c.data;
        break;
      case 'VP8 ':
      case 'VP8L':
        if (image) throw bad('The WebP has two images');
        image = c;
        break;
      default:
        // ICCP, EXIF, XMP and unknown chunks are dropped
        break;
    }
  }
  if (!image) throw bad('The WebP has no image');
  const s = image.id === 'VP8 ' ? vp8Size(image.data) : vp8lSize(image.data);
  if (s.w !== cw || s.h !== ch) throw bad('The WebP size does not match its image');
  if (image.id === 'VP8L' || !alph) {
    if (alph) throw bad('The WebP alpha is misplaced');
    return { bytes: riff([{ id: image.id, data: Buffer.from(image.data) }]), type: 'image/webp', width: s.w, height: s.h };
  }
  if ((alph[0] & 3) === 0 && alph.length !== 1 + s.w * s.h) throw bad('The WebP alpha is truncated');
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x10; // alpha only
  vp8x.writeUIntLE(s.w - 1, 4, 3);
  vp8x.writeUIntLE(s.h - 1, 7, 3);
  return {
    bytes: riff([
      { id: 'VP8X', data: vp8x },
      { id: 'ALPH', data: Buffer.from(alph) },
      { id: 'VP8 ', data: Buffer.from(image.data) },
    ]),
    type: 'image/webp',
    width: s.w,
    height: s.h,
  };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const EXT: Record<AvatarType, string> = { 'image/png': 'png', 'image/webp': 'webp' };
const TYPE_OF_EXT: Record<string, AvatarType> = { png: 'image/png', webp: 'image/webp' };

/**
 * Content-addressed picture files under `dir` (`<id>.png` / `<id>.webp`, written to a temp file and
 * renamed) and the ids an admin removed (`blocked.json`: such a picture cannot be uploaded again).
 * `dir` null: memory only (tests).
 */
export class AvatarStore {
  private readonly types = new Map<string, AvatarType>();
  private readonly memory = new Map<string, Buffer>();
  private readonly blocked = new Set<string>();

  constructor(
    private readonly dir: string | null,
    private readonly log: (m: string) => void = () => {},
  ) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      const m = /^([0-9a-f]{16})\.(png|webp)$/.exec(f);
      if (m) this.types.set(m[1], TYPE_OF_EXT[m[2]]);
    }
    const bl = join(dir, 'blocked.json');
    if (existsSync(bl)) {
      try {
        const ids = JSON.parse(readFileSync(bl, 'utf8')) as unknown;
        if (Array.isArray(ids)) for (const id of ids) if (isAvatarId(id)) this.blocked.add(id);
      } catch (err) {
        log(`avatars: ${bl} is unreadable (${(err as Error).message}); no picture is blocked`);
      }
    }
  }

  get size(): number {
    return this.types.size;
  }

  has(id: string): boolean {
    return this.types.has(id);
  }

  isBlocked(id: string): boolean {
    return this.blocked.has(id);
  }

  /** Stores a cleaned picture (idempotent: the same bytes keep the same id). Returns its id. */
  put(clean: CleanAvatar): string {
    const id = avatarIdOf(clean.bytes);
    if (this.types.has(id)) return id;
    if (this.dir) {
      const file = join(this.dir, `${id}.${EXT[clean.type]}`);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, clean.bytes);
      renameSync(tmp, file);
    } else this.memory.set(id, Buffer.from(clean.bytes));
    this.types.set(id, clean.type);
    return id;
  }

  /** The file of an id, or null. */
  get(id: string): { bytes: Buffer; type: AvatarType } | null {
    const type = isAvatarId(id) ? this.types.get(id) : undefined;
    if (!type) return null;
    if (!this.dir) {
      const b = this.memory.get(id);
      return b ? { bytes: b, type } : null;
    }
    try {
      return { bytes: readFileSync(join(this.dir, `${id}.${EXT[type]}`)), type };
    } catch {
      this.types.delete(id);
      return null;
    }
  }

  /** Deletes a file (a picture nobody wears any more). */
  delete(id: string): void {
    const type = this.types.get(id);
    if (!type) return;
    this.types.delete(id);
    this.memory.delete(id);
    if (!this.dir) return;
    try {
      unlinkSync(join(this.dir, `${id}.${EXT[type]}`));
    } catch (err) {
      this.log(`avatars: could not delete ${id} (${(err as Error).message})`);
    }
  }

  /** An admin removed the picture: it is deleted and cannot be uploaded again. */
  block(id: string): void {
    if (!isAvatarId(id)) return;
    this.blocked.add(id);
    this.delete(id);
    if (!this.dir) return;
    const file = join(this.dir, 'blocked.json');
    writeFileSync(`${file}.tmp`, JSON.stringify([...this.blocked]));
    renameSync(`${file}.tmp`, file);
  }
}

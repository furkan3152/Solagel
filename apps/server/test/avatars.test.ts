import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AVATAR_LIMITS, PROTOCOL_VERSION, PlayerFlag, decodeSnapshot, type PlayerInfo, type ServerMessage } from '@elymum/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import { AvatarStore, avatarIdOf, encodePng, sanitizeAvatar } from '../src/avatars';
import { loadConfig } from '../src/config';
import { Limiter } from '../src/net/limiter';
import { ArenaChain, arena } from './helpers';
import { testSigner } from './signers';

const wallet = () => testSigner().address;

/** An RGBA test picture of `w`×`h` (a gradient, so every picture differs by `seed`). */
function png(w: number, h = w, seed = 0): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = (i + seed) & 0xff;
    px[i * 4 + 1] = (i >> 3) & 0xff;
    px[i * 4 + 2] = seed & 0xff;
    px[i * 4 + 3] = 255;
  }
  return encodePng(px, w, h, 4);
}

/** `file` with one more chunk just before IEND (its own CRC computed here). */
function withChunk(file: Buffer, type: string, data: Buffer): Buffer {
  const crcOf = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crcOf(Buffer.concat([head.subarray(4), data])), 0);
  const iend = file.length - 12;
  return Buffer.concat([file.subarray(0, iend), head, data, crc, file.subarray(iend)]);
}

/** A RIFF/WebP file of the given chunks. */
function webp(chunks: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [];
  for (const [id, data] of chunks) {
    const h = Buffer.alloc(8);
    h.write(id, 0, 'latin1');
    h.writeUInt32LE(data.length, 4);
    parts.push(h, data);
    if (data.length & 1) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** A lossless (VP8L) bitstream header for w×h (the pixel data is not decoded server-side). */
function vp8l(w: number, h: number, alpha = true): Buffer {
  const d = Buffer.alloc(32);
  d[0] = 0x2f;
  d.writeUInt32LE(((w - 1) | ((h - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0, 1);
  return d;
}

/** A lossy (VP8) key frame header for w×h. */
function vp8(w: number, h: number): Buffer {
  const d = Buffer.alloc(40);
  const partition = 20;
  const tag = 0 | (0 << 1) | (1 << 4) | (partition << 5); // key frame, version 0, shown
  d[0] = tag & 0xff;
  d[1] = (tag >> 8) & 0xff;
  d[2] = (tag >> 16) & 0xff;
  d[3] = 0x9d;
  d[4] = 0x01;
  d[5] = 0x2a;
  d.writeUInt16LE(w, 6);
  d.writeUInt16LE(h, 8);
  return d;
}

function vp8x(w: number, h: number, flags: number): Buffer {
  const d = Buffer.alloc(10);
  d[0] = flags;
  d.writeUIntLE(w - 1, 4, 3);
  d.writeUIntLE(h - 1, 7, 3);
  return d;
}

describe('sanitizeAvatar', () => {
  it('re-encodes a PNG: same pixels, metadata and stray chunks gone, deterministic id', () => {
    const src = withChunk(png(128), 'tEXt', Buffer.from('Comment\0hello from exif land'));
    const out = sanitizeAvatar(src);
    expect(out).toMatchObject({ type: 'image/png', width: 128, height: 128 });
    expect(out.bytes.includes(Buffer.from('hello from exif land'))).toBe(false);
    // decoding again gives the same file (canonical form) and the id is its hash
    expect(sanitizeAvatar(out.bytes).bytes.equals(out.bytes)).toBe(true);
    expect(avatarIdOf(out.bytes)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses broken, odd and oversized PNGs', () => {
    const good = png(64);
    const flip = Buffer.from(good);
    flip[48] ^= 0xff; // inside IDAT: the CRC no longer matches
    expect(() => sanitizeAvatar(flip)).toThrow(/CRC/);
    expect(() => sanitizeAvatar(good.subarray(0, good.length - 6))).toThrow(/truncated|incomplete/);
    expect(() => sanitizeAvatar(Buffer.concat([good, Buffer.from('trailing')]))).toThrow(/after its end|truncated|broken/);
    expect(() => sanitizeAvatar(png(64, 48))).toThrow(/square/);
    expect(() => sanitizeAvatar(png(16))).toThrow(/px wide/);
    expect(() => sanitizeAvatar(png(300))).toThrow(/px wide|larger/);
    expect(() => sanitizeAvatar(withChunk(good, 'zzZZ', Buffer.alloc(2)))).not.toThrow(); // ancillary: dropped
    expect(() => sanitizeAvatar(withChunk(good, 'ZZZZ', Buffer.alloc(2)))).toThrow(/unknown chunk/);
    expect(() => sanitizeAvatar(Buffer.alloc(AVATAR_LIMITS.maxBytes + 1))).toThrow(/larger/);
    // a decompression bomb: a tiny IDAT inflating far past the declared size
    const bomb = Buffer.from(good);
    const ihdrEnd = 8 + 25;
    const zipped = deflateSync(Buffer.alloc(10_000_000));
    const idat = Buffer.alloc(12 + zipped.length);
    idat.writeUInt32BE(zipped.length, 0);
    idat.write('IDAT', 4, 'latin1');
    zipped.copy(idat, 8);
    const fake = Buffer.concat([bomb.subarray(0, ihdrEnd), idat, bomb.subarray(bomb.length - 12)]);
    expect(() => sanitizeAvatar(fake)).toThrow();
  });

  it('refuses JPEG, GIF, SVG and text by their magic bytes', () => {
    expect(() => sanitizeAvatar(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toThrow(/PNG or WebP/);
    expect(() => sanitizeAvatar(Buffer.from('GIF89a\x01\x00\x01\x00'))).toThrow(/PNG or WebP/);
    expect(() => sanitizeAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toThrow(/PNG or WebP/);
  });

  it('rebuilds a WebP from its bitstream chunks and checks its size', () => {
    expect(sanitizeAvatar(webp([['VP8L', vp8l(128, 128)]]))).toMatchObject({ type: 'image/webp', width: 128, height: 128 });
    expect(sanitizeAvatar(webp([['VP8 ', vp8(96, 96)]]))).toMatchObject({ type: 'image/webp', width: 96 });
    // VP8X + metadata + alpha + lossy: EXIF / XMP / ICC are dropped
    const exif = Buffer.from('Exif\0\0secret gps');
    const out = sanitizeAvatar(
      webp([
        ['VP8X', vp8x(128, 128, 0x10 | 0x08 | 0x04 | 0x20)],
        ['ICCP', Buffer.alloc(12)],
        ['ALPH', Buffer.from([1, 2, 3, 4])],
        ['VP8 ', vp8(128, 128)],
        ['EXIF', exif],
        ['XMP ', Buffer.from('<x:xmpmeta/>')],
      ]),
    );
    expect(out.bytes.includes(Buffer.from('secret gps'))).toBe(false);
    expect(out.bytes.includes(Buffer.from('ICCP'))).toBe(false);
    expect(out.bytes.toString('latin1', 12, 16)).toBe('VP8X');
    expect(out.bytes[20]).toBe(0x10);
  });

  it('refuses animated, mismatched and broken WebPs', () => {
    expect(() => sanitizeAvatar(webp([['VP8X', vp8x(64, 64, 0x02)], ['ANIM', Buffer.alloc(6)]]))).toThrow(/Animated/);
    expect(() => sanitizeAvatar(webp([['VP8X', vp8x(64, 64, 0)], ['ANMF', Buffer.alloc(16)]]))).toThrow(/Animated/);
    expect(() => sanitizeAvatar(webp([['VP8X', vp8x(64, 64, 0)], ['VP8 ', vp8(96, 96)]]))).toThrow(/does not match/);
    expect(() => sanitizeAvatar(webp([['VP8L', vp8l(64, 32)]]))).toThrow(/square/);
    expect(() => sanitizeAvatar(webp([['VP8 ', vp8(64, 64)], ['VP8 ', vp8(64, 64)]]))).toThrow(/extra data/);
    const bad = webp([['VP8L', vp8l(64, 64)]]);
    bad.writeUInt32LE(9999, 4);
    expect(() => sanitizeAvatar(bad)).toThrow(/size/);
    const notKey = vp8(64, 64);
    notKey[0] |= 1;
    expect(() => sanitizeAvatar(webp([['VP8 ', notKey]]))).toThrow(/key frame/);
  });
});

describe('AvatarStore', () => {
  it('stores content-addressed files, reloads them and keeps blocked ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-av-'));
    const a = new AvatarStore(dir);
    const clean = sanitizeAvatar(png(64, 64, 3));
    const id = a.put(clean);
    expect(a.put(clean)).toBe(id);
    expect(readdirSync(dir)).toEqual([`${id}.png`]);
    const b = new AvatarStore(dir);
    expect(b.get(id)?.type).toBe('image/png');
    b.block(id);
    expect(b.get(id)).toBeNull();
    expect(existsSync(join(dir, `${id}.png`))).toBe(false);
    expect(new AvatarStore(dir).isBlocked(id)).toBe(true);
    expect(b.get('../../etc/passwd')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* HTTP + game                                                         */
/* ------------------------------------------------------------------ */

interface Harness {
  app: App;
  port: number;
  dir: string;
  admin: string;
  call(method: string, path: string, opts?: { wallet?: string | null; raw?: Buffer; type?: string; body?: unknown }): Promise<{ status: number; body: any; headers: Headers; bytes: Buffer }>;
}

async function harness(limits: { avatarWallet?: Limiter } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'elymum-avatar-'));
  const admin = wallet();
  const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '3', BOT_MIN: '3', BOT_MAX: '3', ADMIN_WALLETS: admin, TRUST_PROXY: '0', GAME_ACCESS: 'public' } as NodeJS.ProcessEnv);
  const big = () => new Limiter(10_000, 60_000);
  const app = await createApp(cfg, {
    chain: new ArenaChain([arena(1, 1000)]),
    log: () => {},
    persist: true,
    siteLimits: { writeIp: big(), writeWallet: big(), login: big(), avatarIp: big(), avatarWallet: limits.avatarWallet ?? big() },
    apiLimiter: big(),
  });
  const port = await app.listen();
  const call: Harness['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = {};
    if (opts.wallet) headers.Authorization = `Bearer ${app.auth.issueToken(opts.wallet)}`;
    let body: BodyInit | undefined;
    if (opts.raw) {
      headers['Content-Type'] = opts.type ?? 'image/png';
      body = new Uint8Array(opts.raw);
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body });
    const bytes = Buffer.from(await res.arrayBuffer());
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed, headers: res.headers, bytes };
  };
  return { app, port, dir, admin, call };
}

describe('profile picture API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.app.close();
  });

  it('needs a signed-in wallet', async () => {
    expect((await h.call('POST', '/api/profile/avatar', { raw: png(128) })).status).toBe(401);
    expect((await h.call('DELETE', '/api/profile/avatar')).status).toBe(401);
  });

  it('checks the content type, the size and the image', async () => {
    const w = wallet();
    expect((await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(128), type: 'image/svg+xml' })).status).toBe(415);
    expect((await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(128), type: 'image/webp' })).body).toMatchObject({ error: 'bad_image' });
    const huge = await h.call('POST', '/api/profile/avatar', { wallet: w, raw: Buffer.alloc(AVATAR_LIMITS.maxBytes + 10), type: 'image/png' });
    expect(huge.status).toBe(413);
    const odd = await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(100, 80) });
    expect(odd.status).toBe(400);
    expect(odd.body.error).toBe('bad_image');
    expect((await h.call('GET', '/api/profile', { wallet: w })).body.profile.avatar).toBeNull();
  });

  it('stores a picture, serves it immutable with its type, and deletes it', async () => {
    const w = wallet();
    const up = await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(128, 128, 7) });
    expect(up.status).toBe(201);
    const id = up.body.profile.avatar as string;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect((await h.call('GET', '/api/profile', { wallet: w })).body.profile.avatar).toBe(id);
    const got = await h.call('GET', `/api/avatar/${id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(avatarIdOf(got.bytes)).toBe(id);
    expect(existsSync(join(h.dir, 'avatars', `${id}.png`))).toBe(true);
    // a replacement deletes the old file (nobody else wears it)
    const next = (await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(128, 128, 8) })).body.profile.avatar as string;
    expect(next).not.toBe(id);
    expect((await h.call('GET', `/api/avatar/${id}`)).status).toBe(404);
    const del = await h.call('DELETE', '/api/profile/avatar', { wallet: w });
    expect(del.body.profile.avatar).toBeNull();
    expect((await h.call('GET', `/api/avatar/${next}`)).status).toBe(404);
    expect((await h.call('GET', '/api/avatar/not-an-id')).status).toBe(404);
  });

  it('accepts a WebP', async () => {
    const w = wallet();
    const up = await h.call('POST', '/api/profile/avatar', { wallet: w, raw: webp([['VP8L', vp8l(128, 128)]]), type: 'image/webp' });
    expect(up.status).toBe(201);
    expect((await h.call('GET', `/api/avatar/${up.body.profile.avatar}`)).headers.get('content-type')).toBe('image/webp');
  });

  it('lets an admin list and remove a picture, which cannot come back', async () => {
    const w = wallet();
    const raw = png(128, 128, 21);
    const id = (await h.call('POST', '/api/profile/avatar', { wallet: w, raw })).body.profile.avatar as string;
    expect((await h.call('GET', '/api/admin/avatars', { wallet: w })).status).toBe(403);
    expect((await h.call('DELETE', `/api/admin/avatars/${w}`, { wallet: w })).status).toBe(403);
    const list = await h.call('GET', '/api/admin/avatars', { wallet: h.admin });
    expect(list.body.items[0]).toMatchObject({ wallet: w, avatar: id });
    const rm = await h.call('DELETE', `/api/admin/avatars/${w.toLowerCase()}`, { wallet: h.admin });
    expect(rm.status).toBe(200);
    expect(rm.body.removed).toBe(id);
    expect((await h.call('GET', '/api/profile', { wallet: w })).body.profile.avatar).toBeNull();
    expect((await h.call('GET', `/api/avatar/${id}`)).status).toBe(404);
    const again = await h.call('POST', '/api/profile/avatar', { wallet: w, raw });
    expect(again.status).toBe(403);
    expect(again.body.error).toBe('image_blocked');
    expect((await h.call('DELETE', `/api/admin/avatars/${w}`, { wallet: h.admin })).status).toBe(404);
    expect((await h.call('DELETE', '/api/admin/avatars/nope', { wallet: h.admin })).status).toBe(400);
  });
});

describe('profile picture upload limits', () => {
  it('rate-limits uploads per wallet', async () => {
    const h = await harness({ avatarWallet: new Limiter(2, 60_000) });
    try {
      const w = wallet();
      expect((await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(64, 64, 1) })).status).toBe(201);
      expect((await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(64, 64, 2) })).status).toBe(201);
      const third = await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(64, 64, 3) });
      expect(third.status).toBe(429);
      // another wallet is not affected
      expect((await h.call('POST', '/api/profile/avatar', { wallet: wallet(), raw: png(64, 64, 4) })).status).toBe(201);
    } finally {
      await h.app.close();
    }
  });
});

/** A WebSocket client that keeps the JSON messages and the players of every snapshot. */
class Ws {
  msgs: ServerMessage[] = [];
  players = new Map<number, PlayerInfo>();
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d, bin) => {
      if (!bin) this.msgs.push(JSON.parse(d.toString()) as ServerMessage);
      else {
        const buf = d as Buffer;
        for (const p of decodeSnapshot(buf).players) this.players.set(p.id, p);
      }
    });
  }
  static async open(port: number): Promise<Ws> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
    const c = new Ws(ws);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    await c.next('welcome');
    return c;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async next<T extends ServerMessage['t']>(t: T, timeoutMs = 3000): Promise<Extract<ServerMessage, { t: T }>> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
      if (i >= 0) return this.msgs.splice(0, i + 1)[i] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > until) throw new Error(`no ${t}: ${JSON.stringify(this.msgs.map((m) => m.t))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  close() {
    this.ws.close();
  }
}

describe('profile pictures in game', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.app.close();
  });

  it('carries the avatar id of a player who wears it (never for bots or guests), and drops it on removal', async () => {
    const w = wallet();
    const id = (await h.call('POST', '/api/profile/avatar', { wallet: w, raw: png(128, 128, 99) })).body.profile.avatar as string;
    const me = await Ws.open(h.port);
    me.send({ t: 'auth', token: h.app.auth.issueToken(w) });
    await me.next('authed');
    me.send({ t: 'join', room: 'practice', name: 'pic', skin: 2, pic: true });
    const joined = await me.next('joined');
    await me.until(() => me.players.get(joined.playerId)?.avatar === id);
    const mine = me.players.get(joined.playerId)!;
    expect(mine.flags & PlayerFlag.Avatar).toBe(PlayerFlag.Avatar);
    expect(mine.skin).toBe(2);

    // a guest asking for a picture gets none; bots never have one
    const guest = await Ws.open(h.port);
    guest.send({ t: 'join', room: 'practice', name: 'guest', skin: 1, pic: true });
    const gj = await guest.next('joined');
    await guest.until(() => guest.players.has(gj.playerId));
    expect(guest.players.get(gj.playerId)?.avatar).toBeUndefined();
    for (const c of [me, guest]) for (const p of c.players.values()) if (p.isBot) expect(p.avatar).toBeUndefined();

    // the admin removes it: the next player info carries no avatar
    expect((await h.call('DELETE', `/api/admin/avatars/${w}`, { wallet: h.admin })).status).toBe(200);
    await me.until(() => me.players.get(joined.playerId)?.avatar === undefined);
    expect(me.players.get(joined.playerId)!.flags & PlayerFlag.Avatar).toBe(0);
    me.close();
    guest.close();
  });
});

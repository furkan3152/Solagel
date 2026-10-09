import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  PROTOCOL_VERSION,
  PlayerFlag,
  SKIN_COUNT,
  clamp,
  decodeClientInput,
  isSkinUnlocked,
  levelFromXp,
  parseJoinTarget,
  sanitizeName,
  type ErrorCode,
  type ProfileSummary,
} from '@solagel/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Auth } from '../auth';
import type { ChainGateway, ChainProfile } from '../chain/types';
import type { ServerConfig } from '../config';
import type { RoomManager } from '../rooms/manager';
import { MAX_STAKE_SESSION_AGE_S } from '../rooms/room';
import type { Journal } from '../stake/journal';
import { Conn } from './conn';

export const profileSummary = (p: ChainProfile | null): ProfileSummary | null =>
  p ? { name: p.name, skin: p.skin, xp: p.xp, level: levelFromXp(p.xp), premiumSkins: p.premiumSkins } : null;

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** WebSocket front door: connection limits, message parsing and routing. */
export class Gateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  private readonly perIp = new Map<string, number>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly cfg: ServerConfig,
    private readonly rooms: RoomManager,
    private readonly auth: Auth,
    private readonly chain: ChainGateway,
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly trustProxy = process.env.TRUST_PROXY === '1',
  ) {
    chain.onSettled((e) => {
      for (const conn of this.rooms.connsByWallet(e.player)) {
        const kind = e.kind === 'record' ? 'record' : (e.payout ?? 0) > 0 ? 'cashout' : 'death';
        conn.send({ t: 'settled', kind, signature: e.signature, payout: e.payout });
      }
      void this.refreshProfile(e.player);
    });
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== '/ws') {
        socket.destroy();
        return;
      }
      const ip = clientIp(req, this.trustProxy);
      if (this.rooms.conns.size >= this.cfg.maxConnections || (this.perIp.get(ip) ?? 0) >= this.cfg.maxConnectionsPerIp) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ip));
    });
    // heartbeat + lobby room list
    this.timers.push(
      setInterval(() => {
        for (const ws of this.wss.clients) {
          if (this.alive.get(ws) === false) {
            ws.terminate();
            continue;
          }
          this.alive.set(ws, false);
          ws.ping();
        }
      }, 25_000),
      setInterval(() => {
        const msg = { t: 'rooms', rooms: this.rooms.list(), online: this.rooms.online() } as const;
        for (const c of this.rooms.conns) if (c.helloed && !c.player?.alive) c.send(msg);
      }, 5000),
    );
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    for (const ws of this.wss.clients) ws.close(1001, 'server shutting down');
  }

  private onConnection(ws: WebSocket, ip: string): void {
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    const conn = new Conn(ws, ip);
    this.rooms.conns.add(conn);
    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      this.onMessage(conn, data, isBinary).catch((err) => this.log(`message handling failed: ${(err as Error).stack ?? err}`));
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {});
  }

  private onClose(conn: Conn): void {
    const n = (this.perIp.get(conn.ip) ?? 1) - 1;
    if (n <= 0) this.perIp.delete(conn.ip);
    else this.perIp.set(conn.ip, n);
    this.rooms.conns.delete(conn);
    conn.room?.leave(conn, 'disconnect');
  }

  private error(conn: Conn, code: ErrorCode, message: string): void {
    conn.send({ t: 'error', code, message });
  }

  private async refreshProfile(wallet: string): Promise<void> {
    const profile = await this.chain.getProfile(wallet, true).catch(() => null);
    for (const conn of this.rooms.connsByWallet(wallet)) {
      conn.profile = profile;
      if (profile) conn.send({ t: 'xp', xp: profile.xp, level: levelFromXp(profile.xp) });
    }
  }

  async onMessage(conn: Conn, data: RawData, isBinary: boolean): Promise<void> {
    if (!conn.allow(isBinary ? 1 : 3)) return;
    if (isBinary) {
      const input = decodeClientInput(toBytes(data));
      if (input && conn.room) conn.room.input(conn, input);
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t !== 'hello' && !conn.helloed) return;

    switch (msg.t) {
      case 'hello': {
        if (msg.v !== PROTOCOL_VERSION) {
          this.error(conn, 'version_mismatch', 'A new version of Solagel is available — please refresh.');
          return;
        }
        conn.helloed = true;
        conn.lang = msg.lang === 'tr' ? 'tr' : 'en';
        conn.send({
          t: 'welcome',
          v: PROTOCOL_VERSION,
          serverTime: Date.now(),
          rooms: this.rooms.list(),
          chain: this.chain.status(),
          online: this.rooms.online(),
        });
        return;
      }
      case 'auth':
        await this.onAuth(conn, msg);
        return;
      case 'logout':
        conn.wallet = null;
        conn.profile = null;
        return;
      case 'join':
        await this.onJoin(conn, msg);
        return;
      case 'spectate': {
        const room =
          typeof msg.room === 'string' ? this.rooms.rooms.get(msg.room) : (conn.room ?? this.rooms.lobbyRoom());
        if (!room) {
          this.error(conn, 'room_not_found', 'Room not found');
          return;
        }
        if (conn.player?.alive && conn.room !== room) conn.room?.leave(conn, 'switch');
        room.spectate(conn, msg.next === true);
        return;
      }
      case 'leave':
        conn.room?.leave(conn, 'left');
        conn.send({ t: 'left' });
        return;
      case 'viewport': {
        const w = Number(msg.w);
        const h = Number(msg.h);
        if (w > 0 && h > 0 && Number.isFinite(w / h)) conn.aspect = clamp(w / h, 0.3, 3);
        return;
      }
      case 'chat':
        conn.room?.chat(conn, msg.text);
        return;
      case 'emote':
        conn.room?.emote(conn, msg.id);
        return;
      case 'cashout':
        conn.room?.cashout(conn);
        return;
      case 'ping':
        conn.send({ t: 'pong', ts: Number(msg.ts) || 0, serverTime: Date.now() });
        return;
    }
  }

  private async onAuth(conn: Conn, msg: Record<string, unknown>): Promise<void> {
    let wallet: string | null = null;
    if (typeof msg.token === 'string') wallet = this.auth.verifyToken(msg.token);
    else if (typeof msg.pubkey === 'string' && typeof msg.message === 'string' && typeof msg.signature === 'string') {
      wallet = this.auth.verifySignature(msg.pubkey, msg.message, msg.signature) ? msg.pubkey : null;
    }
    if (!wallet) {
      this.error(conn, 'auth_failed', 'Wallet login failed — please sign again.');
      return;
    }
    conn.wallet = wallet;
    conn.profile = await this.chain.getProfile(wallet, true).catch(() => null);
    conn.send({ t: 'authed', pubkey: wallet, token: this.auth.issueToken(wallet), profile: profileSummary(conn.profile) });
  }

  private async onJoin(conn: Conn, msg: Record<string, unknown>): Promise<void> {
    if (conn.joining) return;
    const target = typeof msg.room === 'string' ? parseJoinTarget(msg.room) : null;
    if (!target) {
      this.error(conn, 'bad_request', 'Unknown room');
      return;
    }
    conn.joining = true;
    try {
      const skin = Number.isInteger(msg.skin) && (msg.skin as number) >= 0 && (msg.skin as number) < SKIN_COUNT ? (msg.skin as number) : 0;
      if (conn.wallet) conn.profile = await this.chain.getProfile(conn.wallet).catch(() => conn.profile);
      const own = conn.profile ? { xp: conn.profile.xp, premiumMask: conn.profile.premiumSkins } : null;
      if (!isSkinUnlocked(skin, own)) {
        this.error(conn, 'skin_locked', 'That skin is locked.');
        return;
      }
      let name = sanitizeName(msg.name);
      let flags = 0;
      if (conn.profile) {
        name = sanitizeName(conn.profile.name, name);
        flags |= PlayerFlag.Verified;
      }

      if (target.mode === 'free') {
        if (conn.player?.alive && conn.room?.opts.mode === 'free') return; // already playing
        const room = this.rooms.freeRoom(conn.room);
        if (conn.player?.alive) conn.room?.leave(conn, 'switch');
        room.join(conn, { name, skin, flags });
        return;
      }

      if (target.mode === 'private') {
        const room = this.rooms.privateRoom(target.code);
        if (!room) {
          this.error(conn, 'room_not_found', 'No private room with that code.');
          return;
        }
        if (conn.player?.alive && conn.room === room) return;
        if (room.isFull) {
          this.error(conn, 'room_full', 'That room is full.');
          return;
        }
        if (conn.player?.alive) conn.room?.leave(conn, 'switch');
        room.join(conn, { name, skin, flags });
        return;
      }

      // stake arena
      if (!this.chain.stakeEnabled) {
        this.error(conn, 'stake_disabled', 'High-stakes arenas are offline.');
        return;
      }
      if (!conn.wallet) {
        this.error(conn, 'auth_required', 'Connect and sign in with your wallet first.');
        return;
      }
      const room = await this.rooms.stakeRoom(target.arenaId);
      if (!room) {
        this.error(conn, 'room_not_found', 'Arena not available.');
        return;
      }
      const existing = room.findStakeByWallet(conn.wallet);
      if (existing) {
        if (conn.player === null && room.reattach(conn, existing.pid)) return;
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      const session = await this.chain.getSession(target.arenaId, conn.wallet);
      if (!session) {
        this.error(conn, 'no_session', 'No open arena ticket found for your wallet.');
        return;
      }
      if (this.journal.pending.some((p) => p.key === session.address)) {
        this.error(conn, 'no_session', 'Your previous game in this arena is still being settled.');
        return;
      }
      if (Date.now() / 1000 - session.openedAt > MAX_STAKE_SESSION_AGE_S - 600) {
        this.error(conn, 'no_session', 'This arena ticket expired and will be refunded.');
        return;
      }
      if (room.isFull) {
        this.error(conn, 'room_full', 'Arena is full — try again in a moment.');
        return;
      }
      // re-check after the awaits above: another tab may have joined with the same ticket meanwhile
      if (room.findStakeByWallet(conn.wallet) || room.liveSessions().includes(session.address)) {
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      if (conn.player?.alive) conn.room?.leave(conn, 'switch');
      room.join(conn, {
        name,
        skin,
        flags: flags | PlayerFlag.Staker,
        stake: {
          player: conn.wallet,
          session: session.address,
          sessionId: session.id,
          arenaId: target.arenaId,
          buyIn: session.buyIn,
          value: session.buyIn,
          openedAt: session.openedAt,
        },
      });
    } finally {
      conn.joining = false;
    }
  }
}

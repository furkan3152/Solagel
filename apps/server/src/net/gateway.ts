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

const ACTIVATION_TIMEOUT_MS = 45_000;

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
        conn.send({ t: 'settled', kind, signature: e.signature, payout: e.payout, sessionId: e.sessionId, arenaId: e.arenaId });
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
        const msg = { t: 'rooms', rooms: this.rooms.list(), online: this.rooms.online(), chain: this.chain.status() } as const;
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
    conn.actionVersion++;
    conn.authVersion++;
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

  private async activateTicket(arenaId: number, wallet: string, sessionId: number): Promise<boolean> {
    if (!this.chain.activateSession) return false;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.chain.activateSession(arenaId, wallet, sessionId),
        new Promise<boolean>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Arena activation timed out')), ACTIVATION_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
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
        conn.actionVersion++;
        conn.authVersion++;
        conn.room?.leave(conn, 'switch');
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
        conn.actionVersion++;
        if (conn.player?.alive && conn.room !== room) conn.room?.leave(conn, 'switch');
        room.spectate(conn, msg.next === true);
        return;
      }
      case 'leave':
        conn.actionVersion++;
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
    if (!conn.allowChainOp()) {
      this.error(conn, 'rate_limited', 'Too many sign-ins — wait a moment.');
      return;
    }
    let wallet: string | null = null;
    if (typeof msg.token === 'string') wallet = this.auth.verifyToken(msg.token);
    else if (typeof msg.pubkey === 'string' && typeof msg.message === 'string' && typeof msg.signature === 'string') {
      wallet = this.auth.verifySignature(msg.pubkey, msg.message, msg.signature) ? msg.pubkey : null;
    }
    if (!wallet) {
      this.error(conn, 'auth_failed', 'Wallet login failed — please sign again.');
      return;
    }
    if (conn.wallet !== wallet) {
      conn.actionVersion++;
      conn.authVersion++;
      conn.room?.leave(conn, 'switch');
      conn.wallet = wallet;
      conn.profile = null;
    }
    const authVersion = conn.authVersion;
    const profile = await this.chain.getProfile(wallet, true).catch(() => null);
    if (!conn.open || conn.wallet !== wallet || conn.authVersion !== authVersion) return;
    conn.profile = profile;
    conn.send({ t: 'authed', pubkey: wallet, token: this.auth.issueToken(wallet), profile: profileSummary(conn.profile) });
    // A confirmed payout may have arrived while this wallet was offline.
    // Clients match arena + session identity before updating a result screen.
    for (const receipt of this.journal.receiptsFor(wallet)) {
      conn.send({ t: 'settled', kind: receipt.payout > 0 ? 'cashout' : 'death', signature: receipt.signature,
        payout: receipt.payout, sessionId: receipt.sessionId, arenaId: receipt.arenaId });
    }
  }

  private async onJoin(conn: Conn, msg: Record<string, unknown>): Promise<void> {
    if (conn.joining) return;
    const target = typeof msg.room === 'string' ? parseJoinTarget(msg.room) : null;
    if (!target) {
      this.error(conn, 'bad_request', 'Unknown room');
      return;
    }
    conn.joining = true;
    const actionVersion = conn.actionVersion;
    const wallet = conn.wallet;
    const canceled = () => !conn.open || conn.actionVersion !== actionVersion || conn.wallet !== wallet;
    try {
      const skin = Number.isInteger(msg.skin) && (msg.skin as number) >= 0 && (msg.skin as number) < SKIN_COUNT ? (msg.skin as number) : 0;
      if (wallet) {
        const profile = await this.chain.getProfile(wallet).catch(() => conn.profile);
        if (canceled()) return;
        conn.profile = profile;
      }
      if (canceled()) return;
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
      // Existing players must still be able to reconnect and exit when new
      // admissions are paused on-chain.
      const currentRoom = this.rooms.rooms.get(`stake-${target.arenaId}`);
      const currentStake = wallet ? currentRoom?.findStakeByWallet(wallet) : undefined;
      if (currentRoom && currentStake) {
        if (conn.player === null && currentRoom.reattach(conn, currentStake.pid)) return;
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      if (!this.chain.stakeEnabled) {
        this.error(conn, 'stake_disabled', 'High-stakes arenas are offline.');
        return;
      }
      if (!wallet) {
        this.error(conn, 'auth_required', 'Connect and sign in with your wallet first.');
        return;
      }
      const room = await this.rooms.stakeRoom(target.arenaId);
      if (canceled()) return;
      if (!room) {
        this.error(conn, 'room_not_found', 'Arena not available.');
        return;
      }
      const existing = room.findStakeByWallet(wallet);
      if (existing) {
        if (conn.player === null && room.reattach(conn, existing.pid)) return;
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      if (room.hasReservation(wallet)) {
        this.error(conn, 'session_busy', 'Your arena ticket is being activated.');
        return;
      }
      if (!conn.allowChainOp()) {
        this.error(conn, 'rate_limited', 'Too many join attempts — wait a moment.');
        return;
      }
      const session = await this.chain.getSession(target.arenaId, wallet);
      if (canceled()) return;
      if (!session) {
        this.error(conn, 'no_session', 'No open arena ticket found for your wallet.');
        return;
      }
      if (session.player !== wallet || session.arenaId !== target.arenaId || !Number.isSafeInteger(session.buyIn) || session.buyIn <= 0) {
        this.error(conn, 'no_session', 'The arena ticket does not match your wallet and arena.');
        return;
      }
      if (this.journal.pending.some((p) => p.key === session.address)) {
        this.error(conn, 'no_session', 'Your previous game in this arena is still being settled.');
        return;
      }
      if (session.activated) {
        this.error(conn, 'no_session', 'This ticket was already played and needs settlement before another entry.');
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
      if (room.findStakeByWallet(wallet) || this.rooms.liveSessions().has(session.address)) {
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      const stake = { player: wallet, session: session.address, sessionId: session.id, arenaId: target.arenaId,
        buyIn: session.buyIn, value: session.buyIn, openedAt: session.openedAt };
      room.reserveStake(stake);
      try {
        const activated = await this.activateTicket(target.arenaId, wallet, session.id);
        if (canceled() || !activated || !this.chain.stakeEnabled) {
          room.cancelReservation(session.address);
          if (!canceled()) this.error(conn, 'no_session', 'Arena entry could not complete. Your ticket has been queued for settlement.');
          return;
        }
        if (conn.player?.alive) conn.room?.leave(conn, 'switch');
        room.join(conn, { name, skin, flags: flags | PlayerFlag.Staker, stake });
      } catch (err) {
        room.cancelReservation(session.address);
        this.log(`arena admission failed: ${(err as Error).message}`);
        if (!canceled()) this.error(conn, 'no_session', 'Arena entry could not complete. Your ticket has been queued for settlement.');
      }
    } catch (err) {
      this.log(`join failed: ${(err as Error).message}`);
      if (!canceled()) this.error(conn, target.mode === 'stake' ? 'no_session' : 'bad_request', 'Entry is temporarily unavailable. Please try again shortly.');
    } finally {
      conn.joining = false;
    }
  }
}

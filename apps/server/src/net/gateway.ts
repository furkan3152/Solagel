import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  PROTOCOL_VERSION,
  PlayerFlag,
  SKIN_COUNT,
  clamp,
  decodeClientInput,
  isBasicSkin,
  levelFromXp,
  parseJoinTarget,
  sanitizeName,
  type ErrorCode,
  type ProfileSummary,
  type ServerMessage,
} from '@slana/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Auth } from '../auth';
import type { ChainGateway, ChainProfile, SettledEvent } from '../chain/types';
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

/**
 * The `settled` message for a settlement event: it names the on-chain session
 * (and arena) so a client matches it to the ticket it paid out (R16).
 */
export function settledMessage(e: SettledEvent): Extract<ServerMessage, { t: 'settled' }> {
  const kind = e.payout > 0 ? 'payout' : 'death';
  return {
    t: 'settled',
    kind,
    session: e.key,
    ...(e.arenaId === undefined ? {} : { arenaId: e.arenaId }),
    signature: e.signature,
    payout: e.payout,
    ...(e.fee === undefined ? {} : { fee: e.fee, net: e.payout - e.fee }),
    ...(e.collect ? { collect: true } : {}),
  };
}

/** WebSocket front door: connection limits, message parsing and routing. */
export class Gateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  private readonly perIp = new Map<string, number>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private timers: NodeJS.Timeout[] = [];
  /** Who may enter a room (join or spectate); null: everyone (unit tests that build a bare gateway). */
  private gameGate: ((wallet: string | null) => boolean) | null = null;

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
        conn.send(settledMessage(e));
      }
      void this.refreshProfile(e.player);
    });
    // the token was set (or another status change clients must see): push the new chain status
    chain.onStatusChange(() => this.broadcastChain());
  }

  /** Sets who may enter rooms (the site's game gate: public, or an admin wallet). */
  setGameGate(gate: ((wallet: string | null) => boolean) | null): void {
    this.gameGate = gate;
  }

  /** Refuses (`game_closed`) a room entry while the game is not public and the session is no admin. */
  private gameClosed(conn: Conn): boolean {
    if (!this.gameGate || this.gameGate(conn.wallet)) return false;
    this.error(conn, 'game_closed', 'The game is not open yet. Follow @slanaio for the launch.');
    return true;
  }

  /** Sends the current chain status (`chain` message) to every connection past `hello`. */
  broadcastChain(): void {
    const msg = { t: 'chain', chain: this.chain.status() } as const;
    for (const c of this.rooms.conns) if (c.helloed) c.send(msg);
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
        const msg = { t: 'rooms', rooms: this.rooms.list(), online: this.rooms.online(), blocked: this.rooms.blockedArenas() } as const;
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

  private error(conn: Conn, code: ErrorCode, message: string, extra: { opensAt?: number } = {}): void {
    conn.send({ t: 'error', code, message, ...extra });
  }

  /**
   * The returning player's ticket was settled at a bell while they were away: their till was paid.
   * The memo stays (a reload asks again) until it expires or a newer ticket is seen.
   */
  private roundEnded(conn: Conn): void {
    this.error(conn, 'round_ended', 'The round ended while you were away. Your ticket was settled at the bell.');
  }

  /**
   * New arena joins are refused from `joinsCloseAt` until the round ends (`round_closed` with
   * `opensAt` = the end). Returns true when refused. Reconnects of a live staker never come here.
   */
  private roundClosed(conn: Conn): boolean {
    const now = this.rooms.now();
    const r = this.rooms.roundWindow(now);
    if (now < r.joinsCloseAt) return false;
    const secs = Math.max(1, Math.ceil((r.endsAt - now) / 1000));
    this.error(conn, 'round_closed', `Joins are closed for the rest of this round. The next round opens in ${secs} s.`, { opensAt: r.endsAt });
    return true;
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
          this.error(conn, 'version_mismatch', 'A new version of Slana is available — please refresh.');
          return;
        }
        conn.helloed = true;
        conn.send({
          t: 'welcome',
          v: PROTOCOL_VERSION,
          serverTime: Date.now(),
          serverNow: this.rooms.now(),
          rooms: this.rooms.list(),
          chain: this.chain.status(),
          online: this.rooms.online(),
          blocked: this.rooms.blockedArenas(),
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
        if (this.gameClosed(conn)) return;
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
        conn.send({ t: 'pong', ts: Number(msg.ts) || 0, serverTime: Date.now(), serverNow: this.rooms.now() });
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
    conn.wallet = wallet;
    conn.profile = await this.chain.getProfile(wallet, true).catch(() => null);
    conn.send({ t: 'authed', pubkey: wallet, token: this.auth.issueToken(wallet), profile: profileSummary(conn.profile) });
  }

  private async onJoin(conn: Conn, msg: Record<string, unknown>): Promise<void> {
    if (conn.joining) return;
    // every room entry (practice, private, arena ticket) is gated before anything else is looked at
    if (this.gameClosed(conn)) return;
    const target = typeof msg.room === 'string' ? parseJoinTarget(msg.room) : null;
    if (!target) {
      this.error(conn, 'bad_request', 'Unknown room');
      return;
    }
    conn.joining = true;
    try {
      const skin = Number.isInteger(msg.skin) && (msg.skin as number) >= 0 && (msg.skin as number) < SKIN_COUNT ? (msg.skin as number) : 0;
      if (conn.wallet) conn.profile = await this.chain.getProfile(conn.wallet).catch(() => conn.profile);
      // only the basic skins can be picked
      if (!isBasicSkin(skin)) {
        this.error(conn, 'skin_locked', 'That skin is locked.');
        return;
      }
      let name = sanitizeName(msg.name);
      let flags = 0;
      if (conn.profile) {
        name = sanitizeName(conn.profile.name, name);
        flags |= PlayerFlag.Verified;
      }

      if (target.mode === 'practice') {
        if (conn.player?.alive && conn.room?.opts.mode === 'practice') return; // already playing
        const room = this.rooms.practiceRoom(this.rooms.leagueFor(conn), conn.room);
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
      if (this.chain.enabled && !this.chain.tokenReady) {
        // initialized without a mint: arenas open once `set-token` runs (picked up without a restart)
        this.error(conn, 'token_not_set', 'Arenas are opening soon: the game token is not set yet. Practice is open.');
        return;
      }
      if (!this.chain.stakeEnabled) {
        this.error(conn, 'arenas_disabled', 'High-stakes arenas are offline.');
        return;
      }
      if (!conn.wallet) {
        this.error(conn, 'auth_required', 'Connect and sign in with your wallet first.');
        return;
      }
      let room = await this.rooms.arenaRoom(target.arenaId);
      if (!room) {
        this.error(conn, 'room_not_found', 'Arena not available.');
        return;
      }
      // a ticket lives in exactly one instance of its arena
      const existing = this.rooms.findArenaStake(target.arenaId, conn.wallet);
      if (existing) {
        if (conn.player === null && existing.room.reattach(conn, existing.entry.pid)) return;
        // `reattach` rings a due bell first: the ticket may have been settled at that bell just now
        if (!this.rooms.findArenaStake(target.arenaId, conn.wallet) && this.rooms.bellSettled(target.arenaId, conn.wallet)) {
          this.roundEnded(conn);
          return;
        }
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      // a player back after a bell that settled their ticket while they were away (AFK)
      const bell = this.rooms.bellSettled(target.arenaId, conn.wallet);
      if (bell) {
        const settling = this.journal.pending.some((p) => p.key === bell.session);
        // undefined: the chain could not be read (or this connection is rate-limited); the normal path below decides then
        const live = settling ? null : conn.allowChainOp() ? await this.chain.getSession(target.arenaId, conn.wallet).catch(() => undefined) : undefined;
        if (settling || live === null || (live && live.id === bell.sessionId && !live.finalized)) {
          this.roundEnded(conn);
          return;
        }
        // a newer ticket (or a payout waiting to be collected): the usual checks apply. When the chain
        // could not be read (`live` undefined) the memo stays, so a later retry still hears round_ended.
        if (live !== undefined) this.rooms.forgetBellSettled(target.arenaId, conn.wallet);
      }
      // a new join (not the AFK return above): only while the round's joins are open
      if (this.roundClosed(conn)) return;
      if (!conn.allowChainOp()) {
        this.error(conn, 'rate_limited', 'Too many join attempts — wait a moment.');
        return;
      }
      const session = await this.chain.getSession(target.arenaId, conn.wallet);
      if (!session) {
        this.error(conn, 'no_session', 'No open arena ticket found for your wallet.');
        return;
      }
      if (session.finalized) {
        // R24: this game is over (settled without a token account); the payout waits for the player
        this.error(conn, 'payout_waiting', 'Your last game in this arena is settled. Collect your payout first.');
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
      // the instance may have filled up or been closed during the awaits above: pick again (arena data is cached)
      room = await this.rooms.confirmArenaRoom(target.arenaId, room);
      if (!room) {
        this.error(conn, 'room_full', 'Arena is full — try again in a moment.');
        return;
      }
      // re-check after the awaits above: another tab may have joined with the same ticket meanwhile (in any instance)
      if (this.rooms.findArenaStake(target.arenaId, conn.wallet) || this.rooms.liveSessions().has(session.address)) {
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      // I1: a settlement (e.g. a stale refund) may have been queued for this session during the awaits
      if (this.journal.pending.some((p) => p.key === session.address)) {
        this.error(conn, 'no_session', 'Your previous game in this arena is still being settled.');
        return;
      }
      // the awaits above may have crossed into the closed window
      if (this.roundClosed(conn)) return;
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
          entryFee: session.entryFee,
          value: session.entryFee,
          openedAt: session.openedAt,
        },
      });
    } finally {
      conn.joining = false;
    }
  }
}

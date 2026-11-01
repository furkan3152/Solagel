import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  PROTOCOL_VERSION,
  PlayerFlag,
  SKIN_COUNT,
  EMBLEM_SKIN_ID,
  clamp,
  decodeClientInput,
  isBasicSkin,
  isFingerprint,
  parseJoinTarget,
  sanitizeName,
  type ErrorCode,
  type ServerMessage,
} from '@elymum/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Auth } from '../auth';
import { ChainBusyError, type ChainGateway, type ChainSession, type SettledEvent } from '../chain/types';
import type { ServerConfig } from '../config';
import type { ProfileStore } from '../profiles';
import type { RoomManager } from '../rooms/manager';
import { MAX_STAKE_SESSION_AGE_S } from '../rooms/room';
import type { Journal } from '../stake/journal';
import { Conn } from './conn';

/**
 * How many reverse proxies in front of this server append to `X-Forwarded-For`: 0 unless `TRUST_PROXY=1`,
 * then `TRUST_PROXY_HOPS` (default 1).
 */
export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  if (env.TRUST_PROXY !== '1') return 0;
  const n = Math.floor(Number(env.TRUST_PROXY_HOPS ?? '1'));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : 1;
}

/**
 * The client's IP. Behind `hops` trusted proxies (true = 1) it is the `hops`-th `X-Forwarded-For` entry from
 * the RIGHT: the address the outermost trusted proxy saw. Entries to its left were written by the client
 * and are never trusted (a forged left-most value would otherwise pick any rate-limit key).
 */
export function clientIp(req: IncomingMessage, hops: number | boolean): string {
  const n = hops === true ? 1 : hops === false ? 0 : hops;
  if (n > 0) {
    const fwd = req.headers['x-forwarded-for'];
    const list = (Array.isArray(fwd) ? fwd.join(',') : (fwd ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const hop = list.length > 0 ? list[Math.max(0, list.length - n)] : undefined;
    if (hop) return hop;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * A paid join whose ticket read fails because the RPC is busy is retried after these delays (on top of
 * the RPC budget's own 429 retries); the player hears "network busy, retrying" once.
 */
export const JOIN_CHAIN_RETRY_MS = [2_000, 4_000, 8_000];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * The `settled` message for a settlement event: it names the session key (and arena) so a client
 * matches it to the ticket it paid out, and the settlement transaction (`txHash`).
 */
export function settledMessage(e: SettledEvent): Extract<ServerMessage, { t: 'settled' }> {
  const kind = e.payout > 0 ? 'payout' : 'death';
  return {
    t: 'settled',
    kind,
    session: e.key,
    ...(e.arenaId === undefined ? {} : { arenaId: e.arenaId }),
    txHash: e.txHash,
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
  private gameGate: ((wallet: string | null, fresh?: boolean) => boolean | Promise<boolean>) | null = null;
  /** Server profiles (names, skins, XP); null: none (bare unit tests). */
  private profiles: ProfileStore | null = null;
  /** Wallets the admin banned from arenas (integrity); null: nobody (bare unit tests). */
  private banGate: ((wallet: string) => boolean) | null = null;
  /** Whether a wallet holds an Elymum emblem (laurel flag, emblem skin); null: nobody does. */
  private holderCheck: ((wallet: string) => Promise<boolean>) | null = null;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly rooms: RoomManager,
    private readonly auth: Auth,
    private readonly chain: ChainGateway,
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly trustProxy: number | boolean = trustProxyHops(),
  ) {
    chain.onSettled((e) => {
      for (const conn of this.rooms.connsByWallet(e.player)) {
        conn.send(settledMessage(e));
      }
    });
    // the token was set (or another status change clients must see): push the new chain status
    chain.onStatusChange(() => this.broadcastChain());
  }

  /** Sets who may enter rooms (the site's game gate: admins, NFT holders, or everyone). */
  setGameGate(gate: ((wallet: string | null, fresh?: boolean) => boolean | Promise<boolean>) | null): void {
    this.gameGate = gate;
  }

  /** Sets the profile store the sign-in and joins read names from. */
  setProfiles(profiles: ProfileStore | null): void {
    this.profiles = profiles;
  }

  /** Sets the emblem holder check (cached by the mint service): holders wear a laurel and may pick the emblem skin. */
  setHolderCheck(check: ((wallet: string) => Promise<boolean>) | null): void {
    this.holderCheck = check;
  }

  /** Sets who is banned from arena joins (the integrity ban list). Practice is never gated by it. */
  setBanGate(gate: ((wallet: string) => boolean) | null): void {
    this.banGate = gate;
  }

  /**
   * Refuses (`game_closed`) a room entry the game gate does not allow for this session. `fresh`: the
   * holder check bypasses its cache (each arena seat, i.e. every new ticket and round, re-checks it).
   */
  private async gameClosed(conn: Conn, fresh = false): Promise<boolean> {
    if (!this.gameGate) return false;
    const open = await Promise.resolve(this.gameGate(conn.wallet, fresh)).catch(() => false);
    if (open) return false;
    this.error(conn, 'game_closed', conn.wallet ? 'The game is not open to this wallet yet.' : 'The game is not open yet. Sign in with your wallet if you hold an Elymum NFT.');
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
          this.error(conn, 'version_mismatch', 'A new version of Elymum is available. Please refresh.');
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
        if (await this.gameClosed(conn)) return;
        // an arena instance not (or no longer) open here resolves to its arena's first instance
        const room =
          typeof msg.room === 'string' ? await this.rooms.spectateRoom(msg.room) : (conn.room ?? this.rooms.lobbyRoom());
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
    else if (typeof msg.address === 'string' && typeof msg.message === 'string' && typeof msg.signature === 'string') {
      wallet = await this.auth.verifySignature(msg.address, msg.message, msg.signature);
    }
    if (!wallet) {
      this.error(conn, 'auth_failed', 'Wallet sign-in failed. Please sign again.');
      return;
    }
    conn.wallet = wallet;
    conn.profile = this.profiles?.summary(wallet) ?? null;
    conn.send({ t: 'authed', address: wallet, token: this.auth.issueToken(wallet), profile: conn.profile });
  }

  private async onJoin(conn: Conn, msg: Record<string, unknown>): Promise<void> {
    if (conn.joining) return;
    // every room entry (practice, private, arena ticket) is gated before anything else is looked at
    conn.joining = true;
    try {
      if (await this.gameClosed(conn)) return;
    } finally {
      conn.joining = false;
    }
    const target = typeof msg.room === 'string' ? parseJoinTarget(msg.room) : null;
    if (!target) {
      this.error(conn, 'bad_request', 'Unknown room');
      return;
    }
    conn.joining = true;
    // integrity evidence only: kept when well-formed, never trusted as an identity
    conn.fp = isFingerprint(msg.fp) ? msg.fp : null;
    try {
      const wantsEmblem = msg.skin === EMBLEM_SKIN_ID;
      const skin = wantsEmblem ? EMBLEM_SKIN_ID : Number.isInteger(msg.skin) && (msg.skin as number) >= 0 && (msg.skin as number) < SKIN_COUNT ? (msg.skin as number) : 0;
      if (conn.wallet) conn.profile = this.profiles?.summary(conn.wallet) ?? null;
      const holder = conn.wallet && this.holderCheck ? await this.holderCheck(conn.wallet).catch(() => false) : false;
      // only the basic skins can be picked, and the emblem skin by emblem holders
      if (wantsEmblem ? !holder : !isBasicSkin(skin)) {
        this.error(conn, 'skin_locked', wantsEmblem ? 'The emblem skin is for Elymum emblem holders.' : 'That skin is locked.');
        return;
      }
      let name = sanitizeName(msg.name);
      let flags = holder ? PlayerFlag.Holder : 0;
      if (conn.profile) {
        name = sanitizeName(conn.profile.name, name);
        flags |= PlayerFlag.Verified;
      }
      // the signed-in wallet's own profile picture, when it asked to wear it (guests and bots never have one)
      const avatar = msg.pic === true && conn.wallet ? (this.profiles?.avatar(conn.wallet) ?? null) : null;

      if (target.mode === 'practice') {
        if (conn.player?.alive && conn.room?.opts.mode === 'practice') return; // already playing
        const room = this.rooms.practiceRoom(this.rooms.leagueFor(conn), conn.room);
        if (conn.player?.alive) conn.room?.leave(conn, 'switch');
        room.join(conn, { name, skin, flags, avatar });
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
        room.join(conn, { name, skin, flags, avatar });
        return;
      }

      // stake arena
      if (this.chain.enabled && !this.chain.tokenReady) {
        // no arena registered or the token not set yet: arenas open once it is (picked up without a restart)
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
      // banned wallets cannot start new arena games (a live ticket can still be resumed below: it is their money)
      const banned = this.banGate?.(conn.wallet) === true;
      if (banned && !this.rooms.findArenaStake(target.arenaId, conn.wallet)) {
        this.error(conn, 'banned', 'This wallet is banned from paid arenas after an integrity review. Practice is open.');
        return;
      }
      try {
        await this.joinArena(conn, target.arenaId, { name, skin, flags, avatar });
      } catch (err) {
        if (!(err instanceof ChainBusyError)) throw err;
        // the RPC refused us even after the retries: the ticket is untouched on chain, the player tries again
        this.log(`join: arena #${target.arenaId} for ${conn.wallet} — ${err.message}`);
        this.error(conn, 'chain_busy', 'The network is busy. Your ticket is safe on chain: press Resume again in a moment.');
      }
    } finally {
      conn.joining = false;
    }
  }

  /**
   * The ticket read of a paid join: on `ChainBusyError` (RPC rate-limited) it is retried after
   * `JOIN_CHAIN_RETRY_MS`, and the player is told once that the network is busy. Throws
   * `ChainBusyError` when every try failed (or the connection closed meanwhile).
   */
  private async sessionWithRetry(conn: Conn, arenaId: number, wallet: string): Promise<ChainSession | null> {
    let told = false;
    for (let i = 0; ; i++) {
      try {
        return await this.chain.getSession(arenaId, wallet);
      } catch (err) {
        if (!(err instanceof ChainBusyError) || i >= JOIN_CHAIN_RETRY_MS.length || conn.ws.readyState > 1) throw err;
        if (!told) {
          told = true;
          this.error(conn, 'chain_busy', 'The network is busy, retrying your ticket…');
        }
        await sleep(JOIN_CHAIN_RETRY_MS[i]);
      }
    }
  }

  /** The arena part of a join (the caller checked the wallet, the gate and the ban). Throws `ChainBusyError`. */
  private async joinArena(conn: Conn, arenaId: number, look: { name: string; skin: number; flags: number; avatar: string | null }): Promise<void> {
    if (!conn.wallet) return;
    const wallet = conn.wallet;
    const target = { arenaId };
    const { name, skin, flags, avatar } = look;
    {
      // a live ticket comes back first, with no chain read at all: its coin is in this process already
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
      let room = await this.rooms.arenaRoom(target.arenaId);
      if (!room) {
        this.error(conn, 'room_not_found', 'Arena not available.');
        return;
      }
      if (!conn.wallet) return; // signed out during the await
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
      const session = await this.sessionWithRetry(conn, target.arenaId, conn.wallet);
      if (!conn.wallet || conn.wallet !== wallet) return; // signed out (or in as another wallet) during the retries
      if (!session) {
        this.error(conn, 'no_session', 'No open arena ticket found for your wallet.');
        return;
      }
      if (session.finalized) {
        // this game is over (settled, but the transfer to the player failed); the payout waits for the player
        this.error(conn, 'payout_waiting', 'Your last game in this arena is settled. Collect your payout first.');
        return;
      }
      if (this.journal.pending.some((p) => p.key === session.key)) {
        this.error(conn, 'no_session', 'Your previous game in this arena is still being settled.');
        return;
      }
      if (Date.now() / 1000 - session.openedAt > MAX_STAKE_SESSION_AGE_S - 600) {
        this.error(conn, 'no_session', 'This arena ticket expired and will be refunded.');
        return;
      }
      // holders gate: re-checked uncached right before every arena seat (each round needs a new ticket and
      // join), so an NFT sold since the sign-in no longer seats its former holder
      if (await this.gameClosed(conn, true)) return;
      // the instance may have filled up or been closed during the awaits above: pick again (arena data is cached)
      room = await this.rooms.confirmArenaRoom(target.arenaId, room);
      if (!room) {
        this.error(conn, 'room_full', 'Arena is full — try again in a moment.');
        return;
      }
      // re-check after the awaits above: another tab may have joined with the same ticket meanwhile (in any instance)
      if (this.rooms.findArenaStake(target.arenaId, conn.wallet) || this.rooms.liveSessions().has(session.key)) {
        this.error(conn, 'session_busy', 'You are already playing in this arena.');
        return;
      }
      // a settlement (e.g. a stale refund) may have been queued for this session during the awaits
      if (this.journal.pending.some((p) => p.key === session.key)) {
        this.error(conn, 'no_session', 'Your previous game in this arena is still being settled.');
        return;
      }
      // the awaits above may have crossed into the closed window
      if (this.roundClosed(conn)) return;
      // a new arena game (not a resumed ticket): refused for a banned wallet (the ban may be new since the check above)
      if (this.banGate?.(conn.wallet) === true) {
        this.error(conn, 'banned', 'This wallet is banned from paid arenas after an integrity review. Practice is open.');
        return;
      }
      if (conn.player?.alive) conn.room?.leave(conn, 'switch');
      room.join(conn, {
        name,
        skin,
        avatar,
        flags: flags | PlayerFlag.Staker,
        stake: {
          player: conn.wallet,
          session: session.key,
          sessionId: session.id,
          arenaId: target.arenaId,
          entryFee: session.entryFee,
          value: session.entryFee,
          openedAt: session.openedAt,
        },
      });
    }
  }
}

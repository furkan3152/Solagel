import {
  BinaryWriter,
  ClientOp,
  EMOTES,
  PlayerFlag,
  RULES,
  clamp,
  VIEW,
  WORLD_PRESETS,
  sanitizeChat,
  viewSize,
  writeSnapshot,
  xpForGame,
  type ClientInput,
  type DeathStats,
  type LbEntry,
  type League,
  type RoomInfo,
  type RoomMode,
  type RoundInfo,
  type RoundStanding,
  type ServerMessage,
} from '@slana/shared';
import type { BotManagerOptions } from '../bots/manager';
import { BotManager } from '../bots/manager';
import type { ChainGateway } from '../chain/types';
import { looksLikeScam, maskProfanity } from '../chat-filter';
import type { Player } from '../game/entities';
import { mulberry32 } from '../game/rng';
import { World, type CellEatenEvent } from '../game/world';
import type { Leaderboards } from '../leaderboards';
import type { Conn } from '../net/conn';
import { sweepKey, type Journal, type JournalItem, type LiveStake, type SettleReason, type SettlementItem } from '../stake/journal';
import { ArenaLedger, type ArenaEntry } from '../stake/ledger';
import { RoundClock } from './round-clock';

/** Stake players are force-cashed-out long before the on-chain 24 h refund window opens. */
export const MAX_STAKE_SESSION_AGE_S = 6 * 3600;
/** While live values or loot changed, the journal is rewritten at most this often. */
const JOURNAL_SNAPSHOT_MS = 1000;
const SLEEP_AFTER_MS = 60_000;
const CHAT_HISTORY = 20;

export interface RoomDeps {
  chain: ChainGateway;
  journal: Journal;
  leaderboards: Leaderboards;
  log: (msg: string) => void;
  /** Slana Pass power (defaults to `RULES.passStartMassMul` / `RULES.passCashoutMs`). */
  pass?: { startMassMul: number; cashoutMs: number };
  /** Wall clock (Unix ms) the arena rounds run on; defaults to `Date.now`. Tests inject their own. */
  now?: () => number;
  /** Arena round clock (defaults to `RULES.roundMs` / `RULES.roundJoinCloseMs`). */
  round?: { roundMs: number; closeMs: number };
  /**
   * The shared round clock (the room manager passes its own, so the gateway and every room
   * agree on the round). Without it the room builds one from `now` and `round`.
   */
  clock?: RoundClock;
  /** A human's game ended (death, leave, round end or operator exit). */
  onGameOver?: (e: { room: Room; conn: Conn | null; player: Player; stats: DeathStats }) => void;
  /**
   * The bell settled the ticket of a staker who was away (AFK, not connected). When they come
   * back the gateway tells them the round ended (`round_ended`) instead of "already playing".
   */
  onBellSettled?: (e: BellSettled) => void;
}

/** An AFK staker's ticket settled at a round's bell (see `RoomDeps.onBellSettled`). */
export interface BellSettled {
  arenaId: number;
  wallet: string;
  /** Session PDA (the settlement's journal key). */
  session: string;
  /** On-chain session id (PDAs are reused by later tickets; the id is not). */
  sessionId: number;
  round: number;
}

/** What a joining player brings besides name and skin. */
export interface JoinOptions {
  name: string;
  skin: number;
  flags: number;
  /** Arena ticket; `stake.hasPass` turns on Pass power in arenas. */
  stake?: Omit<ArenaEntry, 'pid'>;
  /** Verified Slana Pass number the player wears (0 / absent = none). In practice it also turns on Pass power; private rooms ignore it. */
  pass?: number;
  /** Practice: a verified Pass is equipped (Pass power) even when its number is unknown. Private rooms ignore it. */
  hasPass?: boolean;
}

export interface RoomOptions {
  id: string;
  mode: RoomMode;
  name: string;
  maxPlayers: number;
  code?: string;
  /** Practice rooms: the league this room serves. */
  league?: League;
  /** Arena rooms: instance (shard) number within the arena, from 1. */
  instance?: number;
  bots: BotManagerOptions | null;
  stake?: { arenaId: number; buyIn: number; requiresPass?: boolean };
  seed?: number;
}

interface ChatLine {
  pid: number;
  from: string;
  skin: number;
  text: string;
  system?: boolean;
}

type FinishCause = 'death' | 'left' | 'round' | 'maxage' | 'kicked';

export class Room {
  readonly world: World;
  readonly bots: BotManager | null;
  readonly ledger: ArenaLedger | null;
  readonly conns = new Set<Conn>();
  /** Living human players → their connection (null while AFK in a stake room). */
  readonly humans = new Map<number, Conn | null>();
  private readonly afkSince = new Map<number, number>();
  /** Arena rooms: value each staker lost this game (`valueLost` / `lootSpilled` in the death stats). */
  private readonly losses = new Map<number, { lost: number; spilled: number }>();
  private readonly walletOf = new Map<number, string>();
  private readonly chatLog: ChatLine[] = [];
  private readonly writer = new BinaryWriter(32 * 1024);
  private lastLbAt = 0;
  private lastJournalAt = 0;
  /** Arena rooms: live values or loot changed since the last journal write. */
  private journalDirty = false;
  private lastAgeCheckAt = 0;
  /** Arena rooms: the round this room is playing (its end triggers `endRound`). */
  private roundN = 0;
  private roundEndsAt = Infinity;
  private readonly clock: RoundClock;
  lastActivity = Date.now();

  constructor(
    readonly opts: RoomOptions,
    private readonly deps: RoomDeps,
  ) {
    const preset = WORLD_PRESETS[opts.mode];
    const seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
    this.world = new World({ ...preset, powerUps: true, coinRain: opts.mode !== 'arena', seed });
    this.bots = opts.bots ? new BotManager(this.world, opts.bots, mulberry32(seed ^ 0xb07)) : null;
    this.ledger = opts.mode === 'arena' ? new ArenaLedger() : null;
    this.clock = deps.clock ?? new RoundClock(deps.now, deps.round);
    // loot left on any of this arena's instances when the server last stopped: the first instance adopts it all
    if (this.ledger && opts.stake && (opts.instance ?? 1) === 1) this.world.restoreLoot(deps.journal.adoptLoot(opts.stake.arenaId, this.id));
    if (this.ledger) {
      const r = this.clock.window();
      this.roundN = r.n;
      this.roundEndsAt = r.endsAt;
    }
  }

  /** The wall clock rounds run on (Unix ms). */
  now(): number {
    return this.clock.now();
  }

  /** Arena rooms: the round in play now (undefined elsewhere). */
  round(now = this.now()): RoundInfo | undefined {
    if (!this.ledger) return undefined;
    const r = this.clock.window(now);
    return { n: r.n, endsAt: r.endsAt, joinsCloseAt: r.joinsCloseAt };
  }

  /**
   * Arena rooms: rings the bell of the round in play when the clock has passed its end. Runs at
   * the start of every tick and before a player is added (`join`, `reattach`), so a player
   * joining right as a round opens never lands in the round that is ending.
   */
  syncRound(now = this.now()): void {
    if (!this.ledger || now < this.roundEndsAt) return;
    const ended = this.roundN;
    const r = this.clock.window(now);
    this.roundN = r.n;
    this.roundEndsAt = r.endsAt;
    this.endRound(ended);
  }

  get id(): string {
    return this.opts.id;
  }

  info(): RoomInfo {
    return {
      id: this.opts.id,
      mode: this.opts.mode,
      name: this.opts.name,
      width: this.world.cfg.width,
      height: this.world.cfg.height,
      players: this.humans.size,
      bots: this.bots?.bots.size ?? 0,
      maxPlayers: this.opts.maxPlayers,
      league: this.opts.league,
      arenaId: this.opts.stake?.arenaId,
      entryFee: this.opts.stake?.buyIn,
      requiresPass: this.opts.stake ? (this.opts.stake.requiresPass ?? false) : undefined,
      instance: this.opts.stake ? (this.opts.instance ?? 1) : undefined,
      loot: this.ledger ? this.lootValue() : undefined,
      code: this.opts.code,
      round: this.round(),
    };
  }

  /** Σ value of the loot lying on this room's floor. */
  lootValue(): number {
    let sum = 0;
    for (const l of this.world.loot()) sum += l.value;
    return sum;
  }

  private get passPower(): { startMassMul: number; cashoutMs: number } {
    return this.deps.pass ?? { startMassMul: RULES.passStartMassMul, cashoutMs: RULES.passCashoutMs };
  }

  get isFull(): boolean {
    return this.humans.size >= this.opts.maxPlayers;
  }

  /** Stake sessions currently represented in this room. */
  liveSessions(): string[] {
    return this.ledger ? this.ledger.all().map((e) => e.session) : [];
  }

  findStakeByWallet(wallet: string): ArenaEntry | undefined {
    return this.ledger?.all().find((e) => e.player === wallet);
  }

  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const c of this.conns) if (c.open) c.ws.send(json);
  }

  private attach(conn: Conn): void {
    if (conn.room !== this) {
      conn.room?.detach(conn);
      conn.view.reset();
      conn.room = this;
      this.conns.add(conn);
    }
    this.lastActivity = Date.now();
  }

  /** Removes a connection from this room without touching its player. */
  detach(conn: Conn): void {
    this.conns.delete(conn);
    if (conn.room === this) conn.room = null;
    conn.view.reset();
  }

  /* ---------------------------------------------------------------- */
  /* Joining / leaving                                                */
  /* ---------------------------------------------------------------- */

  join(conn: Conn, opts: JoinOptions): Player {
    this.syncRound();
    this.attach(conn);
    // private rooms ignore the Pass entirely
    const practice = this.opts.mode === 'practice';
    const passOk = !!this.ledger || practice;
    const pass = passOk && Number.isInteger(opts.pass) && (opts.pass ?? 0) > 0 && (opts.pass ?? 0) <= 0xffff ? opts.pass! : 0;
    // Pass power: arenas take it from the ticket, practice from a verified Pass
    const hasPass = this.ledger ? (opts.stake?.hasPass ?? false) : practice && (pass > 0 || opts.hasPass === true);
    const flags = hasPass || pass > 0 ? opts.flags | PlayerFlag.Pass : opts.flags & ~PlayerFlag.Pass;
    const mass = hasPass ? RULES.startMass * this.passPower.startMassMul : RULES.startMass;
    const player = this.world.addPlayer({ name: opts.name, skin: opts.skin, flags, mass });
    player.pass = pass;
    player.hasPass = hasPass;
    this.humans.set(player.id, conn);
    conn.player = player;
    conn.spectating = false;
    conn.spectatePid = null;
    conn.lastName = opts.name;
    conn.lastSkin = opts.skin;
    if (conn.wallet) this.walletOf.set(player.id, conn.wallet);
    if (this.ledger && opts.stake) {
      this.ledger.join({ ...opts.stake, pid: player.id });
      this.commitJournal();
    }
    conn.send({
      t: 'joined',
      room: this.info(),
      playerId: player.id,
      name: player.name,
      skin: player.skin,
      value: this.ledger?.value(player.id),
      // the ticket's own price (the arena's may have changed since it was bought)
      entryFee: this.ledger ? (this.ledger.get(player.id)?.entryFee ?? this.entryFee) : undefined,
      hasPass: hasPass || undefined,
      session: this.ledger?.get(player.id)?.session,
      round: this.round(),
    });
    conn.send({ t: 'history', chat: this.chatLog });
    return player;
  }

  /** A stake player reconnected: give them their AFK cells back. */
  reattach(conn: Conn, pid: number): boolean {
    this.syncRound();
    const p = this.world.players.get(pid);
    if (!p || !p.alive || !this.humans.has(pid) || this.humans.get(pid)) return false;
    this.attach(conn);
    this.humans.set(pid, conn);
    this.afkSince.delete(pid);
    p.afk = false;
    conn.player = p;
    conn.spectating = false;
    conn.lastName = p.name;
    conn.lastSkin = p.skin;
    conn.send({
      t: 'joined',
      room: this.info(),
      playerId: p.id,
      name: p.name,
      skin: p.skin,
      value: this.ledger?.value(pid),
      entryFee: this.ledger ? (this.ledger.get(pid)?.entryFee ?? this.entryFee) : undefined,
      hasPass: p.hasPass || undefined,
      session: this.ledger?.get(pid)?.session,
      round: this.round(),
    });
    conn.send({ t: 'history', chat: this.chatLog });
    return true;
  }

  spectate(conn: Conn, next = false): void {
    this.attach(conn);
    if (conn.player?.alive) return;
    conn.spectating = true;
    const ranking = this.world.ranking();
    if (ranking.length === 0) conn.spectatePid = null;
    else if (next && conn.spectatePid !== null) {
      const i = ranking.findIndex((p) => p.id === conn.spectatePid);
      conn.spectatePid = ranking[(i + 1) % ranking.length].id;
    } else conn.spectatePid = ranking[0].id;
    conn.send({ t: 'spectating', room: this.info(), targetPid: conn.spectatePid });
  }

  /**
   * The connection leaves the game. Free rooms remove the player at once;
   * stake rooms leave the cells in the arena (AFK) until they are eaten or the round ends.
   */
  leave(conn: Conn, reason: 'left' | 'disconnect' | 'switch'): void {
    const p = conn.player;
    if (p && p.alive && this.humans.get(p.id) === conn) {
      if (this.ledger) this.goAfk(p);
      else this.finishHuman(p, null, 'left');
    }
    conn.player = null;
    if (reason !== 'left') this.detach(conn);
    else conn.spectating = false;
  }

  private goAfk(p: Player): void {
    this.humans.set(p.id, null);
    p.afk = true;
    this.afkSince.set(p.id, this.world.now);
    const c = p.center();
    this.world.setTarget(p.id, c.x, c.y);
  }

  /* ---------------------------------------------------------------- */
  /* Player actions                                                   */
  /* ---------------------------------------------------------------- */

  input(conn: Conn, input: ClientInput): void {
    const p = conn.player;
    if (!p || !p.alive || p.afk) return;
    switch (input.op) {
      case ClientOp.Target:
        this.world.setTarget(p.id, input.x, input.y);
        break;
      case ClientOp.Split:
        this.world.queueSplit(p.id);
        break;
      case ClientOp.Eject:
        this.world.queueEject(p.id);
        break;
    }
  }

  chat(conn: Conn, raw: unknown): void {
    const now = Date.now();
    const from = conn.player?.name ?? conn.lastName;
    if (!from) return;
    if (now - conn.lastChatAt < 1200) {
      conn.send({ t: 'error', code: 'rate_limited', message: 'Slow down.' });
      return;
    }
    let text = sanitizeChat(raw);
    if (!text) return;
    if (looksLikeScam(text)) {
      conn.send({ t: 'error', code: 'bad_request', message: 'Links and wallet talk are not allowed in chat.' });
      return;
    }
    text = maskProfanity(text);
    conn.lastChatAt = now;
    const line: ChatLine = { pid: conn.player?.id ?? 0, from, skin: conn.player?.skin ?? conn.lastSkin, text };
    this.pushChat(line);
  }

  private pushChat(line: ChatLine): void {
    this.chatLog.push(line);
    if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift();
    this.broadcast({ t: 'chat', ...line });
  }

  emote(conn: Conn, id: unknown): void {
    const p = conn.player;
    const now = Date.now();
    if (!p || !p.alive || typeof id !== 'number' || !EMOTES[id] || now - conn.lastEmoteAt < 900) return;
    conn.lastEmoteAt = now;
    this.broadcast({ t: 'emote', pid: p.id, id });
  }

  /** Paid arenas have no cash-out: everyone alive is paid at the round end. Other rooms have nothing to cash out. */
  cashout(conn: Conn): void {
    if (!this.ledger) return;
    conn.send({ t: 'error', code: 'no_cashout', message: 'No cash-out in paid arenas: stay alive and you are paid your value when the round ends.' });
  }

  /* ---------------------------------------------------------------- */
  /* Game over for a human                                            */
  /* ---------------------------------------------------------------- */

  private statsFor(p: Player, alive: boolean): DeathStats {
    const aliveMs = this.world.now - p.stats.joinedAt;
    return {
      aliveMs,
      finalMass: alive ? Math.floor(p.totalMass()) : 0,
      maxMass: Math.floor(p.stats.maxMass),
      foodEaten: p.stats.foodEaten,
      cellsEaten: p.stats.cellsEaten,
      playersEaten: p.stats.playersEaten,
      bestRank: Number.isFinite(p.stats.bestRank) ? p.stats.bestRank : 0,
      xp: xpForGame(p.stats.maxMass, p.stats.playersEaten, aliveMs),
    };
  }

  liveStakes(): LiveStake[] {
    if (!this.ledger) return [];
    return this.ledger.all().map((e) => {
      const p = this.world.players.get(e.pid);
      return {
        roomId: this.id,
        session: e.session,
        sessionId: e.sessionId,
        player: e.player,
        arenaId: e.arenaId,
        value: e.value,
        score: Math.floor(p?.stats.maxMass ?? 0),
        kills: p?.stats.playersEaten ?? 0,
        hasPass: e.hasPass,
      };
    });
  }

  /** Arena entry fee in raw token units (0 outside arenas). */
  get entryFee(): number {
    return this.opts.stake?.buyIn ?? 0;
  }

  /**
   * Arena rooms: writes live values and loot (plus any settlements) in one
   * atomic journal write, so Σ live + Σ loot + Σ pending never changes on disk
   * except by settlements being confirmed.
   */
  private commitJournal(enqueue?: JournalItem[]): void {
    if (!this.ledger) {
      if (enqueue && enqueue.length > 0) this.deps.journal.commit({ enqueue });
      return;
    }
    const loot = this.opts.stake
      ? { roomId: this.id, arenaId: this.opts.stake.arenaId, items: this.world.loot().map((l) => ({ x: l.x, y: l.y, value: l.value })) }
      : undefined;
    this.deps.journal.commit({ enqueue, roomId: this.id, live: this.liveStakes(), loot });
    this.journalDirty = false;
    this.lastJournalAt = Date.now();
  }

  private sendValue(pid: number, delta: number, reason: 'eat' | 'loot' | 'eaten' | 'spill'): void {
    if (delta === 0 || !this.ledger) return;
    this.humans.get(pid)?.send({ t: 'value', value: this.ledger.value(pid), delta, reason });
  }

  /**
   * Arena value rules for one eaten cell:
   * - staker eats staker → proportional transfer;
   * - a bot (or anyone without value) eats a staker → the same share spills as loot;
   * - the victim is a bot → nothing (bots carry no value).
   */
  private onCellEaten(ce: CellEatenEvent): void {
    const ledger = this.ledger;
    if (!ledger || !ledger.has(ce.victim.id)) return;
    this.journalDirty = true;
    if (ledger.has(ce.eater.id)) {
      const t = ledger.transfer(ce.victim.id, ce.eater.id, ce.mass, ce.victimTotalBefore, ce.last);
      this.noteLoss(ce.victim.id, t, 0);
      this.sendValue(ce.eater.id, t, 'eat');
      this.sendValue(ce.victim.id, -t, 'eaten');
      return;
    }
    const t = ledger.spill(ce.victim.id, ce.mass, ce.victimTotalBefore, ce.last);
    if (t <= 0) return;
    this.noteLoss(ce.victim.id, t, t);
    const pieces = clamp(Math.ceil(t / (this.entryFee * RULES.lootPieceEntryFraction)), RULES.lootPiecesMin, RULES.lootPiecesMax);
    this.world.spawnLoot(ce.x, ce.y, t, pieces);
    this.sendValue(ce.victim.id, -t, 'spill');
  }

  /** Value a staker lost this game (to eaters, and the part spilled as loot): reported on the death sheet. */
  private noteLoss(pid: number, lost: number, spilled: number): void {
    if (lost <= 0) return;
    const l = this.losses.get(pid) ?? { lost: 0, spilled: 0 };
    l.lost += lost;
    l.spilled += spilled;
    this.losses.set(pid, l);
  }

  /** Arena rooms: credits picked-up loot (put back on the floor if nobody can hold it). */
  private onLootPicked(pid: number, value: number): void {
    if (!this.ledger) return;
    this.journalDirty = true;
    if (this.ledger.credit(pid, value)) {
      this.sendValue(pid, value, 'loot');
      return;
    }
    const p = this.world.players.get(pid);
    const c = p?.center() ?? { x: this.world.cfg.width / 2, y: this.world.cfg.height / 2 };
    this.world.restoreLoot([{ x: c.x, y: c.y, value }]);
  }

  /**
   * Ends a human's game. With `batch`, the settlement is appended to it and nothing is written
   * (the caller commits the whole batch in one journal write) and no message is sent.
   */
  private finishHuman(p: Player, conn: Conn | null, cause: FinishCause, killer: Player | null = null, batch?: JournalItem[]): DeathStats {
    const stillAlive = cause !== 'death';
    const stats = this.statsFor(p, stillAlive);
    const wallet = this.walletOf.get(p.id) ?? null;
    const now = Date.now();
    const score = stats.maxMass;

    this.deps.leaderboards.submit({ name: p.name, score, skin: p.skin, wallet, kills: stats.playersEaten, at: now });

    const enqueue: SettlementItem[] = [];
    const loss = this.losses.get(p.id);
    this.losses.delete(p.id);
    if (this.ledger?.has(p.id)) {
      const entry = this.ledger.leave(p.id)!;
      stats.payout = entry.value;
      if (cause === 'death') {
        // the death sheet's "value lost" / "spilled as loot" lines (DeathStats)
        stats.valueLost = loss?.lost ?? 0;
        stats.lootSpilled = loss?.spilled ?? 0;
        stats.byBot = !!killer && this.bots?.isBot(killer.id) === true;
      }
      // arena humans never `leave` (they go AFK); an operator exit settles at value like a kick
      const reason: SettleReason = cause === 'left' ? 'kicked' : cause;
      enqueue.push({
        kind: 'settle',
        key: entry.session,
        player: entry.player,
        arenaId: entry.arenaId,
        session: entry.session,
        sessionId: entry.sessionId,
        payout: entry.value,
        score,
        kills: stats.playersEaten,
        xp: stats.xp ?? 0,
        reason,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    if (batch) batch.push(...enqueue);
    else if (enqueue.length > 0 || this.ledger) {
      this.commitJournal(enqueue);
      if (enqueue.length > 0) this.deps.chain.kick();
    }

    const c = conn ?? this.humans.get(p.id) ?? null;
    try {
      this.deps.onGameOver?.({ room: this, conn: c, player: p, stats });
    } catch (err) {
      this.deps.log(`room ${this.id}: game-over hook failed: ${(err as Error).message}`);
    }
    this.world.removePlayer(p.id);
    this.humans.delete(p.id);
    this.afkSince.delete(p.id);
    this.walletOf.delete(p.id);
    for (const other of this.conns) other.view.forgetPlayer(p.id);

    if (c) {
      if (c.player === p) c.player = null;
      c.lastCenter = p.center();
      if (batch) return stats;
      if (cause === 'death') c.send({ t: 'death', stats, killer: killer?.name ?? null, killerSkin: killer?.skin ?? null });
      else if (cause === 'maxage' || cause === 'kicked') c.send({ t: 'cashout', state: 'done', value: stats.payout, stats });
    }
    return stats;
  }

  /* ---------------------------------------------------------------- */
  /* Round end (arena rooms)                                          */
  /* ---------------------------------------------------------------- */

  /**
   * The bell, in one tick: every live staker (connected or AFK) is settled at their value
   * (reason `round`); the floor loot is collected and one `sweep` item for its value is queued
   * in the SAME journal write (Σ live + Σ loot + Σ pending is preserved); every settled human
   * gets `roundOver`; the world is reset for the next round while bots keep playing.
   */
  private endRound(round: number): void {
    const ledger = this.ledger!;
    // standings at the bell: stakers by value (ties: bigger mass first)
    const ranked = ledger
      .all()
      .map((e) => ({ e, p: this.world.players.get(e.pid) }))
      .sort((a, b) => b.e.value - a.e.value || (b.p?.totalMass() ?? 0) - (a.p?.totalMass() ?? 0));
    const top = ranked.slice(0, 10);

    const batch: JournalItem[] = [];
    const results: { conn: Conn; pid: number; payout: number; stats: DeathStats }[] = [];
    const away: BellSettled[] = [];
    for (const [pid, conn] of [...this.humans]) {
      const p = this.world.players.get(pid);
      if (!p?.alive) continue;
      const payout = ledger.value(pid);
      const c = conn ?? null;
      const entry = ledger.get(pid);
      const stats = this.finishHuman(p, c, 'round', null, batch);
      if (c) results.push({ conn: c, pid, payout, stats });
      else if (entry) away.push({ arenaId: entry.arenaId, wallet: entry.player, session: entry.session, sessionId: entry.sessionId, round });
    }

    const amount = this.world.takeLoot();
    const now = Date.now();
    if (amount > 0 && this.opts.stake) {
      // a key can repeat only if the wall clock stepped back across a round boundary while the
      // earlier sweep is still pending: never drop the loot, queue it under a distinct key
      let key = sweepKey(this.id, round);
      for (let k = 2; this.deps.journal.pending.some((p) => p.key === key); k++) key = `${sweepKey(this.id, round)}:${k}`;
      if (key !== sweepKey(this.id, round)) {
        this.deps.log(`!!! room ${this.id}: loot sweep for round ${round} is already pending (wall clock stepped back?); queuing ${amount} as ${key}`);
      }
      batch.push({
        kind: 'sweep',
        key,
        arenaId: this.opts.stake.arenaId,
        roomId: this.id,
        round,
        amount,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    this.commitJournal(batch);
    if (batch.length > 0) this.deps.chain.kick();
    for (const a of away) this.deps.onBellSettled?.(a);
    const settled = batch.filter((i) => i.kind === 'settle').length;
    if (settled > 0 || amount > 0) this.deps.log(`room ${this.id}: round ${round} over · ${settled} settled · loot ${amount} queued for the season pool`);

    for (const r of results) {
      const standings: RoundStanding[] = top.map(({ e, p }) => ({
        name: p?.name ?? '???',
        value: e.value,
        ...(e.pid === r.pid ? { you: true } : {}),
      }));
      r.conn.send({ t: 'roundOver', round, payout: r.payout, stats: r.stats, standings });
    }

    // the next round starts on a fresh floor; bots keep playing (respawned)
    this.world.clearEjects();
    const gone = this.bots?.resetRound() ?? [];
    for (const c of this.conns) for (const pid of gone) c.view.forgetPlayer(pid);
  }

  /* ---------------------------------------------------------------- */
  /* Tick                                                             */
  /* ---------------------------------------------------------------- */

  get sleeping(): boolean {
    return this.conns.size === 0 && this.humans.size === 0 && Date.now() - this.lastActivity > SLEEP_AFTER_MS;
  }

  tick(dtMs: number): void {
    if (this.conns.size > 0 || this.humans.size > 0) this.lastActivity = Date.now();
    // rounds end on the wall clock, even in a sleeping room (its floor loot goes to the season)
    this.syncRound();
    if (this.sleeping) return;
    const world = this.world;
    const ev = world.tick(dtMs);

    // loot is picked before any cell is eaten in a tick (the world eats static entities first)
    for (const lp of ev.lootPicked) this.onLootPicked(lp.pid, lp.value);
    // value moves with every eaten stake cell
    for (const ce of ev.cellsEaten) this.onCellEaten(ce);

    for (const k of ev.kills) {
      this.broadcast({
        t: 'kf',
        killer: k.killer?.name ?? '???',
        killerSkin: k.killer?.skin ?? 0,
        victim: k.victim.name,
        victimSkin: k.victim.skin,
        cause: k.cause === 'virus' ? 'virus' : 'eat',
      });
      if (this.bots?.isBot(k.victim.id)) {
        this.bots.onDeath(k.victim.id, world.now);
        world.removePlayer(k.victim.id);
        for (const c of this.conns) c.view.forgetPlayer(k.victim.id);
      } else if (this.humans.has(k.victim.id)) {
        this.finishHuman(k.victim, null, 'death', k.killer);
      } else {
        world.removePlayer(k.victim.id);
      }
      if (k.killer && this.bots?.isBot(k.killer.id)) this.bots.onKill(k.killer.id);
    }

    for (const pk of ev.pickups) {
      const c = this.humans.get(pk.player.id);
      if (c) c.send({ t: 'powerup', type: pk.type, ms: Math.max(0, pk.until - world.now) });
    }
    for (const a of ev.airdrops) this.broadcast({ t: 'event', kind: 'airdrop', state: 'start', x: a.x, y: a.y, powerUp: a.type });
    if (ev.coinRain) {
      this.broadcast({ t: 'event', kind: 'coinrain', state: ev.coinRain, ms: ev.coinRain === 'start' ? world.coinRainUntil - world.now : 0 });
      if (ev.coinRain === 'start') this.pushChat({ pid: 0, from: 'Slana', skin: 1, text: 'COIN RAIN!', system: true });
    }

    if (this.bots) {
      const { emotes } = this.bots.update(world.now, this.humans.size);
      for (const e of emotes) this.broadcast({ t: 'emote', pid: e.pid, id: e.id });
      for (const pid of this.bots.retired) for (const c of this.conns) c.view.forgetPlayer(pid);
    }

    if (this.ledger) this.stakeHousekeeping();

    this.sendSnapshots();

    const now = Date.now();
    if (now - this.lastLbAt >= 1000) {
      this.lastLbAt = now;
      this.sendLeaderboard();
    }
  }

  private stakeHousekeeping(): void {
    const world = this.world;
    // AFK stakers are not cashed out any more: their cells stay until eaten or the round ends
    const now = Date.now();
    if (now - this.lastAgeCheckAt >= 5000) {
      this.lastAgeCheckAt = now;
      for (const e of this.ledger!.all()) {
        if (now / 1000 - e.openedAt < MAX_STAKE_SESSION_AGE_S) continue;
        const p = world.players.get(e.pid);
        if (p?.alive) this.finishHuman(p, this.humans.get(e.pid) ?? null, 'maxage');
      }
    }
    if (this.journalDirty && now - this.lastJournalAt >= JOURNAL_SNAPSHOT_MS) this.commitJournal();
  }

  private viewFor(conn: Conn): { rect: { x0: number; y0: number; x1: number; y1: number }; view: { x: number; y: number; h: number } } {
    const p = conn.player;
    let cx: number;
    let cy: number;
    let size: { w: number; h: number };
    if (p && p.alive && p.cells.length > 0) {
      const c = p.center();
      cx = c.x;
      cy = c.y;
      size = viewSize(p.totalMass(), conn.aspect);
      // make sure every own cell fits (after a split pieces can fly far)
      let maxDx = 0;
      let maxDy = 0;
      for (const cell of p.cells) {
        maxDx = Math.max(maxDx, Math.abs(cell.x - cx) + cell.r);
        maxDy = Math.max(maxDy, Math.abs(cell.y - cy) + cell.r);
      }
      size = { w: Math.max(size.w, maxDx * 2.2), h: Math.max(size.h, maxDy * 2.2) };
      conn.lastCenter = { x: cx, y: cy };
    } else {
      const target = conn.spectatePid !== null ? this.world.players.get(conn.spectatePid) : undefined;
      if (conn.spectating && (!target || !target.alive)) {
        const top = this.world.ranking()[0];
        conn.spectatePid = top?.id ?? null;
      }
      const t = conn.spectatePid !== null ? this.world.players.get(conn.spectatePid) : undefined;
      if (conn.spectating && t && t.alive) {
        const c = t.center();
        cx = c.x;
        cy = c.y;
        conn.lastCenter = c;
      } else if (conn.spectating && conn.lastCenter.x === 0 && conn.lastCenter.y === 0) {
        cx = this.world.cfg.width / 2;
        cy = this.world.cfg.height / 2;
      } else {
        cx = conn.lastCenter.x;
        cy = conn.lastCenter.y;
      }
      size = viewSize(0, conn.aspect, true);
    }
    const hw = (size.w / 2) * VIEW.serverMargin;
    const hh = (size.h / 2) * VIEW.serverMargin;
    return { rect: { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }, view: { x: cx, y: cy, h: size.h } };
  }

  private sendSnapshots(): void {
    for (const conn of this.conns) {
      if (!conn.open) continue;
      if (conn.buffered > 768 * 1024) continue; // slow client: skip a frame
      const { rect, view } = this.viewFor(conn);
      const snap = conn.view.build(this.world, rect, view, this.entryFee);
      if (!snap) continue;
      this.writer.reset();
      writeSnapshot(this.writer, snap);
      conn.sendBinary(this.writer.finish());
    }
  }

  private sendLeaderboard(): void {
    let ranking = this.world.ranking();
    if (this.ledger) {
      const ledger = this.ledger;
      ranking = ranking.sort((a, b) => ledger.value(b.id) - ledger.value(a.id) || b.totalMass() - a.totalMass());
    }
    const top: LbEntry[] = ranking.slice(0, 10).map((p) => ({
      pid: p.id,
      name: p.name,
      skin: p.skin,
      score: Math.floor(p.totalMass()),
      value: this.ledger ? this.ledger.value(p.id) : undefined,
      bot: p.isBot || undefined,
      verified: (p.flags & PlayerFlag.Verified) !== 0 || undefined,
    }));
    const leaders = ranking.slice(0, 3).map((p) => {
      const c = p.center();
      return { x: Math.round(c.x), y: Math.round(c.y) };
    });
    const rankOf = new Map<number, number>();
    ranking.forEach((p, i) => {
      rankOf.set(p.id, i + 1);
      if (i + 1 < p.stats.bestRank) p.stats.bestRank = i + 1;
    });
    for (const conn of this.conns) {
      const p = conn.player;
      const me =
        p && p.alive
          ? { rank: rankOf.get(p.id) ?? ranking.length, score: Math.floor(p.totalMass()), value: this.ledger ? this.ledger.value(p.id) : undefined }
          : null;
      conn.send({ t: 'lb', top, me, leaders, players: ranking.length });
    }
  }

  /** Server shutdown: settle every stake player at their current value (an operator exit). */
  shutdown(): void {
    for (const [pid, c] of [...this.humans]) {
      const p = this.world.players.get(pid);
      if (p?.alive) this.finishHuman(p, c, this.ledger ? 'kicked' : 'left');
    }
  }
}

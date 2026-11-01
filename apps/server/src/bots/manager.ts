import { BASIC_SKINS, PlayerFlag, clamp, pickBotName, type LeftReason } from '@elymum/shared';
import type { Player } from '../game/entities';
import { randRange, type Rng } from '../game/rng';
import type { World } from '../game/world';
import { BotBrain } from './brain';
import { rollPersonality, type BotMix } from './personality';
import type { StakedBotTicket } from './staked';

export interface BotManagerOptions {
  /** Desired total population (humans + bots). */
  target: number;
  /** Bots kept even when many humans are online. */
  min: number;
  /** The bot cap of the room (admin `cap`). */
  max: number;
  /** Difficulty mix (default `standard`). */
  mix?: BotMix;
  /** Bots on (default true). Off: every bot goes home and none spawns. */
  enabled?: boolean;
  /**
   * Most mass a bot keeps (per room kind, admin `massCap`; see `DEFAULT_BOT_MASS_CAPS`): bots never
   * spawn above it and shed whatever they eat past it within a second or two. Absent: no cap.
   */
  massCap?: number;
}

/** Share of a capped bot's excess mass that stays after one second (the rest is shed). */
const MASS_CAP_KEEP_PER_SEC = 0.2;
/**
 * Most brains that think in one tick: about a quarter of the room (thoughts are staggered every
 * 120-300 ms anyway; this only flattens rare bursts). Bots over the budget think next tick.
 */
const thinkBudget = (bots: number): number => Math.max(3, Math.ceil(bots / 4));

export interface Bot {
  player: Player;
  brain: BotBrain;
  /** Bots "go home" after a while so the leaderboard keeps changing (staked bots: never). */
  retireAt: number;
  /** Testnet staked bots only: the arena ticket the bot plays (see `StakedBotSource`). */
  staked?: StakedBotTicket;
}

/** A bot that left the room without dying (the room shows "<name> went home"). */
export interface BotDeparture {
  pid: number;
  name: string;
  skin: number;
  reason: LeftReason;
}

/** Names bots wore lately in this room: some come back as "regulars". */
const REGULARS_KEPT = 40;

/** Emote ids (see @elymum/shared EMOTES). */
const EMOTE_GM = 0;
const EMOTE_WAGMI = 1;
const EMOTE_ROCKET = 2;
const EMOTE_YUM = 5;

/**
 * Keeps a room populated with bots when there are few humans, and drives
 * every bot's brain. Bots leave gradually as humans arrive.
 */
export class BotManager {
  readonly bots = new Map<number, Bot>();
  private spawnQueue: number[] = [];
  private lastTrimAt = 0;
  private initialized = false;
  private pendingEmotes: { pid: number; id: number }[] = [];
  /** Player ids of bots that left this tick (rooms forget their player info). */
  retired: number[] = [];
  /** Bots that went home (not died) since the last `takeDepartures`. */
  private departures: BotDeparture[] = [];
  private regulars: string[] = [];
  private opts: BotManagerOptions;
  private lastUpdateAt: number | null = null;
  /** Bots in a stable order for the round-robin think budget (rebuilt when the set changes). */
  private order: Bot[] = [];
  private orderDirty = true;
  private cursor = 0;

  constructor(
    private readonly world: World,
    opts: BotManagerOptions,
    private readonly rng: Rng,
  ) {
    this.opts = { ...opts };
  }

  get options(): Readonly<BotManagerOptions> {
    return this.opts;
  }

  get enabled(): boolean {
    return this.opts.enabled !== false;
  }

  /** The room's bot cap. */
  get cap(): number {
    return this.enabled ? Math.max(0, this.opts.max) : 0;
  }

  /** Bots wanted for this many humans: `clamp(target − humans, min, cap)`, 0 when bots are off. */
  desired(humans: number): number {
    if (!this.enabled) return 0;
    const cap = this.cap;
    return clamp(this.opts.target - humans, Math.min(this.opts.min, cap), cap);
  }

  isBot(pid: number): boolean {
    return this.bots.has(pid);
  }

  /** Testnet staked bots in the room (they hold a ticket). */
  get stakedCount(): number {
    let n = 0;
    for (const b of this.bots.values()) if (b.staked) n++;
    return n;
  }

  /** Remembers a name for a later comeback (a "regular" of this room). */
  private remember(name: string): void {
    const i = this.regulars.indexOf(name);
    if (i >= 0) this.regulars.splice(i, 1);
    this.regulars.push(name);
    if (this.regulars.length > REGULARS_KEPT) this.regulars.shift();
  }

  /** A natural name nobody in the room wears (humans included); sometimes a returning regular. */
  private pickName(): string {
    const used: string[] = [];
    for (const p of this.world.players.values()) used.push(p.name);
    return pickBotName(this.rng, used, this.regulars);
  }

  /** Bots wear the basic skins only. */
  private pickSkin(): number {
    return Math.floor(this.rng() * BASIC_SKINS.length);
  }

  spawnBot(mass?: number, staked?: StakedBotTicket): Bot {
    const taken = new Set([...this.world.players.values()].map((p) => p.name.toLowerCase()));
    const name = staked?.name && !taken.has(staked.name.toLowerCase()) ? staked.name : this.pickName();
    const player = this.world.addPlayer({
      name,
      skin: this.pickSkin(),
      flags: staked ? PlayerFlag.Bot | PlayerFlag.Staker : PlayerFlag.Bot,
      isBot: true,
      mass,
    });
    const bot: Bot = {
      player,
      brain: new BotBrain(rollPersonality(this.rng, this.opts.mix ?? 'standard'), this.rng, this.world.now),
      retireAt: staked ? Infinity : this.world.now + randRange(this.rng, 4 * 60_000, 12 * 60_000),
      ...(staked ? { staked } : {}),
    };
    if (this.opts.massCap !== undefined) bot.brain.massCap = this.opts.massCap;
    this.bots.set(player.id, bot);
    this.orderDirty = true;
    if (this.rng() < 0.2) this.pendingEmotes.push({ pid: player.id, id: EMOTE_GM });
    return bot;
  }

  /** The world reported this bot's death: forget it and maybe respawn later. */
  onDeath(pid: number, now: number): void {
    const bot = this.bots.get(pid);
    if (!bot) return;
    this.bots.delete(pid);
    this.orderDirty = true;
    this.remember(bot.player.name);
    this.spawnQueue.push(now + randRange(this.rng, 1500, 5000));
  }

  /** A bot goes home now: it leaves the world and a departure is recorded. */
  private sendHome(bot: Bot, reason: LeftReason): void {
    const p = bot.player;
    this.bots.delete(p.id);
    this.orderDirty = true;
    this.world.removePlayer(p.id);
    this.retired.push(p.id);
    this.remember(p.name);
    this.departures.push({ pid: p.id, name: p.name, skin: p.skin, reason });
  }

  /**
   * Sends zero-value bots home until at most `want` bots are left (staked bots hold a ticket and
   * stay until death or the bell). Picks bots out of danger first, then the smallest. Returns how many left.
   */
  trimTo(want: number, reason: LeftReason): number {
    let n = 0;
    while (this.bots.size > want) {
      let pick: Bot | null = null;
      let pickScore = Infinity;
      for (const b of this.bots.values()) {
        if (b.staked) continue;
        const score = b.player.totalMass() + (b.brain.lastDanger > 0.2 ? 1e9 : 0);
        if (score < pickScore) {
          pick = b;
          pickScore = score;
        }
      }
      if (!pick) break;
      this.sendHome(pick, reason);
      n++;
    }
    if (this.bots.size >= want) this.spawnQueue.length = 0;
    return n;
  }

  /**
   * A human just took a seat (`humans` counts them): bots over the wanted number go home at once
   * (zero-value bots only), so humans + bots stays at the target and bots never hold a seat.
   */
  makeRoom(humans: number): number {
    return this.trimTo(this.desired(humans), 'make_room');
  }

  /** New admin settings, applied live: bots over the new cap (or all, when off) go home now. */
  setOptions(opts: BotManagerOptions, humans: number): number {
    this.opts = { ...opts };
    for (const b of this.bots.values()) b.brain.massCap = opts.massCap ?? Infinity;
    return this.trimTo(this.desired(humans), 'settings');
  }

  /** Bots that went home since the last call (the room broadcasts the feed lines). */
  takeDepartures(): BotDeparture[] {
    const d = this.departures;
    this.departures = [];
    return d;
  }

  /**
   * Round reset: every bot leaves the world and a fresh population (natural size mix) spawns
   * on the next `update`, so bots keep playing into the new round. Returns the removed player ids.
   */
  resetRound(): number[] {
    const gone = [...this.bots.keys()];
    for (const b of this.bots.values()) this.remember(b.player.name);
    for (const pid of gone) this.world.removePlayer(pid);
    this.bots.clear();
    this.orderDirty = true;
    this.spawnQueue = [];
    this.initialized = false;
    return gone;
  }

  /** A bot ate a player: sometimes it gloats. */
  onKill(pid: number): void {
    if (this.bots.has(pid) && this.rng() < 0.3) this.pendingEmotes.push({ pid, id: this.rng() < 0.7 ? EMOTE_YUM : EMOTE_ROCKET });
  }

  /** Called once per tick after `world.tick`. */
  update(now: number, humans: number): { emotes: { pid: number; id: number }[] } {
    this.retired = [];
    const want = this.desired(humans);

    const cap = this.opts.massCap;
    if (!this.initialized) {
      this.initialized = true;
      // seed a natural size distribution so a fresh room looks alive
      for (let i = 0; i < want; i++) {
        const mass = Math.round(20 + Math.pow(this.rng(), 2.2) * 420);
        this.spawnBot(cap !== undefined ? Math.min(mass, Math.max(20, Math.round(cap * 0.9))) : mass);
      }
    }

    // the mass cap: whatever a bot eats past it melts away
    const dt = this.lastUpdateAt === null ? 0 : Math.max(0, now - this.lastUpdateAt) / 1000;
    this.lastUpdateAt = now;
    if (cap !== undefined && dt > 0) {
      const shed = 1 - Math.pow(MASS_CAP_KEEP_PER_SEC, dt);
      for (const bot of this.bots.values()) if (bot.player.alive) this.world.shedMass(bot.player, cap, shed);
    }

    // spawn queued bots that are still needed
    this.spawnQueue.sort((a, b) => a - b);
    while (this.spawnQueue.length > 0 && this.spawnQueue[0] <= now) {
      this.spawnQueue.shift();
      if (this.bots.size < want) this.spawnBot();
    }
    // top up if below target (e.g. a human left)
    const queued = this.spawnQueue.length;
    if (this.bots.size + queued < want) this.spawnQueue.push(now + randRange(this.rng, 400, 2500));
    // joins make room at once (`makeRoom`); anything else over the wanted number leaves slowly
    if (this.bots.size > want && now - this.lastTrimAt > 8000) {
      this.lastTrimAt = now;
      this.trimTo(this.bots.size - 1, 'retired');
    }
    if (queued > 0 && this.bots.size >= want) this.spawnQueue.length = 0;

    // retire old bots (one at a time, only when they are not mid-fight)
    for (const bot of this.bots.values()) {
      if (now < bot.retireAt) continue;
      if (bot.brain.lastDanger > 0.2) {
        bot.retireAt = now + 10_000;
        continue;
      }
      this.sendHome(bot, 'retired');
      this.spawnQueue.push(now + randRange(this.rng, 1500, 4000));
      break;
    }

    // brains think on their own staggered clocks; a round-robin budget flattens bursts
    if (this.orderDirty) {
      this.order = [...this.bots.values()];
      this.orderDirty = false;
      if (this.cursor >= this.order.length) this.cursor = 0;
    }
    const n = this.order.length;
    let budget = thinkBudget(n);
    const start = this.cursor;
    for (let i = 0; i < n && budget > 0; i++) {
      const bot = this.order[(start + i) % n];
      const p = bot.player;
      if (!p.alive || p.cells.length === 0) continue;
      if (!bot.brain.shouldThink(now)) continue;
      budget--;
      this.cursor = (start + i + 1) % n;
      const d = bot.brain.think(this.world, p, now);
      if (!d) continue;
      this.world.setTarget(p.id, d.target.x, d.target.y);
      if (d.split) this.world.queueSplit(p.id);
      if (d.eject) this.world.queueEject(p.id);
      if (this.rng() < 0.0008) this.pendingEmotes.push({ pid: p.id, id: this.rng() < 0.5 ? EMOTE_WAGMI : EMOTE_ROCKET });
    }

    const emotes = this.pendingEmotes;
    this.pendingEmotes = [];
    return { emotes };
  }
}

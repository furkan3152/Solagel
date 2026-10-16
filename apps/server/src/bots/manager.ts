import { BASIC_SKINS, BOT_NAMES, PlayerFlag, clamp } from '@slana/shared';
import type { Player } from '../game/entities';
import { randRange, type Rng } from '../game/rng';
import type { World } from '../game/world';
import { BotBrain } from './brain';
import { rollPersonality, type BotMix } from './personality';

export interface BotManagerOptions {
  /** Desired total population (humans + bots). */
  target: number;
  /** Bots kept even when many humans are online. */
  min: number;
  max: number;
  /** Difficulty mix (default `standard`). */
  mix?: BotMix;
}

export interface Bot {
  player: Player;
  brain: BotBrain;
  /** Bots "go home" after a while so the leaderboard keeps changing. */
  retireAt: number;
}

/** Emote ids (see @slana/shared EMOTES). */
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

  constructor(
    private readonly world: World,
    private readonly opts: BotManagerOptions,
    private readonly rng: Rng,
  ) {}

  desired(humans: number): number {
    return clamp(this.opts.target - humans, this.opts.min, this.opts.max);
  }

  isBot(pid: number): boolean {
    return this.bots.has(pid);
  }

  private pickName(): string {
    const used = new Set([...this.world.players.values()].map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    if (free.length > 0) return free[Math.floor(this.rng() * free.length)];
    return `${BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)]}_${Math.floor(this.rng() * 90 + 10)}`;
  }

  /** Bots wear the basic skins only. */
  private pickSkin(): number {
    return Math.floor(this.rng() * BASIC_SKINS.length);
  }

  spawnBot(mass?: number): Bot {
    const player = this.world.addPlayer({
      name: this.pickName(),
      skin: this.pickSkin(),
      flags: PlayerFlag.Bot,
      isBot: true,
      mass,
    });
    const bot: Bot = {
      player,
      brain: new BotBrain(rollPersonality(this.rng, this.opts.mix ?? 'standard'), this.rng),
      retireAt: this.world.now + randRange(this.rng, 4 * 60_000, 12 * 60_000),
    };
    this.bots.set(player.id, bot);
    if (this.rng() < 0.2) this.pendingEmotes.push({ pid: player.id, id: EMOTE_GM });
    return bot;
  }

  /** The world reported this bot's death: forget it and maybe respawn later. */
  onDeath(pid: number, now: number): void {
    if (!this.bots.delete(pid)) return;
    this.spawnQueue.push(now + randRange(this.rng, 1500, 5000));
  }

  /**
   * Round reset: every bot leaves the world and a fresh population (natural size mix) spawns
   * on the next `update`, so bots keep playing into the new round. Returns the removed player ids.
   */
  resetRound(): number[] {
    const gone = [...this.bots.keys()];
    for (const pid of gone) this.world.removePlayer(pid);
    this.bots.clear();
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

    if (!this.initialized) {
      this.initialized = true;
      // seed a natural size distribution so a fresh room looks alive
      for (let i = 0; i < want; i++) this.spawnBot(Math.round(20 + Math.pow(this.rng(), 2.2) * 420));
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
    // drop extra bots slowly as humans join (smallest first)
    if (this.bots.size > want + 1 && now - this.lastTrimAt > 8000) {
      this.lastTrimAt = now;
      let smallest: Bot | null = null;
      for (const b of this.bots.values()) if (!smallest || b.player.totalMass() < smallest.player.totalMass()) smallest = b;
      if (smallest) {
        this.bots.delete(smallest.player.id);
        this.world.removePlayer(smallest.player.id);
        this.retired.push(smallest.player.id);
      }
    }
    if (queued > 0 && this.bots.size >= want) this.spawnQueue.length = 0;

    // retire old bots (one at a time, only when they are not mid-fight)
    for (const bot of this.bots.values()) {
      if (now < bot.retireAt) continue;
      if (bot.brain.lastDanger > 0.2) {
        bot.retireAt = now + 10_000;
        continue;
      }
      this.bots.delete(bot.player.id);
      this.world.removePlayer(bot.player.id);
      this.retired.push(bot.player.id);
      this.spawnQueue.push(now + randRange(this.rng, 1500, 4000));
      break;
    }

    for (const bot of this.bots.values()) {
      const p = bot.player;
      if (!p.alive || p.cells.length === 0) continue;
      if (!bot.brain.shouldThink(now)) continue;
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

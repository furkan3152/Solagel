import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { approveCall, formatHypeAmount, joinCall, refundCall, testTokenMintCall, toLedger, type ArenaInfo, type SessionInfo } from '@elymum/sdk';
import { concat, getAddress, keccak256, numberToHex, parseEther, parseUnits, toHex, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmClient } from '../chain/evm-client';
import { LOW_BALANCE_WEI } from '../chain/evm';
import { withRpcPriority } from '../chain/rpc-budget';
import { CHAIN_FILES, isTestChain } from '../chain/state-dir';
import { sessionKey } from '../chain/types';
import type { Journal, SettleReason, SettlementItem } from '../stake/journal';
import type { BotSettingsStore } from './settings';
import type { StakedBotSource, StakedBotTicket } from './staked';

/** Tag mixed into every bot key: `keccak256(serverKey ‖ "elymum-bot" ‖ uint32 index)`. */
export const BOT_KEY_TAG = 'elymum-bot';
/** Most bot wallets one chain keeps (the pool grows only when every wallet is busy). */
export const MAX_BOT_WALLETS = 256;
/** Wallets kept on top of what the settings need (`walletBudget`). */
export const SPARE_BOT_WALLETS = 4;
/** Ticket purchases running at once (each is a few transactions). */
const MAX_CONCURRENT = 3;
const ARENA_TTL_MS = 60_000;
/** The server key's minter right is re-read this often (it changes only by an admin action). */
const CHECK_TTL_MS = 10 * 60_000;
/** Ticket purchases per minute over every arena, unless the deps say otherwise (`BOT_TICKETS_PER_MIN`). */
export const BOT_TICKETS_PER_MIN = 4;
const HOLDER_TTL_MS = 5 * 60_000;
const WARN_EVERY_MS = 10 * 60_000;
const RECEIPT_TIMEOUT_MS = 60_000;
/** Retry backoff after a failed purchase: 2 s, 4 s, 8 s … at most 60 s (never given up). */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
/** Every wallet busy: ask again after this long (no log spam, no RPC storm). */
const NO_WALLET_WAIT_MS = 5_000;
/** A settlement younger than this is about to free its wallet: wait for it instead of growing the pool. */
const SETTLE_SOON_MS = 60_000;
/** A ticket handed to a room that the room never seated is dropped from `playing` after this long. */
const HANDOFF_GRACE_MS = 30_000;
/** In-use flags are reconciled (rooms, journal) at most this often from `acquire`. */
const RECONCILE_EVERY_MS = 30_000;
/** An open on-chain session of a bot wallet that nobody plays is adopted only while younger than this. */
const ADOPT_MAX_AGE_S = 3600;
const MAX_UINT256 = (1n << 256n) - 1n;
/** secp256k1 group order: a derived key must be below it (and not zero). */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** Derives bot wallet `index`'s private key from the server key; null in the (astronomically rare) invalid case. */
export function deriveBotKey(serverKey: Hex, index: number): Hex | null {
  const k = keccak256(concat([serverKey, toHex(BOT_KEY_TAG), numberToHex(index, { size: 4 })]));
  const n = BigInt(k);
  return n === 0n || n >= SECP256K1_N ? null : k;
}

interface BotWallet {
  index: number;
  address: Address;
  key: Hex;
}

interface BotsFile {
  version: 1;
  /** The server key the wallets are derived from (address only). */
  serverKey: string;
  wallets: { index: number; address: string }[];
}

/** What the staked-bot source reads of the chain gateway. */
export interface StakedChainView {
  chainId: number | null;
  /** Arena tickets can be played (token set, server authorized, chain-keyed state matches). */
  stakeEnabled: boolean;
  arena: string | null;
  token: { address: string; decimals: number } | null;
}

export interface TestnetBotDeps {
  /** The chain right now (`ChainGateway.status()` / `stakeEnabled`). */
  chain: () => StakedChainView;
  client: () => EvmClient | null;
  /** The server's private key: bot keys are derived from it (never stored). */
  serverKey: Hex;
  settings: BotSettingsStore;
  journal: Journal;
  /** `DATA_DIR/chains/<id>` (bot wallet addresses in `bots.json`); null: memory only. */
  stateDir: string | null;
  /** New tickets only while the round's joins are open (default: always). */
  joinsOpen?: () => boolean;
  /**
   * Session keys live in the rooms right now (`RoomManager.liveSessions`). With it the source
   * reconciles its in-use flags against the rooms and adopts open on-chain sessions of bot
   * wallets that no room plays (a join whose receipt came too late, a crash between join and seat).
   */
  liveSessions?: () => Set<string>;
  log?: (m: string) => void;
  now?: () => number;
  receiptTimeoutMs?: number;
  maxWallets?: number;
  /**
   * The current arena round (a number that changes at every bell). With it each arena buys at most
   * its staked target of tickets per round: a bot that dies is not replaced before the next round
   * (zero-value bots hold the seat), so bots no longer re-buy after every death.
   */
  round?: () => number;
  /** Purchases per minute over every arena (default `BOT_TICKETS_PER_MIN`; 0 stops purchases). */
  maxTicketsPerMinute?: number;
}

/** What `/api/admin/bots` shows of the staked bots. */
export interface StakedBotStatus {
  /** The chain is a test chain and the arenas are on: staked bots may play. */
  active: boolean;
  chainId: number | null;
  wallets: number;
  /** Tickets bought and not yet settled. */
  playing: number;
  /** Why no bot can buy a ticket right now (null: nothing in the way). */
  problem: string | null;
}

class Blocked extends Error {}

/** The chain and contracts a purchase works with. */
type BotCtx = { client: EvmClient; arena: Address; token: Address; decimals: number; chainId: number };

/**
 * Testnet staked bots (2026-10-31 spec, section 2): implements `StakedBotSource` on the Elysium
 * Testnet (99801) and the localnet (31337) only.
 *
 * Every bot has its own wallet, derived from the server key (`deriveBotKey`); the addresses are kept
 * in `DATA_DIR/chains/<id>/bots.json`, the keys are re-derived at boot. To buy a ticket the source
 * picks a wallet without an open session in that arena, tops its HYPE up to `gasHype` (sent from the
 * server key) and its tELYMUM up to the arena's bankroll (`TestToken.mint` by the server key, which
 * must be a minter), approves the arena once (max allowance) and calls `join` from the bot wallet.
 * The room then seats the ticket (`Room.seatStakedBot`) and settles it like a player's ticket.
 *
 * Anything in the way (not a minter, the server key out of HYPE, an RPC error) is logged at most
 * every 10 minutes, the arena's next purchase backs off (2 s doubling to 60 s, never given up) and
 * the room fields zero-value bots meanwhile: `acquire` never throws.
 *
 * The wallet pool grows lazily (a wallet is created and funded only when every wallet is busy) up
 * to `walletBudget` (the settings' staked targets × 2 + spare). A wallet is busy in an arena while
 * its ticket plays (`playing`, freed by `released` at once) and while its settlement is pending in
 * the journal (until the chain worker confirms it). `reconcile` drops flags no room backs; an open
 * on-chain session of a bot wallet that no room plays is adopted at the next pick. Holders-only
 * arenas are skipped quietly when no bot wallet holds an emblem (no wallet is created for them).
 */
export class TestnetBotSource implements StakedBotSource {
  private readonly wallets: BotWallet[] = [];
  /** `address:arenaId` (lower case) of tickets bought and not released yet → session key, hand-off time. */
  private readonly playing = new Map<string, { session: string; at: number }>();
  /** Per arena: failed purchases in a row and when the next try may run. */
  private readonly backoff = new Map<number, { fails: number; until: number }>();
  /** Holders-only arenas: when the last check found no bot wallet holding an emblem. */
  private readonly noHolders = new Map<number, number>();
  private lastReconcileAt = -Infinity;
  /** `address:arenaId` → when its ticket was released (its settlement then frees the wallet soon). */
  private readonly releasedAt = new Map<string, number>();
  /** Every arena read so far → holders-only (sizes the wallet pool, survives the arena cache). */
  private readonly seenArenas = new Map<number, boolean>();
  /** Wallets a purchase is running for (one at a time per wallet). */
  private readonly locked = new Set<string>();
  private running = 0;
  /** Per arena: tickets bought in the current round. */
  private readonly roundBuys = new Map<number, { round: number; n: number }>();
  /** When the purchases of the last minute were made (the global per-minute cap). */
  private readonly buyTimes: number[] = [];
  private readonly arenaCache = new Map<number, { at: number; value: ArenaInfo }>();
  private readonly holderCache = new Map<string, { at: number; value: boolean }>();
  private minter: { at: number; token: string; value: boolean } | null = null;
  private problemV: string | null = null;
  private readonly lastWarn = new Map<string, number>();
  private readonly log: (m: string) => void;
  private readonly now: () => number;
  private serverAddress: Address;

  constructor(private readonly deps: TestnetBotDeps) {
    this.log = deps.log ?? (() => {});
    this.now = deps.now ?? Date.now;
    this.serverAddress = privateKeyToAccount(deps.serverKey).address;
    this.load();
  }

  /* ---------------------------------------------------------------- */
  /* Wallets                                                          */
  /* ---------------------------------------------------------------- */

  private get file(): string | null {
    return this.deps.stateDir ? join(this.deps.stateDir, CHAIN_FILES.bots) : null;
  }

  private load(): void {
    const p = this.file;
    if (!p || !existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as BotsFile;
      if (!raw || raw.version !== 1 || !Array.isArray(raw.wallets)) throw new Error('bad shape');
      if (typeof raw.serverKey === 'string' && raw.serverKey.toLowerCase() !== this.serverAddress.toLowerCase()) {
        const backup = `${p}.other-key-${Date.now()}`;
        renameSync(p, backup);
        this.log(`bots: ${CHAIN_FILES.bots} belongs to another server key (${raw.serverKey}); moved to ${backup}, new bot wallets will be derived`);
        return;
      }
      for (const w of raw.wallets) {
        if (!Number.isInteger(w?.index) || w.index < 0) continue;
        const key = deriveBotKey(this.deps.serverKey, w.index);
        if (!key) continue;
        const address = privateKeyToAccount(key).address;
        if (typeof w.address === 'string' && w.address.toLowerCase() !== address.toLowerCase()) continue;
        this.wallets.push({ index: w.index, address, key });
      }
      this.wallets.sort((a, b) => a.index - b.index);
    } catch (err) {
      const backup = `${p}.corrupt-${Date.now()}`;
      try {
        renameSync(p, backup);
      } catch {
        /* ignore */
      }
      this.log(`bots: ${CHAIN_FILES.bots} is unreadable (${(err as Error).message}); moved to ${backup}`);
    }
  }

  private save(): void {
    const p = this.file;
    if (!p) return;
    mkdirSync(this.deps.stateDir!, { recursive: true });
    const data: BotsFile = { version: 1, serverKey: this.serverAddress, wallets: this.wallets.map((w) => ({ index: w.index, address: w.address })) };
    writeFileSync(`${p}.tmp`, JSON.stringify(data, null, 2));
    renameSync(`${p}.tmp`, p);
  }

  /** The bot wallet addresses (EIP-55), in index order. */
  addresses(): Address[] {
    return this.wallets.map((w) => w.address);
  }

  /**
   * How many bot wallets the settings need: every non-holders-only arena seen fields its staked
   * target, and a wallet whose last ticket's settlement is still on its way to the chain cannot
   * buy the next one yet (×2), plus a few spare. Capped at `maxWallets` (default 256).
   */
  walletBudget(): number {
    let need = 0;
    for (const [id, holdersOnly] of this.seenArenas) if (!holdersOnly) need += this.deps.settings.stakedWanted(id);
    return Math.min(this.deps.maxWallets ?? MAX_BOT_WALLETS, need * 2 + SPARE_BOT_WALLETS);
  }

  private addWallet(): BotWallet | null {
    const max = this.walletBudget();
    let index = (this.wallets.at(-1)?.index ?? -1) + 1;
    while (this.wallets.length < max) {
      const key = deriveBotKey(this.deps.serverKey, index);
      if (key) {
        const w = { index, address: privateKeyToAccount(key).address, key };
        this.wallets.push(w);
        this.save();
        return w;
      }
      index++;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* StakedBotSource                                                  */
  /* ---------------------------------------------------------------- */

  /** The chain and contracts when staked bots may play now; null otherwise. */
  private context(): BotCtx | null {
    const c = this.deps.chain();
    const client = this.deps.client();
    if (!client || !isTestChain(c.chainId) || !c.stakeEnabled || !c.arena || !c.token) return null;
    return { client, arena: getAddress(c.arena), token: getAddress(c.token.address), decimals: c.token.decimals, chainId: c.chainId! };
  }

  /** True while staked bots may play (a test chain with the arenas on). */
  active(): boolean {
    return this.context() !== null;
  }

  status(): StakedBotStatus {
    return { active: this.active(), chainId: this.deps.chain().chainId, wallets: this.wallets.length, playing: this.playing.size, problem: this.problemV };
  }

  wanted(arenaId: number): number {
    if (!this.context()) return 0;
    // holders-only arenas (the Isles): only bot wallets holding an emblem may go; re-checked every 5 min
    if (this.seenArenas.get(arenaId)) {
      const none = this.noHolders.get(arenaId);
      if (none !== undefined && this.now() - none < HOLDER_TTL_MS) return 0;
    }
    return this.deps.settings.stakedWanted(arenaId);
  }

  /**
   * The purchase caps (no RPC): at most `maxTicketsPerMinute` over every arena, and per arena at most
   * its staked target per round (`deps.round`). A bot that dies mid-round is replaced at the next round.
   */
  private purchaseAllowed(arenaId: number): boolean {
    const now = this.now();
    while (this.buyTimes.length > 0 && now - this.buyTimes[0] >= 60_000) this.buyTimes.shift();
    const perMin = this.deps.maxTicketsPerMinute ?? BOT_TICKETS_PER_MIN;
    if (this.buyTimes.length >= perMin) return false;
    if (this.deps.round) {
      const r = this.deps.round();
      const e = this.roundBuys.get(arenaId);
      if (e && e.round === r && e.n >= this.deps.settings.stakedWanted(arenaId)) return false;
    }
    return true;
  }

  private noteBuy(arenaId: number): void {
    this.buyTimes.push(this.now());
    if (!this.deps.round) return;
    const r = this.deps.round();
    const e = this.roundBuys.get(arenaId);
    this.roundBuys.set(arenaId, e && e.round === r ? { round: r, n: e.n + 1 } : { round: r, n: 1 });
  }

  /** Tickets bought in the last minute (status, tests). */
  purchasesLastMinute(): number {
    const now = this.now();
    return this.buyTimes.filter((t) => now - t < 60_000).length;
  }

  async acquire(arenaId: number, roomId: string): Promise<StakedBotTicket | null> {
    const ctx = this.context();
    if (!ctx || this.running >= MAX_CONCURRENT) return null;
    if (this.deps.joinsOpen && !this.deps.joinsOpen()) return null;
    const now = this.now();
    const b = this.backoff.get(arenaId);
    if (b && now < b.until) return null;
    if (!this.purchaseAllowed(arenaId)) return null;
    // bot purchases are the lowest priority on the RPC: joins, settlements and sweeps go first
    return withRpcPriority('low', () => this.acquireNow(ctx, arenaId, roomId));
  }

  private async acquireNow(ctx: BotCtx, arenaId: number, roomId: string): Promise<StakedBotTicket | null> {
    const b = this.backoff.get(arenaId);
    if (this.now() - this.lastReconcileAt >= RECONCILE_EVERY_MS) this.reconcile();
    // counted before the first await: `acquire` checks it synchronously
    this.running++;
    let wallet: BotWallet | null = null;
    try {
      const arena = await this.arenaInfo(ctx, arenaId);
      if (!arena.exists || !arena.enabled) return null;
      if (arena.holdersOnly && !(await this.anyHolder(ctx, arena))) return null;
      await this.checkMinter(ctx);
      const pick = await this.pickWallet(ctx, arena);
      if (pick === 'wait') {
        this.backoff.set(arenaId, { fails: b?.fails ?? 0, until: this.now() + NO_WALLET_WAIT_MS });
        return null;
      }
      if (!pick) {
        this.backoff.set(arenaId, { fails: b?.fails ?? 0, until: this.now() + NO_WALLET_WAIT_MS });
        this.warn(`wallets:${arenaId}`, `bots: no free bot wallet for arena #${arenaId} (all ${this.wallets.length} of ${this.walletBudget()} busy)`);
        return null;
      }
      wallet = pick.wallet;
      const ticket = pick.adopt ? this.ticketOf(ctx, wallet, pick.adopt) : await this.buy(ctx, wallet, arena);
      if (!pick.adopt) this.noteBuy(arenaId);
      this.problemV = null;
      this.backoff.delete(arenaId);
      this.playing.set(`${wallet.address.toLowerCase()}:${arenaId}`, { session: ticket.stake.session, at: this.now() });
      this.log(
        pick.adopt
          ? `bots: ${wallet.address} adopted its open session ${ticket.stake.sessionId} in arena #${arenaId} for ${roomId}`
          : `bots: ${wallet.address} bought a ticket in arena #${arenaId} for ${roomId} (session ${ticket.stake.sessionId})`,
      );
      return ticket;
    } catch (err) {
      const msg = (err as Error).message.split('\n')[0].slice(0, 240);
      this.problemV = msg;
      // retry with backoff, never give up: 2 s, 4 s, 8 s … 60 s
      const fails = (this.backoff.get(arenaId)?.fails ?? 0) + 1;
      this.backoff.set(arenaId, { fails, until: this.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (fails - 1)) });
      this.warn(err instanceof Blocked ? `blocked:${msg}` : 'error', err instanceof Blocked ? `!!! bots: ${msg}` : `bots: ticket for arena #${arenaId} failed (${msg}); retrying`);
      return null;
    } finally {
      if (wallet) this.locked.delete(wallet.address.toLowerCase());
      this.running--;
    }
  }

  released(ticket: StakedBotTicket, _reason: SettleReason, _item: SettlementItem): void {
    // the wallet is free again once the chain worker settled the session (its pending settlement
    // in the journal keeps it out of `pickWallet` until then; the receipt may take a while)
    const k = `${ticket.stake.player.toLowerCase()}:${ticket.stake.arenaId}`;
    this.playing.delete(k);
    this.releasedAt.set(k, this.now());
  }

  /**
   * Reconciles the in-use flags with the rooms and the journal (on a timer, at boot, and from
   * `acquire`): a ticket no room plays any more (its settlement got lost, a hand-off the room
   * could not seat) frees its flag; the wallet's on-chain session is then read at the next pick
   * (closed: reused; still open: adopted, or left to the stale sweeper when old). Without a
   * `liveSessions` provider nothing is dropped. Returns the flags dropped.
   */
  reconcile(): number {
    this.lastReconcileAt = this.now();
    const live = this.deps.liveSessions?.();
    if (!live) return 0;
    let n = 0;
    for (const [k, p] of this.playing) {
      if (live.has(p.session)) continue;
      if (this.now() - p.at < HANDOFF_GRACE_MS) continue; // being seated right now
      this.playing.delete(k);
      n++;
    }
    if (n > 0) this.log(`bots: ${n} bot ticket flag(s) without a room dropped (reconciled with the rooms and the journal)`);
    return n;
  }

  /* ---------------------------------------------------------------- */
  /* Chain steps                                                      */
  /* ---------------------------------------------------------------- */

  private async arenaInfo(ctx: { client: EvmClient; arena: Address }, id: number): Promise<ArenaInfo> {
    const hit = this.arenaCache.get(id);
    if (hit && this.now() - hit.at < ARENA_TTL_MS) return hit.value;
    const value = await ctx.client.arena(ctx.arena, id);
    this.arenaCache.set(id, { at: this.now(), value });
    if (value.exists) this.seenArenas.set(id, value.holdersOnly);
    else this.seenArenas.delete(id);
    return value;
  }

  /** The server key must be allowed to mint the TestToken (the owner always is). */
  private async checkMinter(ctx: { client: EvmClient; token: Address }): Promise<void> {
    const m = this.minter;
    let ok: boolean;
    if (m && m.token === ctx.token && this.now() - m.at < CHECK_TTL_MS) ok = m.value;
    else {
      const [minter, owner] = await Promise.all([ctx.client.isMinter(ctx.token, this.serverAddress), ctx.client.ownerOf(ctx.token).catch(() => null)]);
      ok = minter || owner?.toLowerCase() === this.serverAddress.toLowerCase();
      this.minter = { at: this.now(), token: ctx.token, value: ok };
    }
    if (!ok) {
      throw new Blocked(
        `the server key ${this.serverAddress} is not a minter of the TestToken ${ctx.token}: staked bots cannot be funded (grant it in /admin → Faucet → minter = server key)`,
      );
    }
  }

  /** A holder check (cached 5 min); an RPC error throws (retried with backoff) instead of caching "no". */
  private async isHolder(ctx: { client: EvmClient; arena: Address }, w: BotWallet): Promise<boolean> {
    const k = w.address.toLowerCase();
    const hit = this.holderCache.get(k);
    if (hit && this.now() - hit.at < HOLDER_TTL_MS) return hit.value;
    const value = await ctx.client.isArenaHolder(ctx.arena, w.address);
    this.holderCache.set(k, { at: this.now(), value });
    return value;
  }

  /**
   * Holders-only arenas: does any known bot wallet hold an emblem? When none does the arena is
   * skipped quietly (one log line per arena and process, no wallet is created or funded) and
   * `wanted` answers 0 until the next check, 5 min later.
   */
  private async anyHolder(ctx: { client: EvmClient; arena: Address }, arena: ArenaInfo): Promise<boolean> {
    for (const w of this.wallets) if (await this.isHolder(ctx, w)) return true;
    if (!this.noHolders.has(arena.id)) {
      this.log(`bots: arena #${arena.id} is holders-only and no bot wallet holds an emblem: no staked bots there (zero-value bots fill it)`);
    }
    this.noHolders.set(arena.id, this.now());
    return false;
  }

  /**
   * A wallet without an open session in this arena (a finalized one collects its payout first),
   * or an open session of a bot wallet no room plays (`adopt`). `wait`: every wallet is busy but
   * one is about to be freed by a settlement on its way to the chain (no new wallet for that).
   * Null: every wallet is busy and the pool is at its budget.
   */
  private async pickWallet(
    ctx: { client: EvmClient; arena: Address },
    arena: ArenaInfo,
  ): Promise<{ wallet: BotWallet; adopt?: SessionInfo } | 'wait' | null> {
    const pending = this.deps.journal.pending.filter((p): p is SettlementItem => p.kind === 'settle' && p.arenaId === arena.id);
    const pendingPlayers = new Set(pending.map((p) => p.player.toLowerCase()));
    const fresh = (p: SettlementItem) => {
      const at = this.releasedAt.get(`${p.player.toLowerCase()}:${arena.id}`);
      return (at !== undefined && this.now() - at < SETTLE_SOON_MS) || Date.now() - p.createdAt < SETTLE_SOON_MS;
    };
    const soon = new Set(pending.filter((p) => !p.held && fresh(p)).map((p) => p.player.toLowerCase()));
    const live = this.deps.liveSessions?.();
    const candidates = [...this.wallets];
    let waitFor = false;
    for (;;) {
      let w = candidates.shift() ?? null;
      if (!w) {
        // holders-only arenas never get fresh wallets (a new wallet holds no emblem)
        if (arena.holdersOnly) return null;
        if (waitFor) return 'wait';
        w = this.addWallet();
        if (!w) return null;
      }
      const k = w.address.toLowerCase();
      if (this.locked.has(k) || this.playing.has(`${k}:${arena.id}`)) continue;
      if (pendingPlayers.has(k)) {
        if (soon.has(k)) waitFor = true;
        continue;
      }
      if (arena.holdersOnly && !(await this.isHolder(ctx, w))) continue;
      this.locked.add(k);
      let s: SessionInfo;
      try {
        s = await ctx.client.session(ctx.arena, arena.id, w.address);
      } catch (err) {
        this.locked.delete(k);
        throw err;
      }
      if (s.id === 0n) return { wallet: w };
      if (!s.finalized && live && !live.has(sessionKey(arena.id, w.address, s.id)) && this.now() / 1000 - s.openedAt < ADOPT_MAX_AGE_S) {
        // a ticket bought but never seated (late receipt, a crash between join and seat): play it
        return { wallet: w, adopt: s };
      }
      if (s.finalized && s.owed > 0n) {
        // the last payout could not be transferred: collect it, use another wallet now
        await this.wait(ctx.client, await ctx.client.signer(w.key).send(refundCall(ctx.arena, arena.id))).catch(() => undefined);
      }
      this.locked.delete(k);
    }
  }

  private async wait(client: EvmClient, hash: Hash): Promise<void> {
    const r = await client.receipt(hash, null, this.deps.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS);
    if (!r) throw new Error(`transaction ${hash} not confirmed in time`);
    if (r.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  }

  /** Gas and bankroll top-up, approve (once), join; resolves with the ticket. */
  private async buy(ctx: { client: EvmClient; arena: Address; token: Address; decimals: number }, w: BotWallet, arena: ArenaInfo): Promise<StakedBotTicket> {
    const { client } = ctx;
    const testnet = this.deps.settings.settings.testnet;
    // gas: top up to `gasHype` when below half of it, from the server key
    const gasWant = parseEther(testnet.gasHype);
    // the three reads at once (the token reads merge into one multicall)
    const [gas, balance, allowance] = await Promise.all([
      client.balance(w.address),
      client.tokenBalance(ctx.token, w.address),
      client.allowance(ctx.token, w.address, ctx.arena),
    ]);
    if (gas < gasWant / 2n) {
      const top = gasWant - gas;
      const server = await client.balance(this.serverAddress);
      if (server < top + LOW_BALANCE_WEI) {
        throw new Blocked(
          `the server key ${this.serverAddress} is out of HYPE (${formatHypeAmount(server)} HYPE; a bot needs ${formatHypeAmount(top)} for gas): fund it to run staked bots`,
        );
      }
      await this.wait(client, await client.sendValue(w.address, top));
    }
    // bankroll: mint up to the arena's bankroll when below half of it (or below one ticket)
    const bankroll = parseUnits(this.deps.settings.bankroll(arena.id), ctx.decimals);
    if (bankroll < arena.entryFee) throw new Blocked(`the bot bankroll of arena #${arena.id} is below its entry fee: raise it in /admin → Bots`);
    if (balance < arena.entryFee || balance < bankroll / 2n) {
      const server = await client.balance(this.serverAddress);
      if (server < LOW_BALANCE_WEI) throw new Blocked(`the server key ${this.serverAddress} is out of HYPE (${formatHypeAmount(server)} HYPE): fund it to run staked bots`);
      if (bankroll > balance) await this.wait(client, await client.send(testTokenMintCall(ctx.token, w.address, bankroll - balance)));
    }
    const bot = client.signer(w.key);
    if (allowance < arena.entryFee) {
      await this.wait(client, await bot.send(approveCall(ctx.token, ctx.arena, MAX_UINT256)));
    }
    await this.wait(client, await bot.send(joinCall(ctx.arena, arena.id)));
    this.arenaCache.delete(arena.id);
    const s = await client.session(ctx.arena, arena.id, w.address);
    if (s.id === 0n || s.finalized) throw new Error(`the join of ${w.address} left no open session`);
    return this.ticketOf(ctx, w, s);
  }

  /** The ticket of an open session of a bot wallet. */
  private ticketOf(ctx: { decimals: number }, w: BotWallet, s: SessionInfo): StakedBotTicket {
    const entryFee = toLedger(s.entryFee, ctx.decimals, 'floor');
    return {
      stake: {
        player: w.address,
        session: sessionKey(s.arenaId, w.address, s.id),
        sessionId: Number(s.id),
        arenaId: s.arenaId,
        entryFee,
        value: entryFee,
        openedAt: s.openedAt,
      },
    };
  }

  private warn(key: string, message: string): void {
    const now = this.now();
    if (now - (this.lastWarn.get(key) ?? -Infinity) < WARN_EVERY_MS) return;
    this.lastWarn.set(key, now);
    this.log(message);
  }
}

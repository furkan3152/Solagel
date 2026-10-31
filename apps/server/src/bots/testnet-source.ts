import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { approveCall, formatHypeAmount, joinCall, refundCall, testTokenMintCall, toLedger, type ArenaInfo } from '@elymum/sdk';
import { concat, getAddress, keccak256, numberToHex, parseEther, parseUnits, toHex, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmClient } from '../chain/evm-client';
import { LOW_BALANCE_WEI } from '../chain/evm';
import { CHAIN_FILES, isTestChain } from '../chain/state-dir';
import { sessionKey } from '../chain/types';
import type { Journal, SettleReason, SettlementItem } from '../stake/journal';
import type { BotSettingsStore } from './settings';
import type { StakedBotSource, StakedBotTicket } from './staked';

/** Tag mixed into every bot key: `keccak256(serverKey ‖ "elymum-bot" ‖ uint32 index)`. */
export const BOT_KEY_TAG = 'elymum-bot';
/** Most bot wallets one chain keeps (the pool grows only when every wallet is busy). */
export const MAX_BOT_WALLETS = 256;
/** Ticket purchases running at once (each is a few transactions). */
const MAX_CONCURRENT = 3;
const ARENA_TTL_MS = 30_000;
const CHECK_TTL_MS = 60_000;
const HOLDER_TTL_MS = 5 * 60_000;
const WARN_EVERY_MS = 10 * 60_000;
const RECEIPT_TIMEOUT_MS = 60_000;
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
  log?: (m: string) => void;
  now?: () => number;
  receiptTimeoutMs?: number;
  maxWallets?: number;
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
 * every 10 minutes and the arena simply fields zero staked bots: `acquire` never throws.
 */
export class TestnetBotSource implements StakedBotSource {
  private readonly wallets: BotWallet[] = [];
  /** `address:arenaId` (lower case) of tickets bought and not released yet. */
  private readonly playing = new Set<string>();
  /** Wallets a purchase is running for (one at a time per wallet). */
  private readonly locked = new Set<string>();
  private running = 0;
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

  private addWallet(): BotWallet | null {
    const max = this.deps.maxWallets ?? MAX_BOT_WALLETS;
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
  private context(): { client: EvmClient; arena: Address; token: Address; decimals: number; chainId: number } | null {
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
    const a = this.arenaCache.get(arenaId)?.value;
    // holders-only arenas (the Isles): only bot wallets holding an emblem may go
    if (a?.holdersOnly && !this.wallets.some((w) => this.holderCache.get(w.address.toLowerCase())?.value)) return 0;
    return this.deps.settings.stakedWanted(arenaId);
  }

  async acquire(arenaId: number, roomId: string): Promise<StakedBotTicket | null> {
    const ctx = this.context();
    if (!ctx || this.running >= MAX_CONCURRENT) return null;
    if (this.deps.joinsOpen && !this.deps.joinsOpen()) return null;
    this.running++;
    let wallet: BotWallet | null = null;
    try {
      const arena = await this.arenaInfo(ctx, arenaId);
      if (!arena.exists || !arena.enabled) return null;
      await this.checkMinter(ctx);
      wallet = await this.pickWallet(ctx, arena);
      if (!wallet) {
        this.warn('wallets', `bots: no free bot wallet for arena #${arenaId} (${this.wallets.length} in use)`);
        return null;
      }
      const ticket = await this.buy(ctx, wallet, arena);
      this.problemV = null;
      this.playing.add(`${wallet.address.toLowerCase()}:${arenaId}`);
      this.log(`bots: ${wallet.address} bought a ticket in arena #${arenaId} for ${roomId} (session ${ticket.stake.sessionId})`);
      return ticket;
    } catch (err) {
      const msg = (err as Error).message.split('\n')[0].slice(0, 240);
      this.problemV = msg;
      this.warn(err instanceof Blocked ? `blocked:${msg}` : 'error', err instanceof Blocked ? `!!! bots: ${msg}` : `bots: ticket for arena #${arenaId} failed (${msg})`);
      return null;
    } finally {
      if (wallet) this.locked.delete(wallet.address.toLowerCase());
      this.running--;
    }
  }

  released(ticket: StakedBotTicket, _reason: SettleReason, _item: SettlementItem): void {
    // the wallet is free again once the chain worker settled the session (checked on chain at the next pick)
    this.playing.delete(`${ticket.stake.player.toLowerCase()}:${ticket.stake.arenaId}`);
  }

  /* ---------------------------------------------------------------- */
  /* Chain steps                                                      */
  /* ---------------------------------------------------------------- */

  private async arenaInfo(ctx: { client: EvmClient; arena: Address }, id: number): Promise<ArenaInfo> {
    const hit = this.arenaCache.get(id);
    if (hit && this.now() - hit.at < ARENA_TTL_MS) return hit.value;
    const value = await ctx.client.arena(ctx.arena, id);
    this.arenaCache.set(id, { at: this.now(), value });
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

  private async isHolder(ctx: { client: EvmClient; arena: Address }, w: BotWallet): Promise<boolean> {
    const k = w.address.toLowerCase();
    const hit = this.holderCache.get(k);
    if (hit && this.now() - hit.at < HOLDER_TTL_MS) return hit.value;
    const value = await ctx.client.isArenaHolder(ctx.arena, w.address).catch(() => false);
    this.holderCache.set(k, { at: this.now(), value });
    return value;
  }

  /** A wallet without an open session in this arena (a finalized one collects its payout first). */
  private async pickWallet(ctx: { client: EvmClient; arena: Address }, arena: ArenaInfo): Promise<BotWallet | null> {
    const pendingPlayers = new Set(
      this.deps.journal.pending.filter((p) => p.kind === 'settle' && p.arenaId === arena.id).map((p) => (p as SettlementItem).player.toLowerCase()),
    );
    const candidates = [...this.wallets];
    for (;;) {
      let w = candidates.shift() ?? null;
      if (!w) {
        // holders-only arenas never get fresh wallets (a new wallet holds no emblem)
        if (arena.holdersOnly) return null;
        w = this.addWallet();
        if (!w) return null;
      }
      const k = w.address.toLowerCase();
      if (this.locked.has(k) || this.playing.has(`${k}:${arena.id}`) || pendingPlayers.has(k)) continue;
      if (arena.holdersOnly && !(await this.isHolder(ctx, w))) continue;
      this.locked.add(k);
      let s;
      try {
        s = await ctx.client.session(ctx.arena, arena.id, w.address);
      } catch (err) {
        this.locked.delete(k);
        throw err;
      }
      if (s.id === 0n) return w;
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
    const gas = await client.balance(w.address);
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
    const balance = await client.tokenBalance(ctx.token, w.address);
    if (balance < arena.entryFee || balance < bankroll / 2n) {
      const server = await client.balance(this.serverAddress);
      if (server < LOW_BALANCE_WEI) throw new Blocked(`the server key ${this.serverAddress} is out of HYPE (${formatHypeAmount(server)} HYPE): fund it to run staked bots`);
      if (bankroll > balance) await this.wait(client, await client.send(testTokenMintCall(ctx.token, w.address, bankroll - balance)));
    }
    const bot = client.signer(w.key);
    if ((await client.allowance(ctx.token, w.address, ctx.arena)) < arena.entryFee) {
      await this.wait(client, await bot.send(approveCall(ctx.token, ctx.arena, MAX_UINT256)));
    }
    await this.wait(client, await bot.send(joinCall(ctx.arena, arena.id)));
    this.arenaCache.delete(arena.id);
    const s = await client.session(ctx.arena, arena.id, w.address);
    if (s.id === 0n || s.finalized) throw new Error(`the join of ${w.address} left no open session`);
    const entryFee = toLedger(s.entryFee, ctx.decimals, 'floor');
    return {
      stake: {
        player: w.address,
        session: sessionKey(arena.id, w.address, s.id),
        sessionId: Number(s.id),
        arenaId: arena.id,
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

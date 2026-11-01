import { randomBytes } from 'node:crypto';
import { DEFAULT_ARENAS, LOCALNET_CHAIN_ID, TOKEN_SYMBOL_DEFAULT, type ChainStatus } from '@elymum/shared';
import { getAddress } from 'viem';
import type { Journal } from '../stake/journal';
import { sessionKey, type ChainArena, type ChainGateway, type ChainSession, type ServerKeyInfo, type SettledEvent, type TokenReceipt } from './types';

/** Decimals of the fake token (18 like the real one; the ledger keeps 6 of them). */
const DECIMALS = 18;
/** Ledger decimals (`ledgerDecimals(18)`): what the rooms and the wire count in. */
const LEDGER_DECIMALS = 6;
/** Fee on profit, basis points (the contract default: 5 %). */
const FEE_BPS = 500;
const FAKE_TOKEN = '0x00000000000000000000000000000000DE7f4CE1';
const FAKE_ARENA = '0x000000000000000000000000000000000000fA4E';
const FAKE_SERVER = '0x00000000000000000000000000000000De75e12f';

/** A fake 0x transaction hash (32 random bytes). */
export const fakeTxHash = (): string => `0x${randomBytes(32).toString('hex')}`;

/** Dev-only actions the HTTP server exposes under `/api/dev/` when the fake chain runs. */
export interface DevFakeChainActions {
  /** Sets the fake game token (like `setToken` from /admin); false when it was already set. */
  devSetToken(): boolean;
  /**
   * "Mines" a game-token transfer (the web's fake wallet buying power-ups): `tokenReceipt` of the
   * returned hash shows it. Null while the token is not set or an address is malformed.
   */
  devTransfer(from: string, to: string, value: bigint): string | null;
}

/**
 * DEV ONLY (`DEV_FAKE_CHAIN=1` with `NODE_ENV=development`, see `assertDevFakeChainAllowed`). An in-memory chain so
 * the arena flow (ticket → play → death / round-end payout → settlement) can be driven
 * locally without a node:
 *  - the game token starts unset (practice only, arenas "opening soon") unless `tokenSet`
 *    (`DEV_FAKE_TOKEN=1`); `devSetToken` (the dev route `POST /api/dev/token`) sets it, which
 *    shows the default arenas and fires `onStatusChange`, like `setToken` on a real chain;
 *  - once set, every signed-in wallet has an open ticket in every default arena;
 *  - settlements are simulated `settleMs` after the journal item appears: the
 *    item is removed, the ticket closes and a `settled` event with the fee and a fake 0x hash fires.
 *    Loot sweeps are "burned" (counted in `burned`).
 *    Only items for tickets this instance issued are ever touched; it also runs
 *    on its own journal file (`journal.dev-fake.json`).
 */
export class DevFakeChain implements ChainGateway, DevFakeChainActions {
  readonly enabled = true;
  private readonly sessions = new Map<string, ChainSession>();
  private readonly byKey = new Map<string, ChainSession>();
  private readonly listeners: ((e: SettledEvent) => void)[] = [];
  private readonly statusListeners: (() => void)[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly scheduled = new Set<string>();
  private nextId = 1;
  private stopped = false;
  private tokenSet: boolean;
  /** Ledger units of floor loot burned at round ends. */
  burned = 0;
  /** Fake token transfers by hash (`devTransfer`). */
  private readonly transfers = new Map<string, TokenReceipt>();
  private block = 1n;

  constructor(
    private readonly journal: Journal,
    private readonly log: (m: string) => void,
    private readonly settleMs = 2600,
    opts: { tokenSet?: boolean } = {},
  ) {
    this.tokenSet = opts.tokenSet ?? false;
  }

  get tokenReady(): boolean {
    return this.tokenSet;
  }

  get stakeEnabled(): boolean {
    return this.tokenSet;
  }

  status(): ChainStatus {
    return {
      enabled: true,
      chainId: LOCALNET_CHAIN_ID,
      chainName: 'Localnet (dev fake)',
      rpcUrl: null,
      explorerUrl: null,
      arenaAddress: FAKE_ARENA,
      nftAddress: null,
      arenasEnabled: this.tokenSet,
      tokenReady: this.tokenSet,
      token: this.tokenSet ? { address: FAKE_TOKEN, symbol: TOKEN_SYMBOL_DEFAULT, decimals: DECIMALS } : null,
      feeBps: FEE_BPS,
      serverKey: FAKE_SERVER,
    };
  }

  serverInfo(): ServerKeyInfo {
    return { address: FAKE_SERVER, balanceWei: (10n ** 18n).toString(), low: false };
  }

  /** DEV ONLY: sets the fake game token; arenas appear and status listeners fire. */
  devSetToken(): boolean {
    if (this.tokenSet) return false;
    this.tokenSet = true;
    this.log(`chain(dev-fake): game token set (${FAKE_TOKEN}) — arenas open`);
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch (err) {
        this.log(`chain(dev-fake): status listener failed: ${(err as Error).stack ?? err}`);
      }
    }
    return true;
  }

  /** DEV ONLY: records a token transfer and returns its fake hash. */
  devTransfer(from: string, to: string, value: bigint): string | null {
    if (!this.tokenSet || value <= 0n) return null;
    let f: string;
    let t: string;
    try {
      f = getAddress(from);
      t = getAddress(to);
    } catch {
      return null;
    }
    const hash = fakeTxHash();
    this.transfers.set(hash, { status: 'success', blockNumber: this.block++, transfers: [{ token: getAddress(FAKE_TOKEN), from: f, to: t, value }] });
    return hash;
  }

  async tokenReceipt(hash: string): Promise<TokenReceipt | null> {
    return this.transfers.get(hash.toLowerCase()) ?? null;
  }

  async getSession(arenaId: number, player: string): Promise<ChainSession | null> {
    const arena = (await this.listArenas()).find((a) => a.id === arenaId);
    if (!arena) return null;
    let wallet: string;
    try {
      wallet = getAddress(player);
    } catch {
      return null;
    }
    const slot = `${arenaId}:${wallet.toLowerCase()}`;
    let s = this.sessions.get(slot);
    if (!s) {
      const id = this.nextId++;
      s = {
        key: sessionKey(arenaId, wallet, id),
        id,
        player: wallet,
        arenaId,
        entryFee: arena.entryFee,
        openedAt: Math.floor(Date.now() / 1000),
        finalized: false,
        owed: 0,
      };
      this.sessions.set(slot, s);
      this.byKey.set(s.key, s);
    }
    return s;
  }

  /** The default arenas once the token is set (none before: `createArena` needs the token). */
  async listArenas(): Promise<ChainArena[]> {
    if (!this.tokenSet) return [];
    return DEFAULT_ARENAS.map((a) => ({
      id: a.id,
      entryFee: a.entryTokens * 10 ** LEDGER_DECIMALS,
      maxSessions: a.maxSessions,
      openSessions: 0,
      enabled: true,
      // no real vault: the server's vault-vs-journal guard does not apply
      pot: null,
    }));
  }

  kick(): void {
    if (this.stopped) return;
    for (const item of this.journal.pending) {
      // only tickets this fake chain issued (and loot sweeps of its own journal file): anything else is real money, never touched
      if (item.kind === 'settle' && !this.byKey.has(item.key)) continue;
      if (item.kind !== 'settle' && item.kind !== 'sweep') continue;
      // integrity holds wait for an admin decision
      if (item.kind === 'settle' && item.held) continue;
      if (this.scheduled.has(item.key)) continue;
      this.scheduled.add(item.key);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.scheduled.delete(item.key);
        this.settle(item.key);
      }, this.settleMs);
      this.timers.add(timer);
    }
  }

  private settle(key: string): void {
    const item = this.journal.pending.find((p) => p.key === key);
    if (!item || this.stopped || (item.kind === 'settle' && item.held)) return;
    if (item.kind === 'sweep') {
      // sweepLoot: the floor loot of a finished round is burned from the arena vault
      this.journal.remove(key);
      this.burned += item.amount;
      this.log(`chain(dev-fake): burned ${item.amount} loot of ${item.roomId} round ${item.round}`);
      return;
    }
    const session = this.byKey.get(key);
    if (!session) return;
    const payout = item.payout ?? 0;
    const profit = Math.max(0, payout - session.entryFee);
    const fee = Math.floor((profit * FEE_BPS) / 10_000);
    this.journal.remove(key);
    this.sessions.delete(`${session.arenaId}:${session.player.toLowerCase()}`);
    this.byKey.delete(key);
    const txHash = fakeTxHash();
    this.log(`chain(dev-fake): settled ${key} payout=${payout} fee=${fee}`);
    for (const fn of this.listeners) fn({ key, player: session.player, arenaId: session.arenaId, txHash, payout, fee });
  }

  setLiveSessionProvider(): void {}

  onSettled(fn: (e: SettledEvent) => void): void {
    this.listeners.push(fn);
  }

  onStatusChange(fn: () => void): void {
    this.statusListeners.push(fn);
  }

  async start(): Promise<void> {
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

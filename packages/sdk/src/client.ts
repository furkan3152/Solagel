import { AnchorProvider, Program, utils } from '@anchor-lang/core';
import BN from 'bn.js';
import type { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
  type AccountInfo,
  type Commitment,
  type Connection,
  type Signer,
  type TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js';
import {
  ACCOUNT_NAMES,
  toArenaView,
  toConfigView,
  toProfileView,
  toSessionView,
  type ArenaView,
  type ConfigView,
  type ProfileView,
  type RawArena,
  type RawConfig,
  type RawProfile,
  type RawSession,
  type SessionView,
} from './accounts';
import type { IntLike } from './math';
import { pdas } from './pda';
import { IDL, PROGRAM_ID, toPublicKey, type Address, type Slana } from './program';
import { ata, tokenAccountAmount } from './token';

/** Arena ids probed when `getProgramAccounts` is unavailable (some public RPCs disable it). */
export const FALLBACK_ARENA_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const MULTIPLE_ACCOUNTS_CHUNK = 100;
const COMMITMENT: Commitment = 'confirmed';

export interface BuildTransactionOptions {
  /** Priority fee in micro-lamports per compute unit (adds `SetComputeUnitPrice`). */
  priorityMicroLamports?: number;
  /** Compute unit limit (adds `SetComputeUnitLimit`). */
  computeUnits?: number;
}

export interface SendOptions extends BuildTransactionOptions {
  /**
   * Called with the signature right after signing, before the transaction is sent, and the
   * `lastValidBlockHeight` of its blockhash ('confirmed'): once the block height passes it, the
   * transaction can never land.
   */
  onSignature?: (signature: string, lastValidBlockHeight: number) => void;
}

export interface BuiltTransaction {
  tx: Transaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * The game token accounts (`Config.tokenMint` / `Config.tokenProgram` once set; the result of
 * `requireToken(config)` fits).
 */
export interface TokenAccounts {
  tokenMint: Address;
  tokenProgram: Address;
}

export interface InitializeParams {
  serverAuthority: Address;
  /** Receives the whole fee on profit and swept vaults (its token account of the game mint). */
  feeWallet: Address;
  /** Fee on profit, `0..=MAX_FEE_BPS`. */
  feeBps: number;
  settleFeeLamports: IntLike;
}

/** Every field is optional; omitted fields keep their stored value. */
export interface UpdateConfigParams {
  admin?: Address;
  serverAuthority?: Address;
  feeWallet?: Address;
  feeBps?: number;
  settleFeeLamports?: IntLike;
  paused?: boolean;
}

export interface CreateArenaParams extends TokenAccounts {
  id: number;
  /** Token base units. */
  entryFee: IntLike;
  maxSessions: number;
}

export interface UpdateArenaParams {
  enabled?: boolean;
  maxSessions?: number;
  /** Token base units (only while no session is open). */
  entryFee?: IntLike;
}

export interface JoinArenaParams extends TokenAccounts {
  arenaId: number;
  /** The fee rate (bps) the player was shown: a higher `Config.feeBps` fails with `FeeAboveLimit`. */
  maxFeeBps: number;
  /** The entry fee (token base units) the player was shown: a higher one fails with `EntryFeeAboveLimit`. */
  maxEntryFee: IntLike;
  /** The settle deposit (lamports) the player was shown: a higher one fails with `SettleFeeAboveLimit`. */
  maxSettleFee: IntLike;
  /** Player's game-token account (default: their ATA). */
  playerToken?: Address;
}

export interface SettleSessionParams extends TokenAccounts {
  player: Address;
  arenaId: number;
  /** On-chain `Session.id` being settled. */
  sessionId: IntLike;
  /** Token base units paid out of the arena vault (the fee on profit is deducted on-chain). */
  payout: IntLike;
  score: number;
  kills: number;
  xp: number;
  /**
   * Token account of the game mint owned by `Config.feeWallet` that receives the fee
   * (usually `feeWalletAta(config)`). Required even when the fee is 0.
   */
  feeWalletToken: Address;
  /**
   * Player's game-token account (default: their ATA). `null` settles without one
   * (R24): the fee and stats happen, and the session is finalized with `owed` for the
   * player to collect via `refundSession`.
   */
  playerToken?: Address | null;
}

export interface RefundSessionParams extends TokenAccounts {
  arenaId: number;
  playerToken?: Address;
}

export interface SweepArenaParams extends TokenAccounts {
  id: number;
  /** Token account of the game mint owned by `Config.feeWallet` (usually `feeWalletAta(config)`). */
  feeWalletToken: Address;
}

export interface SweepLootParams extends TokenAccounts {
  id: number;
  /** Token base units to burn, at most the vault balance (`0` succeeds and burns nothing). */
  amount: IntLike;
}

export interface SetTokenMintParams {
  tokenMint: Address;
  /** SPL Token or Token-2022: the program that owns the mint account. */
  tokenProgram: Address;
}

/** Error thrown by `sendAndConfirm` when a transaction landed but failed. */
export class TransactionFailedError extends Error {
  constructor(
    readonly signature: string,
    readonly err: unknown,
    readonly logs: string[] | undefined,
  ) {
    super(`Transaction ${signature} failed: ${JSON.stringify(err)}`);
    this.name = 'TransactionFailedError';
  }
}

const toBN = (v: IntLike): BN => {
  if (BN.isBN(v)) return v as BN;
  if (typeof v === 'number' && (!Number.isSafeInteger(v) || v < 0)) throw new RangeError(`expected a non-negative integer, got ${v}`);
  if (typeof v === 'bigint' && (v < 0n || v >= 1n << 64n)) throw new RangeError(`expected a u64, got ${v}`);
  return new BN(v.toString());
};

const opt = <T, R>(v: T | undefined | null, f: (v: T) => R): R | null => (v === undefined || v === null ? null : f(v));

type ProviderWallet = ConstructorParameters<typeof AnchorProvider>[1];

/** A wallet that cannot sign: the client only reads and builds instructions. */
function readOnlyWallet(): ProviderWallet {
  const refuse = async (): Promise<never> => {
    throw new Error('SlanaClient is read-only: sign transactions with your wallet');
  };
  return {
    publicKey: PublicKey.default,
    signTransaction: refuse as <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
    signAllTransactions: refuse as <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>,
  };
}

export type SlanaInstructions = ReturnType<typeof createInstructionBuilders>;

/** A u16 basis-point bound (`maxFeeBps`). */
function checkBps(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`maxFeeBps must be a u16, got ${value}`);
  return value;
}

/** Instruction builders; every account is passed explicitly so no RPC call is needed. */
function createInstructionBuilders(program: Program<Slana>, programId: PublicKey) {
  const config = () => pdas.config(programId);
  const profile = (owner: Address) => pdas.profile(owner, programId);
  const arena = (id: number) => pdas.arena(id, programId);
  const vault = (arenaId: number) => pdas.vault(arena(arenaId), programId);
  const session = (arenaId: number, player: Address) => pdas.session(arena(arenaId), player, programId);
  const systemProgram = SystemProgram.programId;
  const tokens = (t: TokenAccounts) => ({ tokenMint: toPublicKey(t.tokenMint), tokenProgram: toPublicKey(t.tokenProgram) });
  const tokenAccount = (explicit: Address | undefined, owner: Address, t: TokenAccounts) =>
    explicit ? toPublicKey(explicit) : ata(owner, t.tokenMint, t.tokenProgram);

  return {
    /** Creates the config without a game token. `admin` must be the program's upgrade authority. */
    initialize(admin: Address, p: InitializeParams): Promise<TransactionInstruction> {
      return program.methods
        .initialize({
          feeBps: p.feeBps,
          settleFeeLamports: toBN(p.settleFeeLamports),
          serverAuthority: toPublicKey(p.serverAuthority),
          feeWallet: toPublicKey(p.feeWallet),
        })
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          program: programId,
          programData: pdas.programData(programId),
          systemProgram,
        })
        .instruction();
    },

    /**
     * Admin only, once: stores the game mint, its token program and decimals
     * (`TokenAlreadySet` afterwards). The program refuses a freeze authority and denied
     * Token-2022 extensions. Pair it with `createFeeWalletAtaIx` so the fee wallet can be paid.
     */
    setTokenMint(admin: Address, p: SetTokenMintParams): Promise<TransactionInstruction> {
      return program.methods
        .setTokenMint()
        .accountsPartial({ admin: toPublicKey(admin), config: config(), tokenMint: toPublicKey(p.tokenMint), tokenProgram: toPublicKey(p.tokenProgram) })
        .instruction();
    },

    updateConfig(admin: Address, p: UpdateConfigParams): Promise<TransactionInstruction> {
      return program.methods
        .updateConfig({
          admin: opt(p.admin, toPublicKey),
          serverAuthority: opt(p.serverAuthority, toPublicKey),
          feeWallet: opt(p.feeWallet, toPublicKey),
          feeBps: p.feeBps ?? null,
          settleFeeLamports: opt(p.settleFeeLamports, toBN),
          paused: p.paused ?? null,
        })
        .accountsPartial({ admin: toPublicKey(admin), config: config() })
        .instruction();
    },

    /** Fails with `TokenNotSet` until `setTokenMint` ran. */
    createArena(admin: Address, p: CreateArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .createArena(p.id, toBN(p.entryFee), p.maxSessions)
        .accountsPartial({ admin: toPublicKey(admin), config: config(), arena: arena(p.id), vault: vault(p.id), ...tokens(p), systemProgram })
        .instruction();
    },

    updateArena(admin: Address, id: number, changes: UpdateArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .updateArena(changes.enabled ?? null, changes.maxSessions ?? null, opt(changes.entryFee, toBN))
        .accountsPartial({ admin: toPublicKey(admin), config: config(), arena: arena(id) })
        .instruction();
    },

    registerPlayer(owner: Address, name: string, skin: number): Promise<TransactionInstruction> {
      return program.methods
        .registerPlayer(name, skin)
        .accountsPartial({ owner: toPublicKey(owner), config: config(), profile: profile(owner), systemProgram })
        .instruction();
    },

    updateProfile(owner: Address, changes: { name?: string; skin?: number }): Promise<TransactionInstruction> {
      return program.methods
        .updateProfile(changes.name ?? null, changes.skin ?? null)
        .accountsPartial({ owner: toPublicKey(owner), profile: profile(owner) })
        .instruction();
    },

    /** Pays `entryFee` tokens into the arena vault (and the settle deposit in lamports). Fails with `TokenNotSet` until the mint is set. */
    joinArena(player: Address, p: JoinArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .joinArena(checkBps(p.maxFeeBps), toBN(p.maxEntryFee), toBN(p.maxSettleFee))
        .accountsPartial({
          player: toPublicKey(player),
          config: config(),
          profile: profile(player),
          arena: arena(p.arenaId),
          vault: vault(p.arenaId),
          session: session(p.arenaId, player),
          playerToken: tokenAccount(p.playerToken, player, p),
          ...tokens(p),
          systemProgram,
        })
        .instruction();
    },

    /**
     * Server-signed settlement: the fee on profit (`splitPayout(payout, session.entryFee,
     * session.feeBps).fee`) goes to `feeWalletToken`, the rest to `playerToken`.
     *
     * `feeWalletToken` and `playerToken` must be different accounts: when the player is the
     * fee wallet itself and both resolve to its ATA, Anchor refuses the duplicate writable
     * account (error 2040, `ConstraintDuplicateMutableAccount`). The caller then passes another
     * token account of the fee wallet as `feeWalletToken`, or settles with `playerToken: null`
     * (finalize; the player collects `owed` with `refundSession`).
     */
    settleSession(server: Address, p: SettleSessionParams): Promise<TransactionInstruction> {
      if (p.playerToken !== null) {
        const playerToken = tokenAccount(p.playerToken, p.player, p);
        if (playerToken.equals(toPublicKey(p.feeWalletToken))) {
          throw new Error(
            'settleSession: feeWalletToken and playerToken are the same account (the program refuses it with 2040); ' +
              'pass another token account of the fee wallet, or playerToken: null',
          );
        }
      }
      return program.methods
        .settleSession({ sessionId: toBN(p.sessionId), payout: toBN(p.payout), score: p.score, kills: p.kills, xp: p.xp })
        .accountsPartial({
          server: toPublicKey(server),
          config: config(),
          arena: arena(p.arenaId),
          vault: vault(p.arenaId),
          session: session(p.arenaId, p.player),
          player: toPublicKey(p.player),
          playerToken: p.playerToken === null ? null : tokenAccount(p.playerToken, p.player, p),
          profile: profile(p.player),
          feeWalletToken: toPublicKey(p.feeWalletToken),
          ...tokens(p),
        })
        .instruction();
    },

    /**
     * The player's own close of a session: collects a finalized session's `owed` payout at
     * once, or refunds an unsettled one's entry fee 24 h after joining.
     */
    refundSession(player: Address, p: RefundSessionParams): Promise<TransactionInstruction> {
      return program.methods
        .refundSession()
        .accountsPartial({
          player: toPublicKey(player),
          config: config(),
          arena: arena(p.arenaId),
          vault: vault(p.arenaId),
          session: session(p.arenaId, player),
          playerToken: tokenAccount(p.playerToken, player, p),
          ...tokens(p),
        })
        .instruction();
    },

    /** Admin: moves a disabled, idle arena's whole vault to the fee wallet's token account. */
    sweepArena(admin: Address, p: SweepArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .sweepArena()
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          arena: arena(p.id),
          vault: vault(p.id),
          feeWalletToken: toPublicKey(p.feeWalletToken),
          ...tokens(p),
        })
        .instruction();
    },

    /**
     * Server-signed: burns `amount` of an arena vault's loot (floor loot at the bell), while
     * the arena runs. The mint is writable (the burn lowers the supply).
     */
    sweepLoot(server: Address, p: SweepLootParams): Promise<TransactionInstruction> {
      return program.methods
        .sweepLoot(toBN(p.amount))
        .accountsPartial({
          server: toPublicKey(server),
          config: config(),
          arena: arena(p.id),
          vault: vault(p.id),
          ...tokens(p),
        })
        .instruction();
    },
  };
}

/**
 * Read-only client for the Slana program: account readers (plain JS views) and instruction
 * builders. Works in browsers and Node; signing is up to the caller (wallet adapter / Keypair).
 */
export class SlanaClient {
  readonly programId: PublicKey;
  readonly program: Program<Slana>;
  readonly ix: SlanaInstructions;
  private readonly rentCache = new Map<number, number>();

  constructor(
    readonly connection: Connection,
    programId?: PublicKey | string,
  ) {
    this.programId = programId ? toPublicKey(programId) : PROGRAM_ID;
    const provider = new AnchorProvider(connection, readOnlyWallet(), { commitment: COMMITMENT, preflightCommitment: COMMITMENT });
    this.program = new Program<Slana>({ ...IDL, address: this.programId.toBase58() } as Slana, provider);
    this.ix = createInstructionBuilders(this.program, this.programId);
  }

  /* ------------------------------------------------------------------ */
  /* Low level                                                           */
  /* ------------------------------------------------------------------ */

  /** Rent-exempt minimum for `dataLength` bytes (cached per size). */
  async rentExemptMinimum(dataLength: number): Promise<number> {
    const hit = this.rentCache.get(dataLength);
    if (hit !== undefined) return hit;
    const lamports = await this.connection.getMinimumBalanceForRentExemption(dataLength, COMMITMENT);
    this.rentCache.set(dataLength, lamports);
    return lamports;
  }

  /** Decodes an account of this program; null when missing or owned by another program. */
  private decode<T>(name: string, info: AccountInfo<Buffer> | null): T | null {
    if (!info || !info.owner.equals(this.programId) || info.data.length === 0) return null;
    try {
      return this.program.coder.accounts.decode<T>(name, info.data);
    } catch (err) {
      throw new Error(`cannot decode ${name} account (is the SDK IDL in sync with the deployed program?): ${(err as Error).message}`);
    }
  }

  private async getMultiple(keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
    const out: (AccountInfo<Buffer> | null)[] = [];
    for (let i = 0; i < keys.length; i += MULTIPLE_ACCOUNTS_CHUNK) {
      const chunk = keys.slice(i, i + MULTIPLE_ACCOUNTS_CHUNK);
      out.push(...(await this.connection.getMultipleAccountsInfo(chunk, COMMITMENT)));
    }
    return out;
  }

  private async programAccounts(name: string): Promise<{ pubkey: PublicKey; account: AccountInfo<Buffer> }[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: COMMITMENT,
      filters: [{ memcmp: this.program.coder.accounts.memcmp(name) }],
    });
    return [...accounts];
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                               */
  /* ------------------------------------------------------------------ */

  /** True when the program account exists and is executable on this cluster. */
  async isDeployed(): Promise<boolean> {
    const info = await this.connection.getAccountInfo(this.programId, COMMITMENT);
    return !!info && info.executable;
  }

  /** The config, or null before `initialize`. `tokenMint` is null until `set_token_mint`. */
  async fetchConfig(): Promise<ConfigView | null> {
    const raw = this.decode<RawConfig>(ACCOUNT_NAMES.config, await this.connection.getAccountInfo(pdas.config(this.programId), COMMITMENT));
    return raw ? toConfigView(raw) : null;
  }

  async fetchProfile(owner: Address): Promise<ProfileView | null> {
    const address = pdas.profile(owner, this.programId);
    const raw = this.decode<RawProfile>(ACCOUNT_NAMES.profile, await this.connection.getAccountInfo(address, COMMITMENT));
    return raw ? toProfileView(address, raw) : null;
  }

  /** Profiles of many owners (same order; null where missing), batched by 100. */
  async fetchProfiles(owners: Address[]): Promise<(ProfileView | null)[]> {
    const keys = owners.map((o) => pdas.profile(o, this.programId));
    const infos = await this.getMultiple(keys);
    return infos.map((info, i) => {
      const raw = this.decode<RawProfile>(ACCOUNT_NAMES.profile, info);
      return raw ? toProfileView(keys[i], raw) : null;
    });
  }

  /** Token balance of a token account (0 when missing or not a token account). */
  private static amountOf(info: AccountInfo<Buffer> | null): bigint {
    return info && info.data.length >= 72 ? tokenAccountAmount(info.data) : 0n;
  }

  /** Token balance of any token account (0 when missing). */
  async fetchTokenAccountAmount(address: Address): Promise<bigint> {
    return SlanaClient.amountOf(await this.connection.getAccountInfo(toPublicKey(address), COMMITMENT));
  }

  async fetchArena(id: number): Promise<ArenaView | null> {
    const address = pdas.arena(id, this.programId);
    const [info, vaultInfo] = await this.getMultiple([address, pdas.vault(address, this.programId)]);
    const raw = this.decode<RawArena>(ACCOUNT_NAMES.arena, info);
    return raw ? toArenaView(address, raw, SlanaClient.amountOf(vaultInfo)) : null;
  }

  /** Every arena with its vault balance, sorted by id. Falls back to probing ids 1–8 when getProgramAccounts fails. */
  async fetchArenas(): Promise<ArenaView[]> {
    let found: { pubkey: PublicKey; account: AccountInfo<Buffer> | null }[];
    try {
      found = await this.programAccounts(ACCOUNT_NAMES.arena);
    } catch {
      const keys = FALLBACK_ARENA_IDS.map((id) => pdas.arena(id, this.programId));
      const infos = await this.getMultiple(keys);
      found = keys.map((pubkey, i) => ({ pubkey, account: infos[i] }));
    }
    const arenas: { pubkey: PublicKey; raw: RawArena }[] = [];
    for (const { pubkey, account } of found) {
      const raw = this.decode<RawArena>(ACCOUNT_NAMES.arena, account);
      if (raw) arenas.push({ pubkey, raw });
    }
    const vaults = await this.getMultiple(arenas.map((a) => a.raw.vault));
    return arenas.map((a, i) => toArenaView(a.pubkey, a.raw, SlanaClient.amountOf(vaults[i]))).sort((a, b) => a.id - b.id);
  }

  async fetchSession(arenaId: number, player: Address): Promise<SessionView | null> {
    const address = pdas.session(pdas.arena(arenaId, this.programId), player, this.programId);
    const raw = this.decode<RawSession>(ACCOUNT_NAMES.session, await this.connection.getAccountInfo(address, COMMITMENT));
    return raw ? toSessionView(address, raw) : null;
  }

  /** Every open session (getProgramAccounts), oldest first. */
  async fetchSessions(): Promise<SessionView[]> {
    const accounts = await this.programAccounts(ACCOUNT_NAMES.session);
    const views: SessionView[] = [];
    for (const { pubkey, account } of accounts) {
      const raw = this.decode<RawSession>(ACCOUNT_NAMES.session, account);
      if (raw) views.push(toSessionView(pubkey, raw));
    }
    return views.sort((a, b) => a.openedAt - b.openedAt || a.id - b.id);
  }

  /* ------------------------------------------------------------------ */
  /* Transactions                                                        */
  /* ------------------------------------------------------------------ */

  /** A legacy transaction with a fresh blockhash; ComputeBudget instructions are prepended when requested. */
  async buildTransaction(ixs: TransactionInstruction[], payer: Address, opts: BuildTransactionOptions = {}): Promise<BuiltTransaction> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(COMMITMENT);
    const tx = new Transaction({ feePayer: toPublicKey(payer), blockhash, lastValidBlockHeight });
    if (opts.computeUnits && opts.computeUnits > 0) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: Math.floor(opts.computeUnits) }));
    if (opts.priorityMicroLamports && opts.priorityMicroLamports > 0) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(opts.priorityMicroLamports) }));
    }
    tx.add(...ixs);
    return { tx, blockhash, lastValidBlockHeight };
  }

  /**
   * Builds, signs (first signer pays), sends and confirms ('confirmed', by polling, no
   * WebSocket needed). Throws web3.js' `SendTransactionError` (simulation logs),
   * `TransactionFailedError` (landed but failed) or `TransactionExpiredBlockheightExceededError`.
   * For keypair signers (scripts, the game server); browsers sign with the wallet adapter instead.
   */
  async sendAndConfirm(ixs: TransactionInstruction[], signers: Signer[], opts: SendOptions = {}): Promise<string> {
    if (signers.length === 0) throw new Error('sendAndConfirm needs at least one signer (the fee payer)');
    const { tx, lastValidBlockHeight } = await this.buildTransaction(ixs, signers[0].publicKey, opts);
    tx.sign(...signers);
    const signature = utils.bytes.bs58.encode(tx.signature!);
    opts.onSignature?.(signature, lastValidBlockHeight);
    await this.connection.sendRawTransaction(tx.serialize(), { preflightCommitment: COMMITMENT, maxRetries: 5 });
    await confirmSignature(this.connection, signature, lastValidBlockHeight);
    return signature;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `signature` is confirmed by polling `getSignatureStatuses` (works without a
 * WebSocket, unlike `connection.confirmTransaction`). Throws `TransactionFailedError` when the
 * transaction failed, `TransactionExpiredBlockheightExceededError` once its blockhash expired and
 * `TransactionExpiredTimeoutError` after `timeoutMs` (default 120 s; outcome unknown).
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const interval = opts.intervalMs ?? 750;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  for (let round = 0; ; round++) {
    if (opts.signal?.aborted) throw new Error(`confirmation of ${signature} aborted`);
    if (Date.now() > deadline) throw new TransactionExpiredTimeoutError(signature, timeoutMs / 1000);
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: round > 0 && round % 10 === 0 })).value[0];
    if (status?.err) {
      const details = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
      throw new TransactionFailedError(signature, status.err, details?.meta?.logMessages ?? undefined);
    }
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return;
    if (round % 4 === 3) {
      const height = await connection.getBlockHeight(COMMITMENT);
      if (height > lastValidBlockHeight) {
        const last = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (last?.err) throw new TransactionFailedError(signature, last.err, undefined);
        if (last && last.confirmationStatus !== 'processed') return;
        throw new TransactionExpiredBlockheightExceededError(signature);
      }
    }
    await sleep(interval);
  }
}

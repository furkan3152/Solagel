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
  toSeasonView,
  toSessionView,
  type ArenaView,
  type ConfigView,
  type ProfileView,
  type RawArena,
  type RawConfig,
  type RawProfile,
  type RawSeason,
  type RawSession,
  type SeasonView,
  type SessionView,
} from './accounts';
import { FIRST_SEASON } from './constants';
import type { IntLike } from './math';
import { pdas } from './pda';
import { IDL, PROGRAM_ID, toPublicKey, type Address, type Slana } from './program';

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
  /** Called with the signature right after signing, before the transaction is sent. */
  onSignature?: (signature: string) => void;
}

export interface BuiltTransaction {
  tx: Transaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SettleSessionParams {
  player: Address;
  arenaId: number;
  /** On-chain `Session.id` being settled. */
  sessionId: IntLike;
  /** Lamports paid out of the arena pot (fee on profit is deducted on-chain). */
  payout: IntLike;
  score: number;
  kills: number;
  xp: number;
  /** `Config.currentSeason` (selects the season PDA). */
  currentSeason: number;
  /** `Config.treasury`. */
  treasury: Address;
}

export interface RecordGameParams {
  player: Address;
  currentSeason: number;
  score: number;
  kills: number;
  xp: number;
}

export interface InitializeParams {
  serverAuthority: Address;
  treasury: Address;
  feeBps: number;
  seasonShareBps: number;
  /** Lamports. */
  skinPrice: IntLike;
}

export interface UpdateConfigParams {
  admin?: Address;
  serverAuthority?: Address;
  treasury?: Address;
  feeBps?: number;
  seasonShareBps?: number;
  /** Lamports. */
  skinPrice?: IntLike;
  paused?: boolean;
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

/** Instruction builders; every account is passed explicitly so no RPC call is needed. */
function createInstructionBuilders(program: Program<Slana>, programId: PublicKey) {
  const config = () => pdas.config(programId);
  const profile = (owner: Address) => pdas.profile(owner, programId);
  const arena = (id: number) => pdas.arena(id, programId);
  const session = (arenaId: number, player: Address) => pdas.session(arena(arenaId), player, programId);
  const season = (id: number) => pdas.season(id, programId);
  const systemProgram = SystemProgram.programId;

  return {
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

    buySkin(owner: Address, skin: number, treasury: Address): Promise<TransactionInstruction> {
      return program.methods
        .buySkin(skin)
        .accountsPartial({
          owner: toPublicKey(owner),
          config: config(),
          profile: profile(owner),
          treasury: toPublicKey(treasury),
          systemProgram,
        })
        .instruction();
    },

    joinArena(player: Address, arenaId: number): Promise<TransactionInstruction> {
      return program.methods
        .joinArena()
        .accountsPartial({
          player: toPublicKey(player),
          config: config(),
          profile: profile(player),
          arena: arena(arenaId),
          session: session(arenaId, player),
          systemProgram,
        })
        .instruction();
    },

    refundSession(player: Address, arenaId: number): Promise<TransactionInstruction> {
      return program.methods
        .refundSession()
        .accountsPartial({ player: toPublicKey(player), arena: arena(arenaId), session: session(arenaId, player) })
        .instruction();
    },

    claimSeasonReward(claimer: Address, seasonId: number): Promise<TransactionInstruction> {
      return program.methods
        .claimSeasonReward(seasonId)
        .accountsPartial({ claimer: toPublicKey(claimer), season: season(seasonId) })
        .instruction();
    },

    /** `seasonId` must be the current season (`Config.currentSeason`). */
    fundSeason(funder: Address, seasonId: number, lamports: IntLike): Promise<TransactionInstruction> {
      return program.methods
        .fundSeason(toBN(lamports))
        .accountsPartial({ funder: toPublicKey(funder), config: config(), season: season(seasonId), systemProgram })
        .instruction();
    },

    settleSession(server: Address, p: SettleSessionParams): Promise<TransactionInstruction> {
      return program.methods
        .settleSession({ sessionId: toBN(p.sessionId), payout: toBN(p.payout), score: p.score, kills: p.kills, xp: p.xp })
        .accountsPartial({
          server: toPublicKey(server),
          config: config(),
          arena: arena(p.arenaId),
          session: session(p.arenaId, p.player),
          player: toPublicKey(p.player),
          profile: profile(p.player),
          season: season(p.currentSeason),
          treasury: toPublicKey(p.treasury),
        })
        .instruction();
    },

    recordGame(server: Address, p: RecordGameParams): Promise<TransactionInstruction> {
      return program.methods
        .recordGame({ score: p.score, kills: p.kills, xp: p.xp })
        .accountsPartial({ server: toPublicKey(server), config: config(), profile: profile(p.player), season: season(p.currentSeason) })
        .instruction();
    },

    /** `admin` must be the program's upgrade authority. */
    initialize(admin: Address, p: InitializeParams): Promise<TransactionInstruction> {
      return program.methods
        .initialize({
          serverAuthority: toPublicKey(p.serverAuthority),
          treasury: toPublicKey(p.treasury),
          feeBps: p.feeBps,
          seasonShareBps: p.seasonShareBps,
          skinPrice: toBN(p.skinPrice),
        })
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          season: season(FIRST_SEASON),
          program: programId,
          programData: pdas.programData(programId),
          systemProgram,
        })
        .instruction();
    },

    updateConfig(admin: Address, p: UpdateConfigParams): Promise<TransactionInstruction> {
      return program.methods
        .updateConfig({
          admin: opt(p.admin, toPublicKey),
          serverAuthority: opt(p.serverAuthority, toPublicKey),
          treasury: opt(p.treasury, toPublicKey),
          feeBps: p.feeBps ?? null,
          seasonShareBps: p.seasonShareBps ?? null,
          skinPrice: opt(p.skinPrice, toBN),
          paused: p.paused ?? null,
        })
        .accountsPartial({ admin: toPublicKey(admin), config: config() })
        .instruction();
    },

    createArena(admin: Address, id: number, buyIn: IntLike, maxPlayers: number): Promise<TransactionInstruction> {
      return program.methods
        .createArena(id, toBN(buyIn), maxPlayers)
        .accountsPartial({ admin: toPublicKey(admin), config: config(), arena: arena(id), systemProgram })
        .instruction();
    },

    updateArena(admin: Address, id: number, changes: { enabled?: boolean; maxPlayers?: number }): Promise<TransactionInstruction> {
      return program.methods
        .updateArena(changes.enabled ?? null, changes.maxPlayers ?? null)
        .accountsPartial({ admin: toPublicKey(admin), config: config(), arena: arena(id) })
        .instruction();
    },

    /** Ends `currentSeason` and creates season `currentSeason + 1`. */
    endSeason(admin: Address, currentSeason: number): Promise<TransactionInstruction> {
      return program.methods
        .endSeason()
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          season: season(currentSeason),
          nextSeason: season(currentSeason + 1),
          systemProgram,
        })
        .instruction();
    },

    /** Moves the unclaimed prizes of finalized `seasonId` into `currentSeason`. */
    rolloverSeason(admin: Address, seasonId: number, currentSeason: number): Promise<TransactionInstruction> {
      return program.methods
        .rolloverSeason(seasonId)
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          oldSeason: season(seasonId),
          currentSeason: season(currentSeason),
        })
        .instruction();
    },

    sweepArena(admin: Address, id: number, treasury: Address): Promise<TransactionInstruction> {
      return program.methods
        .sweepArena()
        .accountsPartial({ admin: toPublicKey(admin), config: config(), arena: arena(id), treasury: toPublicKey(treasury) })
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

  private async arenaView(address: PublicKey, info: AccountInfo<Buffer> | null): Promise<ArenaView | null> {
    const raw = this.decode<RawArena>(ACCOUNT_NAMES.arena, info);
    if (!raw || !info) return null;
    return toArenaView(address, raw, info.lamports, await this.rentExemptMinimum(info.data.length));
  }

  async fetchArena(id: number): Promise<ArenaView | null> {
    const address = pdas.arena(id, this.programId);
    return this.arenaView(address, await this.connection.getAccountInfo(address, COMMITMENT));
  }

  /** Every arena, sorted by id. Falls back to probing ids 1–8 when getProgramAccounts fails. */
  async fetchArenas(): Promise<ArenaView[]> {
    let found: { pubkey: PublicKey; account: AccountInfo<Buffer> | null }[];
    try {
      found = await this.programAccounts(ACCOUNT_NAMES.arena);
    } catch {
      const keys = FALLBACK_ARENA_IDS.map((id) => pdas.arena(id, this.programId));
      const infos = await this.getMultiple(keys);
      found = keys.map((pubkey, i) => ({ pubkey, account: infos[i] }));
    }
    const views: ArenaView[] = [];
    for (const { pubkey, account } of found) {
      const view = await this.arenaView(pubkey, account);
      if (view) views.push(view);
    }
    return views.sort((a, b) => a.id - b.id);
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

  async fetchSeason(id: number): Promise<SeasonView | null> {
    const address = pdas.season(id, this.programId);
    const info = await this.connection.getAccountInfo(address, COMMITMENT);
    const raw = this.decode<RawSeason>(ACCOUNT_NAMES.season, info);
    if (!raw || !info) return null;
    return toSeasonView(address, raw, info.lamports, await this.rentExemptMinimum(info.data.length));
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
    opts.onSignature?.(signature);
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

import { AnchorProvider, Program, utils } from '@anchor-lang/core';
import BN from 'bn.js';
import type { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
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
  type RawMintCounter,
  type RawPassLock,
  type RawProfile,
  type RawSeason,
  type RawSession,
  type SeasonView,
  type SessionView,
} from './accounts';
import { FIRST_SEASON, MAX_BASE_URI_LEN } from './constants';
import { MPL_CORE_ID } from './core';
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
  /** Called with the signature right after signing, before the transaction is sent. */
  onSignature?: (signature: string) => void;
}

export interface BuiltTransaction {
  tx: Transaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

/** The game token accounts (`Config.tokenMint` / `Config.tokenProgram`; a `ConfigView` fits). */
export interface TokenAccounts {
  tokenMint: Address;
  tokenProgram: Address;
}

export interface InitializeParams extends TokenAccounts {
  serverAuthority: Address;
  feeBps: number;
  passFeeBps: number;
  /** `[treasuryBps, seasonBps, burnBps]`, sums to 10 000. */
  split: readonly [number, number, number];
  settleFeeLamports: IntLike;
}

/** Every field is optional; omitted fields keep their stored value. */
export interface UpdateConfigParams {
  admin?: Address;
  serverAuthority?: Address;
  feeBps?: number;
  passFeeBps?: number;
  /** `[treasuryBps, seasonBps, burnBps]`, sums to 10 000. */
  split?: readonly [number, number, number];
  settleFeeLamports?: IntLike;
  paused?: boolean;
  /** At most 96 bytes and must end with `/` (the program appends `<n>.json`). */
  passBaseUri?: string;
  /** `1..=MAX_PASS_SUPPLY`; frozen once the mint has opened (`SupplyLocked`). */
  passSupply?: number;
  passPerWallet?: number;
  /** Token base units. */
  passMinTokens?: IntLike;
  /** `true` opens the mint (never after it ended); `false` only before the first mint — use `closePassMint` after. */
  passMintOpen?: boolean;
  /** Unix seconds. */
  passMintStartTs?: IntLike;
}

export interface CreateArenaParams extends TokenAccounts {
  id: number;
  /** Token base units. */
  entryFee: IntLike;
  maxSessions: number;
  requiresPass: boolean;
}

export interface UpdateArenaParams {
  enabled?: boolean;
  maxSessions?: number;
  /** Token base units (only while no session is open). */
  entryFee?: IntLike;
  requiresPass?: boolean;
}

export interface JoinArenaParams extends TokenAccounts {
  arenaId: number;
  /**
   * The fee rate (bps) the player was shown: the program refuses the join (`FeeAboveLimit`)
   * if the rate it fixes into the session (`passFeeBps` with a Pass, else `feeBps`) is higher.
   */
  maxFeeBps: number;
  /** Player's game-token account (default: their ATA). */
  playerToken?: Address;
}

export interface JoinArenaWithPassParams extends JoinArenaParams {
  /** Core asset of the Slana Pass (locked at `passLock(asset)` until settle/refund). */
  passAsset: Address;
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
  /** `Config.currentSeason` (selects the season PDA). */
  currentSeason: number;
  /** `Session.hasPass`: the Pass lock is passed (and closed) only for Pass sessions. */
  hasPass: boolean;
  /** `Session.passAsset`; required when `hasPass`. */
  passAsset?: Address | null;
  /** Player's game-token account (default: their ATA). */
  playerToken?: Address;
}

export interface RefundSessionParams extends TokenAccounts {
  arenaId: number;
  /** `Session.passAsset` of a Pass session (its lock is closed too). */
  passAsset?: Address | null;
  playerToken?: Address;
}

export interface MintPassParams {
  /** Fresh keypair address for the new Core asset; it must co-sign. */
  asset: Address;
  /** `Config.passCollection`. */
  collection: Address;
  /** Minter's game-token account; needed only when `Config.passMinTokens > 0`. */
  minterToken?: Address | null;
}

export interface SweepArenaParams extends TokenAccounts {
  id: number;
  currentSeason: number;
}

export interface WithdrawTreasuryParams extends TokenAccounts {
  /** Token base units. */
  amount: IntLike;
  /** Destination token account of the game mint. */
  destination: Address;
}

export interface ClaimSeasonRewardParams extends TokenAccounts {
  seasonId: number;
  /** Claimer's game-token account (default: their ATA; create it idempotently first). */
  claimerToken?: Address;
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

/** i64 (may be negative). */
const toI64 = (v: IntLike): BN => {
  if (BN.isBN(v)) return v as BN;
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new RangeError(`expected an integer, got ${v}`);
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

function bytes32(value: Uint8Array | readonly number[], what: string): number[] {
  if (value.length !== 32) throw new RangeError(`${what} must be 32 bytes, got ${value.length}`);
  return Array.from(value);
}

/** `RangeError` unless `uri` is a valid Pass base URI (≤ 96 bytes, ends with `/`, no control characters). */
export function checkBaseUri(uri: string): void {
  const len = new TextEncoder().encode(uri).length;
  if (len > MAX_BASE_URI_LEN) throw new RangeError(`pass base URI is ${len} bytes, max ${MAX_BASE_URI_LEN}`);
  if (!uri.endsWith('/')) throw new RangeError('pass base URI must end with "/"');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(uri)) throw new RangeError('pass base URI contains control characters');
}

/** Instruction builders; every account is passed explicitly so no RPC call is needed. */
function createInstructionBuilders(program: Program<Slana>, programId: PublicKey) {
  const config = () => pdas.config(programId);
  const profile = (owner: Address) => pdas.profile(owner, programId);
  const arena = (id: number) => pdas.arena(id, programId);
  const vault = (arenaId: number) => pdas.vault(arena(arenaId), programId);
  const session = (arenaId: number, player: Address) => pdas.session(arena(arenaId), player, programId);
  const season = (id: number) => pdas.season(id, programId);
  const passLock = (asset: Address | null | undefined) => (asset ? pdas.passLock(asset, programId) : null);
  const systemProgram = SystemProgram.programId;
  const tokens = (t: TokenAccounts) => ({ tokenMint: toPublicKey(t.tokenMint), tokenProgram: toPublicKey(t.tokenProgram) });
  const tokenAccount = (explicit: Address | undefined, owner: Address, t: TokenAccounts) =>
    explicit ? toPublicKey(explicit) : ata(owner, t.tokenMint, t.tokenProgram);

  return {
    /** `admin` must be the program's upgrade authority. */
    initialize(admin: Address, p: InitializeParams): Promise<TransactionInstruction> {
      const [treasuryBps, seasonBps, burnBps] = p.split;
      return program.methods
        .initialize({
          serverAuthority: toPublicKey(p.serverAuthority),
          feeBps: p.feeBps,
          passFeeBps: p.passFeeBps,
          treasuryBps,
          seasonBps,
          burnBps,
          settleFeeLamports: toBN(p.settleFeeLamports),
        })
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          season: season(FIRST_SEASON),
          ...tokens(p),
          treasuryVault: pdas.treasuryVault(programId),
          seasonVault: pdas.seasonVault(programId),
          program: programId,
          programData: pdas.programData(programId),
          systemProgram,
        })
        .instruction();
    },

    updateConfig(admin: Address, p: UpdateConfigParams): Promise<TransactionInstruction> {
      if (p.passBaseUri !== undefined) checkBaseUri(p.passBaseUri);
      return program.methods
        .updateConfig({
          admin: opt(p.admin, toPublicKey),
          serverAuthority: opt(p.serverAuthority, toPublicKey),
          feeBps: p.feeBps ?? null,
          passFeeBps: p.passFeeBps ?? null,
          split: opt(p.split, (s) => [s[0], s[1], s[2]]),
          settleFeeLamports: opt(p.settleFeeLamports, toBN),
          paused: p.paused ?? null,
          passBaseUri: p.passBaseUri ?? null,
          passSupply: p.passSupply ?? null,
          passPerWallet: p.passPerWallet ?? null,
          passMinTokens: opt(p.passMinTokens, toBN),
          passMintOpen: p.passMintOpen ?? null,
          passMintStartTs: opt(p.passMintStartTs, toI64),
        })
        .accountsPartial({ admin: toPublicKey(admin), config: config() })
        .instruction();
    },

    /** `collection` must be a Core collection whose update authority is `pdas.passAuthority()`. */
    setPassCollection(admin: Address, collection: Address): Promise<TransactionInstruction> {
      return program.methods
        .setPassCollection()
        .accountsPartial({ admin: toPublicKey(admin), config: config(), collection: toPublicKey(collection), passAuthority: pdas.passAuthority(programId) })
        .instruction();
    },

    /** Commits `sha256(seed)` (allowed until the first mint). */
    setPassSeedHash(admin: Address, hash: Uint8Array | readonly number[]): Promise<TransactionInstruction> {
      const h = bytes32(hash, 'seed hash');
      return program.methods.setPassSeedHash(h).accountsPartial({ admin: toPublicKey(admin), config: config() }).instruction();
    },

    /** Ends the Pass mint for good and sets the entropy target slot (needs ≥ 1 minted Pass). */
    closePassMint(admin: Address): Promise<TransactionInstruction> {
      return program.methods.closePassMint().accountsPartial({ admin: toPublicKey(admin), config: config() }).instruction();
    },

    /**
     * Permissionless (any signer, e.g. the game server): stores the trait entropy once
     * `passEntropyTargetSlot` has passed, or moves the target if it left the SlotHashes window.
     */
    capturePassEntropy(signer: Address): Promise<TransactionInstruction> {
      return program.methods
        .capturePassEntropy()
        .accountsPartial({ signer: toPublicKey(signer), config: config(), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY })
        .instruction();
    },

    /** Reveals the seed (after the mint ended and the entropy was captured); stores the final seed. */
    revealPass(admin: Address, seed: Uint8Array | readonly number[]): Promise<TransactionInstruction> {
      const s = bytes32(seed, 'seed');
      return program.methods.revealPass(s).accountsPartial({ admin: toPublicKey(admin), config: config() }).instruction();
    },

    /** Free Pass mint; the `asset` keypair must sign the transaction as well as the minter. */
    mintPass(minter: Address, p: MintPassParams): Promise<TransactionInstruction> {
      return program.methods
        .mintPass()
        .accountsPartial({
          minter: toPublicKey(minter),
          asset: toPublicKey(p.asset),
          config: config(),
          collection: toPublicKey(p.collection),
          passAuthority: pdas.passAuthority(programId),
          mintCounter: pdas.passMinted(minter, programId),
          minterToken: p.minterToken ? toPublicKey(p.minterToken) : null,
          mplCoreProgram: MPL_CORE_ID,
          systemProgram,
        })
        .instruction();
    },

    createArena(admin: Address, p: CreateArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .createArena(p.id, toBN(p.entryFee), p.maxSessions, p.requiresPass)
        .accountsPartial({ admin: toPublicKey(admin), config: config(), arena: arena(p.id), vault: vault(p.id), ...tokens(p), systemProgram })
        .instruction();
    },

    updateArena(admin: Address, id: number, changes: UpdateArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .updateArena(changes.enabled ?? null, changes.maxSessions ?? null, opt(changes.entryFee, toBN), changes.requiresPass ?? null)
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

    /** Pays `entryFee` tokens into the arena vault (and the settle deposit in lamports). */
    joinArena(player: Address, p: JoinArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .joinArena(checkBps(p.maxFeeBps))
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

    /** Like `joinArena`, backed by a Slana Pass (lower fee, season points); locks `passLock(asset)`. */
    joinArenaWithPass(player: Address, p: JoinArenaWithPassParams): Promise<TransactionInstruction> {
      return program.methods
        .joinArenaWithPass(checkBps(p.maxFeeBps))
        .accountsPartial({
          player: toPublicKey(player),
          config: config(),
          profile: profile(player),
          arena: arena(p.arenaId),
          vault: vault(p.arenaId),
          session: session(p.arenaId, player),
          playerToken: tokenAccount(p.playerToken, player, p),
          ...tokens(p),
          passAsset: toPublicKey(p.passAsset),
          passLock: pdas.passLock(p.passAsset, programId),
          systemProgram,
        })
        .instruction();
    },

    settleSession(server: Address, p: SettleSessionParams): Promise<TransactionInstruction> {
      if (p.hasPass && !p.passAsset) throw new Error('settleSession: hasPass needs the session passAsset');
      return program.methods
        .settleSession({ sessionId: toBN(p.sessionId), payout: toBN(p.payout), score: p.score, kills: p.kills, xp: p.xp })
        .accountsPartial({
          server: toPublicKey(server),
          config: config(),
          arena: arena(p.arenaId),
          vault: vault(p.arenaId),
          session: session(p.arenaId, p.player),
          player: toPublicKey(p.player),
          playerToken: tokenAccount(p.playerToken, p.player, p),
          profile: profile(p.player),
          season: season(p.currentSeason),
          treasuryVault: pdas.treasuryVault(programId),
          seasonVault: pdas.seasonVault(programId),
          ...tokens(p),
          passLock: p.hasPass ? passLock(p.passAsset) : null,
        })
        .instruction();
    },

    /** The player's own refund, 24 h after joining. */
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
          passLock: passLock(p.passAsset),
        })
        .instruction();
    },

    /** Moves a disabled, idle arena's vault into the current season's pool. */
    sweepArena(admin: Address, p: SweepArenaParams): Promise<TransactionInstruction> {
      return program.methods
        .sweepArena()
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          arena: arena(p.id),
          vault: vault(p.id),
          season: season(p.currentSeason),
          seasonVault: pdas.seasonVault(programId),
          ...tokens(p),
        })
        .instruction();
    },

    withdrawTreasury(admin: Address, p: WithdrawTreasuryParams): Promise<TransactionInstruction> {
      return program.methods
        .withdrawTreasury(toBN(p.amount))
        .accountsPartial({
          admin: toPublicKey(admin),
          config: config(),
          treasuryVault: pdas.treasuryVault(programId),
          destination: toPublicKey(p.destination),
          ...tokens(p),
        })
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

    claimSeasonReward(claimer: Address, p: ClaimSeasonRewardParams): Promise<TransactionInstruction> {
      return program.methods
        .claimSeasonReward(p.seasonId)
        .accountsPartial({
          claimer: toPublicKey(claimer),
          config: config(),
          season: season(p.seasonId),
          seasonVault: pdas.seasonVault(programId),
          claimerToken: tokenAccount(p.claimerToken, claimer, p),
          ...tokens(p),
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

  /** Token balance of a token account (0 when missing or not a token account). */
  private static amountOf(info: AccountInfo<Buffer> | null): bigint {
    return info && info.data.length >= 72 ? tokenAccountAmount(info.data) : 0n;
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

  /** The lock of a Pass asset while it backs an open session (null = free). */
  async fetchPassLock(asset: Address): Promise<{ address: string; session: string; player: string } | null> {
    const address = pdas.passLock(asset, this.programId);
    const raw = this.decode<RawPassLock>(ACCOUNT_NAMES.passLock, await this.connection.getAccountInfo(address, COMMITMENT));
    return raw ? { address: address.toBase58(), session: raw.session.toBase58(), player: raw.player.toBase58() } : null;
  }

  /** Passes minted by `wallet` so far (its `MintCounter`, 0 when none). */
  async fetchMintedCount(wallet: Address): Promise<number> {
    const raw = this.decode<RawMintCounter>(ACCOUNT_NAMES.mintCounter, await this.connection.getAccountInfo(pdas.passMinted(wallet, this.programId), COMMITMENT));
    return raw ? raw.count : 0;
  }

  /** Token balance of the treasury and season vaults (base units). */
  async fetchVaultBalances(): Promise<{ treasury: bigint; season: bigint }> {
    const [treasury, season] = await this.getMultiple([pdas.treasuryVault(this.programId), pdas.seasonVault(this.programId)]);
    return { treasury: SlanaClient.amountOf(treasury), season: SlanaClient.amountOf(season) };
  }

  async fetchSeason(id: number): Promise<SeasonView | null> {
    const address = pdas.season(id, this.programId);
    const raw = this.decode<RawSeason>(ACCOUNT_NAMES.season, await this.connection.getAccountInfo(address, COMMITMENT));
    return raw ? toSeasonView(address, raw) : null;
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

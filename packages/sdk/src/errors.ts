/**
 * Error helpers: extract the program error code from whatever a wallet, web3.js or Anchor
 * throws, and turn it into a short message players can understand.
 */

import { toBase58, type Address } from './program';

export interface ErrorInfo {
  code: number;
  name: string;
  /** Friendly, player-facing message. */
  message: string;
}

/** `SlanaError` codes (6000 + enum index in `error.rs`). */
export const SlanaErrorCode = {
  Unauthorized: 6000,
  Paused: 6001,
  InvalidFee: 6002,
  InvalidName: 6003,
  InvalidSkin: 6004,
  ArenaDisabled: 6005,
  ArenaFull: 6006,
  InsufficientPot: 6007,
  RefundTooEarly: 6008,
  SeasonFinalized: 6009,
  SeasonNotFinalized: 6010,
  NotEligible: 6011,
  AlreadyClaimed: 6012,
  ClaimWindowClosed: 6013,
  ClaimWindowOpen: 6014,
  InvalidSeason: 6015,
  ArenaHasOpenSessions: 6016,
  InvalidAmount: 6017,
  MathOverflow: 6018,
  SessionMismatch: 6019,
  MintNotAllowed: 6020,
  FreezeAuthorityPresent: 6021,
  PassRequired: 6022,
  PassNotOwned: 6023,
  PassWrongCollection: 6024,
  PassInUse: 6025,
  MintClosed: 6026,
  /** @deprecated Unreachable: selling out ends the mint, later mints fail with `MintClosed`. Kept for its code. */
  MintSoldOut: 6027,
  MintLimit: 6028,
  MintMinTokens: 6029,
  SeedMismatch: 6030,
  SeedNotSet: 6031,
  AlreadyRevealed: 6032,
  CollectionAlreadySet: 6033,
  CollectionNotSet: 6034,
  BadCollection: 6035,
  BadSplit: 6036,
  ArenaBusy: 6037,
  BadBaseUri: 6038,
  InvalidMaxSessions: 6039,
  EntryFeeZero: 6040,
  SeedLocked: 6041,
  MintStillOpen: 6042,
  MintEnded: 6043,
  SupplyLocked: 6044,
  UseCloseMint: 6045,
  BadSlotHashes: 6046,
  NothingMinted: 6047,
  EntropyNotReady: 6048,
  EntropyNotCaptured: 6049,
  SeedNotRevealed: 6050,
  FeeAboveLimit: 6051,
  EntryFeeAboveLimit: 6052,
  SettleFeeAboveLimit: 6053,
  SessionFinalized: 6054,
  InvalidAuthority: 6055,
} as const;

export type SlanaErrorName = keyof typeof SlanaErrorCode;

/** Player-facing message for an "already in use" failure on a Pass lock. */
export const PASS_IN_USE_MESSAGE = 'This Pass is already backing another open session.';

/** Player-facing message for an "already in use" failure on the arena session PDA. */
export const SESSION_IN_USE_MESSAGE =
  'You still have a session in this arena. Collect your payout (or resume your ticket) first.';

const FRIENDLY: Record<SlanaErrorName, string> = {
  Unauthorized: 'You are not allowed to do that (wrong wallet or account).',
  Paused: 'Slana is paused for maintenance — arena joins are disabled for now.',
  InvalidFee: 'Invalid fee configuration.',
  InvalidName: 'Names must be 1–16 bytes long and cannot contain control characters.',
  InvalidSkin: 'That skin does not exist.',
  ArenaDisabled: 'This arena is closed right now.',
  ArenaFull: 'This arena is full — try again in a moment.',
  InsufficientPot: 'The arena pot cannot cover this payout right now.',
  RefundTooEarly: 'Refunds open 24 hours after you joined the arena.',
  SeasonFinalized: 'This season has already ended.',
  SeasonNotFinalized: 'This season is still running.',
  NotEligible: 'Only the top 10 of a finished season can claim a prize.',
  AlreadyClaimed: 'You already claimed this prize.',
  ClaimWindowClosed: 'The 30-day claim window for this season is over.',
  ClaimWindowOpen: 'The claim window of that season is still open.',
  InvalidSeason: 'Invalid season.',
  ArenaHasOpenSessions: 'The arena still has open sessions.',
  InvalidAmount: 'Invalid amount.',
  MathOverflow: 'That amount is too large.',
  SessionMismatch: 'This settlement belongs to an older arena session.',
  MintNotAllowed: 'This token mint is not supported.',
  FreezeAuthorityPresent: 'The token mint must not have a freeze authority.',
  PassRequired: 'This arena is for Slana Pass holders only.',
  PassNotOwned: 'That Slana Pass is not in your wallet.',
  PassWrongCollection: 'That NFT is not a Slana Pass.',
  PassInUse: PASS_IN_USE_MESSAGE,
  MintClosed: 'The Slana Pass mint is closed right now.',
  MintSoldOut: 'All Slana Passes have been minted.',
  MintLimit: 'You already minted the maximum number of Passes for one wallet.',
  MintMinTokens: 'You need more tokens in your wallet to mint a Pass.',
  SeedMismatch: 'The seed does not match the committed hash.',
  SeedNotSet: 'The Pass seed hash is not set yet.',
  AlreadyRevealed: 'Pass traits are already revealed.',
  CollectionAlreadySet: 'The Pass collection is already set.',
  CollectionNotSet: 'The Pass collection is not set yet.',
  BadCollection: 'Invalid Pass collection.',
  BadSplit: 'The fee split must add up to 100 %.',
  ArenaBusy: 'The arena has open sessions — try again when they are settled.',
  BadBaseUri: "The Pass base URI is invalid (max 96 bytes, must end with '/', frozen after the first mint).",
  InvalidMaxSessions: 'Max sessions must be between 2 and 2000.',
  EntryFeeZero: 'The entry fee must be greater than zero.',
  SeedLocked: 'The Pass seed hash cannot change after the first mint.',
  MintStillOpen: 'Close the Pass mint (or sell out) before revealing.',
  MintEnded: 'The Pass mint has ended for good and cannot reopen.',
  SupplyLocked: 'The Pass supply cannot change once the mint has opened.',
  UseCloseMint: 'Passes were minted: end the mint with close-mint (it fixes the trait entropy).',
  BadSlotHashes: 'The SlotHashes sysvar account is missing or invalid.',
  NothingMinted: 'No Pass has been minted yet.',
  EntropyNotReady: 'The Pass entropy slot has not passed yet; try again in a minute.',
  EntropyNotCaptured: 'The Pass entropy is not captured yet (capture-entropy).',
  SeedNotRevealed: 'The Pass seed is not revealed yet; the reveal completes after it.',
  FeeAboveLimit: 'The fee changed a moment ago and is now higher than shown. Nothing was charged; check the ticket again.',
  EntryFeeAboveLimit: 'The entry fee changed a moment ago and is now higher than shown. Nothing was charged; check the ticket again.',
  SettleFeeAboveLimit: 'The settle deposit changed a moment ago and is now higher than shown. Nothing was charged; check the ticket again.',
  SessionFinalized: 'This game is already settled. Collect your payout.',
  InvalidAuthority: 'The admin or server key must not be the default (all zero) key.',
};

/** Program errors by code (6000–6055). */
export const SLANA_ERRORS: Readonly<Record<number, ErrorInfo>> = Object.fromEntries(
  (Object.keys(SlanaErrorCode) as SlanaErrorName[]).map((name) => [
    SlanaErrorCode[name],
    { code: SlanaErrorCode[name], name, message: FRIENDLY[name] },
  ]),
);

/** The Anchor framework errors this program can realistically hit. */
export const ANCHOR_ERRORS: Readonly<Record<number, ErrorInfo>> = Object.fromEntries(
  (
    [
      [101, 'InstructionFallbackNotFound', 'The program on this cluster does not match this app version.'],
      [102, 'InstructionDidNotDeserialize', 'The program could not read this request (version mismatch?).'],
      [2000, 'ConstraintMut', 'An account that must be writable was passed read-only.'],
      [2001, 'ConstraintHasOne', 'That account belongs to someone else.'],
      [2002, 'ConstraintSigner', 'A required signature is missing.'],
      [2003, 'ConstraintRaw', 'An account constraint was violated.'],
      [2006, 'ConstraintSeeds', 'Account address mismatch — the data was stale, please try again.'],
      [2012, 'ConstraintAddress', 'Unexpected account address — please refresh and try again.'],
      [2014, 'ConstraintTokenMint', 'That token account holds a different token.'],
      [2015, 'ConstraintTokenOwner', 'That token account belongs to someone else.'],
      [3001, 'AccountDiscriminatorNotFound', 'An account has no data (not created yet).'],
      [3002, 'AccountDiscriminatorMismatch', 'An account has the wrong type.'],
      [3003, 'AccountDidNotDeserialize', 'An account could not be read (version mismatch?).'],
      [3007, 'AccountOwnedByWrongProgram', 'An account is owned by the wrong program.'],
      [3012, 'AccountNotInitialized', 'A required account does not exist yet (create a profile first, or it was already closed).'],
      [4100, 'DeclaredProgramIdMismatch', 'The program id does not match this app.'],
    ] as const
  ).map(([code, name, message]) => [code, { code, name, message }]),
);

const MAX_DEPTH = 4;
const NESTED_KEYS = ['cause', 'error', 'originalError', 'inner', 'err'] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/** `{ InstructionError: [index, { Custom: n }] }` → n. */
function customFromTxError(v: unknown): number | null {
  const r = asRecord(v);
  if (!r) return null;
  const ie = r.InstructionError;
  if (Array.isArray(ie) && ie.length === 2) {
    const inner = asRecord(ie[1]);
    if (inner && typeof inner.Custom === 'number') return inner.Custom;
  }
  return null;
}

/** Program error code in transaction logs (Anchor log line or `custom program error: 0x..`). */
export function codeFromLogs(logs: readonly string[]): number | null {
  for (const line of logs) {
    const m = /Error Number: (\d+)/.exec(line);
    if (m) return Number(m[1]);
  }
  for (const line of logs) {
    const c = codeFromText(line);
    if (c !== null) return c;
  }
  return null;
}

/** Program error code embedded in an error message. */
export function codeFromText(text: string): number | null {
  const patterns: [RegExp, number][] = [
    [/Error Number: (\d+)/, 10],
    [/"Custom"\s*:\s*(\d+)/, 10],
    [/Custom\((\d+)\)/, 10],
    [/custom program error: 0x([0-9a-fA-F]+)/, 16],
  ];
  for (const [re, radix] of patterns) {
    const m = re.exec(text);
    if (m) return parseInt(m[1], radix);
  }
  return null;
}

function logsOf(r: Record<string, unknown>): string[] | null {
  for (const k of ['logs', 'transactionLogs', 'errorLogs']) {
    const v = r[k];
    if (Array.isArray(v) && v.every((l) => typeof l === 'string')) return v as string[];
  }
  const sim = asRecord(r.simulationResponse);
  if (sim && Array.isArray(sim.logs)) return sim.logs as string[];
  return null;
}

function findCode(err: unknown, depth: number): number | null {
  if (err === null || err === undefined || depth > MAX_DEPTH) return null;
  if (typeof err === 'string') return codeFromText(err);
  const r = asRecord(err);
  if (!r) return null;

  // AnchorError: { error: { errorCode: { number } } }
  const anchor = asRecord(asRecord(r.error)?.errorCode);
  if (anchor && typeof anchor.number === 'number') return anchor.number;
  // Anchor ProgramError: { code, msg }
  if (typeof r.code === 'number' && typeof r.msg === 'string') return r.code;
  // Raw transaction error objects (confirmTransaction value.err, SendTransactionError.transactionError)
  const direct = customFromTxError(r) ?? customFromTxError(r.err) ?? customFromTxError(asRecord(r.value)?.err);
  if (direct !== null) return direct;

  const logs = logsOf(r);
  if (logs) {
    const c = codeFromLogs(logs);
    if (c !== null) return c;
  }
  if (typeof r.message === 'string') {
    const c = codeFromText(r.message);
    if (c !== null) return c;
  }
  const txErr = asRecord(r.transactionError);
  if (txErr && typeof txErr.message === 'string') {
    const c = codeFromText(txErr.message);
    if (c !== null) return c;
  }
  // Wallet adapters and wrappers keep the original error in `error`/`cause`.
  for (const k of NESTED_KEYS) {
    const inner = r[k];
    if (inner !== undefined && inner !== err) {
      const c = findCode(inner, depth + 1);
      if (c !== null) return c;
    }
  }
  return null;
}

/**
 * Program error code (e.g. 6011) carried by an Anchor error, a `SendTransactionError`
 * (simulation logs), a confirmation error (`InstructionError: Custom(n)`) or a wallet error
 * wrapping one of those. `null` when there is none.
 */
export function programErrorCode(err: unknown): number | null {
  return findCode(err, 0);
}

/** Every message/log string reachable from an error (for pattern matching). */
function collectText(err: unknown, depth = 0, out: string[] = []): string[] {
  if (err === null || err === undefined || depth > MAX_DEPTH) return out;
  if (typeof err === 'string') {
    out.push(err);
    return out;
  }
  const r = asRecord(err);
  if (!r) return out;
  if (typeof r.message === 'string') out.push(r.message);
  if (typeof r.name === 'string') out.push(r.name);
  const logs = logsOf(r);
  if (logs) out.push(...logs);
  const txErr = asRecord(r.transactionError);
  if (txErr && typeof txErr.message === 'string') out.push(txErr.message);
  for (const k of NESTED_KEYS) {
    const inner = r[k];
    if (inner !== undefined && inner !== err) {
      if (typeof inner === 'object' && inner !== null && !(inner instanceof Error) && !('message' in inner)) {
        try {
          out.push(JSON.stringify(inner));
        } catch {
          /* ignore */
        }
      }
      collectText(inner, depth + 1, out);
    }
  }
  return out;
}

function walletCode(err: unknown, depth = 0): number | null {
  const r = asRecord(err);
  if (!r || depth > MAX_DEPTH) return null;
  if (typeof r.code === 'number' && r.code === 4001) return 4001;
  for (const k of NESTED_KEYS) {
    const c = walletCode(r[k], depth + 1);
    if (c !== null) return c;
  }
  return null;
}

export interface DescribedError {
  /** Program error code, if the error came from a program. */
  code: number | null;
  /** Stable name for i18n (`InsufficientPot`, `UserRejected`, …), null when unknown. */
  name: string | null;
  /** Player-facing message. */
  message: string;
}

const KNOWN_TEXT: [RegExp, string, string][] = [
  [/user rejected|rejected the request|user denied|request rejected|user canceled|user cancelled/i, 'UserRejected', 'You cancelled the request in your wallet.'],
  [
    /Attempt to debit an account but found no record of a prior credit|insufficient funds|insufficient lamports|InsufficientFundsFor(Fee|Rent)/i,
    'InsufficientFunds',
    'Not enough SOL in your wallet for this (including the network fee).',
  ],
  [
    /was not confirmed in|TransactionExpiredTimeoutError/i,
    'ConfirmationTimeout',
    'The network is slow — the transaction may still go through. Check your wallet before retrying.',
  ],
  [
    /block height exceeded|blockhash not found|TransactionExpired|has expired|BlockhashNotFound/i,
    'BlockhashExpired',
    'The transaction expired before it was confirmed — please try again.',
  ],
  [/already in use/i, 'AccountAlreadyInUse', 'That account already exists (already registered or already joined?).'],
];

const NETWORK_TEXT =
  /failed to fetch|fetch failed|networkerror|network request failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|429|too many requests|timed out|timeout/i;

function plainMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  const r = asRecord(err);
  if (r && typeof r.message === 'string' && r.message.trim()) {
    // web3.js prepends long "Simulation failed." prefixes and appends logs; keep the first line.
    return r.message.split('\n')[0].trim();
  }
  return 'Something went wrong.';
}

export interface DescribeContext {
  /** `pass_lock` PDA of the transaction: "already in use" on it means the Pass is busy. */
  passLock?: Address | null;
  /** Session PDA of a join: "already in use" on it means a session (maybe finalized) is still open. */
  session?: Address | null;
}

/** Maps any error to `{ code, name, message }` with a friendly message. */
export function describeError(err: unknown, ctx: DescribeContext = {}): DescribedError {
  const code = programErrorCode(err);
  if (code !== null && SLANA_ERRORS[code]) {
    const e = SLANA_ERRORS[code];
    return { code, name: e.name, message: e.message };
  }
  const text = collectText(err).join('\n');
  if (/already in use/i.test(text)) {
    const lock = ctx.passLock ? toBase58(ctx.passLock) : null;
    if (/\bpass_lock\b/.test(text) || (lock !== null && text.includes(lock))) {
      return { code: SlanaErrorCode.PassInUse, name: 'PassInUse', message: PASS_IN_USE_MESSAGE };
    }
    const session = ctx.session ? toBase58(ctx.session) : null;
    if (session !== null && text.includes(session)) {
      return { code: null, name: 'SessionInUse', message: SESSION_IN_USE_MESSAGE };
    }
  }
  if (walletCode(err) === 4001) return { code: null, name: 'UserRejected', message: 'You cancelled the request in your wallet.' };
  for (const [re, name, message] of KNOWN_TEXT) {
    if (re.test(text)) return { code: name === 'UserRejected' ? null : code, name, message };
  }
  if (code !== null) {
    const e = ANCHOR_ERRORS[code];
    if (e) return { code, name: e.name, message: e.message };
    return { code, name: null, message: `The transaction failed (program error ${code}).` };
  }
  if (NETWORK_TEXT.test(text)) {
    return { code: null, name: 'NetworkError', message: 'Could not reach the Solana network — check your connection and try again.' };
  }
  return { code: null, name: null, message: plainMessage(err) };
}

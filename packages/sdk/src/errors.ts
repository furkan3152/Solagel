import { elymumArenaAbi, elymumNFTAbi, testTokenAbi } from '@elymum/contracts';
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi, type Hex } from 'viem';

type AbiError = Extract<Abi[number], { type: 'error' }>;

/**
 * Error helpers: turn whatever viem, a browser wallet or an RPC throws into a short message
 * people understand. Custom errors of both contracts (and of OpenZeppelin's ERC-20/721/Ownable)
 * are decoded with the bundled ABIs; wallet errors (4001 rejected, 4902 unknown chain, chain
 * mismatch, insufficient funds) get their own kinds.
 */

/** Every custom error the SDK can decode (both contracts, the TestToken and OZ ERC-20 errors), de-duplicated by name (same-named errors have the same selector). */
export const ELYMUM_ERRORS_ABI: readonly AbiError[] = (() => {
  const seen = new Map<string, AbiError>();
  for (const item of [...elymumArenaAbi, ...elymumNFTAbi, ...testTokenAbi] as readonly Abi[number][]) {
    if (item.type === 'error' && !seen.has(item.name)) seen.set(item.name, item as AbiError);
  }
  return [...seen.values()];
})();

/** Player/admin-facing text per custom error name. */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // ElymumArena
  ZeroAddress: 'An address must not be the zero address.',
  NotServer: 'Only the game server key can do that.',
  Paused: 'Elymum is paused for maintenance: arena joins are closed for now.',
  TokenNotSet: 'Arenas are opening soon: the game token is not set yet.',
  TokenAlreadySet: 'The game token is already set; it can be set only once.',
  NotAContract: 'That address is not a contract.',
  InvalidFee: 'The fee must be at most 10 %.',
  InvalidArenaId: 'Arena ids start at 1.',
  ArenaExists: 'That arena already exists.',
  UnknownArena: 'That arena does not exist.',
  EntryFeeZero: 'The entry fee must be greater than zero.',
  InvalidMaxSessions: 'Max sessions must be between 2 and 2000.',
  ArenaBusy: 'The arena has open tickets: its entry fee can change once they are settled.',
  ArenaDisabled: 'This arena is closed right now.',
  ArenaEnabled: 'Disable the arena before sweeping it.',
  ArenaFull: 'This arena is full. Try again in a moment.',
  ArenaHasOpenSessions: 'The arena still has open tickets.',
  SessionExists: 'You already have a ticket in this arena. Play it, or collect your payout first.',
  NoSession: 'You have no ticket in this arena.',
  RefundTooEarly: 'Refunds open 24 hours after you joined.',
  InsufficientVault: 'The arena vault cannot cover that amount right now.',
  FeeOnTransferToken: 'Tokens that take a fee on transfer are not supported.',
  SweepIdNotIncreasing: 'That loot sweep was already done.',
  CannotRescueGameToken: 'The game token can never be rescued.',
  NativeTransferFailed: 'The HYPE transfer failed.',
  RenounceDisabled: 'Ownership cannot be renounced.',
  HoldersOnly: 'This arena is for Elymum emblem holders only. Mint or hold an emblem to enter.',
  SafeERC20FailedOperation: 'The token transfer failed.',
  ReentrancyGuardReentrantCall: 'Re-entrant call refused.',
  OwnableUnauthorizedAccount: 'Only the contract owner can do that. Connect the owner wallet.',
  OwnableInvalidOwner: 'That owner address is not valid.',
  // ElymumNFT
  ZeroQuantity: 'Choose at least one.',
  MintClosed: 'The mint is not open.',
  NotAllowlisted: 'This wallet is not on the allowlist.',
  WlLimitExceeded: 'You reached the allowlist limit for this wallet.',
  PublicLimitExceeded: 'You reached the public mint limit for this wallet.',
  SoldOut: 'Sold out.',
  InsufficientPayment: 'The price changed a moment ago and the payment is short. Nothing was charged; try again.',
  RefundFailed: 'The refund of the overpayment failed (the wallet cannot receive HYPE).',
  WithdrawFailed: 'The withdrawal to the treasury failed.',
  NotPriceSetter: 'Only the owner or the price keeper can set the price.',
  PriceOutOfBounds: 'That price is outside the keeper bounds.',
  InvalidPriceBounds: 'Price bounds need 0 < min ≤ max.',
  MaxSupplyIncrease: 'The max supply can only go down.',
  MaxSupplyBelowTotal: 'The max supply cannot go below what is already minted.',
  MetadataIsFrozen: 'The metadata is frozen.',
  RoyaltyTooHigh: 'The royalty must be at most 10 %.',
  ERC721NonexistentToken: 'That token does not exist.',
  ERC2981InvalidDefaultRoyaltyReceiver: 'That royalty receiver is not valid.',
  ERC2981InvalidDefaultRoyalty: 'That royalty is not valid.',
  // ERC-20 / TestToken
  ERC20InsufficientBalance: 'Your token balance is too low.',
  ERC20InsufficientAllowance: 'The token approval is too low. Approve the amount and try again.',
  ERC20InvalidReceiver: 'That receiver is not valid.',
  ERC20InvalidSpender: 'That spender is not valid.',
  FaucetCooldown: 'This wallet already claimed from the faucet recently. Try again when the countdown ends.',
  InvalidFaucet: 'The faucet amount must be greater than zero and the holder amount at least the normal amount.',
};

export type ErrorKind =
  | 'rejected' // the person declined in the wallet (4001)
  | 'contract' // a decoded custom error
  | 'revert' // a revert without a known error
  | 'wrong-chain' // wallet on another chain
  | 'chain-not-added' // 4902
  | 'insufficient-funds' // not enough HYPE for gas / value
  | 'pending' // -32002, a request already open in the wallet
  | 'network'
  | 'unknown';

export interface DescribedError {
  kind: ErrorKind;
  /** Custom error name (`ArenaFull`) or a viem error name; null when unknown. */
  name: string | null;
  /** Decoded custom error arguments. */
  args: readonly unknown[];
  /** EIP-1193 / JSON-RPC code when there was one. */
  code: number | null;
  /** Short human message. */
  message: string;
}

export interface DescribeContext {
  /** Gas token symbol for the funds message (default HYPE). */
  gasSymbol?: string;
  /** Name of the chain the wallet should be on. */
  chainName?: string;
}

/** Decodes revert data (`0x` + selector + args) against `ELYMUM_ERRORS_ABI`; null when unknown. */
export function decodeRevertData(data: Hex): { name: string; args: readonly unknown[] } | null {
  if (!/^0x[0-9a-fA-F]{8}/.test(data)) return null;
  try {
    const r = decodeErrorResult({ abi: ELYMUM_ERRORS_ABI as Abi, data });
    return { name: r.errorName, args: (r.args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}

/** Human message for a custom error name (falls back to the name). */
export function errorMessage(name: string): string {
  return ERROR_MESSAGES[name] ?? `The transaction was refused (${name}).`;
}

type Obj = Record<string, unknown>;

/** Visits err, its causes and nested `error`/`data` objects (bounded). */
function* nested(err: unknown, depth = 0, seen = new Set<unknown>()): Generator<Obj> {
  if (!err || typeof err !== 'object' || seen.has(err) || depth > 8) return;
  seen.add(err);
  const o = err as Obj;
  yield o;
  for (const k of ['cause', 'error', 'data', 'info', 'originalError']) yield* nested(o[k], depth + 1, seen);
}

function findCode(err: unknown): number | null {
  for (const o of nested(err)) if (typeof o.code === 'number') return o.code;
  return null;
}

function findRevertData(err: unknown): Hex | null {
  for (const o of nested(err)) {
    for (const k of ['data', 'raw']) {
      const v = o[k];
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{8}/.test(v)) return v as Hex;
    }
  }
  return null;
}

function textOf(err: unknown): string {
  if (err instanceof BaseError) return `${err.shortMessage}\n${err.details ?? ''}\n${err.message}`;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as Obj).message === 'string') return (err as Obj).message as string;
  return String(err);
}

/** Classifies and explains an error from viem, a wallet or an RPC. */
export function describeError(err: unknown, ctx: DescribeContext = {}): DescribedError {
  const gas = ctx.gasSymbol ?? 'HYPE';
  const code = findCode(err);
  const names: string[] = [];
  if (err instanceof BaseError) err.walk((e) => (names.push((e as Error).name), false));
  const text = textOf(err);
  const has = (n: string) => names.includes(n);
  const out = (kind: ErrorKind, message: string, name: string | null = null, args: readonly unknown[] = []): DescribedError => ({ kind, name, args, code, message });

  if (code === 4001 || has('UserRejectedRequestError') || /user (rejected|denied)|rejected the request/i.test(text)) {
    return out('rejected', 'You declined the request in your wallet.', 'UserRejectedRequestError');
  }
  if (code === 4902 || /unrecognized chain|chain .*not (been )?added|unknown chain/i.test(text)) {
    return out('chain-not-added', `Your wallet does not know ${ctx.chainName ?? 'this chain'} yet. Add it and try again.`, 'ChainNotAdded');
  }
  if (has('ChainMismatchError') || /does not match the target chain|chain mismatch/i.test(text)) {
    return out('wrong-chain', `Your wallet is on another network. Switch to ${ctx.chainName ?? 'the right chain'} and try again.`, 'ChainMismatchError');
  }
  if (code === -32002 || /already pending/i.test(text)) {
    return out('pending', 'Your wallet already has a request open. Check the wallet window.', 'RequestPending');
  }

  // a decoded custom error
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName && reverted.data.errorName !== 'Error' && reverted.data.errorName !== 'Panic') {
      const name = reverted.data.errorName;
      return out('contract', errorMessage(name), name, (reverted.data.args ?? []) as readonly unknown[]);
    }
    if (reverted?.raw) {
      const d = decodeRevertData(reverted.raw);
      if (d) return out('contract', errorMessage(d.name), d.name, d.args);
    }
  }
  const data = findRevertData(err);
  const decoded = data ? decodeRevertData(data) : null;
  if (decoded) return out('contract', errorMessage(decoded.name), decoded.name, decoded.args);

  if (has('InsufficientFundsError') || /insufficient funds/i.test(text)) {
    return out('insufficient-funds', `Not enough ${gas} for this transaction and its gas.`, 'InsufficientFundsError');
  }
  if (has('ContractFunctionRevertedError') || /execution reverted|reverted/i.test(text)) {
    const reason = /reverted with reason string '([^']+)'/.exec(text)?.[1];
    return out('revert', reason ? `The transaction was refused: ${reason}` : 'The transaction was refused by the contract.', 'Reverted');
  }
  if (has('HttpRequestError') || has('TimeoutError') || /fetch failed|ECONNREFUSED|network error|failed to fetch/i.test(text)) {
    return out('network', 'Could not reach the network. Check your connection and try again.', 'NetworkError');
  }
  const short = err instanceof BaseError ? err.shortMessage : text.split('\n')[0];
  return out('unknown', short || 'Something went wrong.', err instanceof Error ? err.name : null);
}

/** `describeError(err).message`. */
export function humanError(err: unknown, ctx: DescribeContext = {}): string {
  return describeError(err, ctx).message;
}

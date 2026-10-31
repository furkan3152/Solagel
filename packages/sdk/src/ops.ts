/**
 * Admin operations shared by the admin CLI (`admin.ts`, signed by a private key) and the web
 * admin panel (`/admin`, signed by the owner's browser wallet): input validation, refusals that
 * mirror the contracts' checks, the status read, and the default-arena plan. Previews of the
 * calls come from `describeCall` (call.ts).
 *
 * Browser-safe (no Node built-ins). Imported as `@elymum/sdk/ops`; it is deliberately not
 * re-exported from the SDK entry point, so the game bundle does not carry the admin code.
 */
import { arenaMeta, chainInfo, isMainnet, type ChainInfo } from '@elymum/shared';
import { getAddress, isAddress, type Address, type PublicClient } from 'viem';
import {
  defaultArenaParams,
  getArenaConfig,
  getTestTokenFaucet,
  getTokenBalance,
  getTokenInfo,
  isTestTokenMinter,
  listArenas,
  type ArenaConfig,
  type ArenaInfo,
  type ArenaParams,
  type TestTokenFaucetConfig,
  type TokenInfo,
} from './arena';
import { getCodeHash } from './chain';
import { MAX_ARENA_SESSIONS, MAX_FEE_BPS, MIN_ARENA_SESSIONS } from './constants';
import { formatBps, formatTokenAmount, isZeroAddress, parseHypeAmount, parseTokenAmount, sameAddress } from './format';
import { getMintState, type MintState } from './nft';
import { elymumArenaArtifact, elymumNFTArtifact, testTokenArtifact } from '@elymum/contracts';

export { describeCall, describeCallLine, type DescribedCall, type DescribedArg } from './call';

/**
 * A refused input or precondition, found before anything is signed. The CLI prints it without a
 * stack (exit code 2); the panel shows it next to the field.
 */
export class AdminInputError extends Error {
  override name = 'AdminInputError';
}

/* -------------------------------------------------------------------- */
/* Field parsers. `label` names the field the way the user sees it:      */
/* `--fee-bps` in the CLI, "Fee (bps)" in the panel.                     */
/* -------------------------------------------------------------------- */

/** A 0x address (any case) → checksummed. `allowZero` defaults to false. */
export function parseAddressInput(label: string, value: string, opts: { allowZero?: boolean } = {}): Address {
  const v = value.trim();
  if (!isAddress(v, { strict: false })) throw new AdminInputError(`${label}: not an EVM address: ${JSON.stringify(value)}`);
  if (!opts.allowZero && isZeroAddress(v)) throw new AdminInputError(`${label}: the zero address is not allowed`);
  // a mixed-case address with a wrong checksum is a typo
  if (v !== v.toLowerCase() && v.slice(2) !== v.slice(2).toUpperCase() && getAddress(v) !== v) {
    throw new AdminInputError(`${label}: checksum mismatch in ${v} (check for a typo)`);
  }
  return getAddress(v);
}

/** Set-token rail: the address must be typed twice, identically (case-insensitive). */
export function confirmTypedAddress(label: string, first: string, second: string): Address {
  const a = parseAddressInput(label, first);
  const b = parseAddressInput(`${label} (again)`, second);
  if (a !== b) throw new AdminInputError(`${label}: the two addresses differ (${a} vs ${b})`);
  return a;
}

export function parseIntInput(label: string, value: string, min: number, max: number): number {
  const v = value.trim().replace(/_/g, '');
  if (!/^\d+$/.test(v)) throw new AdminInputError(`${label}: expected a whole number, got ${JSON.stringify(value)}`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new AdminInputError(`${label}: must be between ${min} and ${max}, got ${v}`);
  return n;
}

export function parseBigIntInput(label: string, value: string, min = 0n, max?: bigint): bigint {
  const v = value.trim().replace(/_/g, '');
  if (!/^\d+$/.test(v)) throw new AdminInputError(`${label}: expected a whole number, got ${JSON.stringify(value)}`);
  const n = BigInt(v);
  if (n < min || (max !== undefined && n > max)) throw new AdminInputError(`${label}: must be between ${min} and ${max ?? '∞'}, got ${v}`);
  return n;
}

export function parseBoolInput(label: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  throw new AdminInputError(`${label}: expected true or false, got ${JSON.stringify(value)}`);
}

/** Whole tokens (`1000`, `0.5`, `1_000`, `1,000`) → base units. */
export function parseTokenInput(label: string, value: string, decimals: number): bigint {
  try {
    return parseTokenAmount(value, decimals);
  } catch (err) {
    throw new AdminInputError(`${label}: ${(err as Error).message}`);
  }
}

/** HYPE (`0.03`) → wei. */
export function parseHypeInput(label: string, value: string): bigint {
  try {
    return parseHypeAmount(value);
  } catch (err) {
    throw new AdminInputError(`${label}: ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------- */
/* Refusals (null = OK)                                                  */
/* -------------------------------------------------------------------- */

export function setTokenRefusal(config: Pick<ArenaConfig, 'token'>, token: Address, code: boolean): string | null {
  if (config.token) return `the game token is already set to ${config.token}; it can be set only once`;
  if (!code) return `${token} is not a contract on this chain`;
  return null;
}

export function createArenaRefusal(config: Pick<ArenaConfig, 'token'>, p: ArenaParams, existingIds: readonly number[]): string | null {
  if (!config.token) return 'set the game token first (set-token)';
  if (existingIds.includes(p.id)) return `arena #${p.id} already exists; use update-arena`;
  if (p.entryFee <= 0n) return 'the entry fee must be greater than zero';
  if (p.maxSessions < MIN_ARENA_SESSIONS || p.maxSessions > MAX_ARENA_SESSIONS) return `max sessions must be between ${MIN_ARENA_SESSIONS} and ${MAX_ARENA_SESSIONS}`;
  return null;
}

export function updateArenaRefusal(arena: Pick<ArenaInfo, 'id' | 'exists' | 'entryFee' | 'openSessions'>, entryFee: bigint): string | null {
  if (!arena.exists) return `arena #${arena.id} does not exist`;
  if (entryFee !== arena.entryFee && arena.openSessions > 0) {
    return `arena #${arena.id} has ${arena.openSessions} open tickets; the entry fee can change once they are settled`;
  }
  return null;
}

export function sweepArenaRefusal(arena: Pick<ArenaInfo, 'id' | 'exists' | 'enabled' | 'openSessions'>): string | null {
  if (!arena.exists) return `arena #${arena.id} does not exist`;
  if (arena.enabled) return `disable arena #${arena.id} first (update-arena --id ${arena.id} --enabled false)`;
  if (arena.openSessions > 0) return `arena #${arena.id} still has ${arena.openSessions} open tickets; wait until they settle or are refunded`;
  return null;
}

export const SWEEP_WARNING =
  'Check the server journal first: floor loot of this arena still waiting to be burned is no longer backed afterwards. ' +
  'Owed payouts of finalized sessions stay reserved for their players.';

/** Refuses an owner-only action from a wallet that is not the owner. */
export function ownerRefusal(owner: Address, signer: Address | null | undefined, what = 'contract'): string | null {
  if (!signer) return 'connect the owner wallet';
  return sameAddress(owner, signer) ? null : `the connected wallet ${signer} is not the ${what} owner ${owner}`;
}

/**
 * `setHolderPerks`: `nft` null turns the perks off; otherwise it must be a contract (`hasCode`).
 * The holder fee is at most 10 % (a ticket gets `min(feeBps, holderFeeBps)`, so a higher one has no effect).
 */
export function holderPerksRefusal(nft: Address | null, hasCode: boolean, holderFeeBps: number): string | null {
  if (!Number.isInteger(holderFeeBps) || holderFeeBps < 0 || holderFeeBps > MAX_FEE_BPS) return `the holder fee must be between 0 and ${MAX_FEE_BPS} bps`;
  if (nft && !isZeroAddress(nft) && !hasCode) return `${nft} is not a contract on this chain`;
  return null;
}

/** Warnings (not refusals) for a holder-perks change: higher than the normal fee, or holders-only arenas left without holders. */
export function holderPerksWarnings(p: { nft: Address | null; holderFeeBps: number; feeBps: number; holdersOnlyIds: readonly number[] }): string[] {
  const out: string[] = [];
  const off = !p.nft || isZeroAddress(p.nft);
  if (!off && p.holderFeeBps >= p.feeBps) out.push(`the holder fee ${formatBps(p.holderFeeBps)} is not below the normal fee ${formatBps(p.feeBps)}: holders get no discount`);
  if (off && p.holdersOnlyIds.length > 0) out.push(`perks off: holders-only arenas (${p.holdersOnlyIds.map((i) => `#${i}`).join(', ')}) admit nobody until a holder NFT is set`);
  return out;
}

/** `setArenaHoldersOnly`: the arena must exist; marking it holders-only without a holder NFT closes it to everyone. */
export function holdersOnlyRefusal(arena: Pick<ArenaInfo, 'id' | 'exists'>, holdersOnly: boolean, config: Pick<ArenaConfig, 'holderNft'>): string | null {
  if (!arena.exists) return `arena #${arena.id} does not exist`;
  if (holdersOnly && !config.holderNft) return `set the holder NFT first (setHolderPerks): without it nobody could join arena #${arena.id}`;
  return null;
}

/** `TestToken.setFaucet`: base units and seconds. */
export function setFaucetRefusal(p: { amount: bigint; holderAmount: bigint; cooldownSecs: number }): string | null {
  if (p.amount <= 0n) return 'the faucet amount must be greater than zero';
  if (p.holderAmount < p.amount) return 'the holder amount must be at least the normal amount';
  if (!Number.isSafeInteger(p.cooldownSecs) || p.cooldownSecs < 0) return 'the cooldown must be a whole number of seconds';
  return null;
}

/** TestToken only off mainnet. */
export function testTokenRefusal(chainId: number): string | null {
  return isMainnet(chainId) ? 'the TestToken is for the localnet and the testnet only' : null;
}

/** Default tiers to create (those that do not exist yet) and the ids that are skipped. */
export function planDefaultArenas(decimals: number, existingIds: readonly number[]): { create: ArenaParams[]; skip: number[] } {
  const all = defaultArenaParams(decimals);
  return { create: all.filter((a) => !existingIds.includes(a.id)), skip: all.filter((a) => existingIds.includes(a.id)).map((a) => a.id) };
}

export const arenaName = (id: number): string => arenaMeta(id).name;
export const fmtPct = formatBps;
export const fmtTok = (raw: bigint, decimals: number): string => formatTokenAmount(raw, decimals);

/* -------------------------------------------------------------------- */
/* Status                                                                */
/* -------------------------------------------------------------------- */

export type CodeCheck = 'ok' | 'missing' | 'mismatch';

export interface StatusSnapshot {
  chain: ChainInfo;
  mainnet: boolean;
  block: bigint;
  account: { address: Address; balance: bigint } | null;
  arena: {
    address: Address;
    code: CodeCheck;
    config: ArenaConfig | null;
    token: (TokenInfo & { feeWalletBalance: bigint }) | null;
    arenas: ArenaInfo[];
    serverBalance: bigint | null;
  } | null;
  nft: { address: Address; code: CodeCheck; state: MintState | null; balance: bigint } | null;
  /**
   * The TestToken (localnet / testnet): `where.testToken`, or the arena's game token when its code
   * is the bundled TestToken. null otherwise.
   */
  testToken?: {
    address: Address;
    code: CodeCheck;
    faucet: TestTokenFaucetConfig | null;
    /** The arena's server authority may `mint` (funds the testnet bots); null without an arena. */
    serverIsMinter: boolean | null;
    /** The signer (`where.account`) may `mint`; null without an account. */
    accountIsMinter: boolean | null;
  } | null;
}

async function codeCheck(client: PublicClient, address: Address, expected: `0x${string}`): Promise<CodeCheck> {
  const h = await getCodeHash(client, address);
  return h === null ? 'missing' : h === expected ? 'ok' : 'mismatch';
}

/** Checks a deployed address against a bundled artifact (`ElymumArena`, `ElymumNFT`, `TestToken`). */
export function checkDeployedCode(client: PublicClient, address: Address, kind: 'arena' | 'nft' | 'token'): Promise<CodeCheck> {
  const artifact = kind === 'arena' ? elymumArenaArtifact : kind === 'nft' ? elymumNFTArtifact : testTokenArtifact;
  return codeCheck(client, address, artifact.runtimeCodeHash);
}

/** Everything `status` shows: chain, the signer, the arena (config, token, arenas) and the NFT. */
export async function fetchStatus(
  client: PublicClient,
  where: { arena?: Address | null; nft?: Address | null; testToken?: Address | null; account?: Address | null; chainOverrides?: Parameters<typeof chainInfo>[1] },
): Promise<StatusSnapshot> {
  const chainId = await client.getChainId();
  const chain = chainInfo(chainId, where.chainOverrides);
  const [block, account] = await Promise.all([
    client.getBlockNumber(),
    where.account ? client.getBalance({ address: where.account }).then((balance) => ({ address: getAddress(where.account!), balance })) : Promise.resolve(null),
  ]);
  let arena: StatusSnapshot['arena'] = null;
  if (where.arena) {
    const code = await codeCheck(client, where.arena, elymumArenaArtifact.runtimeCodeHash);
    let config: ArenaConfig | null = null;
    let token: (TokenInfo & { feeWalletBalance: bigint }) | null = null;
    let arenas: ArenaInfo[] = [];
    let serverBalance: bigint | null = null;
    if (code !== 'missing') {
      config = await getArenaConfig(client, where.arena);
      [arenas, serverBalance] = await Promise.all([listArenas(client, where.arena), client.getBalance({ address: config.serverAuthority })]);
      if (config.token) {
        const info = await getTokenInfo(client, config.token);
        token = { ...info, feeWalletBalance: await getTokenBalance(client, config.token, config.feeWallet) };
      }
    }
    arena = { address: getAddress(where.arena), code, config, token, arenas, serverBalance };
  }
  let nft: StatusSnapshot['nft'] = null;
  if (where.nft) {
    const code = await codeCheck(client, where.nft, elymumNFTArtifact.runtimeCodeHash);
    const state = code === 'missing' ? null : await getMintState(client, where.nft);
    nft = { address: getAddress(where.nft), code, state, balance: await client.getBalance({ address: where.nft }) };
  }
  let testToken: StatusSnapshot['testToken'] = null;
  let ttAddress: Address | null = where.testToken ? getAddress(where.testToken) : null;
  let ttCode: CodeCheck | null = null;
  if (!ttAddress && arena?.config?.token) {
    ttCode = await codeCheck(client, arena.config.token, testTokenArtifact.runtimeCodeHash);
    if (ttCode === 'ok') ttAddress = arena.config.token;
  }
  if (ttAddress) {
    const code = ttCode ?? (await codeCheck(client, ttAddress, testTokenArtifact.runtimeCodeHash));
    const usable = code === 'ok';
    const server = arena?.config?.serverAuthority ?? null;
    const [faucet, serverIsMinter, accountIsMinter] = usable
      ? await Promise.all([
          getTestTokenFaucet(client, ttAddress),
          server ? isTestTokenMinter(client, ttAddress, server) : Promise.resolve(null),
          account ? isTestTokenMinter(client, ttAddress, account.address) : Promise.resolve(null),
        ])
      : [null, null, null];
    testToken = { address: ttAddress, code, faucet, serverIsMinter, accountIsMinter };
  }
  return { chain, mainnet: isMainnet(chainId), block, account, arena, nft, testToken };
}

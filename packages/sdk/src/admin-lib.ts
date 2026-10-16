/**
 * Admin CLI building blocks (Node only, not exported from the SDK entry point): argument
 * parsing, option validation, the `set-token` transaction and the `status` report. Kept free
 * of side effects so the CLI rules are unit-tested; `admin.ts` wires them to the RPC.
 */
import { DEFAULT_ARENAS, arenaMeta, formatToken, parseToken } from '@slana/shared';
import { getTokenMetadata } from '@solana/spl-token';
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import {
  DEFAULT_FEE_BPS,
  DEFAULT_SETTLE_FEE_LAMPORTS,
  MAX_FEE_BPS,
  MAX_SETTLE_FEE_LAMPORTS,
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createFeeWalletAtaIx,
  lamportsToSol,
  type ArenaView,
  type ConfigView,
  type InitializeParams,
  type SlanaClient,
  type UpdateConfigParams,
} from './index';

export const USAGE = `Slana admin CLI

Usage: pnpm admin <command> [options]

Setup (in this order: deploy → init → set-token → create-arena --defaults)
  init --server <pubkey> [--fee-wallet <pubkey>] [--fee-bps ${DEFAULT_FEE_BPS}] [--settle-fee-lamports ${DEFAULT_SETTLE_FEE_LAMPORTS}]
                          create the config without a game token (keypair must be the upgrade
                          authority); the fee wallet defaults to the admin keypair
  set-token --mint <CA>   set the game token mint, once and for good (SPL Token or Token-2022,
                          read from the mint's owner); in the same transaction the admin pays
                          for the fee wallet's associated token account
  status                  config, token, fee wallet balance and arenas ("token: not set" until set-token)

Config
  update-config [--admin <pubkey>] [--server <pubkey>] [--fee-wallet <pubkey>] [--fee-bps N]
                [--settle-fee-lamports N] [--paused true|false]
                          a new fee wallet gets its associated token account created (admin pays)
  pause                   block arena joins (settlements and refunds keep working)
  unpause                 allow arena joins again

Arenas (need the token: run set-token first)
  create-arena --defaults                  create the four default arenas, open to everyone (skips existing ones)
  create-arena --id N --entry <tokens> --max N
  update-arena --id N [--enabled true|false] [--max N] [--entry <tokens>]
  sweep --id N --force                     move a disabled, idle arena's vault to the fee wallet
                                           (check the server journal first: loot of that arena
                                           still waiting there is no longer backed afterwards)

Options
  --url <rpc>          RPC endpoint (default: $SOLANA_RPC_URL or http://127.0.0.1:8899)
  --keypair <path>     signer / fee payer (default: ~/.config/solana/id.json)
  --program <id>       program id (default: $PROGRAM_ID or ${PROGRAM_ID.toBase58()})
  --cluster <name>     cluster for explorer links (default: inferred from --url)
  --verbose            print transaction logs on errors

Token amounts (--entry) are whole tokens with '.' decimals, scaled by the mint's decimals.
Fee: ${(DEFAULT_FEE_BPS / 100).toFixed(0)} % of profit by default (at most ${MAX_FEE_BPS / 100} %), paid in full to the fee wallet.
`;

/** A wrong command line or a refused precondition: printed without a stack, exit code 2. */
export class UsageError extends Error {}

export type Opts = Map<string, string | true>;

/** `<command> [--name value | --name=value | --flag]…`; at most one positional argument. */
export function parseArgs(argv: string[]): { command: string | null; opts: Opts } {
  const opts: Opts = new Map();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        opts.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          opts.set(a.slice(2), next);
          i++;
        } else {
          opts.set(a.slice(2), true);
        }
      }
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) throw new UsageError(`unexpected argument: ${positional[1]}`);
  return { command: positional[0] ?? null, opts };
}

export function str(opts: Opts, name: string): string | undefined {
  const v = opts.get(name);
  if (v === undefined) return undefined;
  if (v === true) throw new UsageError(`--${name} needs a value`);
  return v;
}

export function required(opts: Opts, name: string, command: string): string {
  const v = str(opts, name);
  if (v === undefined) throw new UsageError(`${command} needs --${name} (see \`pnpm admin help\`)`);
  return v;
}

export function pubkey(opts: Opts, name: string): PublicKey | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  try {
    return new PublicKey(v);
  } catch {
    throw new UsageError(`--${name}: not a valid public key: ${v}`);
  }
}

export function int(opts: Opts, name: string, min: number, max: number): number | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/_/g, ''));
  if (v.trim() === '' || !Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be an integer between ${min} and ${max}`);
  return n;
}

/** A switch: `--force` or `--force=true`. */
export function flag(opts: Opts, name: string): boolean {
  const v = opts.get(name);
  return v === true || v === 'true';
}

export function bool(opts: Opts, name: string): boolean | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new UsageError(`--${name} must be true or false`);
}

/** Whole tokens (`1000`, `0.5`, `1_000`) → base units. */
export function tokens(opts: Opts, name: string, decimals: number): bigint | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  try {
    return parseToken(v.replace(/_/g, ''), decimals);
  } catch (err) {
    throw new UsageError(`--${name}: ${(err as Error).message}`);
  }
}

export function inferCluster(url: string): string {
  if (/devnet/i.test(url)) return 'devnet';
  if (/testnet/i.test(url)) return 'testnet';
  if (/mainnet/i.test(url)) return 'mainnet-beta';
  return 'localnet';
}

/** `init` options; the fee wallet defaults to the admin signer. */
export function parseInitOptions(opts: Opts, admin: PublicKey): InitializeParams & { feeWallet: PublicKey; serverAuthority: PublicKey } {
  if (opts.has('mint')) throw new UsageError('init no longer takes a mint: run `pnpm admin set-token --mint <CA>` after init');
  const serverAuthority = pubkey(opts, 'server');
  if (!serverAuthority) throw new UsageError('init needs --server <pubkey> (see `pnpm admin help`)');
  const feeWallet = pubkey(opts, 'fee-wallet') ?? admin;
  if (feeWallet.equals(PublicKey.default) || serverAuthority.equals(PublicKey.default)) {
    throw new UsageError('the server and fee wallet must not be the default (all zero) key');
  }
  return {
    serverAuthority,
    feeWallet,
    feeBps: int(opts, 'fee-bps', 0, MAX_FEE_BPS) ?? DEFAULT_FEE_BPS,
    settleFeeLamports: int(opts, 'settle-fee-lamports', 0, MAX_SETTLE_FEE_LAMPORTS) ?? DEFAULT_SETTLE_FEE_LAMPORTS,
  };
}

/** `update-config` options (only the given ones); refuses an empty change. */
export function parseUpdateConfigOptions(opts: Opts): UpdateConfigParams {
  const changes: UpdateConfigParams = {
    admin: pubkey(opts, 'admin'),
    serverAuthority: pubkey(opts, 'server'),
    feeWallet: pubkey(opts, 'fee-wallet'),
    feeBps: int(opts, 'fee-bps', 0, MAX_FEE_BPS),
    settleFeeLamports: int(opts, 'settle-fee-lamports', 0, MAX_SETTLE_FEE_LAMPORTS),
    paused: bool(opts, 'paused'),
  };
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete (changes as Record<string, unknown>)[k];
  if (Object.keys(changes).length === 0) throw new UsageError('update-config: nothing to change (see `pnpm admin help`)');
  for (const key of ['admin', 'serverAuthority', 'feeWallet'] as const) {
    const v = changes[key];
    if (v !== undefined && new PublicKey(v).equals(PublicKey.default)) throw new UsageError(`${key} must not be the default (all zero) key`);
  }
  return changes;
}

/** The `create-arena --defaults` arenas in base units of a mint with `decimals`. */
export function defaultArenaParams(decimals: number): { id: number; entryFee: bigint; maxSessions: number }[] {
  const scale = 10n ** BigInt(decimals);
  return DEFAULT_ARENAS.map((a) => ({ id: a.id, entryFee: BigInt(a.entryTokens) * scale, maxSessions: a.maxSessions }));
}

export const isTokenProgram = (program: PublicKey): boolean => program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID);

export function tokenProgramName(program: string | PublicKey | null): string {
  if (program === null) return 'not set';
  const p = typeof program === 'string' ? program : program.toBase58();
  if (p === TOKEN_2022_PROGRAM_ID.toBase58()) return 'Token-2022';
  if (p === TOKEN_PROGRAM_ID.toBase58()) return 'SPL Token';
  return p;
}

/**
 * The `set-token` transaction: create the fee wallet's associated token account idempotently
 * (the admin pays), then `set_token_mint`. `mintOwner` is the program owning the mint account,
 * which picks SPL Token or Token-2022. Refuses when the config already has a mint (the program
 * would fail with `TokenAlreadySet`) or the owner is not a token program.
 */
export async function buildSetTokenInstructions(
  client: SlanaClient,
  admin: PublicKey,
  config: Pick<ConfigView, 'tokenMint' | 'feeWallet'>,
  mint: PublicKey,
  mintOwner: PublicKey,
): Promise<TransactionInstruction[]> {
  if (config.tokenMint !== null) {
    throw new UsageError(`the game token is already set to ${config.tokenMint}; set_token_mint runs only once`);
  }
  if (!isTokenProgram(mintOwner)) {
    throw new UsageError(`${mint.toBase58()} is not an SPL Token / Token-2022 mint (owner ${mintOwner.toBase58()})`);
  }
  return [
    createFeeWalletAtaIx(admin, { feeWallet: config.feeWallet, tokenMint: mint, tokenProgram: mintOwner }),
    await client.ix.setTokenMint(admin, { tokenMint: mint, tokenProgram: mintOwner }),
  ];
}

/** Metaplex Token Metadata program (pump.fun and most SPL Token mints carry their symbol there). */
export const MPL_TOKEN_METADATA_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export function metaplexMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('metadata'), MPL_TOKEN_METADATA_ID.toBytes(), mint.toBytes()], MPL_TOKEN_METADATA_ID)[0];
}

/** Name and symbol of a Metaplex `MetadataV1` account (`key | update authority | mint | name | symbol | …`); null otherwise. */
export function parseMetaplexMetadata(data: Uint8Array): { name: string; symbol: string } | null {
  const KEY_METADATA_V1 = 4;
  if (data.length < 65 + 4 || data[0] !== KEY_METADATA_V1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 65;
  const read = (): string | null => {
    if (data.length < offset + 4) return null;
    const len = view.getUint32(offset, true);
    offset += 4;
    if (len > 200 || data.length < offset + len) return null;
    const s = new TextDecoder().decode(data.subarray(offset, offset + len));
    offset += len;
    return s.replace(/\0+$/, '').trim();
  };
  const name = read();
  const symbol = name === null ? null : read();
  return name === null || symbol === null ? null : { name, symbol };
}

/** Best effort: the mint's symbol from Token-2022 metadata or Metaplex metadata; null when none. */
export async function fetchTokenSymbol(connection: Connection, mint: PublicKey, tokenProgram: PublicKey): Promise<string | null> {
  try {
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      const meta = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
      if (meta?.symbol) return meta.symbol;
    }
    const info = await connection.getAccountInfo(metaplexMetadataPda(mint), 'confirmed');
    const parsed = info && info.owner.equals(MPL_TOKEN_METADATA_ID) ? parseMetaplexMetadata(info.data) : null;
    return parsed?.symbol || null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- */
/* status                                                                */
/* -------------------------------------------------------------------- */

export interface MintSnapshot {
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  symbol: string | null;
}

/** Everything `status` prints, read beforehand (pure formatting below). */
export interface StatusSnapshot {
  url: string;
  cluster: string;
  programId: string;
  deployed: boolean;
  configAddress: string;
  config: ConfigView | null;
  /** Lamports of the server authority. */
  serverBalance?: number;
  /** Fee wallet's associated token account (null while the token is unset). */
  feeWalletToken?: string | null;
  /** Its balance in base units; null when the account does not exist. */
  feeWalletBalance?: bigint | null;
  /** The mint account, null when unreadable or unset. */
  mint?: MintSnapshot | null;
  arenas?: ArenaView[];
}

export const fmtSol = (lamports: number): string => `◎${lamportsToSol(lamports).toLocaleString('en-US', { maximumFractionDigits: 9 })}`;
export const fmtPct = (bps: number): string => `${(bps / 100).toFixed(2)} %`;
export const fmtTok = (raw: bigint, decimals: number): string => formatToken(raw, decimals, { maxFrac: Math.min(decimals, 6) });

const row = (label: string, value: string): string => `  ${`${label}:`.padEnd(18)} ${value}`;

/** The `status` report, one string per line. */
export function formatStatus(s: StatusSnapshot): string[] {
  const out: string[] = [`Slana on ${s.url} (${s.cluster})`, `program   ${s.programId}  ${s.deployed ? '✓ deployed' : '✗ not deployed'}`];
  if (!s.deployed) return out;
  const c = s.config;
  if (!c) {
    out.push('config    ✗ not initialized (run `pnpm admin init --server <pubkey>`)');
    return out;
  }
  const d = c.tokenDecimals;
  const symbol = s.mint?.symbol ? ` ${s.mint.symbol}` : '';
  out.push(`config    ${s.configAddress}`);
  out.push(row('admin', c.admin));
  out.push(row('server authority', `${c.serverAuthority}${s.serverBalance !== undefined ? `  (balance ${fmtSol(s.serverBalance)})` : ''}`));
  out.push(row('fee wallet', c.feeWallet));
  if (c.tokenMint === null) {
    out.push(row('token', 'not set (run `pnpm admin set-token --mint <CA>`; arenas open after it)'));
  } else {
    out.push(row('token', `${c.tokenMint}  (${tokenProgramName(c.tokenProgram)}, ${d} decimals${symbol ? `,${symbol}` : ''})`));
    if (s.mint) {
      const unsafe = s.mint.supply > BigInt(Number.MAX_SAFE_INTEGER) ? '  ✗ above 2^53−1: NOT SUPPORTED' : '';
      out.push(row('supply', `${fmtTok(s.mint.supply, d)}${symbol} (${s.mint.supply} base units)${unsafe}`));
      out.push(row('mint/freeze auth', `${s.mint.mintAuthority ?? 'none'} / ${s.mint.freezeAuthority ?? 'none'}`));
    } else if (s.mint === null) {
      out.push(row('supply', '✗ mint account not readable'));
    }
    if (s.feeWalletToken) {
      const balance = s.feeWalletBalance === null || s.feeWalletBalance === undefined ? '✗ account missing (fees cannot be paid)' : `${fmtTok(s.feeWalletBalance, d)}${symbol}`;
      out.push(row('fee wallet token', `${s.feeWalletToken}  (${balance})`));
    }
  }
  out.push(row('fee', `${fmtPct(c.feeBps)} of profit, 100 % to the fee wallet`));
  out.push(row('settle deposit', `${fmtSol(c.settleFeeLamports)} per session`));
  out.push(row('paused', c.paused ? 'YES (arena joins blocked)' : 'no'));
  out.push(
    row(
      'totals',
      `${c.totals.players} players · ${c.totals.games} games · ${c.totals.sessions} sessions · ${fmtTok(c.totals.staked, d)} staked · ${fmtTok(c.totals.paidOut, d)} paid out`,
    ),
  );
  const arenas = s.arenas ?? [];
  if (arenas.length === 0) {
    out.push(c.tokenMint === null ? 'arenas    none (set the token first, then `pnpm admin create-arena --defaults`)' : 'arenas    none (run `pnpm admin create-arena --defaults`)');
  } else {
    out.push('arenas');
    for (const a of arenas) {
      out.push(
        `  #${a.id} ${arenaMeta(a.id).name.padEnd(14)} entry ${fmtTok(a.entryFee, d).padEnd(10)} ` +
          `open ${a.openSessions}/${a.maxSessions} · pot ${fmtTok(a.pot, d)} · ${a.enabled ? 'enabled' : 'DISABLED'}  ${a.address}`,
      );
    }
  }
  return out;
}

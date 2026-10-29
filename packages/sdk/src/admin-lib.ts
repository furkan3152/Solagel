/**
 * Admin CLI building blocks (Node only, not exported from the SDK entry point): argument
 * parsing and the `status` report. Validation, the mint check, the status read and the
 * instruction plans are shared with the web admin panel and live in `ops.ts` (browser-safe,
 * `@elymum/sdk/ops`); this file adapts them to command-line options. `admin.ts` wires them to the RPC.
 */
import { arenaMeta } from '@elymum/shared';
import { PublicKey } from '@solana/web3.js';
import { DEFAULT_FEE_BPS, DEFAULT_SETTLE_FEE_LAMPORTS, MAX_FEE_BPS, MAX_SETTLE_FEE_LAMPORTS, PROGRAM_ID, type UpdateConfigParams } from './index';
import {
  AdminInputError,
  fmtPct,
  fmtSol,
  fmtTok,
  initParams,
  parseBoolInput,
  parseIntInput,
  parsePubkeyInput,
  parseTokenInput,
  tokenProgramName,
  updateConfigParams,
  type InitPlan,
  type StatusSnapshot,
} from './ops';

export {
  buildSetTokenInstructions,
  defaultArenaParams,
  fetchTokenSymbol,
  fmtPct,
  fmtSol,
  fmtTok,
  inferCluster,
  isTokenProgram,
  metaplexMetadataPda,
  MPL_TOKEN_METADATA_ID,
  parseMetaplexMetadata,
  tokenProgramName,
  type MintSnapshot,
  type StatusSnapshot,
} from './ops';

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
export { AdminInputError as UsageError };
const UsageError = AdminInputError;

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
  return v === undefined ? undefined : parsePubkeyInput(`--${name}`, v);
}

export function int(opts: Opts, name: string, min: number, max: number): number | undefined {
  const v = str(opts, name);
  return v === undefined ? undefined : parseIntInput(`--${name}`, v, min, max);
}

/** A switch: `--force` or `--force=true`. */
export function flag(opts: Opts, name: string): boolean {
  const v = opts.get(name);
  return v === true || v === 'true';
}

export function bool(opts: Opts, name: string): boolean | undefined {
  const v = str(opts, name);
  return v === undefined ? undefined : parseBoolInput(`--${name}`, v);
}

/** Whole tokens (`1000`, `0.5`, `1_000`) → base units. */
export function tokens(opts: Opts, name: string, decimals: number): bigint | undefined {
  const v = str(opts, name);
  return v === undefined ? undefined : parseTokenInput(`--${name}`, v, decimals);
}

/** `init` options; the fee wallet defaults to the admin signer. */
export function parseInitOptions(opts: Opts, admin: PublicKey): InitPlan {
  if (opts.has('mint')) throw new UsageError('init no longer takes a mint: run `pnpm admin set-token --mint <CA>` after init');
  const serverAuthority = pubkey(opts, 'server');
  if (!serverAuthority) throw new UsageError('init needs --server <pubkey> (see `pnpm admin help`)');
  return initParams(
    {
      serverAuthority,
      feeWallet: pubkey(opts, 'fee-wallet'),
      feeBps: int(opts, 'fee-bps', 0, MAX_FEE_BPS),
      settleFeeLamports: int(opts, 'settle-fee-lamports', 0, MAX_SETTLE_FEE_LAMPORTS),
    },
    admin,
  );
}

/** `update-config` options (only the given ones); refuses an empty change. */
export function parseUpdateConfigOptions(opts: Opts): UpdateConfigParams {
  const changes = updateConfigParams({
    admin: pubkey(opts, 'admin'),
    serverAuthority: pubkey(opts, 'server'),
    feeWallet: pubkey(opts, 'fee-wallet'),
    feeBps: int(opts, 'fee-bps', 0, MAX_FEE_BPS),
    settleFeeLamports: int(opts, 'settle-fee-lamports', 0, MAX_SETTLE_FEE_LAMPORTS),
    paused: bool(opts, 'paused'),
  });
  if (Object.keys(changes).length === 0) throw new UsageError('update-config: nothing to change (see `pnpm admin help`)');
  return changes;
}

/* -------------------------------------------------------------------- */
/* status                                                                */
/* -------------------------------------------------------------------- */

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

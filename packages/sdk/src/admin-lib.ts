/**
 * Admin CLI building blocks (Node only, not exported from the SDK entry point): argument
 * parsing, the private key loader and the `status` report. Validation, refusals and the status
 * read are shared with the web admin panel and live in `ops.ts` (browser-safe, `@elymum/sdk/ops`);
 * this file adapts them to command-line options. `admin.ts` wires them to the RPC.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { arenaMeta } from '@elymum/shared';
import type { Address, Hex } from 'viem';
import { DEFAULT_FEE_BPS, MAX_ARENA_SESSIONS, MAX_FEE_BPS, MIN_ARENA_SESSIONS, MINT_PHASE_NAMES } from './constants';
import { formatBps, formatHypeAmount, formatTokenAmount } from './format';
import { AdminInputError, parseAddressInput, parseBigIntInput, parseBoolInput, parseIntInput, parseTokenInput, type StatusSnapshot } from './ops';

export const USAGE = `Elymum admin CLI

Usage: pnpm admin <command> [options]

Environment
  EVM_RPC_URL            RPC endpoint (or --rpc <url>; default http://127.0.0.1:8545)
  ADMIN_PRIVATE_KEY      0x hex key of the owner wallet, or a path to a file holding one
                         (or --key <hex|path>; ADMIN_KEY_FILE=<path> also works)
  ARENA_ADDRESS          the ElymumArena (or --arena <address>)
  NFT_ADDRESS            the ElymumNFT (or --nft <address>)

Setup (in this order)
  status                                 chain, signer, arena config, token, arenas, NFT
  deploy-arena --server <addr> [--fee-wallet <addr>]
                                         deploy ElymumArena (owner = the signer, fee wallet defaults to it)
  deploy-nft --max-supply N (--price-wei N | --usd-cents 100) [--wl-limit 2] [--public-limit 2]
             --base-uri <url> [--treasury <addr>]
  deploy-test-token                      deploy the TestToken (localnet / testnet only)
  set-token --token <addr> --confirm <addr>
                                         set the game token, once and for good (type it twice)
  create-arena --defaults                create the four default arenas (skips existing ones)
  create-arena --id N --fee <tokens> --max N

Arena
  update-arena --id N [--fee <tokens>] [--max N] [--enabled true|false]
  fee --bps N                            fee on profit for new tickets (0..${MAX_FEE_BPS}, default ${DEFAULT_FEE_BPS})
  pause | unpause                        block / allow arena joins (settlements and refunds keep working)
  server-key --address <addr>            set the server authority (settle / sweepLoot)
  sweep-arena --id N --force             move a disabled, idle arena's vault to the fee wallet

NFT
  nft:phase closed|allowlist|public
  nft:root --file <path>                 build the allowlist tree (JSON array or one address per line), publish its root
  nft:price (--usd-cents 100 [--hype-usd X] | --wei N)
  nft:keeper --address <addr|none>       the price keeper (may set the price inside the bounds)
  nft:bounds (--min-wei N --max-wei N | --min-usd-cents N --max-usd-cents N [--hype-usd X])
  nft:withdraw                           send the whole HYPE balance to the treasury

Safety
  Every transaction is printed (function, arguments, value) before it is sent.
  --dry-run              print the preview and stop
  --mainnet              required on Elysium mainnet; you are also asked to type "mainnet"
  --verbose              print raw errors

Token amounts (--fee on arenas) are whole tokens with '.' decimals, scaled by the token's decimals.
`;

/** A wrong command line or a refused precondition: printed without a stack, exit code 2. */
export const UsageError = AdminInputError;
export type UsageError = AdminInputError;

export type Opts = Map<string, string | true>;

/** `<command> [positional] [--name value | --name=value | --flag]…`. */
export function parseArgs(argv: string[]): { command: string | null; positional: string[]; opts: Opts } {
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
  if (positional.length > 2) throw new UsageError(`unexpected argument: ${positional[2]}`);
  return { command: positional[0] ?? null, positional: positional.slice(1), opts };
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

export function address(opts: Opts, name: string): Address | undefined {
  const v = str(opts, name);
  return v === undefined ? undefined : parseAddressInput(`--${name}`, v);
}

export function int(opts: Opts, name: string, min: number, max: number): number | undefined {
  const v = str(opts, name);
  return v === undefined ? undefined : parseIntInput(`--${name}`, v, min, max);
}

export function big(opts: Opts, name: string, min = 0n): bigint | undefined {
  const v = str(opts, name);
  return v === undefined ? undefined : parseBigIntInput(`--${name}`, v, min);
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

export const arenaSessionsBounds = [MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS] as const;

export function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  // `pnpm admin` runs inside packages/sdk: resolve relative paths from where the user typed the command
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

/** A 0x private key, or a path to a file holding one (whitespace and a JSON string are tolerated). */
export function parsePrivateKey(value: string, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): Hex {
  const v = value.trim();
  const asKey = (s: string): Hex | null => {
    const t = s.trim().replace(/^"|"$/g, '');
    const hex = /^0x/i.test(t) ? t : `0x${t}`;
    return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex.toLowerCase() as Hex) : null;
  };
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(v)) return asKey(v)!;
  let text: string;
  try {
    text = readFile(expandHome(v));
  } catch {
    throw new UsageError(`the admin key is neither a 0x private key nor a readable file: ${v.length > 80 ? `${v.slice(0, 20)}…` : v}`);
  }
  let k = asKey(text);
  if (!k) {
    try {
      const j = JSON.parse(text) as unknown;
      if (typeof j === 'string') k = asKey(j);
      else if (j && typeof j === 'object' && typeof (j as { privateKey?: unknown }).privateKey === 'string') k = asKey((j as { privateKey: string }).privateKey);
    } catch {
      /* not JSON */
    }
  }
  if (!k) throw new UsageError(`${v} does not hold a 0x private key (64 hex digits)`);
  return k;
}

/** Addresses from a file: a JSON array (of strings or `{wallet}` / `{address}` objects) or one per line (`#` comments). */
export function parseAddressList(text: string): string[] {
  const t = text.trim();
  if (t.startsWith('[')) {
    const j = JSON.parse(t) as unknown[];
    return j.map((x) => (typeof x === 'string' ? x : String((x as { wallet?: string; address?: string }).wallet ?? (x as { address?: string }).address ?? '')));
  }
  return t
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim().replace(/,$/, ''))
    .filter((l) => l !== '');
}

export function parsePhaseArg(v: string | undefined): (typeof MINT_PHASE_NAMES)[number] {
  const p = (v ?? '').trim().toLowerCase();
  if (p === 'wl') return 'allowlist';
  if ((MINT_PHASE_NAMES as readonly string[]).includes(p)) return p as (typeof MINT_PHASE_NAMES)[number];
  throw new UsageError(`nft:phase needs one of ${MINT_PHASE_NAMES.join(', ')}`);
}

/* -------------------------------------------------------------------- */
/* status                                                                */
/* -------------------------------------------------------------------- */

const row = (label: string, value: string): string => `  ${`${label}:`.padEnd(18)} ${value}`;
const codeText = (c: 'ok' | 'missing' | 'mismatch'): string =>
  c === 'ok' ? '✓ code matches the bundled artifact' : c === 'missing' ? '✗ no contract at this address' : '! code differs from the bundled artifact';

/** The `status` report, one string per line. */
export function formatStatus(s: StatusSnapshot, rpcUrl: string): string[] {
  const out: string[] = [
    `Elymum on ${s.chain.name} (chain id ${s.chain.id}${s.mainnet ? ', MAINNET' : ''}) via ${rpcUrl} · block ${s.block}`,
  ];
  if (s.account) out.push(`signer    ${s.account.address}  (${formatHypeAmount(s.account.balance, 4)})`);
  const a = s.arena;
  if (!a) {
    out.push('arena     not configured (set ARENA_ADDRESS or run `pnpm admin deploy-arena --server <addr>`)');
  } else {
    out.push(`arena     ${a.address}  ${codeText(a.code)}`);
    const c = a.config;
    if (c) {
      const d = c.decimals;
      const sym = a.token?.symbol ? ` ${a.token.symbol}` : '';
      out.push(row('owner', `${c.admin}${c.pendingAdmin ? `  (pending transfer to ${c.pendingAdmin})` : ''}`));
      out.push(row('server authority', `${c.serverAuthority}${a.serverBalance !== null ? `  (${formatHypeAmount(a.serverBalance, 4)})` : ''}`));
      out.push(row('fee wallet', `${c.feeWallet}${a.token ? `  (${formatTokenAmount(a.token.feeWalletBalance, d)}${sym})` : ''}`));
      out.push(row('token', c.token ? `${c.token}  (${a.token?.name ?? '?'}${sym ? `,${sym}` : ''}, ${d} decimals)` : 'not set (run `pnpm admin set-token --token <addr> --confirm <addr>`)'));
      out.push(row('fee', `${formatBps(c.feeBps)} of profit, 100 % to the fee wallet`));
      out.push(row('paused', c.paused ? 'YES (arena joins blocked)' : 'no'));
      const t = c.totals;
      out.push(
        row(
          'totals',
          `${t.sessions} sessions · ${t.games} games · ${formatTokenAmount(t.staked, d)} staked · ${formatTokenAmount(t.paidOut, d)} paid out · ${formatTokenAmount(t.fees, d)} fees · ${formatTokenAmount(t.burned, d)} burned`,
        ),
      );
      if (a.arenas.length === 0) {
        out.push(c.token ? 'arenas    none (run `pnpm admin create-arena --defaults`)' : 'arenas    none (set the token first)');
      } else {
        out.push('arenas');
        for (const x of a.arenas) {
          out.push(
            `  #${x.id} ${arenaMeta(x.id).name.padEnd(20)} entry ${formatTokenAmount(x.entryFee, d).padEnd(10)} ` +
              `open ${x.openSessions}/${x.maxSessions} · vault ${formatTokenAmount(x.vault, d)} · owed ${formatTokenAmount(x.owed, d)} · ${x.enabled ? 'enabled' : 'DISABLED'}`,
          );
        }
      }
    }
  }
  const n = s.nft;
  if (!n) {
    out.push('nft       not configured (set NFT_ADDRESS or run `pnpm admin deploy-nft …`)');
  } else {
    out.push(`nft       ${n.address}  ${codeText(n.code)}`);
    const m = n.state;
    if (m) {
      out.push(row('phase', m.phaseName));
      out.push(row('price', `${formatHypeAmount(m.price)} per token`));
      out.push(row('keeper', m.keeper ? `${m.keeper}  (bounds ${formatHypeAmount(m.minPrice)} .. ${formatHypeAmount(m.maxPrice)})` : 'none'));
      out.push(row('supply', `${m.totalSupply} / ${m.maxSupply}${m.soldOut ? '  SOLD OUT' : ''}`));
      out.push(row('limits', `allowlist ${m.wlLimit} · public ${m.publicLimit} per wallet`));
      out.push(row('root', /^0x0{64}$/.test(m.root) ? 'not set' : m.root));
      out.push(row('treasury', `${m.treasury}  (contract holds ${formatHypeAmount(n.balance)})`));
      out.push(row('metadata', m.frozen ? 'frozen' : 'not frozen'));
    }
  }
  return out;
}

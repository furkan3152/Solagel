/**
 * Slana admin CLI (Node only, not exported from the SDK entry point).
 *
 *   pnpm -F @slana/sdk admin <command> [options]      (or `pnpm admin <command>` at the repo root)
 *
 * Run `pnpm admin help` for the command list. Parsing, validation, the set-token transaction
 * and the status report live in `admin-lib.ts` (unit-tested); this file does the RPC and I/O.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { arenaMeta } from '@slana/shared';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  MAX_ARENA_SESSIONS,
  MIN_ARENA_SESSIONS,
  PROGRAM_ID,
  SlanaClient,
  describeError,
  explorerAddressUrl,
  explorerTxUrl,
  feeWalletAta,
  pdas,
  requireToken,
  type ConfigView,
  type GameToken,
} from './index';
import {
  USAGE,
  UsageError,
  bool,
  flag,
  buildSetTokenInstructions,
  fmtPct,
  fmtSol,
  fmtTok,
  formatStatus,
  inferCluster,
  int,
  parseArgs,
  parseInitOptions,
  parseUpdateConfigOptions,
  pubkey,
  str,
  tokenProgramName,
  tokens,
  type Opts,
} from './admin-lib';
import { SWEEP_WARNING, buildCreateArenasInstructions, defaultArenaParams, buildSweepInstructions, buildUpdateConfigInstructions, fetchStatus, fetchUpgradeAuthority, inspectMint, planDefaultArenas } from './ops';

function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  // `pnpm admin` runs inside packages/sdk: resolve relative paths from where the user typed the command
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function loadKeypair(path: string): Keypair {
  const file = expandHome(path);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new UsageError(`cannot read keypair ${file} (create one with \`solana-keygen new\` or pass --keypair)`);
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    throw new UsageError(`${file} is not a Solana keypair file (JSON array of 64 numbers)`);
  }
}

interface Ctx {
  url: string;
  cluster: string;
  client: SlanaClient;
  signer: () => Keypair;
}

async function send(ctx: Ctx, label: string, ixs: TransactionInstruction[]): Promise<string> {
  const signature = await ctx.client.sendAndConfirm(ixs, [ctx.signer()]);
  console.log(`✓ ${label}`);
  console.log(`  signature ${signature}`);
  console.log(`  ${explorerTxUrl(signature, ctx.cluster, ctx.url)}`);
  return signature;
}

async function requireConfig(ctx: Ctx): Promise<ConfigView> {
  const config = await ctx.client.fetchConfig();
  if (!config) {
    const deployed = await ctx.client.isDeployed();
    throw new UsageError(
      deployed
        ? `program ${ctx.client.programId.toBase58()} is not initialized yet — run \`pnpm admin init --server <pubkey>\``
        : `program ${ctx.client.programId.toBase58()} is not deployed on ${ctx.url}`,
    );
  }
  return config;
}

/** The config's game token, or a usage error pointing at `set-token`. */
function requireGameToken(config: ConfigView): GameToken {
  if (config.tokenMint === null) throw new UsageError('the game token is not set yet — run `pnpm admin set-token --mint <CA>` first');
  return requireToken(config);
}

function requireAdmin(ctx: Ctx, config: ConfigView): Keypair {
  const signer = ctx.signer();
  if (signer.publicKey.toBase58() !== config.admin) {
    throw new UsageError(`this command must be signed by the admin ${config.admin}, not ${signer.publicKey.toBase58()}`);
  }
  return signer;
}

/** Token program owning `mint` and its decimals, after the program's own mint check (`inspectMint`). */
async function loadMint(ctx: Ctx, mint: PublicKey) {
  const m = await inspectMint(ctx.client.connection, mint);
  if (!m.exists) throw new UsageError(`mint ${mint.toBase58()} does not exist on ${ctx.url}`);
  if (m.refusals.length > 0) throw new UsageError(`mint ${mint.toBase58()} is refused: ${m.refusals.join('; ')}`);
  return { program: new PublicKey(m.owner!), decimals: m.decimals!, symbol: m.symbol };
}

/* -------------------------------------------------------------------- */
/* Commands                                                              */
/* -------------------------------------------------------------------- */

async function cmdStatus(ctx: Ctx): Promise<void> {
  for (const line of formatStatus(await fetchStatus(ctx.client, ctx))) console.log(line);
}

async function cmdInit(ctx: Ctx, opts: Opts): Promise<void> {
  const admin = ctx.signer();
  const params = parseInitOptions(opts, admin.publicKey);
  if (!(await ctx.client.isDeployed())) throw new UsageError(`program ${ctx.client.programId.toBase58()} is not deployed on ${ctx.url}`);
  const existing = await ctx.client.fetchConfig();
  if (existing) {
    console.log(`config already initialized (admin ${existing.admin}, fee wallet ${existing.feeWallet}) — use \`pnpm admin update-config\``);
    return;
  }
  const authority = await fetchUpgradeAuthority(ctx.client.connection, ctx.client.programId);
  if (authority && authority !== admin.publicKey.toBase58()) {
    throw new UsageError(`initialize must be signed by the program's upgrade authority ${authority}, not ${admin.publicKey.toBase58()}`);
  }
  const ix = await ctx.client.ix.initialize(admin.publicKey, params);
  await send(ctx, 'initialized the config (no game token yet)', [ix]);
  console.log(`  server ${params.serverAuthority.toBase58()} · fee wallet ${params.feeWallet.toBase58()}${params.feeWallet.equals(admin.publicKey) ? ' (the admin)' : ''}`);
  console.log(`  fee ${fmtPct(params.feeBps)} of profit · settle deposit ${fmtSol(Number(params.settleFeeLamports))}`);
  console.log('  next: pnpm admin set-token --mint <CA>   (once the token exists), then pnpm admin create-arena --defaults');
}

async function cmdSetToken(ctx: Ctx, opts: Opts): Promise<void> {
  const mint = pubkey(opts, 'mint');
  if (!mint) throw new UsageError('set-token needs --mint <CA>');
  const config = await requireConfig(ctx);
  const admin = requireAdmin(ctx, config);
  const { program, decimals, symbol } = await loadMint(ctx, mint);
  const ixs = await buildSetTokenInstructions(ctx.client, admin.publicKey, config, mint, program);
  await send(ctx, `game token set to ${mint.toBase58()}${symbol ? ` (${symbol})` : ''}`, ixs);
  const feeToken = feeWalletAta({ feeWallet: config.feeWallet, tokenMint: mint, tokenProgram: program });
  console.log(`  ${tokenProgramName(program)} · ${decimals} decimals${symbol ? ` · symbol ${symbol}` : ''}`);
  console.log(`  fee wallet ${config.feeWallet} → token account ${feeToken.toBase58()}`);
  console.log('  next: pnpm admin create-arena --defaults');
}

async function cmdUpdateConfig(ctx: Ctx, opts: Opts): Promise<void> {
  const changes = parseUpdateConfigOptions(opts);
  const config = await requireConfig(ctx);
  const admin = requireAdmin(ctx, config);
  // A new fee wallet must hold a token account of the game mint before the next settlement.
  const ixs = await buildUpdateConfigInstructions(ctx.client, admin.publicKey, config, changes);
  await send(ctx, `updated config (${Object.keys(changes).join(', ')})`, ixs);
}

async function cmdPause(ctx: Ctx, paused: boolean): Promise<void> {
  const config = await requireConfig(ctx);
  if (config.paused === paused) {
    console.log(`already ${paused ? 'paused' : 'running'} — nothing to do`);
    return;
  }
  const admin = requireAdmin(ctx, config);
  const ix = await ctx.client.ix.updateConfig(admin.publicKey, { paused });
  await send(ctx, paused ? 'paused: arena joins are blocked (settlements and refunds keep working)' : 'unpaused: arena joins are open', [ix]);
}

async function createArena(ctx: Ctx, admin: Keypair, token: GameToken, id: number, entryFee: bigint, maxSessions: number): Promise<void> {
  const ixs = await buildCreateArenasInstructions(ctx.client, admin.publicKey, token, [{ id, entryFee, maxSessions }]);
  await send(ctx, `created arena #${id} (${arenaMeta(id).name}) · entry ${fmtTok(entryFee, token.tokenDecimals)} · max ${maxSessions}`, ixs);
  console.log(`  arena ${explorerAddressUrl(pdas.arena(id, ctx.client.programId).toBase58(), ctx.cluster, ctx.url)}`);
}

async function cmdCreateArena(ctx: Ctx, opts: Opts): Promise<void> {
  const config = await requireConfig(ctx);
  const admin = requireAdmin(ctx, config);
  const token = requireGameToken(config);
  if (flag(opts, 'defaults')) {
    const existing = (await Promise.all(defaultArenaParams(0).map((a) => ctx.client.fetchArena(a.id)))).filter((a) => a !== null);
    const plan = planDefaultArenas(token.tokenDecimals, existing);
    for (const a of existing) console.log(`• arena #${a.id} exists (entry ${fmtTok(a.entryFee, token.tokenDecimals)}, max ${a.maxSessions}) — skipped`);
    for (const tier of plan.create) await createArena(ctx, admin, token, tier.id, tier.entryFee, tier.maxSessions);
    return;
  }
  const id = int(opts, 'id', 0, 65_535);
  const entry = tokens(opts, 'entry', token.tokenDecimals);
  const maxSessions = int(opts, 'max', MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS);
  if (id === undefined || entry === undefined || maxSessions === undefined) {
    throw new UsageError('create-arena needs --id N --entry <tokens> --max N (or --defaults)');
  }
  if (entry === 0n) throw new UsageError('--entry must be greater than zero');
  if (await ctx.client.fetchArena(id)) throw new UsageError(`arena #${id} already exists — use update-arena`);
  await createArena(ctx, admin, token, id, entry, maxSessions);
}

async function cmdUpdateArena(ctx: Ctx, opts: Opts): Promise<void> {
  const id = int(opts, 'id', 0, 65_535);
  if (id === undefined) throw new UsageError('update-arena needs --id N');
  const config = await requireConfig(ctx);
  const changes = {
    enabled: bool(opts, 'enabled'),
    maxSessions: int(opts, 'max', MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS),
    entryFee: opts.has('entry') ? tokens(opts, 'entry', requireGameToken(config).tokenDecimals) : undefined,
  };
  if (Object.values(changes).every((v) => v === undefined)) throw new UsageError('update-arena: pass --enabled, --max and/or --entry');
  const arena = await ctx.client.fetchArena(id);
  if (!arena) throw new UsageError(`arena #${id} does not exist`);
  if (changes.entryFee !== undefined && arena.openSessions > 0) {
    console.log(`! arena #${id} has ${arena.openSessions} open sessions; the program refuses entry fee changes until they settle`);
  }
  const ix = await ctx.client.ix.updateArena(requireAdmin(ctx, config).publicKey, id, changes);
  await send(ctx, `updated arena #${id}`, [ix]);
}

async function cmdSweep(ctx: Ctx, opts: Opts): Promise<void> {
  const id = int(opts, 'id', 0, 65_535);
  if (id === undefined) throw new UsageError('sweep needs --id N');
  const config = await requireConfig(ctx);
  const token = requireGameToken(config);
  const arena = await ctx.client.fetchArena(id);
  if (!arena) throw new UsageError(`arena #${id} does not exist`);
  if (arena.enabled) throw new UsageError(`disable arena #${id} first: pnpm admin update-arena --id ${id} --enabled false`);
  if (arena.openSessions > 0) throw new UsageError(`arena #${id} still has ${arena.openSessions} open sessions; wait until they settle or are refunded`);
  const d = token.tokenDecimals;
  console.log(
    `! sweep moves arena #${id}'s whole vault (${fmtTok(arena.pot, d)}) to the fee wallet ${config.feeWallet}.\n  ${SWEEP_WARNING}`,
  );
  if (!flag(opts, 'force')) throw new UsageError(`sweep refuses without --force (re-run: pnpm admin sweep --id ${id} --force)`);
  const admin = requireAdmin(ctx, config);
  const feeWalletToken = feeWalletAta(config);
  const ixs = await buildSweepInstructions(ctx.client, admin.publicKey, config, token, id);
  await send(ctx, `swept ${fmtTok(arena.pot, d)} from arena #${id} to the fee wallet token account ${feeWalletToken.toBase58()}`, ixs);
}

/* -------------------------------------------------------------------- */

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { command, opts } = parsed;
  if (!command || command === 'help' || opts.get('help') === true) {
    console.log(USAGE);
    return command && command !== 'help' ? 2 : 0;
  }

  const verbose = opts.get('verbose') === true;
  let ctx: Ctx | null = null;
  try {
    const url = str(opts, 'url') ?? process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
    const programArg = str(opts, 'program') ?? process.env.PROGRAM_ID;
    let programId: PublicKey;
    try {
      programId = programArg ? new PublicKey(programArg) : PROGRAM_ID;
    } catch {
      throw new UsageError(`not a valid program id: ${programArg}`);
    }
    const keypairPath = str(opts, 'keypair') ?? '~/.config/solana/id.json';
    let keypair: Keypair | null = null;
    ctx = {
      url,
      cluster: str(opts, 'cluster') ?? process.env.SOLANA_CLUSTER ?? inferCluster(url),
      client: new SlanaClient(new Connection(url, 'confirmed'), programId),
      signer: () => (keypair ??= loadKeypair(keypairPath)),
    };
    const c = ctx;

    const commands: Record<string, () => Promise<void>> = {
      status: () => cmdStatus(c),
      init: () => cmdInit(c, opts),
      'set-token': () => cmdSetToken(c, opts),
      'update-config': () => cmdUpdateConfig(c, opts),
      pause: () => cmdPause(c, true),
      unpause: () => cmdPause(c, false),
      'create-arena': () => cmdCreateArena(c, opts),
      'update-arena': () => cmdUpdateArena(c, opts),
      sweep: () => cmdSweep(c, opts),
    };
    const run = commands[command];
    if (!run) throw new UsageError(`unknown command: ${command} (see \`pnpm admin help\`)`);
    await run();
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`✗ ${err.message}`);
      return 2;
    }
    const d = describeError(err);
    console.error(`✗ ${d.message}${d.name ? ` [${d.name}${d.code !== null ? ` ${d.code}` : ''}]` : d.code !== null ? ` [${d.code}]` : ''}`);
    const raw = (err as Error)?.message?.split('\n')[0];
    if (raw && raw !== d.message) console.error(`  ${raw}`);
    const logs = (err as { logs?: unknown }).logs;
    if (Array.isArray(logs) && logs.length > 0) {
      if (verbose) for (const line of logs) console.error(`  | ${line}`);
      else console.error('  (re-run with --verbose for the transaction logs)');
    }
    if (d.name === 'NetworkError' && ctx) console.error(`  is a validator running at ${ctx.url}?`);
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

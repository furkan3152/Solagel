/**
 * Solagel admin CLI (Node only — not exported from the SDK entry point).
 *
 *   pnpm -F @solagel/sdk admin <command> [options]      (or `pnpm admin <command>` at the repo root)
 *
 * Run `pnpm -F @solagel/sdk admin help` for the command list.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_ARENAS, arenaMeta } from '@solagel/shared';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  BPF_LOADER_UPGRADEABLE_ID,
  MAX_FEE_BPS,
  PROGRAM_ID,
  SolagelClient,
  describeError,
  explorerAddressUrl,
  explorerTxUrl,
  lamportsToSol,
  pdas,
  shortAddress,
  solToLamports,
  type UpdateConfigParams,
} from './index';

const USAGE = `Solagel admin CLI

Usage: pnpm -F @solagel/sdk admin <command> [options]

Commands:
  status                                   config, arenas (with pots), current season top 10 + pool
  init --server <pubkey> --treasury <pubkey> [--fee-bps 500] [--season-share-bps 5000] [--skin-price-sol 0.05]
                                           create Config + season 1 (keypair must be the upgrade authority)
  update-config [--server <pubkey>] [--treasury <pubkey>] [--fee-bps N] [--season-share-bps N]
                [--skin-price-sol X] [--paused true|false] [--admin <pubkey>]
  create-arena --id N --buy-in-sol X --max-players N
  create-arena --defaults                  create the default tiers (skips existing ones)
  update-arena --id N [--enabled true|false] [--max-players N]
  fund-season --sol X                      donate to the current season's prize pool
  end-season                               freeze the current season and open the next one
  rollover --season N                      move unclaimed prizes of season N into the current season
  sweep --id N                             send an idle arena's leftover pot to the treasury

Options:
  --url <rpc>          RPC endpoint (default: $SOLANA_RPC_URL or http://127.0.0.1:8899)
  --keypair <path>     signer / fee payer (default: ~/.config/solana/id.json)
  --program <id>       program id (default: $PROGRAM_ID or ${PROGRAM_ID.toBase58()})
  --cluster <name>     cluster for explorer links (default: inferred from --url)
  --verbose            print transaction logs on errors
`;

class UsageError extends Error {}

type Opts = Map<string, string | true>;

function parseArgs(argv: string[]): { command: string | null; opts: Opts } {
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

function str(opts: Opts, name: string): string | undefined {
  const v = opts.get(name);
  if (v === undefined) return undefined;
  if (v === true) throw new UsageError(`--${name} needs a value`);
  return v;
}

function required(opts: Opts, name: string): string {
  const v = str(opts, name);
  if (v === undefined) throw new UsageError(`--${name} is required`);
  return v;
}

function pubkey(opts: Opts, name: string): PublicKey | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  try {
    return new PublicKey(v);
  } catch {
    throw new UsageError(`--${name}: not a valid public key: ${v}`);
  }
}

function int(opts: Opts, name: string, min: number, max: number): number | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be an integer between ${min} and ${max}`);
  return n;
}

function bool(opts: Opts, name: string): boolean | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new UsageError(`--${name} must be true or false`);
}

function sol(opts: Opts, name: string): number | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  try {
    const lamports = solToLamports(v);
    if (lamports < 0) throw new Error('negative');
    return lamports;
  } catch {
    throw new UsageError(`--${name} must be a non-negative SOL amount (e.g. 0.05)`);
  }
}

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

function inferCluster(url: string): string {
  if (/devnet/i.test(url)) return 'devnet';
  if (/testnet/i.test(url)) return 'testnet';
  if (/mainnet/i.test(url)) return 'mainnet-beta';
  return 'localnet';
}

const fmtSol = (lamports: number): string => `◎${lamportsToSol(lamports).toLocaleString('en-US', { maximumFractionDigits: 9 })}`;
const fmtPct = (bps: number): string => `${(bps / 100).toFixed(2)} %`;
const fmtTime = (unix: number): string => (unix > 0 ? new Date(unix * 1000).toISOString().replace('.000Z', 'Z') : '—');

interface Ctx {
  url: string;
  cluster: string;
  client: SolagelClient;
  signer: () => Keypair;
}

async function send(ctx: Ctx, label: string, ixs: TransactionInstruction[]): Promise<string> {
  const signer = ctx.signer();
  const signature = await ctx.client.sendAndConfirm(ixs, [signer]);
  console.log(`✓ ${label}`);
  console.log(`  signature ${signature}`);
  console.log(`  ${explorerTxUrl(signature, ctx.cluster, ctx.url)}`);
  return signature;
}

async function requireConfig(ctx: Ctx) {
  const config = await ctx.client.fetchConfig();
  if (!config) {
    const deployed = await ctx.client.isDeployed();
    throw new UsageError(
      deployed
        ? `program ${ctx.client.programId.toBase58()} is not initialized yet — run \`admin init --server <pubkey> --treasury <pubkey>\``
        : `program ${ctx.client.programId.toBase58()} is not deployed on ${ctx.url}`,
    );
  }
  return config;
}

/** Upgrade authority stored in the program's ProgramData account (null = immutable/unknown). */
async function upgradeAuthority(ctx: Ctx): Promise<PublicKey | null> {
  const info = await ctx.client.connection.getAccountInfo(pdas.programData(ctx.client.programId));
  if (!info || !info.owner.equals(BPF_LOADER_UPGRADEABLE_ID) || info.data.length < 45) return null;
  // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
  if (info.data.readUInt32LE(0) !== 3 || info.data[12] !== 1) return null;
  return new PublicKey(info.data.subarray(13, 45));
}

/* -------------------------------------------------------------------- */
/* Commands                                                              */
/* -------------------------------------------------------------------- */

async function cmdStatus(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  const deployed = await client.isDeployed();
  console.log(`Solagel on ${ctx.url} (${ctx.cluster})`);
  console.log(`program   ${client.programId.toBase58()}  ${deployed ? '✓ deployed' : '✗ not deployed'}`);
  if (!deployed) return;
  const config = await client.fetchConfig();
  if (!config) {
    console.log('config    ✗ not initialized (run `admin init`)');
    return;
  }
  const [serverBalance, treasuryBalance] = await Promise.all([
    client.connection.getBalance(new PublicKey(config.serverAuthority)),
    client.connection.getBalance(new PublicKey(config.treasury)),
  ]);
  console.log(`config    ${pdas.config(client.programId).toBase58()}`);
  console.log(`  admin             ${config.admin}`);
  console.log(`  server authority  ${config.serverAuthority}  (balance ${fmtSol(serverBalance)})`);
  console.log(`  treasury          ${config.treasury}  (balance ${fmtSol(treasuryBalance)})`);
  console.log(`  fee               ${fmtPct(config.feeBps)} of profit, ${fmtPct(config.seasonShareBps)} of it to the season pool`);
  console.log(`  skin price        ${fmtSol(config.skinPrice)}`);
  console.log(`  current season    ${config.currentSeason}`);
  console.log(`  paused            ${config.paused ? 'YES (arena joins blocked)' : 'no'}`);
  console.log(
    `  totals            ${config.totalPlayers} players · ${config.totalGames} games · ${config.totalSessions} sessions · ` +
      `${fmtSol(config.totalStaked)} staked · ${fmtSol(config.totalPaidOut)} paid out`,
  );

  const arenas = await client.fetchArenas();
  console.log(arenas.length === 0 ? 'arenas    none (run `admin create-arena --defaults`)' : 'arenas');
  for (const a of arenas) {
    const meta = arenaMeta(a.id);
    console.log(
      `  #${a.id} ${meta.emoji} ${meta.name.en.padEnd(14)} buy-in ${fmtSol(a.buyIn).padEnd(8)} max ${String(a.maxPlayers).padStart(3)} · ` +
        `open ${a.openSessions} · pot ${fmtSol(a.pot)} · ${a.enabled ? 'enabled' : 'DISABLED'}  ${a.address}`,
    );
  }

  const season = await client.fetchSeason(config.currentSeason);
  if (!season) {
    console.log(`season ${config.currentSeason} account not found`);
    return;
  }
  console.log(`season ${season.id}  started ${fmtTime(season.startedAt)} · prize pool ${fmtSol(season.pool)} · ${season.entries.length} ranked`);
  season.entries.slice(0, 10).forEach((e, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${e.name.padEnd(16)} ${String(e.points).padStart(9)} pts · best ${String(e.bestScore).padStart(7)} · ${shortAddress(e.player)}`,
    );
  });
  if (config.currentSeason > 1) {
    const prev = await client.fetchSeason(config.currentSeason - 1);
    if (prev) {
      console.log(
        `season ${prev.id}  ended ${fmtTime(prev.endedAt)} · frozen pool ${fmtSol(prev.prizePool)} · unclaimed ${fmtSol(prev.pool)} · claimed mask 0b${prev.claimedMask.toString(2)}`,
      );
    }
  }
}

async function cmdInit(ctx: Ctx, opts: Opts): Promise<void> {
  const server = pubkey(opts, 'server');
  const treasury = pubkey(opts, 'treasury');
  if (!server || !treasury) throw new UsageError('init needs --server <pubkey> and --treasury <pubkey>');
  const feeBps = int(opts, 'fee-bps', 0, MAX_FEE_BPS) ?? 500;
  const seasonShareBps = int(opts, 'season-share-bps', 0, 10_000) ?? 5_000;
  const skinPrice = sol(opts, 'skin-price-sol') ?? solToLamports(0.05);
  const admin = ctx.signer();

  if (!(await ctx.client.isDeployed())) throw new UsageError(`program ${ctx.client.programId.toBase58()} is not deployed on ${ctx.url}`);
  const existing = await ctx.client.fetchConfig();
  if (existing) {
    console.log(`config already initialized (admin ${existing.admin}) — use \`admin update-config\` to change it`);
    return;
  }
  const authority = await upgradeAuthority(ctx);
  if (authority && !authority.equals(admin.publicKey)) {
    throw new UsageError(`initialize must be signed by the program's upgrade authority ${authority.toBase58()}, not ${admin.publicKey.toBase58()}`);
  }
  const ix = await ctx.client.ix.initialize(admin.publicKey, { serverAuthority: server, treasury, feeBps, seasonShareBps, skinPrice });
  await send(ctx, 'initialized config + season 1', [ix]);
  console.log(`  admin ${admin.publicKey.toBase58()} · server ${server.toBase58()} · treasury ${treasury.toBase58()}`);
  console.log(`  fee ${fmtPct(feeBps)} of profit (season share ${fmtPct(seasonShareBps)}) · skin price ${fmtSol(skinPrice)}`);
}

async function cmdUpdateConfig(ctx: Ctx, opts: Opts): Promise<void> {
  const changes: UpdateConfigParams = {
    admin: pubkey(opts, 'admin'),
    serverAuthority: pubkey(opts, 'server'),
    treasury: pubkey(opts, 'treasury'),
    feeBps: int(opts, 'fee-bps', 0, MAX_FEE_BPS),
    seasonShareBps: int(opts, 'season-share-bps', 0, 10_000),
    skinPrice: sol(opts, 'skin-price-sol'),
    paused: bool(opts, 'paused'),
  };
  const given = Object.entries(changes).filter(([, v]) => v !== undefined);
  if (given.length === 0) throw new UsageError('update-config: nothing to change (see `admin help`)');
  await requireConfig(ctx);
  const ix = await ctx.client.ix.updateConfig(ctx.signer().publicKey, changes);
  await send(ctx, `updated config (${given.map(([k]) => k).join(', ')})`, [ix]);
}

async function createArena(ctx: Ctx, id: number, buyIn: number, maxPlayers: number): Promise<void> {
  const ix = await ctx.client.ix.createArena(ctx.signer().publicKey, id, buyIn, maxPlayers);
  await send(ctx, `created arena #${id} (${arenaMeta(id).name.en}) · buy-in ${fmtSol(buyIn)} · max ${maxPlayers}`, [ix]);
  console.log(`  arena ${explorerAddressUrl(pdas.arena(id, ctx.client.programId).toBase58(), ctx.cluster, ctx.url)}`);
}

async function cmdCreateArena(ctx: Ctx, opts: Opts): Promise<void> {
  await requireConfig(ctx);
  if (opts.get('defaults') === true) {
    for (const tier of DEFAULT_ARENAS) {
      const existing = await ctx.client.fetchArena(tier.id);
      if (existing) {
        console.log(`• arena #${tier.id} exists (buy-in ${fmtSol(existing.buyIn)}, max ${existing.maxPlayers}) — skipped`);
        continue;
      }
      await createArena(ctx, tier.id, solToLamports(tier.buyInSol), tier.maxPlayers);
    }
    return;
  }
  const id = int(opts, 'id', 0, 65_535);
  const buyIn = sol(opts, 'buy-in-sol');
  const maxPlayers = int(opts, 'max-players', 2, 100);
  if (id === undefined || buyIn === undefined || maxPlayers === undefined) {
    throw new UsageError('create-arena needs --id N --buy-in-sol X --max-players N (or --defaults)');
  }
  if (await ctx.client.fetchArena(id)) throw new UsageError(`arena #${id} already exists — use update-arena`);
  await createArena(ctx, id, buyIn, maxPlayers);
}

async function cmdUpdateArena(ctx: Ctx, opts: Opts): Promise<void> {
  const id = int(opts, 'id', 0, 65_535);
  if (id === undefined) throw new UsageError('update-arena needs --id N');
  const enabled = bool(opts, 'enabled');
  const maxPlayers = int(opts, 'max-players', 2, 100);
  if (enabled === undefined && maxPlayers === undefined) throw new UsageError('update-arena: pass --enabled and/or --max-players');
  if (!(await ctx.client.fetchArena(id))) throw new UsageError(`arena #${id} does not exist`);
  const ix = await ctx.client.ix.updateArena(ctx.signer().publicKey, id, { enabled, maxPlayers });
  await send(ctx, `updated arena #${id}`, [ix]);
}

async function cmdFundSeason(ctx: Ctx, opts: Opts): Promise<void> {
  const lamports = sol(opts, 'sol');
  if (!lamports) throw new UsageError('fund-season needs --sol X (> 0)');
  const config = await requireConfig(ctx);
  const ix = await ctx.client.ix.fundSeason(ctx.signer().publicKey, config.currentSeason, lamports);
  await send(ctx, `funded season ${config.currentSeason} with ${fmtSol(lamports)}`, [ix]);
}

async function cmdEndSeason(ctx: Ctx): Promise<void> {
  const config = await requireConfig(ctx);
  const season = await ctx.client.fetchSeason(config.currentSeason);
  const ix = await ctx.client.ix.endSeason(ctx.signer().publicKey, config.currentSeason);
  await send(ctx, `ended season ${config.currentSeason} (prize pool ${fmtSol(season?.pool ?? 0)}); season ${config.currentSeason + 1} is live`, [ix]);
}

async function cmdRollover(ctx: Ctx, opts: Opts): Promise<void> {
  const seasonId = int(opts, 'season', 1, 0xffff_ffff);
  if (seasonId === undefined) throw new UsageError('rollover needs --season N');
  const config = await requireConfig(ctx);
  const old = await ctx.client.fetchSeason(seasonId);
  if (!old) throw new UsageError(`season ${seasonId} does not exist`);
  const ix = await ctx.client.ix.rolloverSeason(ctx.signer().publicKey, seasonId, config.currentSeason);
  await send(ctx, `rolled ${fmtSol(old.pool)} from season ${seasonId} into season ${config.currentSeason}`, [ix]);
}

async function cmdSweep(ctx: Ctx, opts: Opts): Promise<void> {
  const id = int(opts, 'id', 0, 65_535);
  if (id === undefined) throw new UsageError('sweep needs --id N');
  const config = await requireConfig(ctx);
  const arena = await ctx.client.fetchArena(id);
  if (!arena) throw new UsageError(`arena #${id} does not exist`);
  const ix = await ctx.client.ix.sweepArena(ctx.signer().publicKey, id, config.treasury);
  await send(ctx, `swept ${fmtSol(arena.pot)} from arena #${id} to the treasury`, [ix]);
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
      client: new SolagelClient(new Connection(url, 'confirmed'), programId),
      signer: () => (keypair ??= loadKeypair(keypairPath)),
    };

    switch (command) {
      case 'status':
        await cmdStatus(ctx);
        break;
      case 'init':
        await cmdInit(ctx, opts);
        break;
      case 'update-config':
        await cmdUpdateConfig(ctx, opts);
        break;
      case 'create-arena':
        await cmdCreateArena(ctx, opts);
        break;
      case 'update-arena':
        await cmdUpdateArena(ctx, opts);
        break;
      case 'fund-season':
        await cmdFundSeason(ctx, opts);
        break;
      case 'end-season':
        await cmdEndSeason(ctx);
        break;
      case 'rollover':
        await cmdRollover(ctx, opts);
        break;
      case 'sweep':
        await cmdSweep(ctx, opts);
        break;
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
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

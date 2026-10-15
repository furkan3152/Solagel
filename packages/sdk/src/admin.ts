/**
 * Slana admin CLI (Node only — not exported from the SDK entry point).
 *
 *   pnpm -F @slana/sdk admin <command> [options]      (or `pnpm admin <command>` at the repo root)
 *
 * Run `pnpm admin help` for the command list.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { DEFAULT_ARENAS, arenaMeta, formatToken, parseToken } from '@slana/shared';
import { getMint } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, type Signer, type TransactionInstruction } from '@solana/web3.js';
import {
  BPF_LOADER_UPGRADEABLE_ID,
  BPS,
  DEFAULT_FEE_BPS,
  DEFAULT_FEE_SPLIT_BPS,
  DEFAULT_PASS_FEE_BPS,
  DEFAULT_SETTLE_FEE_LAMPORTS,
  ENTROPY_DELAY_SLOTS,
  MAX_ARENA_SESSIONS,
  MAX_FEE_BPS,
  MAX_PASS_PER_WALLET,
  MAX_PASS_SUPPLY,
  MAX_SETTLE_FEE_LAMPORTS,
  MIN_ARENA_SESSIONS,
  PROGRAM_ID,
  SlanaClient,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  assertSafeSupply,
  ata,
  checkBaseUri,
  createAtaIdempotentIx,
  createCollectionIx,
  describeError,
  explorerAddressUrl,
  explorerTxUrl,
  lamportsToSol,
  pdas,
  shortAddress,
  type ConfigView,
  type UpdateConfigParams,
} from './index';

/** Defaults from the v2 plan (all configurable; also quoted by the player docs page). */
const DEFAULTS = { feeBps: DEFAULT_FEE_BPS, passFeeBps: DEFAULT_PASS_FEE_BPS, split: DEFAULT_FEE_SPLIT_BPS, settleFeeLamports: DEFAULT_SETTLE_FEE_LAMPORTS };
const DEFAULT_SEED_FILE = 'keys/pass-seed.json';

const USAGE = `Slana admin CLI

Usage: pnpm admin <command> [options]

Setup
  init --mint <M> --server <pubkey> [--fee-bps 500] [--pass-fee-bps 200] [--split 5000/3000/2000]
       [--settle-fee-lamports 20000]
                          create Config, vaults and season 1 (keypair must be the upgrade authority)
  update-config [--admin <pubkey>] [--server <pubkey>] [--fee-bps N] [--pass-fee-bps N]
                [--split T/S/B] [--settle-fee-lamports N] [--paused true|false]
                [--base-uri <url>/] [--supply N] [--per-wallet N] [--min-tokens X]
                [--mint-open true|false] [--start <unix>]
                          --supply only before the mint first opens (then it is fixed for good);
                          --mint-open false only before the first mint (then use close-mint)
  status                  config, mint, vault balances, arenas, season top 10, Pass mint progress

Slana Pass
  create-collection --name "Slana Pass" --uri <base>/collection.json --royalty-bps 500 --royalty-to <pubkey>
                          create the Core collection (update authority = pass authority PDA)
  set-pass-collection --collection <C>
  pass-seed --new [--seed-file ${DEFAULT_SEED_FILE}] [--force]
                          write 32 random bytes and print their sha256 (keep the file secret)
  set-seed-hash [--seed-file ${DEFAULT_SEED_FILE}]
                          commit sha256(seed) on-chain (before the first mint)
  open-mint --base-uri <url>/ [--start <unix>] [--supply N] [--per-wallet N] [--min-tokens X]
                          the supply is fixed for good once the mint opens
  close-mint              end the mint for good (it never reopens; selling out does the same)
  reveal [--seed-file ${DEFAULT_SEED_FILE}]
                          after the mint ended: publish the seed (checked against the hash); only then
                          the program sets the entropy target, the slot ${ENTROPY_DELAY_SLOTS} slots ahead
  capture-entropy         complete the reveal: store the hash of the first block at or after the target
                          slot and the final seed sha256(seed || entropy). Anyone may send it (the game
                          server and the web Pass page do too)

Arenas
  create-arena --defaults                  create the default tiers (skips existing ones)
  create-arena --id N --entry <tokens> --max N [--pass]
  update-arena --id N [--enabled true|false] [--max N] [--entry <tokens>] [--pass true|false]
  sweep --id N --force                     move a disabled, idle arena's vault into the season pool
                                           (check the server journal first: loot of that arena
                                           still waiting there is no longer backed afterwards)

Treasury & seasons
  withdraw-treasury --amount <tokens> --to <owner>
                          pay the owner's token account (created if missing)
  end-season                               freeze the current season and open the next one
  rollover --season N                      move unclaimed prizes of season N into the current season

Options
  --url <rpc>          RPC endpoint (default: $SOLANA_RPC_URL or http://127.0.0.1:8899)
  --keypair <path>     signer / fee payer (default: ~/.config/solana/id.json)
  --program <id>       program id (default: $PROGRAM_ID or ${PROGRAM_ID.toBase58()})
  --cluster <name>     cluster for explorer links (default: inferred from --url)
  --verbose            print transaction logs on errors

Token amounts (--entry, --amount, --min-tokens) are whole tokens with '.' decimals, scaled by the mint's decimals.
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

function required(opts: Opts, name: string, command: string): string {
  const v = str(opts, name);
  if (v === undefined) throw new UsageError(`${command} needs --${name} (see \`pnpm admin help\`)`);
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

/** `--flag` alone means true; `--flag true|false` is accepted too. */
function flag(opts: Opts, name: string): boolean | undefined {
  return opts.get(name) === true ? true : bool(opts, name);
}

/** Whole tokens (en decimals, e.g. `1000` or `0.5`) → base units. */
function tokens(opts: Opts, name: string, decimals: number): bigint | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  try {
    return parseToken(v.replace(/_/g, ''), decimals, 'en');
  } catch (err) {
    throw new UsageError(`--${name}: ${(err as Error).message}`);
  }
}

function split(opts: Opts): [number, number, number] | undefined {
  const v = str(opts, 'split');
  if (v === undefined) return undefined;
  const parts = v.split('/').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > BPS) || parts[0] + parts[1] + parts[2] !== BPS) {
    throw new UsageError(`--split must be treasury/season/burn basis points summing to ${BPS} (e.g. 5000/3000/2000)`);
  }
  return [parts[0], parts[1], parts[2]];
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

function loadSeed(opts: Opts): { file: string; seed: Uint8Array; hash: string } {
  const file = expandHome(str(opts, 'seed-file') ?? DEFAULT_SEED_FILE);
  let seed: Uint8Array;
  try {
    seed = Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[]);
  } catch {
    throw new UsageError(`cannot read seed file ${file} (create it with \`pnpm admin pass-seed --new\`)`);
  }
  if (seed.length !== 32 || seed.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new UsageError(`${file} must hold a JSON array of 32 bytes`);
  return { file, seed, hash: sha256Hex(seed) };
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

function inferCluster(url: string): string {
  if (/devnet/i.test(url)) return 'devnet';
  if (/testnet/i.test(url)) return 'testnet';
  if (/mainnet/i.test(url)) return 'mainnet-beta';
  return 'localnet';
}

const fmtSol = (lamports: number): string => `◎${lamportsToSol(lamports).toLocaleString('en-US', { maximumFractionDigits: 9 })}`;
const fmtPct = (bps: number): string => `${(bps / 100).toFixed(2)} %`;
const fmtTime = (unix: number): string => (unix > 0 ? new Date(unix * 1000).toISOString().replace('.000Z', 'Z') : '—');
const fmtTok = (raw: bigint, decimals: number): string => formatToken(raw, decimals, 'en', { maxFrac: Math.min(decimals, 6) });

interface Ctx {
  url: string;
  cluster: string;
  client: SlanaClient;
  signer: () => Keypair;
}

async function send(ctx: Ctx, label: string, ixs: TransactionInstruction[], extraSigners: Signer[] = []): Promise<string> {
  const signer = ctx.signer();
  const signature = await ctx.client.sendAndConfirm(ixs, [signer, ...extraSigners]);
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
        ? `program ${ctx.client.programId.toBase58()} is not initialized yet — run \`pnpm admin init --mint <M> --server <pubkey>\``
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

/** Token program owning `mint` and its on-chain state; refuses supplies beyond 2^53 − 1. */
async function loadMint(ctx: Ctx, mint: PublicKey) {
  const info = await ctx.client.connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new UsageError(`mint ${mint.toBase58()} does not exist on ${ctx.url}`);
  const program = info.owner;
  if (!program.equals(TOKEN_PROGRAM_ID) && !program.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new UsageError(`${mint.toBase58()} is not an SPL Token / Token-2022 mint (owner ${program.toBase58()})`);
  }
  const state = await getMint(ctx.client.connection, mint, 'confirmed', program);
  try {
    assertSafeSupply(state.supply);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  return { program, state };
}

/* -------------------------------------------------------------------- */
/* Commands                                                              */
/* -------------------------------------------------------------------- */

async function cmdStatus(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  const deployed = await client.isDeployed();
  console.log(`Slana on ${ctx.url} (${ctx.cluster})`);
  console.log(`program   ${client.programId.toBase58()}  ${deployed ? '✓ deployed' : '✗ not deployed'}`);
  if (!deployed) return;
  const config = await client.fetchConfig();
  if (!config) {
    console.log('config    ✗ not initialized (run `pnpm admin init`)');
    return;
  }
  const d = config.tokenDecimals;
  const [serverBalance, vaults, mint] = await Promise.all([
    client.connection.getBalance(new PublicKey(config.serverAuthority)),
    client.fetchVaultBalances(),
    getMint(client.connection, new PublicKey(config.tokenMint), 'confirmed', new PublicKey(config.tokenProgram)).catch(() => null),
  ]);
  const program = config.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() ? 'Token-2022' : config.tokenProgram === TOKEN_PROGRAM_ID.toBase58() ? 'SPL Token' : config.tokenProgram;
  console.log(`config    ${pdas.config(client.programId).toBase58()}`);
  console.log(`  admin             ${config.admin}`);
  console.log(`  server authority  ${config.serverAuthority}  (balance ${fmtSol(serverBalance)})`);
  console.log(`  token mint        ${config.tokenMint}  (${program}, ${d} decimals)`);
  if (mint) {
    console.log(`  supply            ${fmtTok(mint.supply, d)} (${mint.supply} base units)${mint.supply > BigInt(Number.MAX_SAFE_INTEGER) ? '  ✗ above 2^53−1: NOT SUPPORTED' : ''}`);
    console.log(`  mint/freeze auth  ${mint.mintAuthority?.toBase58() ?? 'none'} / ${mint.freezeAuthority?.toBase58() ?? 'none'}`);
  } else {
    console.log('  supply            ✗ mint account not readable');
  }
  console.log(`  fee               ${fmtPct(config.feeBps)} of profit (Pass ${fmtPct(config.passFeeBps)})`);
  console.log(`  fee split         treasury ${fmtPct(config.treasuryBps)} · season ${fmtPct(config.seasonBps)} · burn ${fmtPct(config.burnBps)}`);
  console.log(`  settle deposit    ${fmtSol(config.settleFeeLamports)} per session`);
  console.log(`  current season    ${config.currentSeason}`);
  console.log(`  paused            ${config.paused ? 'YES (arena joins blocked)' : 'no'}`);
  console.log(
    `  totals            ${config.totals.players} players · ${config.totals.games} games · ${config.totals.sessions} sessions · ` +
      `${fmtTok(config.totals.staked, d)} staked · ${fmtTok(config.totals.paidOut, d)} paid out`,
  );
  console.log(`vaults`);
  console.log(`  treasury          ${fmtTok(vaults.treasury, d)}  ${pdas.treasuryVault(client.programId).toBase58()}`);
  console.log(`  season            ${fmtTok(vaults.season, d)}  ${pdas.seasonVault(client.programId).toBase58()}`);

  const arenas = await client.fetchArenas();
  console.log(arenas.length === 0 ? 'arenas    none (run `pnpm admin create-arena --defaults`)' : 'arenas');
  for (const a of arenas) {
    const meta = arenaMeta(a.id);
    console.log(
      `  #${a.id} ${meta.name.en.padEnd(14)} entry ${fmtTok(a.entryFee, d).padEnd(10)} ${a.requiresPass ? 'PASS ' : '     '}` +
        `open ${a.openSessions}/${a.maxSessions} · pot ${fmtTok(a.pot, d)} · ${a.enabled ? 'enabled' : 'DISABLED'}  ${a.address}`,
    );
  }

  const season = await client.fetchSeason(config.currentSeason);
  if (season) {
    console.log(`season ${season.id}  started ${fmtTime(season.startedAt)} · pool ${fmtTok(season.pool, d)} · ${season.entries.length} ranked`);
    season.entries.slice(0, 10).forEach((e, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${e.name.padEnd(16)} ${String(e.points).padStart(9)} pts · best ${String(e.bestScore).padStart(7)} · ${shortAddress(e.player)}`);
    });
  } else {
    console.log(`season ${config.currentSeason} account not found`);
  }
  if (config.currentSeason > 1) {
    const prev = await client.fetchSeason(config.currentSeason - 1);
    if (prev) {
      console.log(
        `season ${prev.id}  ended ${fmtTime(prev.endedAt)} · prize pool ${fmtTok(prev.prizePool, d)} · unclaimed ${fmtTok(prev.pool, d)} · claimed mask 0b${prev.claimedMask.toString(2)}`,
      );
    }
  }

  console.log('slana pass');
  console.log(`  collection        ${config.passCollection ?? '✗ not set (create-collection, then set-pass-collection)'}`);
  console.log(`  base uri          ${config.passBaseUri || '✗ not set'}`);
  const pct = config.passSupply > 0 ? ((config.passMinted / config.passSupply) * 100).toFixed(1) : '0.0';
  console.log(`  minted            ${config.passMinted} / ${config.passSupply} (${pct} %) · ${config.passPerWallet} per wallet · min ${fmtTok(config.passMinTokens, d)} tokens`);
  const now = Math.floor(Date.now() / 1000);
  const state = !config.passMintOpen ? 'closed' : config.passMintStartTs > now ? `opens ${fmtTime(config.passMintStartTs)}` : 'OPEN';
  console.log(`  mint              ${state}${config.passMintOpen && config.passMintStartTs <= now ? ` since ${fmtTime(config.passMintStartTs)}` : ''}`);
  console.log(`  supply lock       ${config.passMintOpened || config.passMinted > 0 ? 'fixed (the mint has opened)' : 'changeable until the mint opens'}`);
  console.log(`  seed hash         ${config.passSeedHash ?? '✗ not set (pass-seed --new, then set-seed-hash)'}`);
  console.log(
    `  seed              ${config.passSeedRevealed ? `public · ${config.passSeed}` : config.passMintEnded ? 'secret — run `pnpm admin reveal`' : 'secret (revealed after the mint ends)'}`,
  );
  console.log(
    `  entropy           ${
      config.passEntropyCaptured
        ? `${config.passEntropy} (hash of slot ${config.passEntropySlot}; target ${config.passEntropyTargetSlot})`
        : config.passSeedRevealed
          ? `pending — target slot ${config.passEntropyTargetSlot} (anyone can capture after it: server, web, capture-entropy)`
          : 'not yet — the target slot is set by the reveal'
    }`,
  );
  console.log(`  revealed          ${config.passRevealed ? 'yes (traits public)' : config.passSeedRevealed ? 'seed public, waiting for the entropy capture' : 'no'}`);
  if (config.passRevealed) console.log(`  final seed        ${config.passFinalSeed}  (sha256(seed || entropy); every trait derives from it)`);
}

async function cmdInit(ctx: Ctx, opts: Opts): Promise<void> {
  const mintKey = pubkey(opts, 'mint');
  const server = pubkey(opts, 'server');
  if (!mintKey || !server) throw new UsageError('init needs --mint <M> and --server <pubkey>');
  if (opts.has('supply')) {
    throw new UsageError('init does not set the Pass supply: run `pnpm admin update-config --supply N` before `open-mint` (it is fixed for good once the mint opens)');
  }
  const feeBps = int(opts, 'fee-bps', 0, MAX_FEE_BPS) ?? DEFAULTS.feeBps;
  const passFeeBps = int(opts, 'pass-fee-bps', 0, MAX_FEE_BPS) ?? DEFAULTS.passFeeBps;
  if (passFeeBps > feeBps) throw new UsageError('--pass-fee-bps must not exceed --fee-bps');
  const feeSplit = split(opts) ?? [...DEFAULTS.split];
  const settleFeeLamports = int(opts, 'settle-fee-lamports', 0, MAX_SETTLE_FEE_LAMPORTS) ?? DEFAULTS.settleFeeLamports;
  const admin = ctx.signer();

  if (!(await ctx.client.isDeployed())) throw new UsageError(`program ${ctx.client.programId.toBase58()} is not deployed on ${ctx.url}`);
  const existing = await ctx.client.fetchConfig();
  if (existing) {
    console.log(`config already initialized (admin ${existing.admin}, mint ${existing.tokenMint}) — use \`pnpm admin update-config\``);
    return;
  }
  const authority = await upgradeAuthority(ctx);
  if (authority && !authority.equals(admin.publicKey)) {
    throw new UsageError(`initialize must be signed by the program's upgrade authority ${authority.toBase58()}, not ${admin.publicKey.toBase58()}`);
  }
  const { program, state } = await loadMint(ctx, mintKey);
  if (state.freezeAuthority) throw new UsageError(`mint ${mintKey.toBase58()} has a freeze authority; the program refuses it`);
  const ix = await ctx.client.ix.initialize(admin.publicKey, {
    serverAuthority: server,
    tokenMint: mintKey,
    tokenProgram: program,
    feeBps,
    passFeeBps,
    split: feeSplit,
    settleFeeLamports,
  });
  await send(ctx, 'initialized config, treasury/season vaults and season 1', [ix]);
  console.log(`  mint ${mintKey.toBase58()} (${program.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'SPL Token'}, ${state.decimals} decimals)`);
  console.log(`  fee ${fmtPct(feeBps)} (Pass ${fmtPct(passFeeBps)}) · split ${feeSplit.join('/')} · settle deposit ${fmtSol(settleFeeLamports)}`);
}

async function cmdUpdateConfig(ctx: Ctx, opts: Opts): Promise<void> {
  const config = await requireConfig(ctx);
  const changes: UpdateConfigParams = {
    admin: pubkey(opts, 'admin'),
    serverAuthority: pubkey(opts, 'server'),
    feeBps: int(opts, 'fee-bps', 0, MAX_FEE_BPS),
    passFeeBps: int(opts, 'pass-fee-bps', 0, MAX_FEE_BPS),
    split: split(opts),
    settleFeeLamports: int(opts, 'settle-fee-lamports', 0, MAX_SETTLE_FEE_LAMPORTS),
    paused: bool(opts, 'paused'),
    passBaseUri: str(opts, 'base-uri'),
    passSupply: int(opts, 'supply', 0, MAX_PASS_SUPPLY),
    passPerWallet: int(opts, 'per-wallet', 1, MAX_PASS_PER_WALLET),
    passMinTokens: tokens(opts, 'min-tokens', config.tokenDecimals),
    passMintOpen: bool(opts, 'mint-open'),
    passMintStartTs: int(opts, 'start', 0, Number.MAX_SAFE_INTEGER),
  };
  const given = Object.entries(changes).filter(([, v]) => v !== undefined);
  if (given.length === 0) throw new UsageError('update-config: nothing to change (see `pnpm admin help`)');
  checkPassMintChanges(config, changes);
  await sendUpdate(ctx, changes, `updated config (${given.map(([k]) => k).join(', ')})`);
}

/** Client-side mirror of the program's Pass mint rules (R17/R18), with clear messages. */
function checkPassMintChanges(config: ConfigView, changes: UpdateConfigParams): void {
  if (changes.passSupply !== undefined && (config.passMintOpened || config.passMinted > 0)) {
    throw new UsageError(
      `the Pass supply is fixed at ${config.passSupply}: it cannot change once the mint has opened (trait rarity depends on it)`,
    );
  }
  if (changes.passSupply !== undefined && changes.passSupply < 1) throw new UsageError('--supply must be at least 1');
  if (changes.passMintOpen === true && config.passMintEnded) {
    throw new UsageError('the Pass mint has ended for good (its trait entropy is fixed); it cannot reopen');
  }
  if (changes.passMintOpen === true && config.passRevealed) throw new UsageError('the Pass seed is revealed; the mint cannot reopen');
  if (changes.passMintOpen === false && config.passMintOpen && config.passMinted > 0) {
    throw new UsageError(`${config.passMinted} Passes are minted: end the mint with \`pnpm admin close-mint\` (it sets the entropy target slot; the mint never reopens)`);
  }
}

async function sendUpdate(ctx: Ctx, changes: UpdateConfigParams, label: string): Promise<void> {
  let ix: TransactionInstruction;
  try {
    ix = await ctx.client.ix.updateConfig(ctx.signer().publicKey, changes);
  } catch (err) {
    if (err instanceof RangeError) throw new UsageError(err.message);
    throw err;
  }
  await send(ctx, label, [ix]);
}

async function cmdCreateCollection(ctx: Ctx, opts: Opts): Promise<void> {
  const name = required(opts, 'name', 'create-collection');
  const uri = required(opts, 'uri', 'create-collection');
  const royaltyBps = int(opts, 'royalty-bps', 0, BPS);
  const royaltyTo = pubkey(opts, 'royalty-to');
  if (royaltyBps === undefined || !royaltyTo) throw new UsageError('create-collection needs --royalty-bps N and --royalty-to <pubkey>');
  const config = await requireConfig(ctx);
  if (config.passCollection) console.log(`! config already uses collection ${config.passCollection}; a new one cannot replace it`);
  const collection = Keypair.generate();
  const admin = ctx.signer();
  const ix = createCollectionIx({
    collection: collection.publicKey,
    updateAuthority: pdas.passAuthority(ctx.client.programId),
    payer: admin.publicKey,
    name,
    uri,
    royaltyBps,
    royaltyTo,
  });
  await send(ctx, `created Core collection "${name}" (royalty ${fmtPct(royaltyBps)} to ${royaltyTo.toBase58()})`, [ix], [collection]);
  console.log(`  collection ${collection.publicKey.toBase58()}`);
  console.log(`  ${explorerAddressUrl(collection.publicKey.toBase58(), ctx.cluster, ctx.url)}`);
  console.log(`  next: pnpm admin set-pass-collection --collection ${collection.publicKey.toBase58()}`);
}

async function cmdSetPassCollection(ctx: Ctx, opts: Opts): Promise<void> {
  const collection = pubkey(opts, 'collection');
  if (!collection) throw new UsageError('set-pass-collection needs --collection <C>');
  const config = await requireConfig(ctx);
  if (config.passCollection) throw new UsageError(`the Pass collection is already set to ${config.passCollection}`);
  const ix = await ctx.client.ix.setPassCollection(ctx.signer().publicKey, collection);
  await send(ctx, `Pass collection set to ${collection.toBase58()}`, [ix]);
}

function cmdPassSeed(opts: Opts): void {
  const file = expandHome(str(opts, 'seed-file') ?? DEFAULT_SEED_FILE);
  if (opts.get('new') !== true) {
    if (!existsSync(file)) throw new UsageError(`no seed at ${file}; create one with \`pnpm admin pass-seed --new\``);
    console.log(`seed file ${file}\nsha256    ${loadSeed(opts).hash}`);
    return;
  }
  if (existsSync(file) && opts.get('force') !== true) throw new UsageError(`${file} already exists (pass --force to overwrite it — the old seed is lost)`);
  const seed = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify([...seed]), { mode: 0o600 });
  console.log(`✓ wrote 32 random bytes to ${file} — keep it secret and backed up, never commit it`);
  console.log(`  sha256 ${sha256Hex(seed)}`);
  console.log(`  next: pnpm admin set-seed-hash --seed-file ${str(opts, 'seed-file') ?? DEFAULT_SEED_FILE}`);
}

async function cmdSetSeedHash(ctx: Ctx, opts: Opts): Promise<void> {
  const { file, hash } = loadSeed(opts);
  const config = await requireConfig(ctx);
  if (config.passRevealed) throw new UsageError('the Pass seed is already revealed');
  if (config.passMinted > 0) throw new UsageError('Passes were already minted; the seed hash is locked');
  const ix = await ctx.client.ix.setPassSeedHash(ctx.signer().publicKey, hexBytes(hash));
  await send(ctx, `committed seed hash ${hash} (from ${file})`, [ix]);
}

async function cmdOpenMint(ctx: Ctx, opts: Opts): Promise<void> {
  const config = await requireConfig(ctx);
  const baseUri = str(opts, 'base-uri') ?? (config.passBaseUri || undefined);
  if (!baseUri) throw new UsageError('open-mint needs --base-uri <url>/');
  if (!config.passCollection) throw new UsageError('set the Pass collection first (create-collection, set-pass-collection)');
  if (!config.passSeedHash) throw new UsageError('commit the seed hash first (pass-seed --new, set-seed-hash)');
  const startTs = int(opts, 'start', 0, Number.MAX_SAFE_INTEGER);
  const changes: UpdateConfigParams = {
    passMintOpen: true,
    passBaseUri: str(opts, 'base-uri'),
    passMintStartTs: startTs,
    passSupply: int(opts, 'supply', 0, MAX_PASS_SUPPLY),
    passPerWallet: int(opts, 'per-wallet', 1, MAX_PASS_PER_WALLET),
    passMinTokens: tokens(opts, 'min-tokens', config.tokenDecimals),
  };
  checkPassMintChanges(config, changes);
  const start = startTs ?? config.passMintStartTs;
  const supply = changes.passSupply ?? config.passSupply;
  console.log(`! the supply (${supply}) is fixed for good once the mint opens`);
  await sendUpdate(ctx, changes, `Pass mint open${start > Date.now() / 1000 ? ` from ${fmtTime(start)}` : ''} · base uri ${baseUri}`);
}

async function cmdCloseMint(ctx: Ctx): Promise<void> {
  const config = await requireConfig(ctx);
  if (config.passMintEnded) throw new UsageError(`the Pass mint already ended (entropy target slot ${config.passEntropyTargetSlot})`);
  if (config.passMinted === 0) {
    // Nothing minted: just switch the flag off (no entropy; the mint may reopen).
    await sendUpdate(ctx, { passMintOpen: false }, 'Pass mint closed before any mint (it may reopen; nothing is fixed yet)');
    return;
  }
  const ix = await ctx.client.ix.closePassMint(ctx.signer().publicKey);
  await send(ctx, `Pass mint ended for good at ${config.passMinted} / ${config.passSupply}`, [ix]);
  const after = await ctx.client.fetchConfig();
  if (after?.passMintEnded) console.log(`  entropy target slot ${after.passEntropyTargetSlot} (~${Math.round((ENTROPY_DELAY_SLOTS * 0.4) / 60)} min)`);
  console.log('  next: `pnpm admin reveal` publishes the seed and sets the entropy target slot');
}

async function cmdCaptureEntropy(ctx: Ctx): Promise<void> {
  const config = await requireConfig(ctx);
  if (config.passRevealed) {
    console.log(`already revealed: entropy ${config.passEntropy} (hash of slot ${config.passEntropySlot}) · final seed ${config.passFinalSeed}`);
    return;
  }
  if (!config.passSeedRevealed) throw new UsageError('the seed is not public yet: `pnpm admin reveal` (after the mint ended) sets the entropy target');
  const slot = await ctx.client.connection.getSlot('confirmed');
  if (slot <= config.passEntropyTargetSlot) {
    throw new UsageError(`target slot ${config.passEntropyTargetSlot} has not passed (now ${slot}); wait ~${Math.ceil((config.passEntropyTargetSlot - slot + 1) * 0.4)} s`);
  }
  const ix = await ctx.client.ix.capturePassEntropy(ctx.signer().publicKey);
  await send(ctx, 'sent capture_pass_entropy', [ix]);
  const after = await ctx.client.fetchConfig();
  if (after?.passRevealed) {
    console.log(`  entropy    ${after.passEntropy} (hash of slot ${after.passEntropySlot})`);
    console.log(`  final seed ${after.passFinalSeed}  = sha256(seed || entropy); every Pass trait derives from it`);
    console.log(`  images:    pnpm pass:generate --final-seed ${after.passFinalSeed}`);
  } else if (after) {
    console.log(`  the target left the SlotHashes window uncaptured; new target slot ${after.passEntropyTargetSlot} (run again after it)`);
  }
}

async function cmdReveal(ctx: Ctx, opts: Opts): Promise<void> {
  const { hash, seed } = loadSeed(opts);
  const config = await requireConfig(ctx);
  if (config.passRevealed || config.passSeedRevealed) throw new UsageError('the seed is already revealed (see `pnpm admin status`)');
  if (!config.passSeedHash) throw new UsageError('no seed hash is committed on-chain');
  if (config.passSeedHash !== hash) throw new UsageError(`seed hash mismatch: on-chain ${config.passSeedHash}, file ${hash}`);
  if (!config.passMintEnded) {
    throw new UsageError(`the mint has not ended (${config.passMinted} / ${config.passSupply}); run \`pnpm admin close-mint\` first`);
  }
  const ix = await ctx.client.ix.revealPass(ctx.signer().publicKey, seed);
  await send(ctx, `revealed Pass seed ${Buffer.from(seed).toString('hex')}`, [ix]);
  const after = await ctx.client.fetchConfig();
  console.log(`  entropy target slot ${after?.passEntropyTargetSlot ?? '?'} (~${Math.round(ENTROPY_DELAY_SLOTS * 0.4)} s): its hash completes the reveal`);
  console.log('  the game server captures it automatically; anyone can (web Pass page, `pnpm admin capture-entropy`)');
}

async function createArena(ctx: Ctx, config: ConfigView, id: number, entryFee: bigint, maxSessions: number, requiresPass: boolean): Promise<void> {
  const ix = await ctx.client.ix.createArena(ctx.signer().publicKey, { id, entryFee, maxSessions, requiresPass, tokenMint: config.tokenMint, tokenProgram: config.tokenProgram });
  await send(ctx, `created arena #${id} (${arenaMeta(id).name.en}) · entry ${fmtTok(entryFee, config.tokenDecimals)} · max ${maxSessions}${requiresPass ? ' · Pass only' : ''}`, [ix]);
  console.log(`  arena ${explorerAddressUrl(pdas.arena(id, ctx.client.programId).toBase58(), ctx.cluster, ctx.url)}`);
}

async function cmdCreateArena(ctx: Ctx, opts: Opts): Promise<void> {
  const config = await requireConfig(ctx);
  const scale = 10n ** BigInt(config.tokenDecimals);
  if (opts.get('defaults') === true) {
    for (const tier of DEFAULT_ARENAS) {
      const existing = await ctx.client.fetchArena(tier.id);
      if (existing) {
        console.log(`• arena #${tier.id} exists (entry ${fmtTok(existing.entryFee, config.tokenDecimals)}, max ${existing.maxSessions}) — skipped`);
        continue;
      }
      await createArena(ctx, config, tier.id, BigInt(tier.entryTokens) * scale, tier.maxSessions, tier.requiresPass);
    }
    return;
  }
  const id = int(opts, 'id', 0, 65_535);
  const entry = tokens(opts, 'entry', config.tokenDecimals);
  const maxSessions = int(opts, 'max', MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS);
  if (id === undefined || entry === undefined || maxSessions === undefined) {
    throw new UsageError('create-arena needs --id N --entry <tokens> --max N [--pass] (or --defaults)');
  }
  if (entry === 0n) throw new UsageError('--entry must be greater than zero');
  if (await ctx.client.fetchArena(id)) throw new UsageError(`arena #${id} already exists — use update-arena`);
  await createArena(ctx, config, id, entry, maxSessions, flag(opts, 'pass') ?? false);
}

async function cmdUpdateArena(ctx: Ctx, opts: Opts): Promise<void> {
  const id = int(opts, 'id', 0, 65_535);
  if (id === undefined) throw new UsageError('update-arena needs --id N');
  const config = await requireConfig(ctx);
  const changes = {
    enabled: bool(opts, 'enabled'),
    maxSessions: int(opts, 'max', MIN_ARENA_SESSIONS, MAX_ARENA_SESSIONS),
    entryFee: tokens(opts, 'entry', config.tokenDecimals),
    requiresPass: bool(opts, 'pass'),
  };
  if (Object.values(changes).every((v) => v === undefined)) throw new UsageError('update-arena: pass --enabled, --max, --entry and/or --pass');
  const arena = await ctx.client.fetchArena(id);
  if (!arena) throw new UsageError(`arena #${id} does not exist`);
  if ((changes.entryFee !== undefined || changes.requiresPass !== undefined) && arena.openSessions > 0) {
    console.log(`! arena #${id} has ${arena.openSessions} open sessions; the program refuses entry/pass changes until they settle`);
  }
  const ix = await ctx.client.ix.updateArena(ctx.signer().publicKey, id, changes);
  await send(ctx, `updated arena #${id}`, [ix]);
}

async function cmdWithdrawTreasury(ctx: Ctx, opts: Opts): Promise<void> {
  const config = await requireConfig(ctx);
  const amount = tokens(opts, 'amount', config.tokenDecimals);
  const to = pubkey(opts, 'to');
  if (amount === undefined || !to) throw new UsageError('withdraw-treasury needs --amount <tokens> --to <owner>');
  if (amount === 0n) throw new UsageError('--amount must be greater than zero');
  const { treasury } = await ctx.client.fetchVaultBalances();
  if (amount > treasury) throw new UsageError(`the treasury holds only ${fmtTok(treasury, config.tokenDecimals)}`);
  const admin = ctx.signer();
  const destination = ata(to, config.tokenMint, config.tokenProgram);
  const ixs = [
    createAtaIdempotentIx(admin.publicKey, to, config.tokenMint, config.tokenProgram),
    await ctx.client.ix.withdrawTreasury(admin.publicKey, { amount, destination, tokenMint: config.tokenMint, tokenProgram: config.tokenProgram }),
  ];
  await send(ctx, `withdrew ${fmtTok(amount, config.tokenDecimals)} from the treasury to ${to.toBase58()} (${destination.toBase58()})`, ixs);
}

async function cmdEndSeason(ctx: Ctx): Promise<void> {
  const config = await requireConfig(ctx);
  const season = await ctx.client.fetchSeason(config.currentSeason);
  const ix = await ctx.client.ix.endSeason(ctx.signer().publicKey, config.currentSeason);
  await send(ctx, `ended season ${config.currentSeason} (prize pool ${fmtTok(season?.pool ?? 0n, config.tokenDecimals)}); season ${config.currentSeason + 1} is live`, [ix]);
}

async function cmdRollover(ctx: Ctx, opts: Opts): Promise<void> {
  const seasonId = int(opts, 'season', 1, 0xffff_ffff);
  if (seasonId === undefined) throw new UsageError('rollover needs --season N');
  const config = await requireConfig(ctx);
  const old = await ctx.client.fetchSeason(seasonId);
  if (!old) throw new UsageError(`season ${seasonId} does not exist`);
  const ix = await ctx.client.ix.rolloverSeason(ctx.signer().publicKey, seasonId, config.currentSeason);
  await send(ctx, `rolled ${fmtTok(old.pool, config.tokenDecimals)} from season ${seasonId} into season ${config.currentSeason}`, [ix]);
}

async function cmdSweep(ctx: Ctx, opts: Opts): Promise<void> {
  const id = int(opts, 'id', 0, 65_535);
  if (id === undefined) throw new UsageError('sweep needs --id N');
  const config = await requireConfig(ctx);
  const arena = await ctx.client.fetchArena(id);
  if (!arena) throw new UsageError(`arena #${id} does not exist`);
  if (arena.enabled) throw new UsageError(`disable arena #${id} first: pnpm admin update-arena --id ${id} --enabled false`);
  console.log(
    `! sweep moves arena #${id}'s whole vault (${fmtTok(arena.pot, config.tokenDecimals)}) into the season pool. The game server may still hold\n` +
      `  journaled loot or pending cash-outs for this arena that this CLI cannot see — check the server log / journal first.\n` +
      `  A server that finds the vault short of its journal keeps the arena disabled. Never re-enable a swept arena.`,
  );
  if (opts.get('force') !== true) throw new UsageError(`sweep refuses without --force (re-run: pnpm admin sweep --id ${id} --force)`);
  const ix = await ctx.client.ix.sweepArena(ctx.signer().publicKey, { id, currentSeason: config.currentSeason, tokenMint: config.tokenMint, tokenProgram: config.tokenProgram });
  await send(ctx, `swept ${fmtTok(arena.pot, config.tokenDecimals)} from arena #${id} into season ${config.currentSeason}`, [ix]);
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

    const commands: Record<string, () => Promise<void> | void> = {
      status: () => cmdStatus(c),
      init: () => cmdInit(c, opts),
      'update-config': () => cmdUpdateConfig(c, opts),
      'create-collection': () => cmdCreateCollection(c, opts),
      'set-pass-collection': () => cmdSetPassCollection(c, opts),
      'pass-seed': () => cmdPassSeed(opts),
      'set-seed-hash': () => cmdSetSeedHash(c, opts),
      'open-mint': () => cmdOpenMint(c, opts),
      'close-mint': () => cmdCloseMint(c),
      'capture-entropy': () => cmdCaptureEntropy(c),
      reveal: () => cmdReveal(c, opts),
      'create-arena': () => cmdCreateArena(c, opts),
      'update-arena': () => cmdUpdateArena(c, opts),
      'withdraw-treasury': () => cmdWithdrawTreasury(c, opts),
      'end-season': () => cmdEndSeason(c),
      rollover: () => cmdRollover(c, opts),
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

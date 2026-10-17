/**
 * End-to-end check of Slana Simple against a fresh localnet and a real game server (real chain,
 * never DEV_FAKE_CHAIN). It follows the mainnet deploy order: the program is initialized WITHOUT
 * a mint, the game server starts (practice only), the admin sets the token, the server picks it up
 * without a restart, the arenas are created and a timed round is played with real tickets.
 *
 *   scripts/localnet.sh --no-token      # validator + Slana + Token-2022 test mint + `init` (no set-token)
 *   pnpm -F @slana/server e2e           # starts the game server itself (see below) and runs the steps
 *
 * The run starts its own game server (`tsx src/index.ts`) with `.localnet/server.env` plus
 * ROUND_SECONDS=30, ROUND_JOIN_CLOSE_SECONDS=5 and three arena bots (ARENA_BOT_*=3), on PORT
 * (default 8787), and stops it at the end. Pass a ws URL (`pnpm -F @slana/server e2e ws://host:port/ws`)
 * to use a server you started yourself with that env instead.
 *
 * What it proves, in order:
 *  1. the program has no mint; the server reports `tokenReady: false` (`/api/config`, `welcome`),
 *     answers arena joins with `token_not_set` and plays practice;
 *  2. `pnpm admin set-token --mint <CA>` (the real CLI): the fee wallet's token account exists,
 *     the config holds the mint; the running server picks it up (config watcher, ≤ 30 s) and
 *     pushes `chain` with `tokenReady: true` to the open connection;
 *  3. `pnpm admin create-arena --defaults`: the server attaches the arenas without a restart;
 *  4. fresh wallets get SOL and $SLANA; at the start of a fresh round four players sign in over
 *     the WebSocket and buy a ticket for the same arena with one real transaction each
 *     (ATA idempotent + register_player + join_arena): a hunter, a prey, a feeder and the fee
 *     wallet itself (the admin, ruling 2040);
 *  5. the hunter grows on food and eats the prey (value moves to the hunter); the feeder swims
 *     into a bot (its value spills as loot); the fee wallet stands still;
 *  6. at the bell every live staker is paid its value: the fee (5 % of the profit, the rate fixed
 *     in the session at join) lands in the fee wallet's token account; the fee wallet's own ticket is
 *     settled WITHOUT its token account (the same account receives the fee) and finalized with
 *     `owed`, which it collects with `refund_session`;
 *  7. the floor loot left at the bell is burned by `sweep_loot`: the mint supply falls by exactly
 *     the tickets minus the payouts, and the arena vault is back where it started (conservation).
 *
 * Bots make step 5 a game: if a bot eats the hunter or the prey first, the run fails with a
 * message saying so (re-run it; it needs a fresh `scripts/localnet.sh --no-token`).
 * Env: SOLANA_RPC_URL (default http://127.0.0.1:8899), PROGRAM_ID (default: SDK IDL address),
 *      ADMIN_KEYPAIR (default ~/.config/solana/id.json), TOKEN_MINT (default: .localnet/token-mint.json),
 *      ARENA_ID (default 1), PORT (default 8787).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SlanaClient,
  ata,
  confirmSignature,
  createAtaIdempotentIx,
  describeError,
  feeWalletAta,
  fetchTokenBalance,
  lamportsToSol,
  requireToken,
  splitPayout,
  type ConfigView,
  type SessionView,
} from '@slana/sdk';
import { EntityKind, PROTOCOL_VERSION, PlayerFlag, decodeSnapshot, encodeTarget, radiusToMass, type ChainStatus, type RoomInfo, type ServerMessage } from '@slana/shared';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction, type Signer } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import WebSocket from 'ws';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SERVER_DIR = resolve(ROOT, 'apps/server');
const port = Number(process.env.PORT ?? 8787);
const externalServer = process.argv[2];
const wsUrl = externalServer ?? `ws://127.0.0.1:${port}/ws`;
const httpUrl = wsUrl.replace(/^ws(s?):/, 'http$1:').replace(/\/ws\/?$/, '');
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const arenaId = Number(process.env.ARENA_ID ?? 1);
const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : resolve(p));
const adminKeypairPath = expandHome(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json');
/** Mass the hunter grows to before it goes for the prey (prey: 20; eat ratio 1.25). */
const HUNT_MASS = 27;
/** The feeder only swims into a bot at least this much heavier than itself (sure to be eaten). */
const FEED_RATIO = 1.4;
const ROUND_ENV = {
  ROUND_SECONDS: '30',
  ROUND_JOIN_CLOSE_SECONDS: '5',
  ARENA_BOT_TARGET: '3',
  ARENA_BOT_MIN: '3',
  ARENA_BOT_MAX: '3',
};

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const step = (msg: string) => console.log(`${elapsed()}  > ${msg}`);
const ok = (msg: string) => console.log(`${elapsed()}  OK ${msg}`);
const sol = (lamports: number) => `◎${lamportsToSol(lamports).toFixed(9).replace(/\.?0+$/, '')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
/** JSON for messages (bigints as strings). */
const j = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

class Fail extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}

async function waitUntil<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>, everyMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe().catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) throw new Fail(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(everyMs);
  }
}

function loadKeypair(path: string, what: string): Keypair {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
  } catch {
    throw new Fail(`cannot read ${what} ${path}`);
  }
}

/** `KEY=value` lines of `.localnet/server.env`. */
function readEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Fail(`cannot read ${path} — run scripts/localnet.sh --no-token first`);
  }
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** `TransferChecked` (SPL Token and Token-2022). */
function transferCheckedIx(source: PublicKey, mint: PublicKey, dest: PublicKey, owner: PublicKey, amount: bigint, decimals: number, tokenProgram: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/* ── processes ───────────────────────────────────────────────────────────── */

const children: ChildProcess[] = [];
let dataDir: string | null = null;

/** Runs the admin CLI (`pnpm -F @slana/sdk admin …`) against the localnet; output is shown. */
function adminCli(programId: string, args: string[]): Promise<void> {
  const all = ['--silent', '-F', '@slana/sdk', 'admin', '--url', rpcUrl, '--keypair', adminKeypairPath, '--program', programId, '--cluster', 'localnet', ...args];
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pnpm', all, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const prefix = (buf: Buffer) =>
      buf
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((l) => console.log(`         admin │ ${l}`));
    child.stdout.on('data', prefix);
    child.stderr.on('data', prefix);
    child.on('error', (err) => reject(new Fail(`admin ${args[0]}: ${err.message}`)));
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Fail(`admin ${args.join(' ')} exited with ${code}`))));
  });
}

/** Starts the game server with the localnet env and short rounds; resolves once it answers. */
async function startServer(): Promise<ChildProcess> {
  // a fresh data dir: the journal and leaderboards of this run only (removed at the end)
  dataDir = mkdtempSync(join(tmpdir(), 'slana-e2e-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...readEnvFile(resolve(ROOT, '.localnet/server.env')),
    ...ROUND_ENV,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    // the run plays as ordinary wallets: open the game to everyone (no admin-only gate)
    GAME_PUBLIC: '1',
  };
  delete env.DEV_FAKE_CHAIN;
  const child = spawn(resolve(SERVER_DIR, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const show = (buf: Buffer) =>
    buf
      .toString()
      .split('\n')
      .filter((l) => /chain:|arena|!!!|error|Error/.test(l))
      .forEach((l) => console.log(`        server │ ${l.replace(/^\[[^\]]+\] /, '')}`));
  child.stdout!.on('data', show);
  child.stderr!.on('data', show);
  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? -1));
  await waitUntil('the game server to answer', 60_000, async () => {
    if (exited !== null) throw new Fail(`the game server exited with ${exited}`);
    return (await fetch(`${httpUrl}/api/health`)).ok;
  });
  return child;
}

/** Stops the game server (SIGTERM, then SIGKILL after 15 s) and removes its data dir. */
async function stopChildren(): Promise<void> {
  await Promise.all(
    children.map(
      (c) =>
        new Promise<void>((done) => {
          if (c.exitCode !== null || c.signalCode !== null) return done();
          const kill = setTimeout(() => c.kill('SIGKILL'), 15_000);
          c.once('exit', () => {
            clearTimeout(kill);
            done();
          });
          c.kill('SIGTERM');
        }),
    ),
  );
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

/* ── the game socket ─────────────────────────────────────────────────────── */

interface Seen {
  kind: number;
  x: number;
  y: number;
  r: number;
  playerId?: number;
}

/** JSON messages + a tracked view of the binary snapshots (entities, players and the camera). */
class GameSocket {
  private readonly msgs: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; reject: (e: Error) => void; failOnError: boolean }[] = [];
  readonly entities = new Map<number, Seen>();
  /** Player flags by player id (from the snapshots' player records). */
  readonly flags = new Map<number, number>();
  view = { x: 0, y: 0 };
  pid = -1;
  /** The latest leaderboard: the top entries and the leaders' centres (minimap). */
  lb: Extract<ServerMessage, { t: 'lb' }> | null = null;

  private constructor(
    private readonly ws: WebSocket,
    readonly label: string,
  ) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.onBinary(data as Buffer);
        return;
      }
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.t === 'lb') {
        this.lb = msg;
        return;
      }
      this.msgs.push(msg);
      if (msg.t === 'joined') this.pid = msg.playerId;
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          this.waiters = this.waiters.filter((x) => x !== w);
          w.resolve(msg);
        } else if (msg.t === 'error' && w.failOnError) {
          this.waiters = this.waiters.filter((x) => x !== w);
          w.reject(new Fail(`${label}: server error ${msg.code}: ${msg.message}`));
        }
      }
    });
    ws.on('close', () => {
      for (const w of this.waiters) w.reject(new Fail(`${label}: websocket closed`));
      this.waiters = [];
    });
  }

  private onBinary(buf: Buffer): void {
    let snap;
    try {
      snap = decodeSnapshot(buf);
    } catch {
      return; // not a snapshot
    }
    this.view = { x: snap.view.x, y: snap.view.y };
    for (const p of snap.players) this.flags.set(p.id, p.flags);
    for (const r of snap.removals) this.entities.delete(r.id);
    for (const e of snap.upserts) this.entities.set(e.id, { kind: e.kind, x: e.x, y: e.y, r: e.r, playerId: e.playerId });
  }

  static connect(url: string, label: string): Promise<GameSocket> {
    return new Promise((resolvePromise, reject) => {
      const ws = new WebSocket(url);
      const s = new GameSocket(ws, label);
      ws.once('open', () => resolvePromise(s));
      ws.once('error', (err) => reject(new Fail(`cannot connect to ${url} (${err.message}) — is the game server running?`)));
    });
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  target(x: number, y: number): void {
    this.ws.send(Buffer.from(encodeTarget(x, y)));
  }

  /** Own cells (mass and centre of mass) from the tracked snapshot entities. */
  me(): { mass: number; x: number; y: number } {
    let mass = 0;
    let x = 0;
    let y = 0;
    for (const e of this.entities.values()) {
      if (e.kind !== EntityKind.Cell || e.playerId !== this.pid) continue;
      const m = radiusToMass(e.r);
      mass += m;
      x += e.x * m;
      y += e.y * m;
    }
    return mass > 0 ? { mass, x: x / mass, y: y / mass } : { mass: 0, ...this.view };
  }

  nearest(kind: number, from: { x: number; y: number }): Seen | null {
    let best: Seen | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== kind) continue;
      const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** A visible bot cell heavier than `minMass`, nearest first; else the minimap centre of the heaviest bot. */
  botTarget(from: { x: number; y: number }, minMass: number): { x: number; y: number } | null {
    let best: Seen | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== EntityKind.Cell || e.playerId === undefined || e.playerId === this.pid) continue;
      if (((this.flags.get(e.playerId) ?? 0) & PlayerFlag.Bot) === 0 || radiusToMass(e.r) < minMass) continue;
      const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) return best;
    const lb = this.lb;
    if (!lb) return null;
    for (let i = 0; i < lb.leaders.length; i++) if (lb.top[i]?.bot && lb.top[i].score >= minMass) return lb.leaders[i];
    return null;
  }

  wait<T extends ServerMessage['t']>(
    t: T,
    timeoutMs: number,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    failOnError = true,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const match = (m: ServerMessage) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>);
    const seen = this.msgs.find(match);
    if (seen) return Promise.resolve(seen as Extract<ServerMessage, { t: T }>);
    return new Promise((resolvePromise, reject) => {
      const w = { pred: match, resolve: resolvePromise as (m: ServerMessage) => void, reject, failOnError };
      this.waiters.push(w);
      setTimeout(() => {
        if (!this.waiters.includes(w)) return;
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Fail(`${this.label}: timed out after ${timeoutMs / 1000} s waiting for '${t}'`));
      }, timeoutMs).unref();
    });
  }

  has<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true): boolean {
    return this.msgs.some((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
  }

  close(): void {
    this.ws.close();
  }
}

/** Wallet sign-in over the WebSocket (nonce → signed message). */
async function signIn(kp: Keypair, label: string): Promise<GameSocket> {
  const wallet = kp.publicKey.toBase58();
  const nonce = (await fetch(`${httpUrl}/api/auth/nonce?pubkey=${wallet}`).then((r) => r.json())) as { message: string };
  assert(typeof nonce.message === 'string', `nonce request failed: ${j(nonce)}`);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), kp.secretKey));
  const ws = await GameSocket.connect(wsUrl, label);
  ws.send({ t: 'hello', v: PROTOCOL_VERSION });
  await ws.wait('welcome', 10_000);
  ws.send({ t: 'viewport', w: 1600, h: 900 });
  ws.send({ t: 'auth', pubkey: wallet, message: nonce.message, signature });
  const authed = await ws.wait('authed', 15_000);
  assert(authed.pubkey === wallet, `unexpected authed message ${j(authed)}`);
  return ws;
}

const serverConfig = async () => ((await fetch(`${httpUrl}/api/config`).then((r) => r.json())) as { protocol: number; chain: ChainStatus }).chain;

/* ── the run ─────────────────────────────────────────────────────────────── */

/** Compute units of the transactions the run sent or watched (information only). */
const units: { label: string; used: number }[] = [];

async function main(): Promise<void> {
  console.log(`Slana e2e · rpc ${rpcUrl} · game ${wsUrl} · arena #${arenaId}\n`);
  const connection = new Connection(rpcUrl, 'confirmed');
  const client = new SlanaClient(connection, process.env.PROGRAM_ID || undefined);
  const programId = client.programId;
  const admin = loadKeypair(adminKeypairPath, 'the admin keypair (ADMIN_KEYPAIR)');
  const mint = new PublicKey(process.env.TOKEN_MINT ?? loadKeypair(resolve(ROOT, '.localnet/token-mint.json'), 'the test mint keypair').publicKey);

  const txUnits = async (signature: string): Promise<number> => {
    const tx = await waitUntil(`transaction ${short(signature)}`, 30_000, () =>
      connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }),
    );
    const used = tx.meta?.computeUnitsConsumed;
    assert(typeof used === 'number', `no computeUnitsConsumed for ${signature}`);
    return used;
  };
  const send = async (label: string, ixs: TransactionInstruction[], signers: Signer[]): Promise<string> => {
    const signature = await client.sendAndConfirm(ixs, signers, { computeUnits: 200_000, priorityMicroLamports: 20_000 });
    units.push({ label, used: await txUnits(signature) });
    return signature;
  };

  /* 1. deployed and initialized without a mint; the server plays practice only */
  step(`checking program ${programId.toBase58()} (initialized, no token yet)`);
  assert(await client.isDeployed(), `program is not deployed on ${rpcUrl} — run scripts/localnet.sh --no-token`);
  let config: ConfigView | null = await client.fetchConfig();
  assert(config, 'program is not initialized — run scripts/localnet.sh --no-token');
  assert(config.admin === admin.publicKey.toBase58(), `ADMIN_KEYPAIR ${admin.publicKey.toBase58()} is not the config admin ${config.admin}`);
  assert(config.tokenMint === null, `the token is already set (${config.tokenMint}) — the e2e needs a FRESH \`scripts/localnet.sh --no-token\``);
  assert((await client.fetchArenas()).length === 0, 'arenas already exist — the e2e needs a FRESH `scripts/localnet.sh --no-token`');
  assert(config.feeWallet === admin.publicKey.toBase58(), `the fee wallet ${config.feeWallet} is not the admin (localnet.sh inits with the admin as fee wallet)`);
  ok(`config: fee ${config.feeBps} bps → fee wallet ${short(config.feeWallet)} (the admin) · token not set · no arena`);

  if (!externalServer) {
    step(`starting the game server on :${port} (ROUND_SECONDS=30, 3 arena bots)`);
    await startServer();
  }
  let status = await serverConfig();
  assert(status.enabled && !status.tokenReady && !status.arenasEnabled && status.token === null, `/api/config before set-token: ${j(status)}`);
  assert(status.feeBps === config.feeBps, `/api/config feeBps ${status.feeBps} ≠ ${config.feeBps}`);
  const watcher = Keypair.generate();
  const watch = await signIn(watcher, 'watcher');
  const welcome = await watch.wait('welcome', 5_000);
  assert(!welcome.chain.tokenReady && welcome.rooms.every((r) => r.mode !== 'arena'), `welcome before set-token: ${j(welcome.chain)}`);
  watch.send({ t: 'join', room: `arena:${arenaId}`, name: 'early', skin: 0 });
  const early = await watch.wait('error', 5_000, (m) => m.code === 'token_not_set', false);
  watch.send({ t: 'join', room: 'practice', name: 'early', skin: 0 });
  const practice = await watch.wait('joined', 5_000);
  assert(practice.room.mode === 'practice', `practice join went to ${practice.room.id}`);
  watch.send({ t: 'leave' });
  ok(`server: tokenReady false · arena join → ${early.code} ("${early.message}") · practice plays`);

  /* 2. set-token with the real admin CLI; the server picks it up without a restart */
  step(`pnpm admin set-token --mint ${mint.toBase58()}`);
  await adminCli(programId.toBase58(), ['set-token', '--mint', mint.toBase58()]);
  config = (await client.fetchConfig())!;
  const token = requireToken(config);
  const tokenProgram = new PublicKey(token.tokenProgram);
  const feeAta = feeWalletAta(config);
  assert(token.tokenMint === mint.toBase58(), `config mint ${token.tokenMint} ≠ ${mint.toBase58()}`);
  assert(await connection.getAccountInfo(feeAta, 'confirmed'), `fee wallet token account ${feeAta.toBase58()} missing after set-token`);
  const scale = 10n ** BigInt(token.tokenDecimals);
  const fmt = (raw: bigint | number) => `${(Number(raw) / Number(scale)).toLocaleString('en-US', { maximumFractionDigits: token.tokenDecimals })} $SLANA`;
  const supply = async () => BigInt((await connection.getTokenSupply(mint, 'confirmed')).value.amount);
  const balance = (owner: PublicKey) => fetchTokenBalance(connection, owner, token.tokenMint, token.tokenProgram);
  const tokenAccountAmount = async (address: PublicKey) => BigInt((await connection.getTokenAccountBalance(address, 'confirmed')).value.amount);
  ok(`token set: ${short(token.tokenMint)} (${token.tokenDecimals} decimals, ${tokenProgram.equals(new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')) ? 'Token-2022' : 'SPL Token'}) · fee wallet token account ${short(feeAta.toBase58())} · supply ${fmt(await supply())}`);

  step('waiting for the server to pick the token up (config watcher, every 30 s)');
  const pushed = await watch.wait('chain', 45_000, (m) => m.chain.tokenReady);
  status = await serverConfig();
  assert(status.tokenReady && status.token?.mint === token.tokenMint && status.token.decimals === token.tokenDecimals, `/api/config after set-token: ${j(status)}`);
  ok(`server: tokenReady true (pushed as \`chain\` to the open connection, no restart) · arenasEnabled ${pushed.chain.arenasEnabled}`);

  /* 3. the default arenas; the server attaches them without a restart */
  step('pnpm admin create-arena --defaults');
  await adminCli(programId.toBase58(), ['create-arena', '--defaults']);
  const arena = await client.fetchArena(arenaId);
  assert(arena?.enabled, `arena #${arenaId} missing or disabled after create-arena --defaults`);
  const listed = await waitUntil(`the server to list arena #${arenaId}`, 90_000, async () => {
    const rooms = ((await fetch(`${httpUrl}/api/rooms`).then((r) => r.json())) as { rooms: RoomInfo[] }).rooms;
    return rooms.find((r) => r.mode === 'arena' && r.arenaId === arenaId) ?? null;
  }, 1_000);
  assert(BigInt(listed.entryFee ?? 0) === arena.entryFee, `room entry fee ${listed.entryFee} ≠ ${arena.entryFee}`);
  ok(`arena #${arenaId} (${listed.name}, ${fmt(arena.entryFee)}) is open on the server · vault ${fmt(arena.pot)}`);
  watch.close();

  /* 4. fresh wallets, a fresh round, four real tickets */
  const hunter = Keypair.generate();
  const prey = Keypair.generate();
  const feeder = Keypair.generate();
  const players = [
    { kp: hunter, name: `hunt_${hunter.publicKey.toBase58().slice(0, 6)}`, skin: 3 },
    { kp: prey, name: `prey_${prey.publicKey.toBase58().slice(0, 6)}`, skin: 5 },
    { kp: feeder, name: `feed_${feeder.publicKey.toBase58().slice(0, 6)}`, skin: 1 },
    { kp: admin, name: 'feewallet', skin: 2 },
  ];
  step(`funding ${players.slice(0, 3).map((p) => p.name).join(', ')}: 2 SOL + ${fmt(arena.entryFee)} each`);
  for (const p of players.slice(0, 3)) {
    const { lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    await confirmSignature(connection, await connection.requestAirdrop(p.kp.publicKey, 2 * LAMPORTS_PER_SOL), lastValidBlockHeight);
  }
  await send(
    'fund (ATA + transfer ×3)',
    players.slice(0, 3).flatMap((p) => [
      createAtaIdempotentIx(admin.publicKey, p.kp.publicKey, mint, tokenProgram),
      transferCheckedIx(feeAta, mint, ata(p.kp.publicKey, mint, tokenProgram), admin.publicKey, arena.entryFee, token.tokenDecimals, tokenProgram),
    ]),
    [admin],
  );
  for (const p of players.slice(0, 3)) assert((await balance(p.kp.publicKey)) === arena.entryFee, `${p.name} was not funded`);
  ok(`funded (${sol(2 * LAMPORTS_PER_SOL)} each)`);

  const vaultBefore = (await client.fetchArena(arenaId))!.pot;
  const supplyBefore = await supply();
  const roundMs = await waitForFreshRound();
  const sockets = new Map<Keypair, GameSocket>();
  const sessions = new Map<Keypair, SessionView>();
  try {
    for (const p of players) {
      const wallet = p.kp.publicKey;
      const ws = await signIn(p.kp, p.name);
      sockets.set(p.kp, ws);
      // one transaction, as a browser signs it: ATA idempotent + register_player + join_arena
      const ixs = [
        createAtaIdempotentIx(wallet, wallet, mint, tokenProgram),
        await client.ix.registerPlayer(wallet, p.name, p.skin),
        await client.ix.joinArena(wallet, {
          arenaId,
          ...token,
          maxFeeBps: config.feeBps,
          maxEntryFee: arena.entryFee,
          maxSettleFee: config.settleFeeLamports,
        }),
      ];
      const sig = await send(`ticket (ata + register + join_arena)`, ixs, [p.kp]);
      ws.send({ t: 'join', room: `arena:${arenaId}`, name: p.name, skin: p.skin });
      const joined = await ws.wait('joined', 15_000);
      const session = (await client.fetchSession(arenaId, wallet))!;
      assert(session && session.feeBps === config.feeBps && session.entryFee === arena.entryFee, `session ${j(session)}`);
      assert(joined.value === Number(session.entryFee) && joined.session === session.address && !('hasPass' in joined), `joined ${j(joined)}`);
      sessions.set(p.kp, session);
      ok(`${p.name} in ${joined.room.name} as pid ${joined.playerId} · session #${session.id} at ${session.feeBps} bps · ${sig.slice(0, 12)}…`);
    }
    const feeAtaAfterTickets = await tokenAccountAmount(feeAta);

    /* 5. the hunt, the feeding, the fee wallet stands still */
    const hws = sockets.get(hunter)!;
    const pws = sockets.get(prey)!;
    const fws = sockets.get(feeder)!;
    const aws = sockets.get(admin)!;
    step(`play: the hunter grows to mass ${HUNT_MASS} and eats the prey; the feeder swims into a bot`);
    let phase: 'grow' | 'chase' = 'grow';
    let wander = 0;
    const steer = setInterval(() => {
      for (const still of [pws, aws]) {
        const m = still.me();
        still.target(m.x, m.y);
      }
      const h = hws.me();
      if (h.mass > 0) {
        if (phase === 'grow' && h.mass >= HUNT_MASS) phase = 'chase';
        if (phase === 'grow') {
          const f = hws.nearest(EntityKind.Food, h);
          hws.target(f ? f.x : h.x + 400, f ? f.y : h.y);
        } else {
          const p = pws.me();
          hws.target(p.x, p.y);
        }
      }
      const f = fws.me();
      if (f.mass > 0) {
        const bot = fws.botTarget(f, f.mass * FEED_RATIO);
        if (bot) fws.target(bot.x, bot.y);
        else {
          // no heavy bot known yet: sweep the map until the minimap shows one
          wander += 0.02;
          fws.target(3200 + Math.cos(wander) * 2400, 3200 + Math.sin(wander) * 2400);
        }
      }
    }, 50);
    let preyDeath: Extract<ServerMessage, { t: 'death' }>;
    let feederDeath: Extract<ServerMessage, { t: 'death' }>;
    try {
      const beforeBell = (ws: GameSocket) => {
        const guard = ws.wait('roundOver', roundMs + 10_000).then((m): never => {
          throw new Fail(`${ws.label}: round ${m.round} ended before it died (re-run; the bots or the map got in the way)`);
        });
        guard.catch(() => {}); // it outlives the race (a dead player never hears the bell)
        return guard;
      };
      [preyDeath, feederDeath] = await Promise.all([
        Promise.race([pws.wait('death', roundMs + 10_000), beforeBell(pws)]),
        Promise.race([fws.wait('death', roundMs + 10_000), beforeBell(fws)]),
      ]);
    } finally {
      clearInterval(steer);
    }
    const entry = Number(arena.entryFee);
    assert(preyDeath.stats.byBot === false && preyDeath.stats.valueLost === entry, `the prey was not eaten by the hunter (re-run): ${j(preyDeath)}`);
    const eat = await hws.wait('value', 5_000, (m) => m.reason === 'eat');
    assert(feederDeath.stats.byBot === true && (feederDeath.stats.lootSpilled ?? 0) > 0, `the feeder was not eaten by a bot (re-run): ${j(feederDeath)}`);
    ok(`prey eaten by ${preyDeath.killer} (hunter value ${fmt(eat.value)}) · feeder eaten by bot ${feederDeath.killer}: ${fmt(feederDeath.stats.lootSpilled ?? 0)} spilled as loot`);
    for (const ws of [hws, aws]) {
      const m = ws.me();
      ws.target(m.x, m.y);
    }

    /* 6. the bell: payouts, fees, the fee wallet's own ticket */
    step('waiting for the bell and the settlements');
    const settledOf = async (kp: Keypair) => {
      const ws = sockets.get(kp)!;
      const session = sessions.get(kp)!;
      return ws.wait('settled', roundMs + 120_000, (m) => m.session === session.address);
    };
    const results = new Map<Keypair, Extract<ServerMessage, { t: 'settled' }>>();
    for (const p of players) results.set(p.kp, await settledOf(p.kp));
    const hOver = hws.has('roundOver') ? 'paid at the bell' : 'died';
    for (const p of players) {
      const s = results.get(p.kp)!;
      const session = sessions.get(p.kp)!;
      const split = splitPayout(s.payout, session.entryFee, session.feeBps);
      assert(s.fee === Number(split.fee) && s.net === Number(split.player), `${p.name}: settled ${j(s)}, expected fee ${split.fee}`);
      units.push({ label: `settle_session (server, ${p.name})`, used: await txUnits(s.signature) });
    }
    const hRes = results.get(hunter)!;
    const aRes = results.get(admin)!;
    assert(hRes.payout >= 2 * entry && (hRes.fee ?? 0) > 0, `the hunter (${hOver}) has no profit: ${j(hRes)}`);
    assert(results.get(prey)!.payout === 0 && results.get(feeder)!.payout === 0, 'the prey and the feeder must settle at 0');
    assert(aRes.collect === true, `the fee wallet's settlement is not finalized for collection: ${j(aRes)}`);
    assert(!results.get(hunter)!.collect, 'the hunter was paid directly');
    // the payouts left the vault: the hunter's net to its ATA, every fee to the fee wallet's ATA
    for (const kp of [hunter, prey, feeder]) await waitUntil(`${short(kp.publicKey.toBase58())}'s session to close`, 30_000, async () => !(await client.fetchSession(arenaId, kp.publicKey)));
    const fees = [...results.values()].reduce((sum, s) => sum + BigInt(s.fee ?? 0), 0n);
    const feeAtaDelta = (await tokenAccountAmount(feeAta)) - feeAtaAfterTickets;
    assert(feeAtaDelta === fees && fees > 0n, `fee wallet token account +${feeAtaDelta}, expected the fees ${fees}`);
    assert((await balance(hunter.publicKey)) === BigInt(hRes.net!), `hunter balance ≠ its net payout ${hRes.net}`);
    const hProfile = await client.fetchProfile(hunter.publicKey);
    assert(hProfile && hProfile.stakeGames === 1 && hProfile.totalWon === BigInt(hRes.net!), `hunter profile ${j(hProfile)}`);
    ok(
      `hunter ${hOver}: ${fmt(hRes.payout)} − fee ${fmt(hRes.fee!)} (${config.feeBps} bps of the profit) = ${fmt(hRes.net!)} · ` +
        `fee wallet token account +${fmt(feeAtaDelta)} (all fees)`,
    );

    // the fee wallet's own ticket: settled without its token account (2040), finalized with owed
    const finalized = await waitUntil('the fee wallet session to be finalized', 30_000, async () => {
      const s = await client.fetchSession(arenaId, admin.publicKey);
      return s?.finalized ? s : null;
    });
    assert(finalized.owed === BigInt(aRes.net ?? 0), `owed ${finalized.owed} ≠ the fee wallet's net payout ${aRes.net}`);
    const beforeCollect = await tokenAccountAmount(feeAta);
    await send('collect (ata idempotent + refund_session)', [createAtaIdempotentIx(admin.publicKey, admin.publicKey, mint, tokenProgram), await client.ix.refundSession(admin.publicKey, { arenaId, ...token })], [admin]);
    assert(!(await client.fetchSession(arenaId, admin.publicKey)), 'the fee wallet session is still open after collecting');
    assert((await tokenAccountAmount(feeAta)) - beforeCollect === finalized.owed, 'the fee wallet did not collect exactly owed');
    ok(`fee wallet played: settled without player_token (no 2040) · finalized with owed ${fmt(finalized.owed)} · collected with refund_session`);

    /* 7. the floor loot is burned; conservation */
    const payouts = [...results.values()].reduce((sum, s) => sum + BigInt(s.payout), 0n);
    const tickets = BigInt(players.length) * arena.entryFee;
    const expectBurn = tickets - payouts;
    step(`waiting for sweep_loot to burn ${fmt(expectBurn)} (tickets ${fmt(tickets)} − payouts ${fmt(payouts)})`);
    const burned = await waitUntil('the loot burn', 60_000, async () => {
      const b = supplyBefore - (await supply());
      return b === expectBurn ? b : null;
    });
    assert(burned > 0n, 'no loot was burned');
    const vaultAfter = (await client.fetchArena(arenaId))!.pot;
    assert(vaultAfter === vaultBefore, `arena vault ${vaultAfter} ≠ ${vaultBefore} before the round (conservation)`);
    ok(`loot burned: supply ${fmt(supplyBefore)} → ${fmt(supplyBefore - burned)} (−${fmt(burned)}) · vault back to ${fmt(vaultAfter)}`);
  } finally {
    for (const ws of sockets.values()) ws.close();
  }

  console.log('\nCompute units:');
  for (const u of units) console.log(`  ${u.label.padEnd(56)} ${String(u.used).padStart(7)}`);
  console.log(
    `\nPASS: e2e passed in ${elapsed().trim()}: init without a mint → server practice only (token_not_set) → set-token → server picks it up ` +
      `(no restart) → create-arena --defaults → arenas attach → 4 real tickets → hunt + bot feeding → bell → fees to the fee wallet → ` +
      `fee wallet's own ticket finalized and collected → loot burned (supply down) → vault conserved`,
  );
}

/**
 * Arena rounds are wall-clock aligned on the server clock (`welcome.serverNow`, `room.round`).
 * Waits for the next round to open unless one just started, so the tickets and the play fit in
 * one round. Returns the round length (ms).
 */
async function waitForFreshRound(): Promise<number> {
  const probe = await GameSocket.connect(wsUrl, 'round probe');
  try {
    probe.send({ t: 'hello', v: PROTOCOL_VERSION });
    const welcome = await probe.wait('welcome', 10_000);
    const round = welcome.rooms.find((r) => r.mode === 'arena' && r.arenaId === arenaId)?.round;
    assert(round && typeof welcome.serverNow === 'number', `arena #${arenaId} has no round on this server`);
    // round n runs [n·len, (n+1)·len): the length follows from its end
    const roundMs = round.endsAt / (round.n + 1);
    const into = welcome.serverNow - (round.endsAt - roundMs);
    assert(roundMs <= 120_000, `rounds last ${roundMs / 1000} s: run the game server with ROUND_SECONDS=30 ROUND_JOIN_CLOSE_SECONDS=5`);
    if (into > 1_500) {
      step(`waiting ${((round.endsAt - welcome.serverNow) / 1000).toFixed(1)} s for the next ${roundMs / 1000} s round`);
      await sleep(round.endsAt - welcome.serverNow + 300);
    }
    ok(`round of ${roundMs / 1000} s open for joins`);
    return roundMs;
  } finally {
    probe.close();
  }
}

main().then(
  async () => {
    await stopChildren();
    process.exit(0);
  },
  async (err) => {
    if (err instanceof Fail) console.error(`\nFAIL: e2e failed: ${err.message}`);
    else {
      const d = describeError(err);
      console.error(`\nFAIL: e2e failed: ${d.message}${d.name ? ` [${d.name}]` : ''}`);
      console.error(err);
    }
    if (units.length) console.error(`compute units so far: ${j(units)}`);
    await stopChildren();
    process.exit(1);
  },
);
process.on('SIGINT', () => void stopChildren().then(() => process.exit(130)));

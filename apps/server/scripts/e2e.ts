/**
 * End-to-end check of Slana v2 against a fresh localnet and a running game server (real chain,
 * never DEV_FAKE_CHAIN):
 *
 *   scripts/localnet.sh        # validator + Slana + Metaplex Core + test mint + config + Pass mint + arenas
 *   cd apps/server && env $(cat ../../.localnet/server.env | xargs) \
 *     STALE_SESSION_AFTER_S=5 ROUND_SECONDS=30 ROUND_JOIN_CLOSE_SECONDS=5 \
 *     ARENA_BOT_TARGET=0 ARENA_BOT_MIN=0 ARENA_BOT_MAX=0 \
 *     npx tsx src/index.ts
 *   pnpm -F @slana/server e2e [ws://127.0.0.1:8787/ws]
 *
 * What it proves, in order:
 *  1. fresh wallets get SOL (airdrop) and $SLANA (from the admin);
 *  2. two of them mint a Slana Pass with the web's mint transaction (Core asset + counter);
 *  3. at the start of a fresh round (timed rounds, `ROUND_SECONDS`), both sign in over the
 *     WebSocket, buy a Pass ticket for the Pass-only arena with the web's ticket transaction
 *     (ATA idempotent + register_player + join_arena_with_pass) and join it;
 *  4. the admin raises the Pass fee: the open sessions keep the fee they were sold with;
 *  5. the hunter eats the prey in the game and collects its value; the prey's death settles
 *     (payout 0); cash-out is refused (paid arenas play rounds); at the round end the hunter is
 *     paid its value (`roundOver`) and the server settles: fee = 2 % of the profit, its burn
 *     share leaves the token supply, treasury and season vaults get theirs, the season
 *     leaderboard lists the hunter. With no bots no loot is left on the floor, so no
 *     `sweep_loot` runs here (the server tests cover the sweep worker);
 *  6. the Pass reveal: close-mint → reveal_pass (admin seed) → the server's own
 *     capture_pass_entropy after the target slot → final seed = sha256(seed || entropy) and
 *     `/pass/<n>.json` carries the traits `passTraits(finalSeed, n, supply)`;
 *  7. two-phase settle (ruling R24): an unplayed ticket whose token account was closed is
 *     refunded by the sweeper (STALE_SESSION_AFTER_S); the server settles it at once WITHOUT the
 *     token account, so the session is finalized with `owed` = the buy-in (no server-paid rent,
 *     no 24 h wait), and the player collects exactly that with the web's collect transaction
 *     (ATA idempotent + refund_session);
 *  8. end_season and the hunter claims its prize with the web's claim transaction;
 *  9. compute units of every player-signed transaction against the web's limits, and the
 *     account sizes the web quotes against the real accounts.
 *
 * Needs a FRESH localnet: the Pass mint ends for good in step 6 and the season ends in step 8.
 * The game server must run short rounds (ROUND_SECONDS=30, joins closed only in the last 5 s):
 * the run waits for a fresh round before the tickets and for its end to settle the hunter.
 * Env: SOLANA_RPC_URL (default http://127.0.0.1:8899), PROGRAM_ID (default: SDK IDL address),
 *      ADMIN_KEYPAIR (default ~/.config/solana/id.json), PASS_SEED_FILE (default .localnet/pass-seed.json),
 *      PASS_ARENA_ID (default 3), PLAIN_ARENA_ID (default 1).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { passJson, passTraits } from '@slana/art';
import {
  MPL_CORE_ID,
  SlanaClient,
  ata,
  confirmSignature,
  createAtaIdempotentIx,
  describeError,
  fetchTokenBalance,
  lamportsToSol,
  parseCoreAsset,
  passNumberFromName,
  pdas,
  prizeAmount,
  splitPayout,
  splitSessionPayout,
  TOKEN_2022_PROGRAM_ID,
  type SessionView,
} from '@slana/sdk';
import {
  EntityKind,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeTarget,
  radiusToMass,
  type ServerMessage,
} from '@slana/shared';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction, type Signer } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import WebSocket from 'ws';
// The web app's own transaction builders and limits: the e2e signs exactly what a browser signs.
import { CAPTURE_COMPUTE_UNITS, MINT_COMPUTE_UNITS, MINT_COUNTER_BYTES, buildMintTx, coreAssetBytes } from '../../web/src/solana/pass';
import { CLAIM_COMPUTE_UNITS, buildClaimTx } from '../../web/src/solana/season';
import { ACCOUNT_BYTES, CLOSE_COMPUTE_UNITS, TICKET_COMPUTE_UNITS, buildCloseTx, buildTicketTx } from '../../web/src/solana/ticket';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const wsUrl = process.argv[2] ?? 'ws://127.0.0.1:8787/ws';
const httpUrl = wsUrl.replace(/^ws(s?):/, 'http$1:').replace(/\/ws\/?$/, '');
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const passArenaId = Number(process.env.PASS_ARENA_ID ?? 3);
const plainArenaId = Number(process.env.PLAIN_ARENA_ID ?? 1);
const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : resolve(p));
const adminKeypairPath = expandHome(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json');
const seedFile = expandHome(process.env.PASS_SEED_FILE ?? resolve(ROOT, '.localnet/pass-seed.json'));
/** Mass the hunter grows to before it goes for the prey (prey: 23 = 20 × the Pass head start 1.15; eat ratio 1.25). */
const HUNT_MASS = 31;

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const step = (msg: string) => console.log(`${elapsed()}  ▸ ${msg}`);
const ok = (msg: string) => console.log(`${elapsed()}  ✓ ${msg}`);
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
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Fail(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(everyMs);
  }
}

function loadKeypair(path: string): Keypair {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
  } catch {
    throw new Fail(`cannot read the admin keypair ${path} (set ADMIN_KEYPAIR)`);
  }
}

/* ── raw Token-2022 / SPL instructions the SDK does not need ─────────────── */

/** `TransferChecked` (works for SPL Token and Token-2022). */
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

/** `CloseAccount` (balance must be zero): rent goes back to `dest`. */
function closeAccountIx(account: PublicKey, dest: PublicKey, owner: PublicKey, tokenProgram: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  });
}

/* ── the game socket ─────────────────────────────────────────────────────── */

interface Seen {
  kind: number;
  x: number;
  y: number;
  r: number;
  playerId?: number;
}

/** JSON messages + a tracked view of the binary snapshots (entities and the camera). */
class GameSocket {
  private readonly msgs: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; reject: (e: Error) => void; failOnError: boolean }[] = [];
  readonly entities = new Map<number, Seen>();
  view = { x: 0, y: 0 };
  pid = -1;

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
    for (const r of snap.removals) this.entities.delete(r.id);
    for (const e of snap.upserts) this.entities.set(e.id, { kind: e.kind, x: e.x, y: e.y, r: e.r, playerId: e.playerId });
  }

  static connect(url: string, label: string): Promise<GameSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const s = new GameSocket(ws, label);
      ws.once('open', () => resolve(s));
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

  nearestFood(from: { x: number; y: number }): Seen | null {
    let best: Seen | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== EntityKind.Food) continue;
      const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Waits for a message `t` (also one received earlier). Server errors fail the wait unless `failOnError` is false. */
  wait<T extends ServerMessage['t']>(
    t: T,
    timeoutMs: number,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    failOnError = true,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const match = (m: ServerMessage) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>);
    const seen = this.msgs.find(match);
    if (seen) return Promise.resolve(seen as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const w = { pred: match, resolve: resolve as (m: ServerMessage) => void, reject, failOnError };
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

/* ── the run ─────────────────────────────────────────────────────────────── */

/** Compute units consumed by player/server transactions, against the web's limits. */
const units: { label: string; used: number; limit: number | null }[] = [];
/** Real account sizes against what the web quotes for the SOL disclosure. */
const sizes: { label: string; real: number; quoted: number }[] = [];

async function main(): Promise<void> {
  console.log(`Slana e2e · rpc ${rpcUrl} · game ${wsUrl} · Pass arena #${passArenaId} · plain arena #${plainArenaId}\n`);
  const connection = new Connection(rpcUrl, 'confirmed');
  const client = new SlanaClient(connection, process.env.PROGRAM_ID || undefined);
  const programId = client.programId;
  const admin = loadKeypair(adminKeypairPath);

  const txUnits = async (signature: string): Promise<number> => {
    const tx = await waitUntil(`transaction ${short(signature)}`, 30_000, () =>
      connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }),
    );
    const used = tx.meta?.computeUnitsConsumed;
    assert(typeof used === 'number', `no computeUnitsConsumed for ${signature}`);
    return used;
  };
  /** Sends like the web does (compute-unit limit + priority fee) and records the units used. */
  const send = async (label: string, ixs: TransactionInstruction[], signers: Signer[], limit: number | null = null): Promise<string> => {
    const signature = await client.sendAndConfirm(ixs, signers, limit ? { computeUnits: limit, priorityMicroLamports: 20_000 } : {});
    if (limit !== null) {
      const used = await txUnits(signature);
      units.push({ label, used, limit });
      assert(used <= limit, `${label}: ${used} compute units exceed the web limit ${limit}`);
    }
    return signature;
  };
  const accountSize = async (address: string | PublicKey): Promise<number> => {
    const info = await connection.getAccountInfo(new PublicKey(address), 'confirmed');
    assert(info, `account ${address} missing`);
    return info.data.length;
  };
  const checkSize = async (label: string, address: string | PublicKey, quoted: number) => {
    const real = await accountSize(address);
    sizes.push({ label, real, quoted });
    assert(real === quoted, `${label}: the account has ${real} bytes, the web quotes rent for ${quoted}`);
  };

  /* 0. the stack */
  step(`checking program ${programId.toBase58()} and the game server`);
  assert(await client.isDeployed(), `program is not deployed on ${rpcUrl} — run scripts/localnet.sh`);
  let config = (await client.fetchConfig())!;
  assert(config, 'program is not initialized — run scripts/localnet.sh');
  assert(config.admin === admin.publicKey.toBase58(), `ADMIN_KEYPAIR ${admin.publicKey.toBase58()} is not the config admin ${config.admin}`);
  assert(config.passCollection && config.passMintOpen && !config.passMintEnded, 'the Pass mint is not open (or already ended) — the e2e needs a FRESH scripts/localnet.sh');
  const passArena = await client.fetchArena(passArenaId);
  const plainArena = await client.fetchArena(plainArenaId);
  assert(passArena?.enabled && passArena.requiresPass, `arena #${passArenaId} must exist, be enabled and require a Pass`);
  assert(plainArena?.enabled && !plainArena.requiresPass, `arena #${plainArenaId} must exist, be enabled and not require a Pass`);
  const seed = Uint8Array.from(JSON.parse(readFileSync(seedFile, 'utf8')) as number[]);
  assert(createHash('sha256').update(seed).digest('hex') === config.passSeedHash, `${seedFile} does not match the committed seed hash`);
  const health = (await fetch(`${httpUrl}/api/config`).then((r) => r.json())) as { chain: { enabled: boolean; arenasEnabled: boolean; pass: unknown } };
  assert(health.chain.enabled && health.chain.arenasEnabled && health.chain.pass, `game server at ${httpUrl} has chain/arenas/pass off: ${j(health.chain)}`);
  const token = { tokenMint: config.tokenMint, tokenProgram: config.tokenProgram };
  const mint = new PublicKey(config.tokenMint);
  const tokenProgram = new PublicKey(config.tokenProgram);
  const scale = 10n ** BigInt(config.tokenDecimals);
  const fmt = (raw: bigint | number) => `${(Number(raw) / Number(scale)).toLocaleString('en-US', { maximumFractionDigits: config.tokenDecimals })} $SLANA`;
  const supply = async () => BigInt((await connection.getTokenSupply(mint, 'confirmed')).value.amount);
  const balance = (owner: PublicKey) => fetchTokenBalance(connection, owner, config.tokenMint, config.tokenProgram);
  ok(
    `season ${config.currentSeason} · fee ${config.feeBps} bps (Pass ${config.passFeeBps}) · split ${config.treasuryBps}/${config.seasonBps}/${config.burnBps} · ` +
      `arena #${passArenaId} ${fmt(passArena.entryFee)} (Pass) · arena #${plainArenaId} ${fmt(plainArena.entryFee)} · supply ${fmt(await supply())}`,
  );

  /* 1. fresh wallets with SOL and $SLANA */
  const hunter = Keypair.generate();
  const prey = Keypair.generate();
  const idle = Keypair.generate();
  const wallets = [
    { kp: hunter, name: `hunt_${hunter.publicKey.toBase58().slice(0, 6)}`, tokens: passArena.entryFee },
    { kp: prey, name: `prey_${prey.publicKey.toBase58().slice(0, 6)}`, tokens: passArena.entryFee },
    { kp: idle, name: `idle_${idle.publicKey.toBase58().slice(0, 6)}`, tokens: plainArena.entryFee },
  ];
  step(`funding ${wallets.map((w) => w.name).join(', ')}: 2 SOL each + their entry fee in $SLANA`);
  for (const w of wallets) {
    const { lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    await confirmSignature(connection, await connection.requestAirdrop(w.kp.publicKey, 2 * LAMPORTS_PER_SOL), lastValidBlockHeight);
  }
  await send(
    'fund',
    wallets.flatMap((w) => [
      createAtaIdempotentIx(admin.publicKey, w.kp.publicKey, mint, tokenProgram),
      transferCheckedIx(ata(admin.publicKey, mint, tokenProgram), mint, ata(w.kp.publicKey, mint, tokenProgram), admin.publicKey, w.tokens, config.tokenDecimals, tokenProgram),
    ]),
    [admin],
  );
  for (const w of wallets) assert((await balance(w.kp.publicKey)) === w.tokens, `${w.name} was not funded`);
  const lamports = await Promise.all(wallets.map((w) => connection.getBalance(w.kp.publicKey, 'confirmed')));
  ok(`funded: ${wallets.map((w, i) => `${w.name} ${sol(lamports[i])} + ${fmt(w.tokens)}`).join(' · ')}`);

  /* 2. mint a Pass each (the web's mint transaction) */
  const passes = new Map<string, { asset: string; number: number }>();
  for (const who of [hunter, prey]) {
    const asset = Keypair.generate();
    const before = config.passMinted;
    step(`mint_pass for ${short(who.publicKey.toBase58())} (asset ${short(asset.publicKey.toBase58())})`);
    const { ixs } = await buildMintTx(client.ix, { minter: who.publicKey, asset: asset.publicKey, config });
    const sig = await send('mint (mint_pass: Core CreateV2 + counter)', ixs, [who, asset], MINT_COMPUTE_UNITS);
    const info = await connection.getAccountInfo(asset.publicKey, 'confirmed');
    assert(info && info.owner.equals(MPL_CORE_ID), 'the Pass asset is not a Core account');
    const parsed = parseCoreAsset(info.data);
    const number = parsed ? passNumberFromName(parsed.name) : null;
    assert(parsed && parsed.owner === who.publicKey.toBase58() && parsed.collection === config.passCollection, `unexpected Pass asset ${j(parsed)}`);
    assert(number === before + 1, `Pass number ${number}, expected ${before + 1}`);
    assert(parsed.uri === `${config.passBaseUri}${number}.json`, `Pass uri ${parsed.uri}`);
    await checkSize(`Core asset (Slana Pass #${number})`, asset.publicKey, coreAssetBytes(number, config.passBaseUri));
    await checkSize('MintCounter', pdas.passMinted(who.publicKey, programId), MINT_COUNTER_BYTES);
    passes.set(who.publicKey.toBase58(), { asset: asset.publicKey.toBase58(), number });
    config = (await client.fetchConfig())!;
    ok(`Slana Pass #${number} → ${short(who.publicKey.toBase58())} · minted ${config.passMinted}/${config.passSupply} · ${sig.slice(0, 16)}…`);
  }

  /* 3. a fresh round; sign in, buy a Pass ticket, join the arena */
  const roundMs = await waitForFreshRound();
  const sockets = new Map<string, GameSocket>();
  const sessions = new Map<string, SessionView>();
  try {
    for (const w of wallets.slice(0, 2)) {
      const wallet = w.kp.publicKey.toBase58();
      step(`${w.name}: wallet login over the WebSocket (nonce → signed message)`);
      const nonce = (await fetch(`${httpUrl}/api/auth/nonce?pubkey=${wallet}`).then((r) => r.json())) as { message: string };
      assert(typeof nonce.message === 'string', `nonce request failed: ${j(nonce)}`);
      const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), w.kp.secretKey));
      const ws = await GameSocket.connect(wsUrl, w.name);
      sockets.set(wallet, ws);
      ws.send({ t: 'hello', v: PROTOCOL_VERSION });
      const welcome = await ws.wait('welcome', 10_000);
      assert(welcome.chain.enabled && welcome.chain.arenasEnabled && welcome.chain.pass, `welcome says chain=${j(welcome.chain)}`);
      assert(!(welcome.blocked ?? []).some((b) => b.arenaId === passArenaId), `arena #${passArenaId} is blocked (R20)`);
      // I3: the server publishes the Pass power it applies (the web discloses these numbers)
      assert(welcome.chain.passPower && welcome.chain.passPower.startMassMul >= 1, `welcome has no passPower: ${j(welcome.chain)}`);
      ws.send({ t: 'viewport', w: 1600, h: 900 });
      ws.send({ t: 'auth', pubkey: wallet, message: nonce.message, signature });
      const authed = await ws.wait('authed', 15_000);
      assert(authed.pubkey === wallet, `unexpected authed message ${j(authed)}`);

      // the ticket: one transaction, exactly what the web builds (ATA idempotent + register + join with the Pass)
      const pass = passes.get(wallet)!;
      step(`${w.name}: ticket for arena #${passArenaId} with Slana Pass #${pass.number}`);
      const { steps, ixs } = await buildTicketTx(client.ix, {
        player: wallet,
        arenaId: passArenaId,
        token,
        ataExists: w.kp === hunter ? null : true,
        register: { name: w.name, skin: w.kp === hunter ? 3 : 5 },
        passAsset: pass.asset,
        maxFeeBps: config.passFeeBps,
        maxEntryFee: passArena.entryFee,
        maxSettleFee: config.settleFeeLamports,
      });
      const ticketSig = await send(`ticket (${steps.join(' + ')})`, ixs, [w.kp], TICKET_COMPUTE_UNITS);
      // join right away: an unplayed ticket is refunded after STALE_SESSION_AFTER_S
      ws.send({ t: 'join', room: `arena:${passArenaId}`, name: w.name, skin: 3, pass: pass.asset });
      const joined = await ws.wait('joined', 15_000);
      const session = (await client.fetchSession(passArenaId, wallet))!;
      assert(session && session.hasPass && session.passAsset === pass.asset, `session ${j(session)}`);
      assert(session.feeBps === config.passFeeBps, `session fee ${session.feeBps} bps ≠ the Pass fee ${config.passFeeBps}`);
      assert(joined.value === Number(session.entryFee) && joined.hasPass === true && joined.session === session.address, `joined ${j(joined)}`);
      sessions.set(wallet, session);
      const lock = await client.fetchPassLock(pass.asset);
      assert(lock && lock.session === session.address && lock.player === wallet, 'the Pass is not locked to the session');
      await checkSize('Session', session.address, ACCOUNT_BYTES.session);
      await checkSize('PassLock', lock.address, ACCOUNT_BYTES.passLock);
      await checkSize('PlayerProfile', pdas.profile(wallet, programId), ACCOUNT_BYTES.profile);
      ok(
        `${w.name} in ${joined.room.name} as pid ${joined.playerId} · value ${fmt(joined.value ?? 0)} · session #${session.id} at ${session.feeBps} bps · ` +
          `Pass #${pass.number} locked · ${ticketSig.slice(0, 16)}…`,
      );
    }
    for (const w of wallets) {
      await checkSize(`token account (${w.name})`, ata(w.kp.publicKey, mint, tokenProgram), tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? ACCOUNT_BYTES.ata2022 : ACCOUNT_BYTES.ata);
    }

    /* 4. the fee is fixed in the session at join */
    const snapshotBps = config.passFeeBps;
    step(`admin raises the Pass fee ${snapshotBps} → ${snapshotBps + 100} bps while both sessions are open`);
    await send('update_config', [await client.ix.updateConfig(admin.publicKey, { passFeeBps: snapshotBps + 100 })], [admin]);
    config = (await client.fetchConfig())!;
    assert(config.passFeeBps === snapshotBps + 100, 'fee update did not land');
    ok(`config Pass fee ${config.passFeeBps} bps; the open sessions keep ${snapshotBps} bps`);

    /* 5. the hunter eats the prey, then is paid at the round end */
    const hws = sockets.get(hunter.publicKey.toBase58())!;
    const pws = sockets.get(prey.publicKey.toBase58())!;
    const hSession = sessions.get(hunter.publicKey.toBase58())!;
    const pSession = sessions.get(prey.publicKey.toBase58())!;
    step(`hunt: the prey waits, the hunter grows to mass ${HUNT_MASS} on food and swallows it`);
    let phase: 'grow' | 'chase' = 'grow';
    const steer = setInterval(() => {
      const p = pws.me();
      pws.target(p.x, p.y); // stand still
      const h = hws.me();
      if (h.mass === 0) return;
      if (phase === 'grow' && h.mass >= HUNT_MASS) phase = 'chase';
      if (phase === 'grow') {
        const f = hws.nearestFood(h);
        hws.target(f ? f.x : h.x + 400, f ? f.y : h.y);
      } else {
        hws.target(p.x, p.y);
      }
    }, 50);
    let preyDeath;
    try {
      // the hunt must end before the bell (both would then be paid their value)
      preyDeath = await Promise.race([
        pws.wait('death', 180_000),
        pws.wait('roundOver', 180_000).then((m): never => {
          throw new Fail(`round ${m.round} ended before the hunt finished: run the game server with a longer ROUND_SECONDS`);
        }),
      ]);
    } finally {
      clearInterval(steer);
    }
    const eat = await hws.wait('value', 5_000, (m) => m.reason === 'eat');
    assert(eat.delta === Number(pSession.entryFee) && eat.value === Number(hSession.entryFee + pSession.entryFee), `value ${j(eat)}`);
    assert(preyDeath.stats.payout === 0 && preyDeath.stats.valueLost === Number(pSession.entryFee) && preyDeath.stats.byBot === false, `prey death stats ${j(preyDeath.stats)}`);
    ok(`prey eaten by ${preyDeath.killer}: hunter value ${fmt(eat.value)} (+${fmt(eat.delta)}) · prey lost ${fmt(preyDeath.stats.valueLost ?? 0)}`);

    step('prey: death settlement (payout 0)');
    const preySettled = await pws.wait('settled', 90_000);
    assert(preySettled.kind === 'death' && preySettled.payout === 0 && preySettled.session === pSession.address, `prey settled ${j(preySettled)}`);
    units.push({ label: 'settle_session (server, death, Pass)', used: await txUnits(preySettled.signature), limit: null });
    await waitUntil('the prey session to close', 30_000, async () => !(await client.fetchSession(passArenaId, prey.publicKey)));
    assert(!(await client.fetchPassLock(passes.get(prey.publicKey.toBase58())!.asset)), 'the prey Pass is still locked');
    ok(`prey settled at 0 · session closed · Pass unlocked · ${preySettled.signature.slice(0, 16)}…`);

    const supplyBefore = await supply();
    const vaultsBefore = await client.fetchVaultBalances();
    const hunterTokensBefore = await balance(hunter.publicKey);
    step('hunter: no cash-out in a paid arena; it waits for the round end');
    const hPos = hws.me();
    hws.target(hPos.x, hPos.y);
    hws.send({ t: 'cashout' });
    await hws.wait('error', 5_000, (m) => m.code === 'no_cashout', false);
    const over = await hws.wait('roundOver', roundMs + 15_000);
    const payout = over.payout;
    assert(payout === Number(hSession.entryFee + pSession.entryFee), `round-end payout ${payout}`);
    assert(over.stats.payout === payout && over.standings[0]?.you === true && over.standings[0].value === payout, `roundOver ${j(over)}`);
    assert(!hws.has('cashout'), 'the server answered a cash-out in a paid arena');
    ok(`round ${over.round} over: the hunter is paid its value ${fmt(payout)} at the bell (#1 of ${over.standings.length})`);

    step('waiting for the server settle_session');
    const settled = await hws.wait('settled', 90_000);
    const split = splitSessionPayout(payout, hSession, config);
    const preview = splitPayout(payout, hSession.entryFee, true, { ...config, passFeeBps: snapshotBps });
    assert(split.fee === preview.fee, 'session split differs from the snapshot preview');
    assert(split.fee === (BigInt(payout) - hSession.entryFee) * BigInt(snapshotBps) / 10_000n, 'fee is not 2 % of the profit');
    assert(settled.kind === 'payout' && settled.session === hSession.address && settled.payout === payout, `settled ${j(settled)}`);
    assert(settled.fee === Number(split.fee) && settled.net === Number(split.player), `settled fee ${settled.fee} / net ${settled.net}, expected ${split.fee} / ${split.player}`);
    units.push({ label: 'settle_session (server, round end, Pass)', used: await txUnits(settled.signature), limit: null });
    await waitUntil('the hunter session to close', 30_000, async () => !(await client.fetchSession(passArenaId, hunter.publicKey)));
    const delta = (await balance(hunter.publicKey)) - hunterTokensBefore;
    const burned = supplyBefore - (await supply());
    const vaultsAfter = await client.fetchVaultBalances();
    assert(delta === split.player, `hunter received ${delta}, expected ${split.player}`);
    assert(burned === split.burn && burned > 0n, `supply fell by ${burned}, expected the burn ${split.burn}`);
    assert(vaultsAfter.treasury - vaultsBefore.treasury === split.treasury, 'treasury share');
    assert(vaultsAfter.season - vaultsBefore.season === split.season, 'season share');
    assert(!(await client.fetchPassLock(passes.get(hunter.publicKey.toBase58())!.asset)), 'the hunter Pass is still locked');
    ok(
      `settled: payout ${fmt(payout)} − fee ${fmt(split.fee)} (${snapshotBps} bps of the ${fmt(BigInt(payout) - hSession.entryFee)} profit, not ${config.passFeeBps}) = ${fmt(split.player)} · ` +
        `burned ${fmt(burned)} (supply ↓) · treasury +${fmt(split.treasury)} · season +${fmt(split.season)} · ${settled.signature.slice(0, 16)}…`,
    );

    const profile = await client.fetchProfile(hunter.publicKey);
    assert(profile && profile.stakeGames === 1 && profile.gamesPlayed === 1 && profile.totalWon === split.player, `hunter profile ${j(profile)}`);
    const season = await client.fetchSeason(config.currentSeason);
    const rank = season?.entries.findIndex((e) => e.player === hunter.publicKey.toBase58()) ?? -1;
    assert(season && rank >= 0, `hunter missing from the season ${config.currentSeason} leaderboard`);
    ok(`season ${season.id} leaderboard: #${rank + 1} ${season.entries[rank].name} · ${season.entries[rank].points} pts · pool ${fmt(season.pool)}`);

    step(`admin restores the Pass fee to ${snapshotBps} bps`);
    await send('update_config', [await client.ix.updateConfig(admin.publicKey, { passFeeBps: snapshotBps })], [admin]);
    config = (await client.fetchConfig())!;
  } finally {
    for (const ws of sockets.values()) ws.close();
  }

  /* 6. the Pass reveal */
  step('close-mint → reveal_pass (admin seed) → the server captures the entropy');
  await send('close_pass_mint', [await client.ix.closePassMint(admin.publicKey)], [admin]);
  await send('reveal_pass', [await client.ix.revealPass(admin.publicKey, seed)], [admin]);
  config = (await client.fetchConfig())!;
  assert(config.passMintEnded && config.passSeedRevealed && config.passSeed === Buffer.from(seed).toString('hex'), 'reveal_pass did not publish the seed');
  const target = config.passEntropyTargetSlot;
  const revealSlot = await connection.getSlot('confirmed');
  assert(target > revealSlot, `entropy target ${target} is not in the future (slot ${revealSlot})`);
  ok(`seed public · entropy target slot ${target} (now ${revealSlot}, ${target - revealSlot} slots ahead)`);
  // the server's 30 s refresh sends capture_pass_entropy once the target passed
  const revealed = await waitUntil('the server to capture the Pass entropy', 150_000, async () => {
    const c = await client.fetchConfig();
    return c?.passRevealed ? c : null;
  }, 1_000);
  const passedAt = await connection.getSlot('confirmed');
  const entropy = Buffer.from(revealed.passEntropy!, 'hex');
  const finalSeed = createHash('sha256').update(seed).update(entropy).digest('hex');
  assert(revealed.passFinalSeed === finalSeed, `final seed ${revealed.passFinalSeed} ≠ sha256(seed || entropy) ${finalSeed}`);
  assert(revealed.passEntropySlot >= target, `entropy slot ${revealed.passEntropySlot} is before the target ${target}`);
  const captureSig = await findCapture(connection, programId, pdas.config(programId), revealed.serverAuthority);
  units.push({ label: 'capture_pass_entropy (sent by the game server)', used: await txUnits(captureSig), limit: CAPTURE_COMPUTE_UNITS });
  ok(`captured by the game server (${captureSig.slice(0, 16)}…) · hash of slot ${revealed.passEntropySlot} · final seed ${finalSeed.slice(0, 16)}… = sha256(seed || entropy) · now slot ${passedAt}`);
  const capture = units[units.length - 1];
  assert(capture.used <= CAPTURE_COMPUTE_UNITS, `capture used ${capture.used} > the web limit ${CAPTURE_COMPUTE_UNITS}`);

  for (const [owner, p] of passes) {
    const json = (await waitUntil(`/pass/${p.number}.json to be revealed`, 40_000, async () => {
      const j = (await fetch(`${httpUrl}/pass/${p.number}.json`).then((r) => r.json())) as { attributes: { trait_type: string; value: unknown }[] };
      return j.attributes.some((a) => a.trait_type === 'Status' && a.value === 'Sealed') ? null : j;
    })) as { attributes: unknown[]; name: string };
    const expected = passJson(p.number, finalSeed, revealed.passSupply);
    assert(j(json.attributes) === j(expected.attributes), `/pass/${p.number}.json attributes ≠ passTraits(finalSeed, ${p.number}, ${revealed.passSupply})`);
    const t = passTraits(finalSeed, p.number, revealed.passSupply);
    ok(`/pass/${p.number}.json (${short(owner)}) revealed: ${t.ink} ink · ${t.symbol} · ${t.eyes}${t.special ? ` · ${t.special}` : ''}`);
  }
  config = revealed;

  /* 7. two-phase settle (R24): a stale refund without a token account is finalized, the player collects */
  const idleKey = idle.publicKey.toBase58();
  const idleName = wallets[2].name;
  const idleAta = ata(idle.publicKey, mint, tokenProgram);
  step(`${idleName}: plain ticket for arena #${plainArenaId}, then closes its (now empty) token account`);
  const { steps, ixs } = await buildTicketTx(client.ix, {
    player: idleKey,
    arenaId: plainArenaId,
    token,
    ataExists: true,
    register: { name: idleName, skin: 1 },
    passAsset: null,
    maxFeeBps: config.feeBps,
    maxEntryFee: plainArena!.entryFee,
    maxSettleFee: config.settleFeeLamports,
  });
  await send(`ticket (${steps.join(' + ')})`, ixs, [idle], TICKET_COMPUTE_UNITS);
  const idleSession = (await client.fetchSession(plainArenaId, idle.publicKey))!;
  assert(idleSession && !idleSession.hasPass && idleSession.feeBps === config.feeBps && !idleSession.finalized, `idle session ${j(idleSession)}`);
  await send('close token account', [closeAccountIx(idleAta, idle.publicKey, idle.publicKey, tokenProgram)], [idle]);
  assert(!(await connection.getAccountInfo(idleAta, 'confirmed')), 'token account still exists');
  ok(`session #${idleSession.id} opened (${fmt(idleSession.entryFee)}), never played · token account closed`);

  step('waiting for the sweeper: the refund settles without the token account (finalized, owed)');
  const finalized = await waitUntil('the session to be finalized', 60_000, async () => {
    const s = await client.fetchSession(plainArenaId, idle.publicKey);
    return s?.finalized ? s : null;
  });
  assert(finalized.id === idleSession.id && finalized.owed === idleSession.entryFee, `finalized ${j(finalized)}`);
  assert(!(await connection.getAccountInfo(idleAta, 'confirmed')), 'the server created the player token account');
  const arenaAfter = (await client.fetchArena(plainArenaId))!;
  assert(arenaAfter.openSessions >= 1, 'a finalized session must keep counting as open (sweep guard)');
  // the journal item goes once the server's send is confirmed (the chain may show the result first)
  await waitUntil('the journal to drop the finalized settlement', 30_000, async () => {
    const r = (await fetch(`${httpUrl}/api/pending?wallet=${idleKey}`).then((x) => x.json())) as { pending: { key: string }[] };
    return r.pending.some((p) => p.key === idleSession.address) ? null : true;
  });
  ok(`finalized: owed ${fmt(finalized.owed)} (the buy-in, no fee) waits in the vault · no server-paid rent · journal clear`);

  step(`${idleName}: collects the payout with the web's transaction (ATA idempotent + refund_session), no 24 h wait`);
  const collect = await buildCloseTx(client.ix, { player: idleKey, arenaId: plainArenaId, token, finalized: true, passAsset: finalized.passAsset });
  await send(`collect (${collect.steps.join(' + ')})`, collect.ixs, [idle], CLOSE_COMPUTE_UNITS);
  assert(!(await client.fetchSession(plainArenaId, idle.publicKey)), 'the session is still open after collecting');
  const refunded = await balance(idle.publicKey);
  assert(refunded === idleSession.entryFee, `collected ${refunded}, expected the owed buy-in ${idleSession.entryFee}`);
  ok(`collected ${fmt(refunded)} (exactly owed) · session closed`);

  /* 8. end the season, the hunter claims */
  const seasonId = config.currentSeason;
  step(`admin ends season ${seasonId}; the hunter claims its prize`);
  await send('end_season', [await client.ix.endSeason(admin.publicKey, seasonId)], [admin]);
  const ended = (await client.fetchSeason(seasonId))!;
  assert(ended.finalized && ended.prizePool > 0n, 'season not finalized with a prize pool');
  const rank = ended.entries.findIndex((e) => e.player === hunter.publicKey.toBase58());
  const prize = prizeAmount(ended.prizePool, rank);
  assert(rank >= 0 && prize > 0n, `the hunter (rank ${rank + 1}) has no prize`);
  const before = await balance(hunter.publicKey);
  const claimIxs = await buildClaimTx(client.ix, { claimer: hunter.publicKey, seasonId, token, ataExists: null });
  await send('claim (ATA idempotent + claim_season_reward)', claimIxs, [hunter], CLAIM_COMPUTE_UNITS);
  const won = (await balance(hunter.publicKey)) - before;
  assert(won === prize, `claimed ${won}, expected ${prize}`);
  ok(`season ${seasonId} prize pool ${fmt(ended.prizePool)} · rank #${rank + 1} claimed ${fmt(won)}`);

  /* 9. report */
  console.log('\nCompute units (consumed / web limit):');
  for (const u of units) console.log(`  ${u.label.padEnd(64)} ${String(u.used).padStart(7)}${u.limit ? ` / ${u.limit} (${Math.round((u.used / u.limit) * 100)} %)` : ''}`);
  console.log('Account sizes (real = quoted by the web):');
  for (const s of sizes) console.log(`  ${s.label.padEnd(64)} ${String(s.real).padStart(7)} = ${s.quoted}`);
  console.log(
    `\n✅ e2e passed in ${elapsed().trim()}: fund → mint Pass ×2 → fresh round → login → Pass tickets → join → fee raise (snapshot kept) → eat → ` +
      `death settle → round-end settle (fee ${fmt(splitSessionPayout(Number(passArena.entryFee) * 2, { entryFee: passArena.entryFee, feeBps: 200 }, config).fee)}, burn in supply) → season entry → ` +
      `close-mint → reveal → server capture → revealed metadata → stale refund finalized without a token account (R24) → collect → end season → claim`,
  );
}

/**
 * Arena rounds are wall-clock aligned on the server clock (`welcome.serverNow`, `room.round`).
 * Waits for the next round to open unless one just started, so the joins and the hunt fit in
 * one round. Returns the round length (ms).
 */
async function waitForFreshRound(): Promise<number> {
  const probe = await GameSocket.connect(wsUrl, 'round probe');
  try {
    probe.send({ t: 'hello', v: PROTOCOL_VERSION });
    const welcome = await probe.wait('welcome', 10_000);
    const round = welcome.rooms.find((r) => r.mode === 'arena' && r.arenaId === passArenaId)?.round;
    assert(round && typeof welcome.serverNow === 'number', `arena #${passArenaId} has no round on this server (an old build?)`);
    // round n runs [n·len, (n+1)·len): the length follows from its end
    const roundMs = round.endsAt / (round.n + 1);
    const into = welcome.serverNow - (round.endsAt - roundMs);
    assert(roundMs <= 120_000, `rounds last ${roundMs / 1000} s: run the game server with ROUND_SECONDS=30 ROUND_JOIN_CLOSE_SECONDS=5`);
    if (into > 1_500) {
      step(`waiting ${((round.endsAt - welcome.serverNow) / 1000).toFixed(1)} s for the next ${roundMs / 1000} s round (joins close ${(round.endsAt - round.joinsCloseAt) / 1000} s before its end)`);
      await sleep(round.endsAt - welcome.serverNow + 300);
    }
    ok(`round of ${roundMs / 1000} s open for joins`);
    return roundMs;
  } finally {
    probe.close();
  }
}

/**
 * The capture transaction is found by its instruction discriminator, not by log text: the
 * deployed (Pinocchio) program does not print Anchor's `Instruction: …` log lines.
 */
async function findCapture(connection: Connection, programId: PublicKey, configPda: PublicKey, server: string): Promise<string> {
  const discriminator = createHash('sha256').update('global:capture_pass_entropy').digest().subarray(0, 8);
  const sigs = await connection.getSignaturesForAddress(configPda, { limit: 25 }, 'confirmed');
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await connection.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    const keys = tx.transaction.message.getAccountKeys();
    const isCapture = tx.transaction.message.compiledInstructions.some(
      (ix) => keys.get(ix.programIdIndex)?.equals(programId) && discriminator.equals(Buffer.from(ix.data).subarray(0, 8)),
    );
    if (!isCapture) continue;
    const payer = keys.get(0)!.toBase58();
    assert(payer === server, `capture_pass_entropy was sent by ${payer}, not the game server ${server}`);
    return s.signature;
  }
  throw new Fail('no capture_pass_entropy transaction found');
}

main().then(
  () => process.exit(0),
  (err) => {
    if (err instanceof Fail) console.error(`\n❌ e2e failed: ${err.message}`);
    else {
      const d = describeError(err);
      console.error(`\n❌ e2e failed: ${d.message}${d.name ? ` [${d.name}]` : ''}`);
      console.error(err);
    }
    if (units.length) console.error(`compute units so far: ${j(units)}`);
    process.exit(1);
  },
);

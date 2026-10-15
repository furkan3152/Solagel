/**
 * End-to-end check of the stake flow against a running localnet and game server:
 *
 *   scripts/localnet.sh                                   # validator + program + config + arenas
 *   cd apps/server && env $(cat ../../.localnet/server.env | xargs) npx tsx src/index.ts
 *   pnpm -F @slana/server e2e [ws://127.0.0.1:8787/ws]
 *
 * A fresh wallet registers a profile, buys into an arena on-chain, logs into the game server
 * (signed message), joins the arena, cashes out and waits for the server's settle_session:
 * session closed, payout received, season leaderboard updated.
 *
 * TODO(Task 17): fund the fresh wallet with game tokens (localnet v2 mint) before join_arena.
 *
 * Env: SOLANA_RPC_URL (default http://127.0.0.1:8899), PROGRAM_ID (default: SDK IDL address),
 *      ARENA_ID (default 1).
 */
import {
  SlanaClient,
  confirmSignature,
  createAtaIdempotentIx,
  describeError,
  explorerTxUrl,
  fetchTokenBalance,
  lamportsToSol,
  splitPayout,
} from '@slana/sdk';
import { PROTOCOL_VERSION, type ServerMessage } from '@slana/shared';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import WebSocket from 'ws';

const wsUrl = process.argv[2] ?? 'ws://127.0.0.1:8787/ws';
const httpUrl = wsUrl.replace(/^ws(s?):/, 'http$1:').replace(/\/ws\/?$/, '');
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const arenaId = Number(process.env.ARENA_ID ?? 1);

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
const step = (msg: string) => console.log(`${elapsed()}  ▸ ${msg}`);
const ok = (msg: string) => console.log(`${elapsed()}  ✓ ${msg}`);
const sol = (lamports: number) => `◎${lamportsToSol(lamports).toFixed(9).replace(/\.?0+$/, '')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Fail extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}

async function waitUntil<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Fail(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(500);
  }
}

/** Minimal JSON WebSocket client: binary snapshots are ignored, server errors fail the wait. */
class GameSocket {
  private readonly msgs: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; reject: (e: Error) => void }[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.msgs.push(msg);
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          this.waiters = this.waiters.filter((x) => x !== w);
          w.resolve(msg);
        } else if (msg.t === 'error') {
          this.waiters = this.waiters.filter((x) => x !== w);
          w.reject(new Fail(`server error ${msg.code}: ${msg.message}`));
        }
      }
    });
    ws.on('close', () => {
      for (const w of this.waiters) w.reject(new Fail('websocket closed'));
      this.waiters = [];
    });
  }

  static connect(url: string): Promise<GameSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const s = new GameSocket(ws);
      ws.once('open', () => resolve(s));
      ws.once('error', (err) => reject(new Fail(`cannot connect to ${url} (${err.message}) — is the game server running?`)));
    });
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  wait<T extends ServerMessage['t']>(
    t: T,
    timeoutMs: number,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const match = (m: ServerMessage) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>);
    const seen = this.msgs.find(match);
    if (seen) return Promise.resolve(seen as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const w = { pred: match, resolve: resolve as (m: ServerMessage) => void, reject };
      this.waiters.push(w);
      setTimeout(() => {
        if (!this.waiters.includes(w)) return;
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Fail(`timed out after ${timeoutMs / 1000} s waiting for '${t}'`));
      }, timeoutMs).unref();
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function main(): Promise<void> {
  console.log(`Slana e2e · rpc ${rpcUrl} · game ${wsUrl} · arena #${arenaId}\n`);
  const connection = new Connection(rpcUrl, 'confirmed');
  const client = new SlanaClient(connection, process.env.PROGRAM_ID || undefined);

  step(`checking program ${client.programId.toBase58()}`);
  assert(await client.isDeployed(), `program is not deployed on ${rpcUrl} — run scripts/localnet.sh`);
  const config = await client.fetchConfig();
  assert(config, 'program is not initialized — run scripts/localnet.sh');
  const arena = await client.fetchArena(arenaId);
  assert(arena && arena.enabled, `arena #${arenaId} does not exist or is disabled`);
  ok(`season ${config.currentSeason} · arena #${arenaId} entry ${arena.entryFee} · pot ${arena.pot} (token base units)`);

  const health = await fetch(`${httpUrl}/api/config`).then((r) => r.json() as Promise<{ chain: { enabled: boolean; arenasEnabled: boolean } }>);
  assert(health.chain.enabled && health.chain.arenasEnabled, `game server at ${httpUrl} has the chain/arenas disabled: ${JSON.stringify(health.chain)}`);

  // 1. fresh funded wallet with a profile
  const player = Keypair.generate();
  const wallet = player.publicKey.toBase58();
  const name = `e2e_${wallet.slice(0, 6)}`;
  step(`new player ${wallet} — airdrop 2 SOL`);
  const { lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  await confirmSignature(connection, await connection.requestAirdrop(player.publicKey, 2 * LAMPORTS_PER_SOL), lastValidBlockHeight);
  ok(`balance ${sol(await connection.getBalance(player.publicKey, 'confirmed'))}`);

  step(`register_player "${name}" (skin 3)`);
  const regSig = await client.sendAndConfirm([await client.ix.registerPlayer(player.publicKey, name, 3)], [player]);
  const profile = await client.fetchProfile(player.publicKey);
  assert(profile && profile.name === name && profile.skin === 3, 'profile was not created as expected');
  ok(`profile ${profile.address} · ${explorerTxUrl(regSig, 'localnet', rpcUrl)}`);

  // 2. buy into the arena on-chain
  step(`join_arena #${arenaId}`);
  const token = { tokenMint: config.tokenMint, tokenProgram: config.tokenProgram };
  const joinSig = await client.sendAndConfirm(
    [createAtaIdempotentIx(player.publicKey, player.publicKey, config.tokenMint, config.tokenProgram), await client.ix.joinArena(player.publicKey, { arenaId, ...token, maxFeeBps: config.feeBps })],
    [player],
  );
  const session = await client.fetchSession(arenaId, player.publicKey);
  assert(session, 'session account was not created');
  const sessionInfo = await connection.getAccountInfo(new PublicKey(session.address), 'confirmed');
  assert(sessionInfo, 'session account missing');
  const sessionRent = sessionInfo.lamports;
  const tokensAfterJoin = await fetchTokenBalance(connection, player.publicKey, config.tokenMint, config.tokenProgram);
  ok(`session ${session.address} #${session.id} · entry ${session.entryFee} · rent ${sol(sessionRent)} · ${explorerTxUrl(joinSig, 'localnet', rpcUrl)}`);

  // 3. sign in to the game server
  step('wallet login (nonce → signed message)');
  const nonce = (await fetch(`${httpUrl}/api/auth/nonce?pubkey=${wallet}`).then((r) => r.json())) as { nonce: string; message: string };
  assert(typeof nonce.message === 'string', `nonce request failed: ${JSON.stringify(nonce)}`);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), player.secretKey));

  const ws = await GameSocket.connect(wsUrl);
  try {
    ws.send({ t: 'hello', v: PROTOCOL_VERSION, lang: 'en' });
    const welcome = await ws.wait('welcome', 10_000);
    assert(welcome.chain.enabled && welcome.chain.arenasEnabled, `welcome says chain=${JSON.stringify(welcome.chain)}`);
    ws.send({ t: 'auth', pubkey: wallet, message: nonce.message, signature });
    const authed = await ws.wait('authed', 15_000);
    assert(authed.pubkey === wallet && authed.profile?.name === name, `unexpected authed message ${JSON.stringify(authed)}`);
    ok(`authed as ${authed.profile?.name} (level ${authed.profile?.level})`);

    // 4. play: join the stake arena, then cash out
    step(`WS join arena:${arenaId}`);
    ws.send({ t: 'join', room: `arena:${arenaId}`, name, skin: 3 });
    const joined = await ws.wait('joined', 15_000);
    assert(joined.value === Number(session.entryFee), `joined with value ${joined.value}, expected the entry fee ${session.entryFee}`);
    ok(`joined ${joined.room.name} as pid ${joined.playerId} with ${joined.value ?? 0}`);

    await sleep(1_500);
    step('cash out');
    ws.send({ t: 'cashout' });
    await ws.wait('cashout', 5_000, (m) => m.state === 'started');
    const done = await ws.wait('cashout', 15_000, (m) => m.state === 'done');
    const payout = done.value ?? 0;
    ok(`cash-out done in game: ${payout}`);

    // 5. the server settles on-chain
    step('waiting for settle_session');
    const settled = await ws.wait('settled', 90_000);
    ok(`server reported '${settled.kind}' · ${explorerTxUrl(settled.signature, 'localnet', rpcUrl)}`);
    await waitUntil('the session account to close', 60_000, async () => {
      const s = await client.fetchSession(arenaId, player.publicKey);
      return !s || s.id !== session.id;
    });
    ok('session account closed');

    const split = splitPayout(payout, session.entryFee, session.hasPass, config);
    const tokensAfter = await waitUntil('the payout', 30_000, async () => {
      const b = await fetchTokenBalance(connection, player.publicKey, config.tokenMint, config.tokenProgram);
      return b - tokensAfterJoin >= split.player ? b : null;
    });
    const delta = tokensAfter - tokensAfterJoin;
    assert(delta === split.player, `token balance +${delta} ≠ ${split.player}`);
    ok(`tokens +${delta} (payout ${payout} − fee ${split.fee})`);

    const after = await client.fetchProfile(player.publicKey);
    assert(after && after.stakeGames === 1 && after.gamesPlayed === 1, `profile stats not updated: ${JSON.stringify(after)}`);
    assert(after.totalWon === split.player, `profile.totalWon ${after.totalWon} ≠ ${split.player}`);
    const season = await client.fetchSeason(config.currentSeason);
    const rank = season?.entries.findIndex((e) => e.player === wallet) ?? -1;
    assert(season && rank >= 0, `player missing from the season ${config.currentSeason} leaderboard`);
    const entry = season.entries[rank];
    ok(`season ${season.id} leaderboard: #${rank + 1} ${entry.name} · ${entry.points} pts · best ${entry.bestScore} · pool ${season.pool}`);

    console.log(
      `\n✅ e2e passed in ${elapsed().trim()}: register → join_arena → login → join → cash-out → settle_session ` +
        `(session #${session.id}, +${delta} tokens, xp ${after.xp}, level ${after.level}, season rank #${rank + 1})`,
    );
  } finally {
    ws.close();
  }
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
    process.exit(1);
  },
);

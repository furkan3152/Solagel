#!/usr/bin/env node
// One-command Slana demo.
//   pnpm demo            fake chain: server (NODE_ENV=development DEV_FAKE_CHAIN=1) + web dev server
//   pnpm demo:localnet   real local validator + slana_lean.so + production-built server + web dev server
// Flags: --browser  also open a Chromium with the Dev Wallet (a local keypair; needs a display)
//        --no-build (localnet) skip building missing pieces and fail instead
// Ctrl+C (SIGINT), SIGTERM and SIGHUP stop every child process group, and in localnet mode the validator.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, hasCommand, portFree, waitForHttp, withSolanaPath } from './lib/common.mjs';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--localnet', '--browser', '--no-build', '--help', '-h']);
const bad = argv.find((a) => !KNOWN.has(a));
if (bad || argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node scripts/demo.mjs [--localnet] [--browser] [--no-build]');
  process.exit(bad ? 2 : 0);
}
const LOCALNET = argv.includes('--localnet');
const OPEN_BROWSER = argv.includes('--browser');
const NO_BUILD = argv.includes('--no-build');

const SERVER_PORT = 8787;
const WEB_PORT = 5173;
const RPC_PORT = 8899;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const ENV = LOCALNET ? withSolanaPath() : { ...process.env };

const color = (n, s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const say = (s) => console.log(`${color('1;35', '>')} ${s}`);
const fail = (s, hint) => {
  console.error(`${color('1;31', 'x')} ${s}`);
  if (hint) console.error(`  ${hint.replace(/\n/g, '\n  ')}`);
  process.exit(1);
};

// ───────────────────────────── preflight ─────────────────────────────
async function preflight() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) fail(`Node ${process.versions.node} is too old; Slana needs Node 22 or newer.`, 'Install it from https://nodejs.org or with nvm: nvm install 22');
  const pv = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (pv.error || pv.status !== 0) fail('pnpm was not found.', 'Install it with: corepack enable   (or npm i -g pnpm@10)');
  const pnpmMajor = Number(pv.stdout.trim().split('.')[0]);
  if (pnpmMajor < 10) fail(`pnpm ${pv.stdout.trim()} is too old; Slana needs pnpm 10.`, 'Run: corepack enable   (the repo pins pnpm@10 in package.json)');
  const installed = ['apps/server/node_modules/tsx', 'apps/web/node_modules/vite', 'apps/web/node_modules/playwright'].every((p) => existsSync(join(ROOT, p)));
  if (!installed) fail('Dependencies are not installed.', 'Run: pnpm install');
  const ports = [[SERVER_PORT, 'game server'], [WEB_PORT, 'web app'], ...(LOCALNET ? [[RPC_PORT, 'validator RPC'], [RPC_PORT + 1, 'validator websocket']] : [])];
  for (const [port, what] of ports) {
    if (!(await portFree(port))) {
      fail(`Port ${port} (${what}) is already in use.`, `Stop whatever uses it (find it with: lsof -i :${port}) and try again.` + (LOCALNET && port >= RPC_PORT ? '\nA validator from an earlier run: scripts/localnet.sh --stop' : ''));
    }
  }
  if (LOCALNET) {
    const missing = ['solana-test-validator', 'solana', 'solana-keygen', 'spl-token', 'curl'].filter((t) => !hasCommand(t, ENV));
    if (missing.length) fail(`Missing tools for the local validator: ${missing.join(', ')}.`, 'Install the Agave CLI: https://docs.anza.xyz/cli/install  (spl-token: cargo install spl-token-cli)');
  }
}

// ───────────────────────────── process control ─────────────────────────────
const children = new Set(); // detached process groups that keep running (server, web, browser)
let step = null; // the foreground build / setup step
let shuttingDown = false;

function pipeLines(stream, tag, out) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      if (!shuttingDown) out.write(`${tag} ${buf.slice(0, i)}\n`);
      buf = buf.slice(i + 1);
    }
  });
  stream.on('end', () => buf && out.write(`${tag} ${buf}\n`));
}

function start(name, cmd, args, { cwd = ROOT, env = ENV, tagColor = '36', essential = true } = {}) {
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = color(tagColor, `[${name}]`.padEnd(9));
  pipeLines(child.stdout, tag, process.stdout);
  pipeLines(child.stderr, tag, process.stderr);
  const rec = { name, child, exited: false };
  children.add(rec);
  child.on('error', (e) => {
    rec.exited = true;
    if (!shuttingDown) {
      console.error(`${color('1;31', 'x')} could not start ${name}: ${e.message}`);
      void shutdown(1);
    }
  });
  child.on('exit', (code, sig) => {
    rec.exited = true;
    if (!essential) {
      console.log(`${tag} closed (${sig ?? `exit ${code}`}); the stack keeps running.`);
    } else if (!shuttingDown) {
      console.error(`${color('1;31', 'x')} ${name} stopped unexpectedly (${sig ?? `exit ${code}`}). See the log above.`);
      void shutdown(1);
    }
  });
  return rec;
}

/** Runs a foreground step to completion; resolves with its exit code. */
function runStep(label, cmd, args, { cwd = ROOT, env = ENV } = {}) {
  say(label);
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
    step = c;
    c.on('error', (e) => {
      console.error(e.message);
      step = null;
      resolve(127);
    });
    c.on('exit', (code, sig) => {
      step = null;
      resolve(code ?? (sig ? 130 : 1));
    });
  });
}

const killGroup = (rec, sig) => {
  if (rec.exited || !rec.child.pid) return;
  try {
    process.kill(-rec.child.pid, sig); // the whole group: pnpm -> tsx/vite -> node
  } catch {
    /* already gone */
  }
};

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${color('1;35', '>')} stopping...`);
  if (step) step.kill('SIGTERM');
  for (const rec of children) killGroup(rec, 'SIGTERM');
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && [...children].some((r) => !r.exited)) await new Promise((r) => setTimeout(r, 100));
  for (const rec of children) killGroup(rec, 'SIGKILL');
  if (LOCALNET) spawnSync(join(ROOT, 'scripts/localnet.sh'), ['--stop'], { env: ENV, stdio: 'inherit' });
  console.log(`${color('1;35', '>')} stopped.`);
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => void shutdown(sig === 'SIGINT' ? 130 : 143));

// ───────────────────────────── modes ─────────────────────────────
function parseEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function buildMissing() {
  const lean = join(ROOT, 'target/deploy/slana_lean.so');
  const core = join(ROOT, 'target/programs/mpl_core.so');
  const need = (what, hint) => fail(`${what} is missing and --no-build was given.`, hint);
  if (!existsSync(lean)) {
    if (NO_BUILD) need('target/deploy/slana_lean.so', 'Run: scripts/build-lean.sh');
    if (!hasCommand('cargo-build-sbf', ENV)) fail('target/deploy/slana_lean.so is missing and cargo-build-sbf is not installed.', 'Install the Agave/Solana build tools, then run: scripts/build-lean.sh');
    if ((await runStep('building the Slana program (scripts/build-lean.sh, a few minutes the first time)', join(ROOT, 'scripts/build-lean.sh'), [])) !== 0) fail('The program build failed.', 'Fix the error above, or run scripts/build-lean.sh yourself.');
  }
  if (!existsSync(core)) {
    if (NO_BUILD) need('target/programs/mpl_core.so (Metaplex Core)', 'Run: scripts/fetch-programs.sh   (or copy mpl_core.so there)');
    if ((await runStep('downloading Metaplex Core (scripts/fetch-programs.sh, needs network access to a Solana mainnet RPC)', join(ROOT, 'scripts/fetch-programs.sh'), [])) !== 0) {
      fail('Could not download Metaplex Core.', `The fetch needs a reachable mainnet RPC. Use another one:  MAINNET_RPC=<url> pnpm demo:localnet\nor copy a dumped mpl_core.so to ${core}\n(dump it elsewhere with: solana program dump -u mainnet-beta CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d mpl_core.so)`);
    }
  }
  if ((await runStep('building the game server (tsup)', 'pnpm', ['-F', '@slana/server', 'build'])) !== 0) fail('The server build failed.', 'Run: pnpm -F @slana/server build');
}

async function main() {
  await preflight();
  let serverCwd = join(ROOT, 'apps/server');
  let walletKeypair = join(ROOT, 'out/dev-wallet.json');
  let serverEnv;
  let serverCmd;

  if (!LOCALNET) {
    // Exactly the walkthrough setup: in-memory fake chain, fresh journal each run.
    const data = join(ROOT, 'out/demo-data');
    rmSync(data, { recursive: true, force: true });
    mkdirSync(data, { recursive: true });
    serverEnv = { ...ENV, NODE_ENV: 'development', DEV_FAKE_CHAIN: '1', DATA_DIR: data };
    delete serverEnv.PROGRAM_ID; // the fake chain refuses to start next to a real chain config
    delete serverEnv.SERVER_KEYPAIR;
    serverCmd = ['pnpm', ['-F', '@slana/server', 'dev']];
  } else {
    await buildMissing();
    walletKeypair = join(ROOT, '.localnet/dev-wallet.json');
    // The browser talks to the web dev server (it proxies /api and /ws), so SIWS and the Pass links name it.
    const rc = await runStep('starting the validator and setting up the chain (scripts/localnet.sh)', join(ROOT, 'scripts/localnet.sh'), [], { env: { ...ENV, GAME_URL: WEB_URL } });
    if (rc !== 0) {
      spawnSync(join(ROOT, 'scripts/localnet.sh'), ['--stop'], { env: ENV, stdio: 'ignore' });
      fail('scripts/localnet.sh failed.', 'See the output above and .localnet/validator.stdout.log. Common causes: a stale ledger (scripts/localnet.sh --stop) or a missing build.');
    }
    if (shuttingDown) return;
    const file = parseEnvFile(join(ROOT, '.localnet/server.env'));
    serverEnv = { ...ENV, ...file, PUBLIC_URL: WEB_URL, DATA_DIR: join(ROOT, '.localnet/server-data'), STALE_SESSION_AFTER_S: '60' };
    delete serverEnv.DEV_FAKE_CHAIN;
    serverCmd = ['node', ['dist/index.js']];
  }
  if (shuttingDown) return;

  say(LOCALNET ? 'starting the game server (production build) and the web app' : 'starting the game server (fake chain) and the web app');
  start('server', serverCmd[0], serverCmd[1], { cwd: serverCwd, env: serverEnv, tagColor: '36' });
  start('web', 'pnpm', ['-F', '@slana/web', 'dev'], { env: { ...ENV, GAME_SERVER: `http://127.0.0.1:${SERVER_PORT}` }, tagColor: '33' });

  const alive = () => shuttingDown;
  const okServer = await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/health`, 90_000, alive);
  const okWeb = await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 90_000, alive);
  if (shuttingDown) return;
  if (!okServer || !okWeb) {
    console.error(`${color('1;31', 'x')} ${!okServer ? 'the game server' : 'the web app'} did not come up within 90 s. See its log above.`);
    return void (await shutdown(1));
  }

  console.log('');
  console.log(color('1;32', `  Slana is running:  ${WEB_URL}`));
  console.log(`  game server:       http://127.0.0.1:${SERVER_PORT}/api/health`);
  if (LOCALNET) {
    console.log(`  validator RPC:     http://127.0.0.1:${RPC_PORT}   (server env: .localnet/server.env)`);
    console.log('  wallet:            Phantom on localhost (Settings > Developer Settings > Testnet Mode > Solana Localnet),');
    console.log('                     or `pnpm demo:localnet --browser` for a local-keypair Dev Wallet. Fund an address with:');
    console.log('                       scripts/localnet-fund.sh <WALLET_ADDRESS>');
  } else {
    console.log('  wallet:            any Wallet Standard wallet signs in (no funds needed), or run with --browser for a Dev Wallet.');
    console.log('  Pass mint:         open and unrevealed. Reveal it with:  curl -X POST localhost:8787/api/dev/pass/reveal');
  }
  console.log('  stop:              Ctrl+C');
  console.log('');

  if (OPEN_BROWSER) {
    if (LOCALNET) {
      const kp = spawnSync('node', ['-e', `import('./scripts/lib/dev-wallet.mjs').then(m=>console.log(m.addressOf(m.loadOrCreateKeypair(${JSON.stringify(walletKeypair)}))))`], { cwd: ROOT, encoding: 'utf8' });
      const addr = kp.stdout.trim();
      if (addr) {
        say(`funding the Dev Wallet ${addr} (SOL + $SLANA)`);
        await runStep('funding', join(ROOT, 'scripts/localnet-fund.sh'), [addr]);
      }
    }
    start('browser', 'node', [join(ROOT, 'scripts/dev-browser.mjs'), WEB_URL, '--keypair', walletKeypair], { tagColor: '35', essential: false });
  }
}

main().catch((e) => {
  console.error(e);
  void shutdown(1);
});

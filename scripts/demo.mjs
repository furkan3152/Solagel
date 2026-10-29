#!/usr/bin/env node
// One-command Elymum demo.
//   pnpm demo            fake chain: server (NODE_ENV=development DEV_FAKE_CHAIN=1 DEV_FAKE_TOKEN=1) + web dev server
//                        (DEV_FAKE_TOKEN=0 pnpm demo: the game token starts unset, arenas "Opening soon";
//                        `curl -X POST localhost:8787/api/dev/token` sets it live)
//   pnpm demo:localnet   a real local EVM: `hardhat node` + the contracts deployed with the SDK (TestToken,
//                        ElymumArena, ElymumNFT, token set, four arenas, mint open) + the production-built
//                        server on that chain (EVM_RPC_URL, SERVER_PRIVATE_KEY, ARENA_ADDRESS, NFT_ADDRESS,
//                        ADMIN_WALLETS) + the web dev server
// Flags: --browser  also open a Chromium with the Dev Wallet (an EIP-6963 wallet whose key stays in Node;
//                   on localnet it is Hardhat account #0, the contract owner and admin; needs a display)
//        --no-build (localnet) do not build the server first and fail if it is missing
// Rounds: paid arenas play wall-clock rounds (5 minutes by default, no cash-out). To see the bell sooner, set
//        ROUND_SECONDS (e.g. `ROUND_SECONDS=90 pnpm demo`); joins close ROUND_JOIN_CLOSE_SECONDS before it (default
//        60, capped at half a round). The server reads both.
// Ctrl+C (SIGINT), SIGTERM and SIGHUP stop every child process group, including the hardhat node.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALNET_RPC_PORT, ROOT, portFree, waitForHttp } from './lib/common.mjs';
import { ACCOUNT, STATE_DIR, deployLocalnet, startHardhatNode } from './lib/localnet.mjs';

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
const RPC_PORT = LOCALNET_RPC_PORT;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const ENV = { ...process.env };

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
  if (major < 22) fail(`Node ${process.versions.node} is too old; Elymum needs Node 22 or newer.`, 'Install it from https://nodejs.org or with nvm: nvm install 22');
  const pv = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (pv.error || pv.status !== 0) fail('pnpm was not found.', 'Install it with: corepack enable   (or npm i -g pnpm@10)');
  const pnpmMajor = Number(pv.stdout.trim().split('.')[0]);
  if (pnpmMajor < 10) fail(`pnpm ${pv.stdout.trim()} is too old; Elymum needs pnpm 10.`, 'Run: corepack enable   (the repo pins pnpm@10 in package.json)');
  const installed = ['apps/server/node_modules/tsx', 'apps/web/node_modules/vite', 'apps/web/node_modules/playwright'].every((p) => existsSync(join(ROOT, p)));
  if (!installed) fail('Dependencies are not installed.', 'Run: pnpm install');
  const ports = [[SERVER_PORT, 'game server'], [WEB_PORT, 'web app'], ...(LOCALNET ? [[RPC_PORT, 'hardhat node RPC']] : [])];
  for (const [port, what] of ports) {
    if (!(await portFree(port))) {
      fail(`Port ${port} (${what}) is already in use.`, `Stop whatever uses it (find it with: lsof -i :${port}) and try again.` + (LOCALNET && port === RPC_PORT ? '\nA hardhat node from an earlier run (scripts/localnet.mjs) may still be up.' : ''));
    }
  }
  if (LOCALNET && !existsSync(join(ROOT, 'packages/contracts/node_modules/.bin/hardhat'))) fail('Hardhat is not installed.', 'Run: pnpm install');
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
  console.log(`${color('1;35', '>')} stopped.`);
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => void shutdown(sig === 'SIGINT' ? 130 : 143));

// ───────────────────────────── modes ─────────────────────────────
async function buildServer() {
  if (NO_BUILD) {
    if (!existsSync(join(ROOT, 'apps/server/dist/index.js'))) fail('apps/server/dist/index.js is missing and --no-build was given.', 'Run: pnpm -F @elymum/server build');
    return;
  }
  if ((await runStep('building the game server (tsup)', 'pnpm', ['-F', '@elymum/server', 'build'])) !== 0) fail('The server build failed.', 'Run: pnpm -F @elymum/server build');
}

async function main() {
  await preflight();
  let serverCwd = join(ROOT, 'apps/server');
  let serverEnv;
  let serverCmd;
  let localnet = null;

  if (!LOCALNET) {
    // Exactly the walkthrough setup: in-memory fake chain, fresh journal each run.
    const data = join(ROOT, 'out/demo-data');
    rmSync(data, { recursive: true, force: true });
    mkdirSync(data, { recursive: true });
    // DEV_FAKE_TOKEN=1: the game token starts set, so the arenas are playable at once.
    // `DEV_FAKE_TOKEN=0 pnpm demo` starts with it unset ("Opening soon"; set it with POST /api/dev/token).
    serverEnv = { ...ENV, NODE_ENV: 'development', DEV_FAKE_CHAIN: '1', DEV_FAKE_TOKEN: ENV.DEV_FAKE_TOKEN === '0' ? '0' : '1', DATA_DIR: data };
    // the fake chain refuses to start next to a real chain config
    for (const k of ['EVM_RPC_URL', 'SERVER_PRIVATE_KEY', 'ARENA_ADDRESS', 'NFT_ADDRESS']) delete serverEnv[k];
    // anyone who signs in may play the demo
    serverEnv.GAME_ACCESS ??= 'public';
    serverCmd = ['pnpm', ['-F', '@elymum/server', 'dev']];
  } else {
    await buildServer();
    say(`starting hardhat node on 127.0.0.1:${RPC_PORT}`);
    let node;
    try {
      node = await startHardhatNode({ port: RPC_PORT });
    } catch (e) {
      fail(`hardhat node did not start: ${e.message}`, 'Try it by hand: pnpm -F @elymum/contracts exec hardhat node');
    }
    const rec = { child: node, exited: false };
    node.on('exit', () => {
      rec.exited = true;
      if (!shuttingDown) {
        console.error(`${color('1;31', 'x')} the hardhat node stopped unexpectedly.`);
        void shutdown(1);
      }
    });
    children.add(rec);
    if (shuttingDown) return;
    say('deploying TestToken, ElymumArena and ElymumNFT with the SDK (the /admin deploy order)');
    let deployed;
    try {
      // the browser talks to the web dev server (it proxies /api and /ws), so SIWE names it
      deployed = await deployLocalnet({ rpcUrl: `http://127.0.0.1:${RPC_PORT}`, publicUrl: WEB_URL, openMint: true, log: (l) => say(l) });
    } catch (e) {
      fail(`the local deploy failed: ${e.shortMessage ?? e.message}`);
    }
    const data = join(STATE_DIR, 'server-data');
    rmSync(data, { recursive: true, force: true });
    mkdirSync(data, { recursive: true });
    serverEnv = { ...ENV, ...deployed.env, NODE_ENV: 'production', DATA_DIR: data, STALE_SESSION_AFTER_S: '60' };
    serverEnv.GAME_ACCESS ??= 'public';
    delete serverEnv.DEV_FAKE_CHAIN;
    delete serverEnv.DEV_FAKE_TOKEN;
    serverCmd = ['node', ['dist/index.js']];
    localnet = deployed;
  }
  if (shuttingDown) return;

  say(LOCALNET ? 'starting the game server (production build) and the web app' : 'starting the game server (fake chain) and the web app');
  start('server', serverCmd[0], serverCmd[1], { cwd: serverCwd, env: serverEnv, tagColor: '36' });
  start('web', 'pnpm', ['-F', '@elymum/web', 'dev'], { env: { ...ENV, GAME_SERVER: `http://127.0.0.1:${SERVER_PORT}` }, tagColor: '33' });

  const alive = () => shuttingDown;
  const okServer = await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/health`, 90_000, alive);
  const okWeb = await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 90_000, alive);
  if (shuttingDown) return;
  if (!okServer || !okWeb) {
    console.error(`${color('1;31', 'x')} ${!okServer ? 'the game server' : 'the web app'} did not come up within 90 s. See its log above.`);
    return void (await shutdown(1));
  }

  console.log('');
  console.log(color('1;32', `  Elymum is running: ${WEB_URL}`));
  console.log(`  game server:       http://127.0.0.1:${SERVER_PORT}/api/health`);
  if (localnet) {
    console.log(`  hardhat node:      http://127.0.0.1:${RPC_PORT}   (chain id ${localnet.chainId}; addresses in .localnet/contracts.json)`);
    console.log(`  arena / NFT:       ${localnet.arena} / ${localnet.nft}`);
    console.log(`  owner + admin:     ${localnet.owner} (Hardhat account #0; import its key into a wallet for /admin)`);
    console.log('  wallet:            any EVM wallet on "Localnet" (RPC http://127.0.0.1:8545, chain id 31337),');
    console.log('                     or `pnpm demo:localnet --browser` for the Dev Wallet. Fund an address with:');
    console.log('                       node scripts/localnet-fund.mjs <0x-address>');
  } else {
    console.log('  wallet:            any EVM wallet signs in (SIWE, no funds needed), or run with --browser for the Dev Wallet.');
  }
  const rs = Number(ENV.ROUND_SECONDS) || 300;
  console.log(`  arena rounds:      ${rs} s each, no cash-out (set ROUND_SECONDS=90 for a quicker bell)`);
  console.log('  stop:              Ctrl+C');
  console.log('');

  if (OPEN_BROWSER) {
    const args = [join(ROOT, 'scripts/dev-browser.mjs'), WEB_URL];
    if (localnet) args.push('--account', String(ACCOUNT.owner), '--rpc', `http://127.0.0.1:${RPC_PORT}`);
    start('browser', 'node', args, { tagColor: '35', essential: false });
  }
}

main().catch((e) => {
  console.error(e);
  void shutdown(1);
});

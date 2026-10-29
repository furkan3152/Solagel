#!/usr/bin/env node
// Local chain for Elymum: starts `hardhat node` (chain id 31337, HYPE as the gas token), deploys the
// TestToken, ElymumArena and ElymumNFT with the SDK (the /admin → Deploy order), sets the token, creates
// the four default arenas, and writes the game server's env to .localnet/server.env (addresses also in
// .localnet/contracts.json). It keeps the node running until Ctrl+C.
//
//   node scripts/localnet.mjs                 start the node, deploy, keep running
//   node scripts/localnet.mjs --no-token      deploy but leave the token unset (like a fresh deploy)
//   node scripts/localnet.mjs --open-mint     also open the NFT mint to the public
//   node scripts/localnet.mjs --deploy-only   deploy to a node that is already running (RPC_URL), then exit
//
// Env: RPC_PORT (default 8545), RPC_URL (with --deploy-only), PUBLIC_URL (default http://localhost:5173).
// Then run the server with that env, e.g.
//   cd apps/server && env $(cat ../../.localnet/server.env | xargs) NODE_ENV=production DATA_DIR=../../.localnet/server-data npx tsx src/index.ts
// or simply use `pnpm demo:localnet`, which does all of it. Fund a wallet: node scripts/localnet-fund.mjs <0x...>
import { LOCALNET_RPC_PORT } from './lib/common.mjs';
import { SERVER_ENV_FILE, deployLocalnet, rpcUrlFor, startHardhatNode } from './lib/localnet.mjs';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--no-token', '--open-mint', '--deploy-only', '--help', '-h']);
const bad = argv.find((a) => !KNOWN.has(a));
if (bad || argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node scripts/localnet.mjs [--no-token] [--open-mint] [--deploy-only]');
  process.exit(bad ? 2 : 0);
}
const port = Number(process.env.RPC_PORT) || LOCALNET_RPC_PORT;
const say = (s) => console.log(`> ${s}`);

let node = null;
const stop = (code) => {
  if (node?.pid) {
    try {
      process.kill(-node.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
  process.exit(code);
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(0));

try {
  let rpcUrl = process.env.RPC_URL ?? rpcUrlFor(port);
  if (!argv.includes('--deploy-only')) {
    say(`starting hardhat node on ${rpcUrlFor(port)}`);
    node = await startHardhatNode({ port });
    rpcUrl = rpcUrlFor(port);
  }
  const out = await deployLocalnet({
    rpcUrl,
    publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
    noToken: argv.includes('--no-token'),
    openMint: argv.includes('--open-mint'),
    log: say,
  });
  console.log('');
  say(`local chain ready (chain id ${out.chainId})`);
  console.log(`  TestToken     ${out.token}`);
  console.log(`  ElymumArena   ${out.arena}`);
  console.log(`  ElymumNFT     ${out.nft}`);
  console.log(`  owner/admin   ${out.owner}   (Hardhat account #0)`);
  console.log(`  server key    ${out.server}   (Hardhat account #1)`);
  console.log(`\nGame server env (${SERVER_ENV_FILE}):\n`);
  for (const [k, v] of Object.entries(out.env)) console.log(`  ${k}=${k === 'SERVER_PRIVATE_KEY' ? `${v.slice(0, 10)}... (Hardhat #1, local only)` : v}`);
  console.log('');
  if (!node) process.exit(0);
  say('the node keeps running; Ctrl+C stops it');
  await new Promise((r) => node.on('exit', r));
  stop(1);
} catch (e) {
  console.error(`x ${e.message ?? e}`);
  stop(1);
}

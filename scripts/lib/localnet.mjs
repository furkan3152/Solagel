// A local Elysium stand-in: `hardhat node` (chain id 31337, gas token shown as HYPE) with the Elymum
// contracts deployed in the same order as /admin → Deploy, through the SDK:
//   TestToken → ElymumArena (server authority = the game server's key) → ElymumNFT
//   → setToken → the four default arenas (→ optionally the mint opened to the public).
// Shared by scripts/localnet.mjs, scripts/localnet-fund.mjs and scripts/demo.mjs.
//
// Accounts are Hardhat's well-known dev accounts (public keys, local only, 10,000 HYPE each):
//   #0 owner / admin (contract owner, fee wallet, NFT treasury; in ADMIN_WALLETS)
//   #1 game server key (SERVER_PRIVATE_KEY, the arena's server authority)
//   #2 the Dev Wallet player of `--browser`
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALNET_RPC_PORT, ROOT, hardhatAccount, hardhatKey, importSdk, rpcUp, viem } from './common.mjs';

export const STATE_DIR = join(ROOT, '.localnet');
export const ADDRESSES_FILE = join(STATE_DIR, 'contracts.json');
export const SERVER_ENV_FILE = join(STATE_DIR, 'server.env');
export const ACCOUNT = { owner: 0, server: 1, player: 2 };

export const rpcUrlFor = (port = LOCALNET_RPC_PORT) => `http://127.0.0.1:${port}`;

/**
 * Starts `pnpm -F @elymum/contracts exec hardhat node` in its own process group and waits for the RPC.
 * Returns the child (kill it with `process.kill(-child.pid)`).
 */
export async function startHardhatNode({ port = LOCALNET_RPC_PORT, onLine = null, timeoutMs = 90_000 } = {}) {
  const url = rpcUrlFor(port);
  if (await rpcUp(url)) throw new Error(`something already answers JSON-RPC on ${url}; stop it first (lsof -i :${port})`);
  mkdirSync(STATE_DIR, { recursive: true });
  const child = spawn('pnpm', ['-F', '@elymum/contracts', 'exec', 'hardhat', 'node', '--port', String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const s of [child.stdout, child.stderr]) {
    s.setEncoding('utf8');
    s.on('data', (d) => onLine && d.split('\n').filter(Boolean).forEach(onLine));
  }
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`hardhat node exited (code ${child.exitCode})`);
    if (await rpcUp(url)) return child;
    await new Promise((r) => setTimeout(r, 300));
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
  throw new Error(`hardhat node did not answer on ${url} within ${timeoutMs / 1000} s`);
}

function clients(sdk, rpcUrl, chainId, key) {
  const { privateKeyToAccount } = viem('/accounts');
  const chain = sdk.elysiumChain(chainId);
  const account = privateKeyToAccount(key);
  return {
    account,
    publicClient: sdk.createElymumPublicClient(rpcUrl, chain, { pollingInterval: 200 }),
    wallet: sdk.createElymumWalletClient(rpcUrl, { account, chain, pollingInterval: 200 }),
  };
}

/**
 * Deploys TestToken + ElymumArena + ElymumNFT from the owner account and (unless `noToken`) sets the
 * token and creates the default arenas. Writes `.localnet/contracts.json` and `.localnet/server.env`.
 * Returns `{ token, arena, nft, owner, server, chainId, rpcUrl, env }`.
 */
export async function deployLocalnet({ rpcUrl = rpcUrlFor(), publicUrl = 'http://localhost:5173', noToken = false, openMint = false, log = console.log } = {}) {
  const sdk = await importSdk();
  const probe = sdk.createElymumPublicClient(rpcUrl);
  const chainId = await probe.getChainId();
  const ownerKey = hardhatKey(ACCOUNT.owner);
  const serverKey = hardhatKey(ACCOUNT.server);
  const { account: owner, publicClient, wallet } = clients(sdk, rpcUrl, chainId, ownerKey);
  const server = hardhatAccount(ACCOUNT.server).address;

  const send = async (call, what) => {
    const hash = await sdk.sendCall(wallet, call);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`${what} reverted (${hash})`);
  };

  log(`deploying TestToken (owner ${owner.address})`);
  const token = await sdk.deployedAddress(publicClient, await sdk.deployTestToken(wallet, { owner: owner.address }));
  log(`deploying ElymumArena (server authority ${server}, fee wallet = owner)`);
  const arena = await sdk.deployedAddress(publicClient, await sdk.deployArena(wallet, { admin: owner.address, serverAuthority: server, feeWallet: owner.address }));
  log('deploying ElymumNFT (supply 5,000, 0.02 HYPE, WL 2 / public 5 per wallet)');
  const nft = await sdk.deployedAddress(
    publicClient,
    await sdk.deployNft(wallet, {
      owner: owner.address,
      maxSupply: 5000,
      mintPrice: 2n * 10n ** 16n,
      wlLimit: 2,
      publicLimit: 5,
      baseURI: `${publicUrl.replace(/\/$/, '')}/api/nft/`,
      treasury: owner.address,
    }),
  );
  // the owner gets test tokens to hand out (localnet-fund.mjs)
  await send(sdk.testTokenMintCall(token, owner.address, 100_000_000n * 10n ** 18n), 'TestToken.mint');
  if (!noToken) {
    log('setToken + the four default arenas');
    await send(sdk.setTokenCall(arena, token), 'setToken');
    for (const call of sdk.createDefaultArenaCalls(arena, 18)) await send(call, `createArena(${call.args[0]})`);
  } else {
    log('--no-token: the token is NOT set on the arena (set it from /admin → Arena, like a fresh deploy)');
  }
  if (openMint) {
    log('opening the mint to the public');
    await send(sdk.setPhaseCall(nft, 'public'), 'setPhase');
  }

  const env = {
    EVM_RPC_URL: rpcUrl,
    PUBLIC_RPC_URL: rpcUrl,
    SERVER_PRIVATE_KEY: serverKey,
    ARENA_ADDRESS: arena,
    NFT_ADDRESS: nft,
    ADMIN_WALLETS: owner.address,
    PUBLIC_URL: publicUrl,
  };
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(ADDRESSES_FILE, `${JSON.stringify({ chainId, rpcUrl, token, arena, nft, owner: owner.address, server }, null, 2)}\n`);
  writeFileSync(SERVER_ENV_FILE, `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  return { token, arena, nft, owner: owner.address, server, chainId, rpcUrl, env };
}

/** The addresses written by the last `deployLocalnet`. */
export function readAddresses() {
  try {
    return JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  } catch {
    throw new Error(`${ADDRESSES_FILE} is missing: start the local chain first (node scripts/localnet.mjs or pnpm demo:localnet)`);
  }
}

/** Sends `hype` HYPE and `tokens` test tokens from the owner to `to`. */
export async function fundAddress(to, { hype = 10, tokens = 100_000, log = console.log } = {}) {
  const { token, rpcUrl } = readAddresses();
  const sdk = await importSdk();
  const { parseEther, getAddress } = viem();
  const probe = sdk.createElymumPublicClient(rpcUrl);
  const chainId = await probe.getChainId();
  const { publicClient, wallet } = clients(sdk, rpcUrl, chainId, hardhatKey(ACCOUNT.owner));
  const addr = getAddress(to);
  if (hype > 0) {
    const hash = await wallet.sendTransaction({ to: addr, value: parseEther(String(hype)) });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`sent ${hype} HYPE to ${addr}`);
  }
  if (tokens > 0) {
    const hash = await sdk.sendCall(wallet, sdk.testTokenMintCall(token, addr, BigInt(tokens) * 10n ** 18n));
    await publicClient.waitForTransactionReceipt({ hash });
    log(`minted ${tokens.toLocaleString('en-US')} test tokens (${token}) to ${addr}`);
  }
  const bal = await publicClient.getBalance({ address: addr });
  const tbal = await sdk.getTokenBalance(publicClient, token, addr);
  log(`balance of ${addr}: ${viem().formatEther(bal)} HYPE, ${sdk.formatTokenAmount(tbal, 18)} test tokens`);
}

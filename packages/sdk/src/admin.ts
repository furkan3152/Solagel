/**
 * Elymum admin CLI (Node only, not exported from the SDK entry point).
 *
 *   pnpm -F @elymum/sdk admin <command> [options]      (or `pnpm admin <command>` at the repo root)
 *
 * Run `pnpm admin help` for the command list. Parsing, the key loader and the status report live
 * in `admin-lib.ts`; validation and refusals in `ops.ts` (shared with the web admin panel). This
 * file does the RPC and the I/O. Safety rails: every transaction is previewed and simulated
 * before it is sent, `--dry-run` stops after the preview, Elysium mainnet needs `--mainnet` and a
 * typed confirmation, and `set-token` takes the address twice.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { explorerAddressUrl, explorerTxUrl } from '@elymum/shared';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Address, Chain, Hash, PublicClient, WalletClient } from 'viem';
import {
  arenaSessionsBounds,
  big,
  bool,
  expandHome,
  flag,
  formatStatus,
  int,
  parseAddressList,
  parseArgs,
  parsePhaseArg,
  parsePrivateKey,
  required,
  str,
  tokens,
  address as addressOpt,
  USAGE,
  UsageError,
  type Opts,
} from './admin-lib';
import {
  createArenaCall,
  deployArenaParams,
  deployTestTokenParams,
  deployedAddress,
  getArena,
  getArenaConfig,
  getArenaIds,
  getTokenInfo,
  setFeeBpsCall,
  setPausedCall,
  setServerAuthorityCall,
  setTokenCall,
  sweepArenaCall,
  updateArenaFrom,
  type ArenaConfig,
} from './arena';
import { describeCall, sendCall, simulateCall, type ContractCall } from './call';
import { createElymumPublicClient, createElymumWalletClient, elysiumChain, isMainnetChain } from './chain';
import { MAX_FEE_BPS } from './constants';
import { describeError } from './errors';
import { formatBps, formatHypeAmount, formatTokenAmount } from './format';
import { buildMerkleTree } from './merkle';
import { deployNftParams, getMintState, getNftOwner, setMerkleRootCall, setPhaseCall, setPriceBoundsCall, setPriceCall, setPriceKeeperCall, withdrawCall } from './nft';
import {
  arenaName,
  checkDeployedCode,
  confirmTypedAddress,
  createArenaRefusal,
  fetchStatus,
  ownerRefusal,
  planDefaultArenas,
  setTokenRefusal,
  sweepArenaRefusal,
  SWEEP_WARNING,
  testTokenRefusal,
  updateArenaRefusal,
} from './ops';
import { fetchHypeUsd, usdCentsToWei } from './price';

interface Ctx {
  url: string;
  opts: Opts;
  client: PublicClient;
  chain: Chain;
  chainId: number;
  mainnet: boolean;
  explorer: string | null;
  account: () => PrivateKeyAccount;
  wallet: () => WalletClient;
  arena: () => Address;
  nft: () => Address;
  confirmed: boolean;
}

/* -------------------------------------------------------------------- */
/* Rails                                                                 */
/* -------------------------------------------------------------------- */

async function confirmMainnet(ctx: Ctx): Promise<void> {
  if (!ctx.mainnet || ctx.confirmed) return;
  if (!flag(ctx.opts, 'mainnet')) throw new UsageError(`chain ${ctx.chainId} is Elysium MAINNET: re-run with --mainnet to send real transactions`);
  if (!process.stdin.isTTY) throw new UsageError('mainnet transactions need an interactive terminal to confirm');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('! MAINNET. Type "mainnet" to send: ');
    if (answer.trim().toLowerCase() !== 'mainnet') throw new UsageError('not confirmed: nothing was sent');
  } finally {
    rl.close();
  }
  ctx.confirmed = true;
}

function printPreview(title: string, lines: string[]): void {
  console.log(`→ ${title}`);
  for (const l of lines) console.log(`    ${l}`);
}

function txLinks(ctx: Ctx, hash: Hash): void {
  console.log(`  tx ${hash}`);
  const link = explorerTxUrl(ctx.explorer, hash);
  if (link) console.log(`  ${link}`);
}

/** Preview → (dry run stops) → simulate → mainnet confirmation → send → receipt. */
async function send(ctx: Ctx, label: string, call: ContractCall): Promise<Hash | null> {
  const d = describeCall(call);
  printPreview(`${d.signature} on ${d.to}`, [...d.args.map((a) => `${a.name} (${a.type}) = ${a.value}`), ...(d.valueText ? [`value = ${d.valueText}`] : [])]);
  if (flag(ctx.opts, 'dry-run')) {
    console.log('  dry run: not sent');
    return null;
  }
  const account = ctx.account();
  await simulateCall(ctx.client, call, account);
  await confirmMainnet(ctx);
  const hash = await sendCall(ctx.wallet(), call, { account, chain: ctx.chain });
  const receipt = await ctx.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  console.log(`✓ ${label}`);
  txLinks(ctx, hash);
  return hash;
}

async function deploy(ctx: Ctx, name: string, p: { abi: readonly unknown[]; bytecode: `0x${string}`; args: readonly unknown[] }, argNames: string[]): Promise<Address | null> {
  printPreview(`deploy ${name}`, p.args.map((a, i) => `${argNames[i]} = ${typeof a === 'bigint' ? a.toString() : String(a)}`));
  if (flag(ctx.opts, 'dry-run')) {
    console.log('  dry run: not sent');
    return null;
  }
  await confirmMainnet(ctx);
  const hash = await ctx.wallet().deployContract({ abi: p.abi, bytecode: p.bytecode, args: p.args, account: ctx.account(), chain: ctx.chain } as never);
  const address = await deployedAddress(ctx.client, hash);
  console.log(`✓ deployed ${name} at ${address}`);
  txLinks(ctx, hash);
  const link = explorerAddressUrl(ctx.explorer, address);
  if (link) console.log(`  ${link}`);
  return address;
}

async function requireArenaOwner(ctx: Ctx): Promise<ArenaConfig> {
  const arena = ctx.arena();
  const code = await checkDeployedCode(ctx.client, arena, 'arena');
  if (code === 'missing') throw new UsageError(`no contract at ARENA_ADDRESS ${arena} on chain ${ctx.chainId}`);
  if (code === 'mismatch') console.log(`! ${arena}: code differs from the bundled ElymumArena artifact`);
  const config = await getArenaConfig(ctx.client, arena);
  const refusal = ownerRefusal(config.admin, ctx.account().address, 'arena');
  if (refusal) throw new UsageError(refusal);
  return config;
}

async function requireNftOwner(ctx: Ctx): Promise<Address> {
  const nft = ctx.nft();
  const code = await checkDeployedCode(ctx.client, nft, 'nft');
  if (code === 'missing') throw new UsageError(`no contract at NFT_ADDRESS ${nft} on chain ${ctx.chainId}`);
  if (code === 'mismatch') console.log(`! ${nft}: code differs from the bundled ElymumNFT artifact`);
  const refusal = ownerRefusal(await getNftOwner(ctx.client, nft), ctx.account().address, 'NFT');
  if (refusal) throw new UsageError(refusal);
  return nft;
}

function requireToken(config: ArenaConfig): { token: Address; decimals: number } {
  if (!config.token) throw new UsageError('the game token is not set yet: run `pnpm admin set-token --token <addr> --confirm <addr>` first');
  return { token: config.token, decimals: config.decimals };
}

async function hypeUsd(ctx: Ctx): Promise<string> {
  const given = str(ctx.opts, 'hype-usd');
  if (given) return given;
  const { price } = await fetchHypeUsd({ url: process.env.HYPE_PRICE_URL || undefined });
  console.log(`  HYPE/USD ${price} (Hyperliquid)`);
  return price;
}

/* -------------------------------------------------------------------- */
/* Commands                                                              */
/* -------------------------------------------------------------------- */

async function cmdStatus(ctx: Ctx): Promise<void> {
  let account: Address | null = null;
  try {
    account = ctx.account().address;
  } catch {
    /* status works without a key */
  }
  const arena = str(ctx.opts, 'arena') ?? process.env.ARENA_ADDRESS;
  const nft = str(ctx.opts, 'nft') ?? process.env.NFT_ADDRESS;
  const s = await fetchStatus(ctx.client, { arena: arena ? ctx.arena() : null, nft: nft ? ctx.nft() : null, account });
  for (const line of formatStatus(s, ctx.url)) console.log(line);
}

async function cmdDeployArena(ctx: Ctx): Promise<void> {
  const admin = ctx.account().address;
  const server = addressOpt(ctx.opts, 'server');
  if (!server) throw new UsageError('deploy-arena needs --server <address> (the game server key, shown in /admin as serverKey)');
  const feeWallet = addressOpt(ctx.opts, 'fee-wallet') ?? admin;
  const address = await deploy(ctx, 'ElymumArena', deployArenaParams({ admin, serverAuthority: server, feeWallet }), ['admin', 'serverAuthority', 'feeWallet']);
  if (address) {
    console.log(`  next: export ARENA_ADDRESS=${address}`);
    console.log('        register it in /admin (Deploy) so the server uses it, then set-token and create-arena --defaults');
  }
}

async function cmdDeployNft(ctx: Ctx): Promise<void> {
  const owner = ctx.account().address;
  const o = ctx.opts;
  const maxSupply = int(o, 'max-supply', 1, 0xffffffff);
  if (maxSupply === undefined) throw new UsageError('deploy-nft needs --max-supply N');
  let price = big(o, 'price-wei');
  const cents = int(o, 'usd-cents', 1, 1_000_000);
  if (price === undefined && cents !== undefined) price = usdCentsToWei(cents, await hypeUsd(ctx));
  if (price === undefined) throw new UsageError('deploy-nft needs --price-wei N or --usd-cents N');
  const baseURI = required(o, 'base-uri', 'deploy-nft');
  const args = {
    owner,
    maxSupply,
    mintPrice: price,
    wlLimit: int(o, 'wl-limit', 0, 0xffff) ?? 2,
    publicLimit: int(o, 'public-limit', 0, 0xffff) ?? 2,
    baseURI,
    treasury: addressOpt(o, 'treasury') ?? owner,
  };
  console.log(`  price ${formatHypeAmount(price)} per token`);
  const address = await deploy(ctx, 'ElymumNFT', deployNftParams(args), ['owner', 'maxSupply', 'mintPrice', 'wlLimit', 'publicLimit', 'baseURI', 'treasury']);
  if (address) console.log(`  next: export NFT_ADDRESS=${address}  (and register it in /admin)`);
}

async function cmdDeployTestToken(ctx: Ctx): Promise<void> {
  const refusal = testTokenRefusal(ctx.chainId);
  if (refusal) throw new UsageError(refusal);
  const address = await deploy(ctx, 'TestToken', deployTestTokenParams({ owner: ctx.account().address }), ['owner']);
  if (address) console.log(`  next: pnpm admin set-token --token ${address} --confirm ${address}`);
}

async function cmdSetToken(ctx: Ctx): Promise<void> {
  const token = confirmTypedAddress('--token', required(ctx.opts, 'token', 'set-token'), required(ctx.opts, 'confirm', 'set-token'));
  const config = await requireArenaOwner(ctx);
  const code = await ctx.client.getCode({ address: token });
  const refusal = setTokenRefusal(config, token, !!code && code !== '0x');
  if (refusal) throw new UsageError(refusal);
  const info = await getTokenInfo(ctx.client, token);
  console.log(`  token ${token}: ${info.name ?? '?'} (${info.symbol ?? '?'}), ${info.decimals} decimals`);
  console.log('  ! this is final: the arena contract accepts the game token once');
  await send(ctx, `game token set to ${token}`, setTokenCall(ctx.arena(), token));
  console.log('  next: pnpm admin create-arena --defaults');
}

async function cmdCreateArena(ctx: Ctx): Promise<void> {
  const config = await requireArenaOwner(ctx);
  const { decimals } = requireToken(config);
  const existing = await getArenaIds(ctx.client, ctx.arena());
  if (flag(ctx.opts, 'defaults')) {
    const plan = planDefaultArenas(decimals, existing);
    for (const id of plan.skip) console.log(`• arena #${id} (${arenaName(id)}) exists: skipped`);
    for (const p of plan.create) {
      await send(ctx, `created arena #${p.id} (${arenaName(p.id)}) · entry ${formatTokenAmount(p.entryFee, decimals)} · max ${p.maxSessions}`, createArenaCall(ctx.arena(), p));
    }
    if (plan.create.length === 0) console.log('nothing to do');
    return;
  }
  const id = int(ctx.opts, 'id', 1, 65_535);
  const entryFee = tokens(ctx.opts, 'fee', decimals);
  const maxSessions = int(ctx.opts, 'max', ...arenaSessionsBounds);
  if (id === undefined || entryFee === undefined || maxSessions === undefined) throw new UsageError('create-arena needs --id N --fee <tokens> --max N (or --defaults)');
  const p = { id, entryFee, maxSessions };
  const refusal = createArenaRefusal(config, p, existing);
  if (refusal) throw new UsageError(refusal);
  await send(ctx, `created arena #${id} (${arenaName(id)}) · entry ${formatTokenAmount(entryFee, decimals)} · max ${maxSessions}`, createArenaCall(ctx.arena(), p));
}

async function cmdUpdateArena(ctx: Ctx): Promise<void> {
  const id = int(ctx.opts, 'id', 1, 65_535);
  if (id === undefined) throw new UsageError('update-arena needs --id N');
  const config = await requireArenaOwner(ctx);
  const { decimals } = requireToken(config);
  const changes = {
    entryFee: tokens(ctx.opts, 'fee', decimals),
    maxSessions: int(ctx.opts, 'max', ...arenaSessionsBounds),
    enabled: bool(ctx.opts, 'enabled'),
  };
  if (Object.values(changes).every((v) => v === undefined)) throw new UsageError('update-arena: pass --fee, --max and/or --enabled');
  const current = await getArena(ctx.client, ctx.arena(), id);
  const refusal = updateArenaRefusal(current, changes.entryFee ?? current.entryFee);
  if (refusal) throw new UsageError(refusal);
  await send(ctx, `updated arena #${id}`, updateArenaFrom(ctx.arena(), current, changes));
}

async function cmdFee(ctx: Ctx): Promise<void> {
  const bps = int(ctx.opts, 'bps', 0, MAX_FEE_BPS);
  if (bps === undefined) throw new UsageError(`fee needs --bps N (0..${MAX_FEE_BPS})`);
  const config = await requireArenaOwner(ctx);
  console.log(`  fee ${formatBps(config.feeBps)} → ${formatBps(bps)} (open tickets keep the rate they joined with)`);
  await send(ctx, `fee set to ${formatBps(bps)}`, setFeeBpsCall(ctx.arena(), bps));
}

async function cmdPause(ctx: Ctx, paused: boolean): Promise<void> {
  const config = await requireArenaOwner(ctx);
  if (config.paused === paused) {
    console.log(`already ${paused ? 'paused' : 'running'}: nothing to do`);
    return;
  }
  await send(ctx, paused ? 'paused: arena joins are blocked (settlements and refunds keep working)' : 'unpaused: arena joins are open', setPausedCall(ctx.arena(), paused));
}

async function cmdServerKey(ctx: Ctx): Promise<void> {
  const server = addressOpt(ctx.opts, 'address');
  if (!server) throw new UsageError('server-key needs --address <addr>');
  const config = await requireArenaOwner(ctx);
  console.log(`  server authority ${config.serverAuthority} → ${server}`);
  await send(ctx, `server authority set to ${server}`, setServerAuthorityCall(ctx.arena(), server));
}

async function cmdSweepArena(ctx: Ctx): Promise<void> {
  const id = int(ctx.opts, 'id', 1, 65_535);
  if (id === undefined) throw new UsageError('sweep-arena needs --id N');
  const config = await requireArenaOwner(ctx);
  const { decimals } = requireToken(config);
  const arena = await getArena(ctx.client, ctx.arena(), id);
  const refusal = sweepArenaRefusal(arena);
  if (refusal) throw new UsageError(refusal);
  console.log(`! sweep moves arena #${id}'s whole vault (${formatTokenAmount(arena.vault, decimals)}) to the fee wallet ${config.feeWallet}.\n  ${SWEEP_WARNING}`);
  if (!flag(ctx.opts, 'force')) throw new UsageError(`sweep-arena refuses without --force (re-run: pnpm admin sweep-arena --id ${id} --force)`);
  await send(ctx, `swept arena #${id}`, sweepArenaCall(ctx.arena(), id));
}

async function cmdNftPhase(ctx: Ctx, positional: string[]): Promise<void> {
  const phase = parsePhaseArg(positional[0] ?? str(ctx.opts, 'phase'));
  const nft = await requireNftOwner(ctx);
  const state = await getMintState(ctx.client, nft);
  if (phase !== 'closed' && /^0x0{64}$/.test(state.root)) console.log('! no allowlist root is set yet (nft:root --file <path>)');
  await send(ctx, `mint phase set to ${phase}`, setPhaseCall(nft, phase));
}

async function cmdNftRoot(ctx: Ctx): Promise<void> {
  const file = required(ctx.opts, 'file', 'nft:root');
  let text: string;
  try {
    text = readFileSync(expandHome(file), 'utf8');
  } catch {
    throw new UsageError(`cannot read ${file}`);
  }
  let tree;
  try {
    tree = buildMerkleTree(parseAddressList(text));
  } catch (err) {
    throw new UsageError(`${file}: ${(err as Error).message}`);
  }
  console.log(`  ${tree.count} unique addresses · root ${tree.root}`);
  const nft = await requireNftOwner(ctx);
  await send(ctx, `allowlist root set (${tree.count} wallets)`, setMerkleRootCall(nft, tree.root));
}

async function cmdNftPrice(ctx: Ctx): Promise<void> {
  let wei = big(ctx.opts, 'wei');
  const cents = int(ctx.opts, 'usd-cents', 1, 1_000_000);
  if (wei === undefined && cents !== undefined) wei = usdCentsToWei(cents, await hypeUsd(ctx));
  if (wei === undefined) throw new UsageError('nft:price needs --usd-cents N or --wei N');
  const nft = await requireNftOwner(ctx);
  const state = await getMintState(ctx.client, nft);
  console.log(`  price ${formatHypeAmount(state.price)} → ${formatHypeAmount(wei)}`);
  await send(ctx, `price set to ${formatHypeAmount(wei)}`, setPriceCall(nft, wei));
}

async function cmdNftKeeper(ctx: Ctx): Promise<void> {
  const raw = required(ctx.opts, 'address', 'nft:keeper');
  const keeper = /^(none|0)$/i.test(raw.trim()) ? null : addressOpt(ctx.opts, 'address')!;
  const nft = await requireNftOwner(ctx);
  const state = await getMintState(ctx.client, nft);
  if (keeper && state.maxPrice === 0n) console.log('! no price bounds yet: the keeper cannot set a price until nft:bounds is set');
  await send(ctx, keeper ? `price keeper set to ${keeper}` : 'price keeper removed', setPriceKeeperCall(nft, keeper));
}

async function cmdNftBounds(ctx: Ctx): Promise<void> {
  let min = big(ctx.opts, 'min-wei', 1n);
  let max = big(ctx.opts, 'max-wei', 1n);
  const minC = int(ctx.opts, 'min-usd-cents', 1, 1_000_000);
  const maxC = int(ctx.opts, 'max-usd-cents', 1, 1_000_000);
  if ((min === undefined || max === undefined) && minC !== undefined && maxC !== undefined) {
    const p = await hypeUsd(ctx);
    min = usdCentsToWei(minC, p);
    max = usdCentsToWei(maxC, p);
  }
  if (min === undefined || max === undefined) throw new UsageError('nft:bounds needs --min-wei and --max-wei (or --min-usd-cents and --max-usd-cents)');
  if (min > max) throw new UsageError('the minimum is above the maximum');
  const nft = await requireNftOwner(ctx);
  console.log(`  keeper bounds ${formatHypeAmount(min)} .. ${formatHypeAmount(max)}`);
  await send(ctx, 'price bounds set', setPriceBoundsCall(nft, min, max));
}

async function cmdNftWithdraw(ctx: Ctx): Promise<void> {
  const nft = await requireNftOwner(ctx);
  const [state, balance] = await Promise.all([getMintState(ctx.client, nft), ctx.client.getBalance({ address: nft })]);
  if (balance === 0n) {
    console.log('the NFT contract holds no HYPE: nothing to withdraw');
    return;
  }
  console.log(`  ${formatHypeAmount(balance)} → treasury ${state.treasury}`);
  await send(ctx, `withdrew ${formatHypeAmount(balance)} to the treasury`, withdrawCall(nft));
}

/* -------------------------------------------------------------------- */

function envAddress(opts: Opts, flagName: string, env: string): () => Address {
  return () => {
    const v = str(opts, flagName) ?? process.env[env];
    if (!v) throw new UsageError(`set ${env} or pass --${flagName} <address>`);
    return addressOpt(new Map([[flagName, v]]), flagName)!;
  };
}

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { command, positional, opts } = parsed;
  if (!command || command === 'help' || opts.get('help') === true) {
    console.log(USAGE);
    return command && command !== 'help' ? 2 : 0;
  }

  const verbose = flag(opts, 'verbose');
  let url = '';
  try {
    url = str(opts, 'rpc') ?? process.env.EVM_RPC_URL ?? 'http://127.0.0.1:8545';
    const probe = createElymumPublicClient(url);
    const chainId = await probe.getChainId();
    const chain = elysiumChain(chainId, { name: process.env.CHAIN_NAME, explorerUrl: process.env.EXPLORER_URL, rpcUrl: url });
    const client = createElymumPublicClient(url, chain);
    let account: PrivateKeyAccount | null = null;
    let wallet: WalletClient | null = null;
    const keySource = str(opts, 'key') ?? process.env.ADMIN_PRIVATE_KEY ?? process.env.ADMIN_KEY_FILE;
    const ctx: Ctx = {
      url,
      opts,
      client,
      chain,
      chainId,
      mainnet: isMainnetChain(chainId),
      explorer: chain.blockExplorers?.default.url ?? null,
      account: () => {
        if (!account) {
          if (!keySource) throw new UsageError('set ADMIN_PRIVATE_KEY (a 0x key or a key file path) or pass --key');
          account = privateKeyToAccount(parsePrivateKey(keySource));
        }
        return account;
      },
      wallet: () => (wallet ??= createElymumWalletClient(url, { account: ctx.account(), chain })),
      arena: envAddress(opts, 'arena', 'ARENA_ADDRESS'),
      nft: envAddress(opts, 'nft', 'NFT_ADDRESS'),
      confirmed: false,
    };
    if (ctx.mainnet) console.log(`! Elysium MAINNET (chain id ${chainId})`);

    const commands: Record<string, () => Promise<void>> = {
      status: () => cmdStatus(ctx),
      'deploy-arena': () => cmdDeployArena(ctx),
      'deploy-nft': () => cmdDeployNft(ctx),
      'deploy-test-token': () => cmdDeployTestToken(ctx),
      'set-token': () => cmdSetToken(ctx),
      'create-arena': () => cmdCreateArena(ctx),
      'update-arena': () => cmdUpdateArena(ctx),
      fee: () => cmdFee(ctx),
      pause: () => cmdPause(ctx, true),
      unpause: () => cmdPause(ctx, false),
      'server-key': () => cmdServerKey(ctx),
      'sweep-arena': () => cmdSweepArena(ctx),
      'nft:phase': () => cmdNftPhase(ctx, positional),
      'nft:root': () => cmdNftRoot(ctx),
      'nft:price': () => cmdNftPrice(ctx),
      'nft:keeper': () => cmdNftKeeper(ctx),
      'nft:bounds': () => cmdNftBounds(ctx),
      'nft:withdraw': () => cmdNftWithdraw(ctx),
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
    console.error(`✗ ${d.message}${d.name ? ` [${d.name}]` : ''}`);
    if (d.kind === 'network') console.error(`  is an RPC node running at ${url}?`);
    if (verbose) console.error(err);
    else console.error('  (re-run with --verbose for the raw error)');
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

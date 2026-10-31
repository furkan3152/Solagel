/**
 * Measures real transaction gas (21k base, calldata and cold storage included) on the in-process Hardhat network:
 * `pnpm hardhat run scripts/gas-report.ts`.
 */
import { network } from 'hardhat';
import { keccak256, encodeAbiParameters, parseEther, type Address, type Hex } from 'viem';

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [admin, server, feeWallet, ...players] = await viem.getWalletClients();

async function gas(hash: Hex): Promise<bigint> {
  return (await publicClient.waitForTransactionReceipt({ hash })).gasUsed;
}

const token = await viem.deployContract('TestToken', [admin.account.address]);
const arena = await viem.deployContract('ElymumArena', [
  admin.account.address,
  server.account.address,
  feeWallet.account.address,
]);
await arena.write.setToken([token.address]);
const FEE = parseEther('1000');
await arena.write.createArena([1, FEE, 2000]);

const accounts: Address[] = [];
for (let i = 0; i < 41; i++) {
  const w = players[i % players.length];
  // Use fresh impersonated addresses beyond the funded wallets.
  accounts.push(i < players.length ? w.account.address : (`0x${(0x7000 + i).toString(16).padStart(40, '0')}` as Address));
}
const testClient = await viem.getTestClient();
const joinGas: bigint[] = [];
for (const a of accounts) {
  await testClient.impersonateAccount({ address: a });
  await testClient.setBalance({ address: a, value: parseEther('10') });
  await token.write.mint([a, FEE * 10n]);
  await token.write.approve([arena.address, FEE * 10n], { account: a });
  joinGas.push(await gas(await arena.write.join([1], { account: a })));
}
const session = async (a: Address) => ((await arena.read.getSession([1, a])) as { id: bigint }).id;
const settleOne = [{ arenaId: 1, player: accounts[0], sessionId: await session(accounts[0]), payout: parseEther('1500') }];
const s1 = await gas(await arena.write.settle([settleOne], { account: server.account }));
const many = [];
for (let i = 1; i < 41; i++) {
  many.push({ arenaId: 1, player: accounts[i], sessionId: await session(accounts[i]), payout: parseEther(String(500 + i * 30)) });
}
const s40 = await gas(await arena.write.settle([many], { account: server.account }));
const sweep = await gas(await arena.write.sweepLoot([1, 1n, parseEther('100')], { account: server.account }));

// NFT
const nft = await viem.deployContract('ElymumNFT', [admin.account.address, 10_000, parseEther('0.03'), 2, 3, 'https://x/api/nft/', admin.account.address]);
const minter = players[0].account.address;
const leaf = (a: Address) => keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [a])));
const other = leaf('0x0000000000000000000000000000000000001111');
const l = leaf(minter);
const root = keccak256(l < other ? `0x${l.slice(2)}${other.slice(2)}` as Hex : `0x${other.slice(2)}${l.slice(2)}` as Hex);
await nft.write.setMerkleRoot([root]);
await nft.write.setPhase([1]);
const mintWl = await gas(await nft.write.mintAllowlist([1n, [other]], { account: players[0].account, value: parseEther('0.03') }));
await nft.write.setPhase([2]);
const mintPub = await gas(await nft.write.mintPublic([1n], { account: players[1].account, value: parseEther('0.05') }));

const sorted = [...joinGas].sort((a, b) => Number(a - b));
console.log(JSON.stringify({
  join_firstEver: joinGas[0].toString(),
  join_typical: sorted[Math.floor(sorted.length / 2)].toString(),
  settle1: s1.toString(),
  settle40: s40.toString(),
  sweepLoot: sweep.toString(),
  mintAllowlist1: mintWl.toString(),
  mintPublic1_withRefund: mintPub.toString(),
}, null, 2));

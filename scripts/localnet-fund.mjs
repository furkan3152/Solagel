#!/usr/bin/env node
// Funds a wallet on the local chain started by scripts/localnet.mjs (or `pnpm demo:localnet`): HYPE
// from the owner account and test tokens minted by the TestToken owner.
//
//   node scripts/localnet-fund.mjs <0x-address> [hype=10] [tokens=100000]
import { fundAddress } from './lib/localnet.mjs';

const [to, hype = '10', tokens = '100000'] = process.argv.slice(2);
if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to) || !(Number(hype) >= 0) || !(Number(tokens) >= 0)) {
  console.log('usage: node scripts/localnet-fund.mjs <0x-address> [hype=10] [tokens=100000]');
  process.exit(2);
}
try {
  await fundAddress(to, { hype: Number(hype), tokens: Math.floor(Number(tokens)) });
} catch (e) {
  console.error(`x ${e.shortMessage ?? e.message ?? e}`);
  process.exit(1);
}

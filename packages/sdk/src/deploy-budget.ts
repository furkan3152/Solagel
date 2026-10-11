/** Read-only budget gate for the upgradeable SOL beta program. Never signs or sends. */
import { Connection } from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import idl from './idl/solagel.json';

type IdlType = string | { array?: [IdlType, number]; defined?: { name: string } };

function sizeOf(type: IdlType): number {
  if (typeof type === 'string') {
    const sizes: Record<string, number> = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 };
    if (sizes[type] === undefined) throw new Error(`Variable or unsupported IDL field: ${type}`);
    return sizes[type];
  }
  if (type.array) return sizeOf(type.array[0]) * type.array[1];
  if (type.defined) return structSize(type.defined.name);
  throw new Error('Unsupported IDL account layout');
}

function structSize(name: string): number {
  const definition = idl.types.find(t => t.name === name);
  if (!definition || definition.type.kind !== 'struct') throw new Error(`Missing fixed account layout: ${name}`);
  return definition.type.fields.reduce((sum, field) => sum + sizeOf(field.type as IdlType), 0);
}

export function accountSize(name: string): number {
  const account = idl.accounts.find(a => a.name === name);
  if (!account) throw new Error(`Unknown account: ${name}`);
  return account.discriminator.length + structSize(name);
}

export async function deploymentBudget(
  rpc: Pick<Connection, 'getMinimumBalanceForRentExemption'>,
  binaryBytes: number,
  budgetLamports = 500_000_000,
  allowanceLamports = 20_000_000,
) {
  if (!Number.isSafeInteger(binaryBytes) || binaryBytes <= 0 || binaryBytes > 10 * 1024 * 1024) throw new Error('Invalid SBF program size');
  if (![budgetLamports, allowanceLamports].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid budget');
  const entries = [
    { name: 'Program', bytes: 36, count: 1 },
    { name: 'ProgramData', bytes: binaryBytes + 45, count: 1 },
    { name: 'Config', bytes: accountSize('Config'), count: 1 },
    { name: 'First season', bytes: accountSize('Season'), count: 1 },
    { name: 'Arena', bytes: accountSize('Arena'), count: 3 },
  ];
  const accounts = await Promise.all(entries.map(async entry => {
    const rent = await rpc.getMinimumBalanceForRentExemption(entry.bytes, 'confirmed');
    if (!Number.isSafeInteger(rent) || rent < 0) throw new Error('RPC returned an invalid rent requirement');
    return { ...entry, rentLamports: rent * entry.count };
  }));
  const rentLamports = accounts.reduce((sum, entry) => sum + entry.rentLamports, 0);
  if (!Number.isSafeInteger(rentLamports + allowanceLamports)) throw new Error('Budget total exceeds exact accounting range');
  return { binaryBytes, budgetLamports, rentLamports, allowanceLamports,
    plannedLamports: rentLamports + allowanceLamports, remainingLamports: budgetLamports - rentLamports - allowanceLamports,
    withinBudget: rentLamports + allowanceLamports <= budgetLamports, accounts };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const file = resolve(process.argv[2] ?? resolve(root, 'target/deploy/solagel_compact.so'));
  const rpcUrl = process.argv[3] ?? 'https://api.mainnet-beta.solana.com';
  if (!/^https?:\/\//.test(rpcUrl)) throw new Error('Expected an HTTP(S) RPC URL');
  const binary = await readFile(file);
  if (binary.subarray(0, 4).toString('hex') !== '7f454c46') throw new Error('Expected a compiled SBF ELF program');
  const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) });
  const estimate = await deploymentBudget(connection, binary.byteLength);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), program: idl.address,
    artifact: file, sha256: createHash('sha256').update(binary).digest('hex'), ...estimate,
    note: 'Read-only estimate. 0.02 SOL is an allowance for fees and initial server operation, not a fee guarantee. Hosting and prize funding are excluded. Recheck before signing; no transaction was sent.' }, null, 2));
  if (!estimate.withinBudget) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error && !error.message.includes('http') ? error.message : 'Budget RPC check failed. No transaction was sent.');
    process.exitCode = 1;
  });
}

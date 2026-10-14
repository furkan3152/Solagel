#!/usr/bin/env node
/**
 * Copies the Anchor build output into the SDK:
 *
 *   target/idl/slana.json  →  packages/sdk/src/idl/slana.json   (runtime IDL, snake_case)
 *   target/types/slana.ts  →  packages/sdk/src/idl/slana.ts     (`export type Slana`, camelCase)
 *
 * Run it after every `anchor build` (pnpm -F @slana/sdk sync-idl).
 *
 * Program address: the IDL carries the address from `declare_id!` in programs/slana/src/lib.rs.
 * `anchor keys sync` rewrites `declare_id!` and Anchor.toml to match target/deploy/slana-keypair.json,
 * which CHANGES the program address; after it you must `anchor build` again and re-run this script,
 * otherwise the SDK (PROGRAM_ID, PDAs) points at the old program. This script warns when the IDL
 * address and the deploy keypair disagree.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pairs = [
  ['target/idl/slana.json', 'packages/sdk/src/idl/slana.json'],
  ['target/types/slana.ts', 'packages/sdk/src/idl/slana.ts'],
];

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Minimal base58 encoder (no dependencies). */
function base58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

let missing = false;
for (const [from, to] of pairs) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`✗ ${from} not found — run \`anchor build\` at the repo root first.`);
    missing = true;
  }
}
if (missing) process.exit(1);

for (const [from, to] of pairs) {
  const dst = join(root, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(root, from), dst);
  console.log(`✓ ${from} → ${relative(root, dst)}`);
}

const idl = JSON.parse(readFileSync(join(root, pairs[0][0]), 'utf8'));
console.log(`  program address in IDL: ${idl.address}`);
const keypairPath = join(root, 'target/deploy/slana-keypair.json');
if (existsSync(keypairPath)) {
  try {
    const secret = JSON.parse(readFileSync(keypairPath, 'utf8'));
    // Solana keypair files hold 64 bytes: 32-byte seed followed by the 32-byte public key.
    const pubkey = base58(Uint8Array.from(secret.slice(32, 64)));
    if (pubkey !== idl.address) {
      console.warn(
        `⚠ target/deploy/slana-keypair.json is ${pubkey} but the IDL says ${idl.address}.\n` +
          '  Run `anchor keys sync && anchor build` and then this script again (this changes the program address).',
      );
    }
  } catch {
    /* unreadable keypair: nothing to compare */
  }
}

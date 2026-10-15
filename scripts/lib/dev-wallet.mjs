// A Wallet Standard "Dev Wallet" injected into a Playwright browser context. The key lives in the
// Node process: it signs the (free) sign-in message and, on a real chain, transactions. Used by
// `pnpm demo --browser` and `pnpm demo:record`; any Wallet Standard dapp discovers it like Phantom.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { requireFrom } from './common.mjs';

const serverRequire = requireFrom('apps/server');
const nacl = serverRequire('tweetnacl');
const bs58 = serverRequire('bs58').default ?? serverRequire('bs58');

const ICON =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1E1B2E"/><circle cx="16" cy="16" r="8" fill="#FF4F87"/></svg>',
  ).toString('base64');

/** Loads a Solana-CLI-format keypair file (JSON array of 64 bytes), creating it when missing. */
export function loadOrCreateKeypair(path) {
  if (existsSync(path)) return nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  const kp = nacl.sign.keyPair();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export const addressOf = (kp) => bs58.encode(kp.publicKey);

/** Registers the Dev Wallet on every page of `ctx`. `kp` defaults to a fresh random key. */
export async function installDevWallet(ctx, kp = nacl.sign.keyPair(), { allowTransactions = true } = {}) {
  await ctx.exposeBinding('__devWalletSign', (_src, bytes) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)));
  await ctx.exposeBinding('__devWalletSignTx', (_src, bytes) => {
    if (!allowTransactions) throw new Error('dev wallet refuses transactions');
    const { VersionedTransaction, PublicKey } = serverRequire('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
    const sig = nacl.sign.detached(tx.message.serialize(), kp.secretKey);
    tx.addSignature(new PublicKey(kp.publicKey), sig);
    return Array.from(tx.serialize());
  });
  await ctx.addInitScript(
    ({ address, pub, icon }) => {
      const chains = ['solana:devnet', 'solana:mainnet', 'solana:testnet', 'solana:localnet'];
      const account = { address, publicKey: Uint8Array.from(pub), chains, features: ['solana:signMessage', 'solana:signTransaction'], label: 'Dev' };
      const listeners = new Set();
      const wallet = {
        version: '1.0.0',
        name: 'Dev Wallet',
        icon,
        chains,
        accounts: [],
        features: {
          'standard:connect': {
            version: '1.0.0',
            connect: async () => {
              wallet.accounts = [account];
              listeners.forEach((l) => l({ accounts: wallet.accounts }));
              return { accounts: wallet.accounts };
            },
          },
          'standard:disconnect': {
            version: '1.0.0',
            disconnect: async () => {
              wallet.accounts = [];
              listeners.forEach((l) => l({ accounts: [] }));
            },
          },
          'standard:events': {
            version: '1.0.0',
            on: (ev, l) => {
              if (ev !== 'change') return () => {};
              listeners.add(l);
              return () => listeners.delete(l);
            },
          },
          'solana:signMessage': {
            version: '1.0.0',
            signMessage: async (...inputs) =>
              Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: Uint8Array.from(await window.__devWalletSign(Array.from(message))) }))),
          },
          'solana:signTransaction': {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy', 0],
            signTransaction: async (...inputs) =>
              Promise.all(inputs.map(async ({ transaction }) => ({ signedTransaction: Uint8Array.from(await window.__devWalletSignTx(Array.from(transaction))) }))),
          },
        },
      };
      const register = ({ register }) => register(wallet);
      window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail));
      try {
        window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
      } catch {
        /* no registry yet */
      }
    },
    { address: bs58.encode(kp.publicKey), pub: Array.from(kp.publicKey), icon: ICON },
  );
  return kp;
}

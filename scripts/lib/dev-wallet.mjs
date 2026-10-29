// The "Dev Wallet": an EIP-1193 provider injected into a Playwright browser context and announced
// the EIP-6963 way, so the web app lists it next to MetaMask or Rabby. The private key never enters
// the page: it lives in this Node process (viem `privateKeyToAccount`), which signs the free SIWE
// sign-in message and, on a real chain (`rpcUrl`), sends transactions to that RPC.
// Used by `pnpm demo --browser`, `pnpm demo:localnet --browser` and `pnpm demo:record`.
//
// Methods: eth_requestAccounts, eth_accounts, eth_chainId, net_version, personal_sign,
// eth_signTypedData_v4, eth_sendTransaction, wallet_switchEthereumChain / wallet_addEthereumChain
// (accepted; the wallet follows the chain the app asks for), wallet_requestPermissions,
// wallet_getPermissions; every other read (eth_call, eth_getBalance, eth_estimateGas, receipts, ...)
// is forwarded to `rpcUrl`, and refused with code 4200 when there is none (the fake chain).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LOCALNET_CHAIN_ID, hardhatKey, viem } from './common.mjs';

const ICON =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#04181C"/><circle cx="16" cy="16" r="9" fill="#F2C14E" stroke="#F6EEDA" stroke-width="2"/></svg>',
  ).toString('base64');

/** A 0x private key from a file (created with a fresh random key when missing). */
export function loadOrCreateKey(path) {
  if (existsSync(path)) {
    const key = readFileSync(path, 'utf8').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${path} does not hold a private key (0x + 64 hex digits)`);
    return key;
  }
  const key = viem('/accounts').generatePrivateKey();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  return key;
}

/** The key of a Hardhat dev account (funded on `hardhat node`). */
export const devAccountKey = (index) => hardhatKey(index);

export const addressOf = (key) => viem('/accounts').privateKeyToAccount(key).address;

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Registers the Dev Wallet on every page of `ctx`.
 * @param ctx      Playwright BrowserContext
 * @param key      0x private key (default: a fresh random one)
 * @param opts.rpcUrl            JSON-RPC URL for transactions and reads (omit on the fake chain)
 * @param opts.chainId           chain id reported before the app asks to switch (default: the RPC's, else 31337)
 * @param opts.allowTransactions false refuses eth_sendTransaction (code 4100)
 * @returns the account address
 */
export async function installDevWallet(ctx, key = viem('/accounts').generatePrivateKey(), { rpcUrl = null, chainId = null, allowTransactions = true } = {}) {
  const { createWalletClient, createPublicClient, http, hexToBigInt, isHex, defineChain } = viem();
  const account = viem('/accounts').privateKeyToAccount(key);
  let currentChainId = chainId;
  if (currentChainId == null && rpcUrl) {
    currentChainId = await createPublicClient({ transport: http(rpcUrl) }).getChainId().catch(() => null);
  }
  currentChainId ??= LOCALNET_CHAIN_ID;

  const chainFor = (id) =>
    defineChain({ id, name: `chain ${id}`, nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl ?? 'http://127.0.0.1:8545'] } } });
  const forward = async (method, params) => {
    if (!rpcUrl) throw new RpcError(4200, `Dev Wallet: ${method} needs a real chain (no RPC on the fake chain)`);
    const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
    const body = await res.json();
    if (body.error) throw new RpcError(body.error.code ?? -32603, body.error.message ?? 'RPC error');
    return body.result;
  };
  const big = (v) => (v == null ? undefined : hexToBigInt(v));

  async function handle(method, params = []) {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address];
      case 'eth_chainId':
        return `0x${currentChainId.toString(16)}`;
      case 'net_version':
        return String(currentChainId);
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions':
        return [{ parentCapability: 'eth_accounts' }];
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain': {
        const id = Number.parseInt(params?.[0]?.chainId ?? '0x0', 16);
        if (id > 0) currentChainId = id;
        return null;
      }
      case 'personal_sign': {
        // personal_sign(message, address); some apps send (address, message)
        let [message, address] = params;
        if (isHex(message) && message.length === 42 && !isHex(address ?? '')) [message, address] = [address, message];
        if (address && address.toLowerCase() !== account.address.toLowerCase()) throw new RpcError(4100, 'Dev Wallet: unknown account');
        return account.signMessage({ message: isHex(message) ? { raw: message } : message });
      }
      case 'eth_signTypedData_v4': {
        const data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        const { EIP712Domain: _drop, ...types } = data.types;
        return account.signTypedData({ domain: data.domain, types, primaryType: data.primaryType, message: data.message });
      }
      case 'eth_sendTransaction': {
        if (!allowTransactions) throw new RpcError(4001, 'Dev Wallet: transactions are turned off');
        if (!rpcUrl) throw new RpcError(4200, 'Dev Wallet: no RPC to send to (fake chain)');
        const tx = params[0] ?? {};
        const wallet = createWalletClient({ account, chain: chainFor(currentChainId), transport: http(rpcUrl) });
        return wallet.sendTransaction({
          to: tx.to ?? undefined,
          data: tx.data ?? tx.input ?? undefined,
          value: big(tx.value),
          gas: big(tx.gas),
          ...(tx.maxFeePerGas ? { maxFeePerGas: big(tx.maxFeePerGas), maxPriorityFeePerGas: big(tx.maxPriorityFeePerGas) } : {}),
        });
      }
      case 'eth_sign':
      case 'eth_signTransaction':
        throw new RpcError(4200, `Dev Wallet: ${method} is not supported`);
      default:
        return forward(method, params);
    }
  }

  await ctx.exposeBinding('__devWalletRequest', async (_src, { method, params }) => {
    try {
      return { ok: true, result: await handle(method, params) };
    } catch (e) {
      return { ok: false, code: e.code ?? -32603, message: e.shortMessage ?? e.message ?? String(e) };
    }
  });

  await ctx.addInitScript(
    ({ address, icon }) => {
      const listeners = new Map();
      const emit = (ev, arg) => (listeners.get(ev) ?? []).forEach((l) => l(arg));
      const provider = {
        isDevWallet: true,
        async request({ method, params }) {
          const r = await window.__devWalletRequest({ method, params });
          if (!r.ok) {
            const err = new Error(r.message);
            err.code = r.code;
            throw err;
          }
          if (method === 'eth_requestAccounts') emit('connect', { chainId: await provider.request({ method: 'eth_chainId' }) });
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') emit('chainChanged', await provider.request({ method: 'eth_chainId' }));
          return r.result;
        },
        on(ev, l) {
          if (!listeners.has(ev)) listeners.set(ev, new Set());
          listeners.get(ev).add(l);
          return provider;
        },
        removeListener(ev, l) {
          listeners.get(ev)?.delete(l);
          return provider;
        },
      };
      const info = Object.freeze({ uuid: crypto.randomUUID?.() ?? `dev-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`, name: 'Dev Wallet', icon, rdns: 'dev.elymum.wallet' });
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
      window.__devWallet = { address, provider };
    },
    { address: account.address, icon: ICON },
  );
  return account.address;
}

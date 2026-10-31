// An EIP-6963 browser wallet for Playwright tours and `pnpm demo --browser`: the page sees a normal
// EIP-1193 provider ("Dev Wallet"), but the key lives in this Node process as a viem local account
// (`privateKeyToAccount`). It signs the free SIWE sign-in (`personal_sign`) and, when an RPC is
// known (the chain the app asks for, or `rpcUrl`), sends transactions; every other JSON-RPC call is
// forwarded to that RPC.
//
//   import { installEvmWallet, newDevKey } from './evm-wallet.mjs';
//   const { address } = await installEvmWallet(ctx, { privateKey: newDevKey(), autoConnect: true });
import { createWalletClient, defineChain, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export const DEV_WALLET_RDNS = 'xyz.elymum.devwallet';
const ICON =
  'data:image/svg+xml;base64,' +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0F2A30"/><circle cx="16" cy="16" r="8" fill="#34B7DD"/></svg>').toString('base64');

/** A fresh random private key (0x hex). */
export const newDevKey = () => generatePrivateKey();

/**
 * Injects the wallet into every page of the Playwright context `ctx`.
 * - `autoConnect`: the app reconnects to it silently on load (as a wallet the site already trusts).
 * - `chainId`: the chain it starts on (default 31337); `wallet_switchEthereumChain` / `wallet_addEthereumChain` change it.
 * - `rpcUrl`: RPC for reads and transactions when the app never adds a chain (e.g. the localnet).
 * - `allowTransactions`: false refuses `eth_sendTransaction` (sign-in only).
 */
export async function installEvmWallet(ctx, { privateKey = generatePrivateKey(), autoConnect = false, chainId = 31337, rpcUrl = null, allowTransactions = true } = {}) {
  const account = privateKeyToAccount(privateKey);
  const rpcs = new Map();
  if (rpcUrl) rpcs.set(chainId, rpcUrl);
  let current = chainId;
  const rpc = () => rpcs.get(current) ?? (current === 31337 ? 'http://127.0.0.1:8545' : null);
  const fail = (code, message) => {
    const e = new Error(message);
    e.code = code;
    return e;
  };
  const forward = async (method, params) => {
    const url = rpc();
    if (!url) throw fail(4900, `no RPC for chain ${current}`);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
    const body = await res.json();
    if (body.error) throw fail(body.error.code ?? -32603, body.error.message ?? 'RPC error');
    return body.result;
  };

  await ctx.exposeBinding('__elymumWalletRequest', async (_src, method, params) => {
    try {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return { result: [account.address] };
        case 'eth_chainId':
          return { result: `0x${current.toString(16)}` };
        case 'wallet_switchEthereumChain': {
          const id = Number.parseInt(params?.[0]?.chainId, 16);
          if (!rpcs.has(id) && id !== 31337) throw fail(4902, `Unrecognized chain ID ${params?.[0]?.chainId}`);
          current = id;
          return { result: null, chainChanged: `0x${id.toString(16)}` };
        }
        case 'wallet_addEthereumChain': {
          const p = params?.[0] ?? {};
          const id = Number.parseInt(p.chainId, 16);
          if (p.rpcUrls?.[0]) rpcs.set(id, p.rpcUrls[0]);
          current = id;
          return { result: null, chainChanged: `0x${id.toString(16)}` };
        }
        case 'wallet_revokePermissions':
          return { result: null };
        case 'personal_sign': {
          const [data, from] = params ?? [];
          if (String(from).toLowerCase() !== account.address.toLowerCase()) throw fail(4100, 'unknown account');
          return { result: await account.signMessage({ message: { raw: data } }) };
        }
        case 'eth_sendTransaction': {
          if (!allowTransactions) throw fail(4001, 'User rejected the request (dev wallet refuses transactions).');
          const url = rpc();
          if (!url) throw fail(4900, `no RPC for chain ${current}`);
          const chain = defineChain({ id: current, name: `chain ${current}`, nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: [url] } } });
          const wallet = createWalletClient({ account, chain, transport: http(url) });
          const tx = params?.[0] ?? {};
          const hash = await wallet.sendTransaction({
            to: tx.to ?? undefined,
            data: tx.data ?? tx.input ?? undefined,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
          return { result: hash };
        }
        default:
          return { result: await forward(method, params) };
      }
    } catch (e) {
      return { error: { code: e.code ?? -32603, message: e.message ?? String(e) } };
    }
  });

  await ctx.addInitScript(
    ({ address, icon, rdns, autoConnect }) => {
      if (autoConnect) localStorage.setItem('elymum.wallet.v1', rdns);
      const listeners = {};
      const emit = (ev, v) => (listeners[ev] ?? []).forEach((l) => l(v));
      const provider = {
        isDevWallet: true,
        async request({ method, params }) {
          const r = await window.__elymumWalletRequest(method, params ?? []);
          if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
          if (r.chainChanged) setTimeout(() => emit('chainChanged', r.chainChanged), 0);
          return r.result;
        },
        on(ev, l) {
          (listeners[ev] ??= []).push(l);
          return provider;
        },
        removeListener(ev, l) {
          listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== l);
          return provider;
        },
      };
      const info = Object.freeze({ uuid: crypto.randomUUID(), name: 'Dev Wallet', icon, rdns });
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
      window.__elymumDevWallet = { address, provider };
    },
    { address: account.address, icon: ICON, rdns: DEV_WALLET_RDNS, autoConnect },
  );
  return { address: account.address, account };
}

/**
 * Signs in the page's game session over the WebSocket (SIWE): the nonce from the server, the
 * signature from the local account. The page must expose `window.__elymum` (dev builds).
 */
export async function signInGame(page, base, account) {
  const res = await fetch(`${base.replace(/\/$/, '')}/api/auth/nonce?address=${account.address}`);
  const { message } = await res.json();
  const signature = await account.signMessage({ message });
  await page.evaluate(([a, m, s]) => window.__elymum.engine.authSignature(a, m, s), [account.address, message, signature]);
  await page.waitForFunction(() => !!window.__elymum.useUi.getState().auth, null, { timeout: 10000 });
}

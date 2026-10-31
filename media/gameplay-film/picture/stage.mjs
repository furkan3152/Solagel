// Staging for the film's /mint beat. The dev fake chain has no NFT contract, so the take (and
// its replay) stand one up around the real mint page: the site API answers a live public mint
// (`/api/site/mint`), a tiny JSON-RPC (Node) plays the contract for the Dev Wallet (mintState,
// mintedBy, the mint transaction and its receipt with the ERC-721 Transfer log), and the minted
// emblem's image is the server's own `emblemSvg`. Everything is deterministic, so the replay
// (which runs the same wallet calls again) sees the same answers.
import http from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, importSdk, viem } from '../../../scripts/lib/common.mjs';

export const NFT = '0x00000000000000000000000000000000000e1a11';
export const CHAIN_ID = 31337;
/** HYPE/USD the take shows (fixed so the replay matches). */
export const HYPE_USD = 31.25;
export const PRICE_WEI = 32000000000000000n; // 0.032 HYPE = $1.00 at 31.25
export const MINTED_BEFORE = 411; // the counter on the card
export const MAX_SUPPLY = 3333;

let svgFn = null;
async function emblemSvg(id) {
  if (!svgFn) {
    const req = (await import('node:module')).createRequire(join(ROOT, 'apps/server/package.json'));
    const api = req.resolve('tsx/esm/api').replace(/index\.cjs$/, 'index.mjs');
    const { tsImport } = await import(pathToFileURL(api).href);
    svgFn = (await tsImport(join(ROOT, 'apps/server/src/site/emblem.ts'), import.meta.url)).emblemSvg;
  }
  return svgFn(id);
}

export function mintStateBody(totalSupply = MINTED_BEFORE) {
  return {
    nftAddress: NFT,
    chainId: CHAIN_ID,
    contract: {
      phase: 'public', priceWei: PRICE_WEI.toString(), minPriceWei: (PRICE_WEI / 2n).toString(), maxPriceWei: (PRICE_WEI * 4n).toString(),
      keeper: '0x0000000000000000000000000000000000000000', merkleRoot: '0x' + '0'.repeat(64),
      maxSupply: MAX_SUPPLY, totalSupply, wlLimit: 2, publicLimit: 5,
      treasury: '0x00000000000000000000000000000000000e1a12', frozen: false,
    },
    hypeUsd: HYPE_USD,
    priceUsd: Number(PRICE_WEI) / 1e18 * HYPE_USD,
    targetUsdCents: 100,
    holders: 268,
    soldOut: false,
    gameAccess: 'public',
  };
}

/** Routes of a browser context: the live mint state and the emblem images. */
export async function stageRoutes(ctx) {
  await ctx.route('**/api/site/mint', (r) => r.fulfill({ json: mintStateBody() }));
  await ctx.route(/\/api\/nft\/(\d+)\.svg/, async (r) => {
    const id = Number(new URL(r.request().url()).pathname.match(/(\d+)\.svg/)[1]);
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: await emblemSvg(id) });
  });
}

/** The fake NFT chain for the Dev Wallet (`rpcUrl`). Returns { url, close }. */
export async function startFakeRpc() {
  const sdk = await importSdk();
  const abi = sdk.elymumNFTAbi;
  const v = viem();
  const minted = new Map(); // tx hash -> { from, qty }
  let supply = MINTED_BEFORE;
  const block = (n) => ({
    number: v.toHex(n), hash: v.keccak256(v.toHex(n)), parentHash: '0x' + '0'.repeat(64), timestamp: v.toHex(1_790_000_000 + n), baseFeePerGas: '0x3b9aca00',
    gasLimit: '0x1c9c380', gasUsed: '0x0', miner: '0x' + '0'.repeat(40), extraData: '0x', logsBloom: '0x' + '0'.repeat(512), transactions: [], difficulty: '0x0', nonce: '0x0000000000000000', sha3Uncles: '0x' + '0'.repeat(64), size: '0x0', stateRoot: '0x' + '0'.repeat(64), receiptsRoot: '0x' + '0'.repeat(64), transactionsRoot: '0x' + '0'.repeat(64), mixHash: '0x' + '0'.repeat(64), totalDifficulty: '0x0', uncles: [],
  });
  const handle = (method, params) => {
    switch (method) {
      case 'eth_chainId': return v.toHex(CHAIN_ID);
      case 'net_version': return String(CHAIN_ID);
      case 'eth_blockNumber': return v.toHex(1000);
      case 'eth_getBlockByNumber': return block(1000);
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
      case 'eth_feeHistory': return { oldestBlock: v.toHex(999), baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'], gasUsedRatio: [0.5], reward: [['0x3b9aca00']] };
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_estimateGas': return v.toHex(180000);
      case 'eth_getBalance': return v.toHex(42n * 10n ** 17n);
      case 'eth_getCode': return '0x60016000';
      case 'eth_call': {
        const { to, data } = params[0];
        if (!to || to.toLowerCase() !== NFT.toLowerCase()) return '0x';
        const { functionName } = v.decodeFunctionData({ abi, data });
        if (functionName === 'mintState') return v.encodeFunctionResult({ abi, functionName, result: { phase: 2, price: PRICE_WEI, minPrice: PRICE_WEI / 2n, maxPrice: PRICE_WEI * 4n, keeper: v.zeroAddress, root: '0x' + '0'.repeat(64), maxSupply: MAX_SUPPLY, totalSupply: supply, wlLimit: 2, publicLimit: 5, treasury: '0x00000000000000000000000000000000000e1a12', frozen: false } });
        if (functionName === 'mintedBy') return v.encodeFunctionResult({ abi, functionName, result: [0, 0] });
        if (functionName === 'balanceOf') return v.encodeFunctionResult({ abi, functionName, result: 0n });
        return '0x';
      }
      case 'eth_sendRawTransaction': {
        const raw = params[0];
        const hash = v.keccak256(raw);
        const tx = v.parseTransaction(raw);
        const from = v.recoverTransactionAddress ? null : null;
        const { args } = v.decodeFunctionData({ abi, data: tx.data });
        minted.set(hash, { qty: Number(args[0]), raw });
        return hash;
      }
      case 'eth_getTransactionByHash': return null;
      case 'eth_getTransactionReceipt': {
        const m = minted.get(params[0]);
        if (!m) return null;
        return m.receipt;
      }
      default: throw Object.assign(new Error(`fake rpc: ${method} unsupported`), { code: -32601 });
    }
  };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      const one = async (q) => {
        try {
          if (q.method === 'eth_sendRawTransaction') {
            const out = handle(q.method, q.params);
            const m = minted.get(out);
            const tx = v.parseTransaction(m.raw);
            const from = await v.recoverTransactionAddress({ serializedTransaction: m.raw });
            const ids = Array.from({ length: m.qty }, (_, i) => BigInt(supply + 1 + i));
            supply += m.qty;
            const logs = ids.map((id, i) => ({
              address: NFT, topics: v.encodeEventTopics({ abi, eventName: 'Transfer', args: { from: v.zeroAddress, to: from, tokenId: id } }), data: '0x',
              blockNumber: v.toHex(1001), blockHash: v.keccak256('0x01'), transactionHash: out, transactionIndex: '0x0', logIndex: v.toHex(i), removed: false,
            }));
            m.receipt = { transactionHash: out, transactionIndex: '0x0', blockHash: v.keccak256('0x01'), blockNumber: v.toHex(1001), from, to: tx.to, cumulativeGasUsed: v.toHex(150000), gasUsed: v.toHex(150000), effectiveGasPrice: '0x3b9aca00', contractAddress: null, logs, logsBloom: '0x' + '0'.repeat(512), status: '0x1', type: '0x2' };
            return { jsonrpc: '2.0', id: q.id, result: out };
          }
          return { jsonrpc: '2.0', id: q.id, result: handle(q.method, q.params) };
        } catch (e) {
          return { jsonrpc: '2.0', id: q.id, error: { code: e.code ?? -32603, message: e.message } };
        }
      };
      const q = JSON.parse(body || '{}');
      const out = Array.isArray(q) ? await Promise.all(q.map(one)) : await one(q);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out, (_k, x) => (typeof x === 'bigint' ? v.toHex(x) : x)));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close(), reset: () => { supply = MINTED_BEFORE; minted.clear(); } };
}

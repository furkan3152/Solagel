import { CONTRACT_KINDS, isMainnet, type FaucetConfig, type NetworkContractCheck, type NetworkInfo } from '@elymum/shared';
import type { Address } from 'viem';
import { withTimeout } from '../chain/evm-client';
import { isTestChain, storedChains } from '../chain/state-dir';
import type { ChainGateway } from '../chain/types';
import type { ContractsStore } from './contracts';

const RPC_CHECK_TIMEOUT_MS = 10_000;
const FAUCET_TTL_MS = 60_000;

/** `GET /api/admin/network`: the chain, RPC health, the server key and the chain-keyed state. */
export async function networkInfo(d: { chain: ChainGateway; contracts: ContractsStore | null; dataDir: string | null }): Promise<NetworkInfo> {
  const status = d.chain.status();
  const client = d.chain.evm?.() ?? null;
  const key = d.chain.serverInfo();
  let rpcOk = false;
  let rpcLatencyMs: number | null = null;
  let block: string | null = null;
  if (client) {
    const t0 = performance.now();
    try {
      block = (await withTimeout(client.blockNumber(), RPC_CHECK_TIMEOUT_MS, 'eth_blockNumber')).toString();
      rpcOk = true;
      rpcLatencyMs = Math.round(performance.now() - t0);
    } catch {
      rpcOk = false;
    }
  }
  const contracts: NetworkContractCheck[] = [];
  const registry = d.contracts?.effective(status.chainId) ?? null;
  if (registry) {
    for (const kind of CONTRACT_KINDS) {
      const r = registry[kind];
      if (!r) continue;
      const code = client && rpcOk ? await withTimeout(client.codeCheck(r.address as Address, kind), RPC_CHECK_TIMEOUT_MS, 'eth_getCode').catch(() => null) : null;
      contracts.push({ kind, address: r.address, code, registeredBy: r.registeredBy });
    }
  }
  const chainId = status.chainId;
  return {
    chainId,
    chainName: status.chainName,
    testnet: chainId !== null && !isMainnet(chainId),
    rpcOk,
    rpcLatencyMs,
    block,
    serverKey: key.address,
    serverBalanceWei: key.balanceWei,
    low: key.low,
    contracts,
    otherChains: d.dataDir ? storedChains(d.dataDir).filter((id) => id !== chainId) : [],
  };
}

/**
 * `GET /api/site/faucet`: the TestToken faucet settings for the web's `/faucet` page. Enabled on a test
 * chain with a registered TestToken; the settings are read from the token (cached 60 s).
 */
export class FaucetInfo {
  private cache: { token: string; at: number; value: FaucetConfig } | null = null;

  constructor(
    private readonly d: { chain: ChainGateway; contracts: ContractsStore | null; hypeFaucetUrl: string; now?: () => number },
  ) {}

  async get(): Promise<FaucetConfig> {
    const now = this.d.now?.() ?? Date.now();
    const chainId = this.d.chain.status().chainId;
    const token = this.d.contracts?.effective(chainId).token?.address ?? null;
    const base: FaucetConfig = {
      enabled: isTestChain(chainId) && token !== null,
      chainId,
      token,
      decimals: 18,
      amount: null,
      holderAmount: null,
      cooldownSecs: null,
      holderNft: null,
      hypeFaucetUrl: this.d.hypeFaucetUrl,
    };
    if (!base.enabled) return base;
    const c = this.cache;
    if (c && c.token === token && now - c.at < FAUCET_TTL_MS) return { ...c.value };
    const client = this.d.chain.evm?.() ?? null;
    if (!client) return base;
    try {
      const f = await withTimeout(client.testTokenFaucet(token as Address), RPC_CHECK_TIMEOUT_MS, 'faucet settings');
      const value: FaucetConfig = { ...base, amount: f.amount.toString(), holderAmount: f.holderAmount.toString(), cooldownSecs: f.cooldownSecs, holderNft: f.holderNft };
      this.cache = { token: token!, at: now, value };
      return { ...value };
    } catch {
      // the chain is slow or the token is not the TestToken: the page still shows what is known
      return c && c.token === token ? { ...c.value } : base;
    }
  }
}

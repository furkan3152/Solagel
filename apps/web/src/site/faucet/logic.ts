import type { ContractsRegistry, FaucetConfig } from '@elymum/shared';
import type { TestTokenFaucetConfig } from '@elymum/sdk';

/** Kinetiq's HYPE faucet for Elysium Testnet gas. */
export const HYPE_FAUCET_URL = 'https://elysium.kinetiq.xyz/testnet-faucet';

/** The display symbol of the faucet token. */
export const TEST_SYMBOL_DEFAULT = 'tELYMUM';

/** What the faucet page shows, in order of precedence (pure, tested). */
export type FaucetView =
  /** The server's chain is not known yet. */
  | 'loading'
  /** No chain, or the server is not answering. */
  | 'offline'
  /** Mainnet: there are no test tokens. */
  | 'mainnet'
  /** Testnet, but no TestToken is registered (or its faucet cannot be read). */
  | 'no-token'
  /** Ready: connect, then claim. */
  | 'ready';

export function faucetView(i: { chain: 'loading' | 'off' | 'mainnet' | 'testnet'; token: string | null; tokenUnreadable?: boolean }): FaucetView {
  if (i.chain === 'loading') return 'loading';
  if (i.chain === 'off') return 'offline';
  if (i.chain === 'mainnet') return 'mainnet';
  if (!i.token || i.tokenUnreadable) return 'no-token';
  return 'ready';
}

/**
 * The faucet token: the registered TestToken (`/api/site/contracts`, kind `token`), else the
 * arena's game token on a testnet (the page then checks it really has a faucet).
 */
export function faucetTokenAddress(registry: ContractsRegistry | null, gameToken: string | null | undefined): string | null {
  return registry?.token?.address ?? gameToken ?? null;
}

/** "59:07", "1:02:03" for a countdown. */
export function formatWait(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Whole tokens with thousands separators (`1000000000000000000000000n`, 18 → "1,000,000"). */
export function wholeTokens(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(Math.max(0, decimals));
  return (raw / unit).toLocaleString('en-US');
}

/** The holder bonus multiple (2 for 2,000,000 vs 1,000,000); null when there is no bonus. */
export function holderMultiple(cfg: { amount: bigint; holderAmount: bigint; holderNft: string | null } | null): number | null {
  if (!cfg || !cfg.holderNft || cfg.amount <= 0n || cfg.holderAmount <= cfg.amount) return null;
  const x = Number((cfg.holderAmount * 10n) / cfg.amount) / 10;
  return Number.isFinite(x) ? x : null;
}

/** `wallet_watchAsset` params for the faucet token (EIP-747). */
export function watchAssetParams(address: string, symbol: string, decimals: number) {
  // wallets refuse symbols over 11 characters
  return { type: 'ERC20' as const, options: { address, symbol: symbol.slice(0, 11), decimals } };
}

/** The faucet settings the server published (`GET /api/site/faucet`) as the SDK shape; null when it has no amounts. */
export function servedConfig(f: FaucetConfig | null | undefined, token: string): TestTokenFaucetConfig | null {
  if (!f || !f.enabled || !f.token || f.amount === null || f.holderAmount === null || f.cooldownSecs === null) return null;
  try {
    return {
      address: token as `0x${string}`,
      owner: token as `0x${string}`,
      amount: BigInt(f.amount),
      holderAmount: BigInt(f.holderAmount),
      cooldownSecs: f.cooldownSecs,
      holderNft: (f.holderNft as `0x${string}` | null) ?? null,
    };
  } catch {
    return null;
  }
}

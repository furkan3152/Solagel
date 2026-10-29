import type { ChainStatus } from '@elymum/shared';
import { getAddress, type Address } from 'viem';
import type { Eip1193Provider, ProviderDetail } from '../src/wallet/eip6963';

/** A server chain status on the Elysium testnet (overrides merged in). */
export function chainStatus(over: Partial<ChainStatus> = {}): ChainStatus {
  return {
    enabled: true,
    chainId: 99801,
    chainName: 'Elysium Testnet',
    rpcUrl: 'https://testnet-rpc.elysium.kinetiq.xyz',
    explorerUrl: 'https://explorer-elysium-testnet.t.conduit.xyz',
    arenaAddress: '0x00000000000000000000000000000000000a4e4a',
    nftAddress: null,
    arenasEnabled: true,
    tokenReady: true,
    token: { address: '0x0000000000000000000000000000000000007e57', symbol: '$ELYMUM', decimals: 18 },
    feeBps: 500,
    serverKey: '0x000000000000000000000000000000000000beef',
    ...over,
  };
}

export const ALICE = getAddress('0x1111111111111111111111111111111111111111');
export const BOB = getAddress('0x2222222222222222222222222222222222222222');

/** One whole 18-decimal token. */
export const ONE = 10n ** 18n;

export interface FakeProvider extends Eip1193Provider {
  calls: { method: string; params?: unknown }[];
  chainId: number;
  accounts: Address[];
  /** Known chains (`wallet_switchEthereumChain` to anything else answers 4902). */
  known: Set<number>;
  emit(event: string, value: unknown): void;
  /** Per-method overrides (return a value or throw). */
  handlers: Record<string, (params: unknown) => unknown>;
}

/** A scriptable EIP-1193 provider: records calls, knows some chains, emits events. */
export function fakeProvider(opts: { accounts?: Address[]; chainId?: number; known?: number[] } = {}): FakeProvider {
  const listeners: Record<string, ((v: unknown) => void)[]> = {};
  const p: FakeProvider = {
    calls: [],
    chainId: opts.chainId ?? 1,
    accounts: opts.accounts ?? [ALICE],
    known: new Set(opts.known ?? [1]),
    handlers: {},
    emit(event, value) {
      (listeners[event] ?? []).forEach((l) => l(value));
    },
    async request({ method, params }) {
      p.calls.push({ method, params });
      if (p.handlers[method]) return p.handlers[method](params);
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return p.accounts;
        case 'eth_chainId':
          return `0x${p.chainId.toString(16)}`;
        case 'wallet_switchEthereumChain': {
          const id = Number.parseInt((params as { chainId: string }[])[0].chainId, 16);
          if (!p.known.has(id)) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
          p.chainId = id;
          p.emit('chainChanged', `0x${id.toString(16)}`);
          return null;
        }
        case 'wallet_addEthereumChain': {
          const id = Number.parseInt((params as { chainId: string }[])[0].chainId, 16);
          p.known.add(id);
          return null;
        }
        case 'wallet_revokePermissions':
          return null;
        case 'personal_sign':
          return `0x${'11'.repeat(65)}`;
        default:
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    },
    on(event, l) {
      (listeners[event] ??= []).push(l as (v: unknown) => void);
    },
    removeListener(event, l) {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== (l as unknown));
    },
  };
  return p;
}

export const detail = (provider: Eip1193Provider, name = 'Test Wallet', rdns = 'test.wallet'): ProviderDetail => ({
  info: { uuid: `uuid-${rdns}`, name, icon: 'data:image/svg+xml,<svg/>', rdns },
  provider,
});

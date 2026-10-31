import { DEFAULT_FEE_BPS, type ArenaConfig, type SessionInfo } from '@elymum/sdk';
import type { ChainStatus } from '@elymum/shared';
import type { Address, Hash } from 'viem';
import { DEV_FAKE_ARENA_ADDRESS } from './devFakeLoader';
import type { TicketStep } from './ticket';
import type { TxPhase } from './tx';

/**
 * DEV ONLY. The game server's `DEV_FAKE_CHAIN=1` mode advertises `DEV_FAKE_ARENA_ADDRESS` and
 * hands every signed-in wallet free tickets. When the web dev build sees it, the lobby reads a
 * local stand-in for the chain (balances, allowance, open tickets) and "sends" ticket
 * transactions by waiting, so the whole lobby and ticket flow can be driven (and screenshot)
 * without a node or a wallet that sends transactions. The game token follows the server: unset
 * until `DEV_FAKE_TOKEN=1` or `POST /api/dev/token` (then the server pushes `chain`). Production
 * builds never enter this path (`import.meta.env.DEV` is false there).
 */

export interface FakeWallet {
  /** Game-token balance, base units of an 18-decimal token. */
  tokenBalance: bigint;
  /** HYPE, wei. */
  wei: bigint;
  /** Allowance granted to the arena, base units. */
  allowance: bigint;
  sessions: Record<number, SessionInfo | null>;
  /** The next settled payout is "finalized" instead of paid (the collect flow, for screenshots). */
  failPayouts: boolean;
  /** Simulated wallet + network delay per phase (ms). */
  delayMs: number;
  /** Next "transaction" fails with this SDK error name (e.g. `ArenaFull`), then clears. */
  failNext: string | null;
}

const ONE = 10n ** 18n;

export const fakeWallet: FakeWallet = {
  tokenBalance: 12_450n * ONE,
  wei: 42n * 10n ** 16n,
  allowance: 0n,
  sessions: {},
  failPayouts: false,
  delayMs: 900,
  failNext: null,
};

/** The config the fake chain stands for: the token as the server reports it (unset until it is set). */
export function fakeConfig(chain: ChainStatus): ArenaConfig {
  const token = chain.tokenReady ? chain.token : null;
  const addr = DEV_FAKE_ARENA_ADDRESS as Address;
  return {
    address: addr,
    admin: addr,
    pendingAdmin: null,
    serverAuthority: (chain.serverKey as Address | null) ?? addr,
    feeWallet: addr,
    token: (token?.address as Address | undefined) ?? null,
    decimals: token?.decimals ?? 18,
    feeBps: chain.feeBps ?? DEFAULT_FEE_BPS,
    paused: false,
    totals: { sessions: 0n, games: 0n, staked: 0n, paidOut: 0n, fees: 0n, burned: 0n },
    holderNft: null,
    holderFeeBps: chain.feeBps ?? DEFAULT_FEE_BPS,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeHash = (): Hash => `0x${'de7fa4e0'.padEnd(56, '0')}${Date.now().toString(16).padStart(8, '0').slice(-8)}` as Hash;
/** Fake hashes never get explorer links. */
export const isFakeHash = (h: string | null | undefined): boolean => !!h && h.startsWith('0xde7fa4e0');

let nextSession = 1n;

/** "Signs" and "confirms" a ticket (approve if needed, then join): applies its effects to the fake wallet. */
export async function fakeSendTicket(
  owner: Address,
  arenaId: number,
  entryFee: bigint,
  steps: readonly TicketStep[],
  feeBps: number,
  onPhase: (step: TicketStep, phase: TxPhase, hash?: Hash) => void,
): Promise<{ ok: true; hash: Hash } | { ok: false; name: string }> {
  let last: Hash = fakeHash();
  for (const step of steps) {
    onPhase(step, 'signing');
    await sleep(fakeWallet.delayMs);
    if (fakeWallet.failNext) {
      const name = fakeWallet.failNext;
      fakeWallet.failNext = null;
      return { ok: false, name };
    }
    last = fakeHash();
    onPhase(step, 'confirming', last);
    await sleep(fakeWallet.delayMs);
    if (step === 'approve') fakeWallet.allowance = entryFee;
  }
  fakeWallet.tokenBalance -= entryFee;
  fakeWallet.allowance = 0n;
  fakeWallet.sessions[arenaId] = {
    arenaId,
    player: owner,
    id: nextSession++,
    entryFee,
    openedAt: Math.floor(Date.now() / 1000),
    feeBps,
    finalized: false,
    owed: 0n,
  };
  return { ok: true, hash: last };
}

/** Simulated refund / collect transaction (`apply` moves the fake tokens). */
export async function fakeSimpleTx(onPhase: (p: TxPhase) => void, apply: () => void): Promise<boolean> {
  onPhase('signing');
  await sleep(fakeWallet.delayMs);
  onPhase('confirming');
  await sleep(fakeWallet.delayMs);
  apply();
  return true;
}

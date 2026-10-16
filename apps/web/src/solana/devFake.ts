import { DEFAULT_FEE_BPS, TOKEN_PROGRAM_ID, type ConfigView, type ProfileView, type SessionView } from '@slana/sdk';
import type { ChainStatus } from '@slana/shared';
import { DEV_FAKE_PROGRAM_ID } from './devFakeLoader';
import type { TicketStep } from './ticket';

/**
 * DEV ONLY. The game server's `DEV_FAKE_CHAIN=1` mode advertises this program
 * id and hands every signed-in wallet free tickets. When the web dev build sees
 * it, the lobby reads a local stand-in for the chain (balance, profile, open
 * tickets) and "sends" ticket transactions by waiting, so the whole lobby and
 * ticket flow can be driven (and screenshot) without a validator or a wallet
 * that signs transactions. The game token follows the server: unset until
 * `DEV_FAKE_TOKEN=1` or `POST /api/dev/token` (then the server pushes `chain`). Production builds never enter this path
 * (`import.meta.env.DEV` is false there).
 */

const TOKEN = 1_000_000n; // 6 decimals, like the fake server mint

export interface FakeWallet {
  tokenBalance: bigint;
  lamports: number;
  profile: ProfileView | null;
  sessions: Record<number, SessionView | null>;
  /** The wallet's game-token account exists. False: a settled game is finalized and waits to be collected (R24 screenshots). */
  ataExists: boolean;
  /** Simulated wallet + network delay per phase (ms). */
  delayMs: number;
  /** Next "transaction" fails with this SDK error name (e.g. `FeeAboveLimit`), then clears. */
  failNext: string | null;
}

export const fakeWallet: FakeWallet = {
  tokenBalance: 12_450n * TOKEN,
  lamports: 420_000_000,
  profile: null,
  sessions: {},
  ataExists: true,
  delayMs: 900,
  failNext: null,
};

/** The config the fake chain stands for: the token as the server reports it (unset until it is set). */
export function fakeConfig(chain: ChainStatus): ConfigView {
  const token = chain.tokenReady ? chain.token : null;
  return {
    admin: DEV_FAKE_PROGRAM_ID,
    serverAuthority: DEV_FAKE_PROGRAM_ID,
    feeWallet: DEV_FAKE_PROGRAM_ID,
    tokenMint: token?.mint ?? null,
    tokenProgram: token ? TOKEN_PROGRAM_ID.toBase58() : null,
    tokenDecimals: token?.decimals ?? 0,
    feeBps: chain.feeBps ?? DEFAULT_FEE_BPS,
    settleFeeLamports: 20_000,
    paused: false,
    totals: { players: 0, games: 0, sessions: 0, staked: 0n, paidOut: 0n },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Signs" and "confirms" a ticket: applies its effects to the fake wallet. */
export async function fakeSendTicket(
  owner: string,
  arenaId: number,
  entryFee: bigint,
  steps: TicketStep[],
  register: { name: string; skin: number } | null,
  feeBps: number,
  onPhase: (p: 'signing' | 'confirming', sig?: string) => void,
): Promise<{ ok: true; signature: string } | { ok: false; name: string }> {
  onPhase('signing');
  await sleep(fakeWallet.delayMs);
  if (fakeWallet.failNext) {
    const name = fakeWallet.failNext;
    fakeWallet.failNext = null;
    return { ok: false, name };
  }
  const signature = `DevFakeSig${Date.now().toString(36)}`;
  onPhase('confirming', signature);
  await sleep(fakeWallet.delayMs);
  fakeWallet.tokenBalance -= entryFee;
  if (steps.includes('register') && register) {
    fakeWallet.profile = {
      address: `DevProfile${owner.slice(0, 8)}`,
      owner,
      name: register.name,
      skin: register.skin,
      xp: 0,
      level: 1,
      gamesPlayed: 0,
      kills: 0,
      bestScore: 0,
      totalScore: 0,
      stakeGames: 0,
      totalStaked: 0n,
      totalWon: 0n,
      createdAt: Math.floor(Date.now() / 1000),
      lastPlayed: 0,
    };
  }
  fakeWallet.sessions[arenaId] = {
    address: `DevLocalSession${arenaId}`,
    id: Date.now(),
    player: owner,
    arena: `DevArena${arenaId}`,
    arenaId,
    entryFee,
    openedAt: Math.floor(Date.now() / 1000),
    settleFee: 20_000,
    feeBps,
    finalized: false,
    owed: 0n,
  };
  return { ok: true, signature };
}

/** Simulated collect / refund transaction (`apply` moves the fake tokens). */
export async function fakeSimpleTx(onPhase: (p: 'signing' | 'confirming') => void, apply: () => void): Promise<boolean> {
  onPhase('signing');
  await sleep(fakeWallet.delayMs);
  onPhase('confirming');
  await sleep(fakeWallet.delayMs);
  apply();
  return true;
}

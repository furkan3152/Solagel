import { TOKEN_PROGRAM_ID, type ConfigView, type ProfileView, type SessionView } from '@slana/sdk';
import type { ChainStatus } from '@slana/shared';
import type { TicketStep } from './ticket';

/**
 * DEV ONLY. The game server's `DEV_FAKE_CHAIN=1` mode advertises this program
 * id and hands every signed-in wallet free tickets. When the web dev build sees
 * it, the lobby reads a local stand-in for the chain (balance, profile, open
 * tickets) and "sends" ticket transactions by waiting, so the whole lobby and
 * ticket flow can be driven (and screenshot) without a validator or a wallet
 * that signs transactions. Production builds never enter this path
 * (`import.meta.env.DEV` is false there).
 */
export const DEV_FAKE_PROGRAM_ID = 'DevFakeChain1111111111111111111111111111111';

export function isDevFake(chain: ChainStatus | null): boolean {
  return import.meta.env.DEV && chain?.programId === DEV_FAKE_PROGRAM_ID;
}

const TOKEN = 1_000_000n; // 6 decimals, like the fake server mint

export interface FakeWallet {
  tokenBalance: bigint;
  lamports: number;
  profile: ProfileView | null;
  sessions: Record<number, SessionView | null>;
  /** Simulated wallet + network delay per phase (ms). */
  delayMs: number;
  /** Next "transaction" fails with this SDK error name (e.g. `PassInUse`), then clears. */
  failNext: string | null;
}

export const fakeWallet: FakeWallet = {
  tokenBalance: 12_450n * TOKEN,
  lamports: 420_000_000,
  profile: null,
  sessions: {},
  delayMs: 900,
  failNext: null,
};

export function fakeConfig(chain: ChainStatus): ConfigView {
  return {
    admin: DEV_FAKE_PROGRAM_ID,
    serverAuthority: DEV_FAKE_PROGRAM_ID,
    tokenMint: chain.token?.mint ?? DEV_FAKE_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    tokenDecimals: chain.token?.decimals ?? 6,
    feeBps: 500,
    passFeeBps: 200,
    treasuryBps: 5000,
    seasonBps: 3000,
    burnBps: 2000,
    settleFeeLamports: 50_000,
    currentSeason: chain.currentSeason ?? 1,
    paused: false,
    passCollection: chain.pass?.collection ?? null,
    passBaseUri: '',
    passSupply: chain.pass?.supply ?? 0,
    passMinted: chain.pass?.minted ?? 0,
    passPerWallet: chain.pass?.perWallet ?? 1,
    passMinTokens: 0n,
    passMintOpen: chain.pass?.mintOpen ?? false,
    passMintStartTs: 0,
    passSeedHash: null,
    passSeed: chain.pass?.seed ?? null,
    passRevealed: chain.pass?.revealed ?? false,
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
  passAsset: string | null,
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
      season: 1,
      seasonPoints: 0,
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
    hasPass: passAsset !== null,
    passAsset,
    settleFee: 50_000,
  };
  return { ok: true, signature };
}

/** Simulated R10 account creation / refund (no token movement besides the refund). */
export async function fakeSimpleTx(onPhase: (p: 'signing' | 'confirming') => void, apply: () => void): Promise<boolean> {
  onPhase('signing');
  await sleep(fakeWallet.delayMs);
  onPhase('confirming');
  await sleep(fakeWallet.delayMs);
  apply();
  return true;
}

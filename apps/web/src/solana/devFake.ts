import { TOKEN_PROGRAM_ID, type ConfigView, type OwnedPass, type ProfileView, type SessionView } from '@slana/sdk';
import type { ChainStatus, PassStatus } from '@slana/shared';
import { SERVER } from '../config';
import { useUi } from '../store';
import { refreshChain, type SeasonInfo } from './chain';
import { DEV_FAKE_PROGRAM_ID } from './devFakeLoader';
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
  /** Next "transaction" fails with this SDK error name (e.g. `PassInUse`), then clears. */
  failNext: string | null;
  /** Passes in the wallet; null = the server's dev-fake answer (what this wallet minted there, or one revealed Pass with `DEV_FAKE_PASS=revealed`). */
  passes: OwnedPass[] | null;
  /** Passes this wallet minted (its `MintCounter`). */
  minted: number;
  /** Overrides of the collection state (sealed / mint not started / sold out screenshots). */
  pass: Partial<PassStatus> | null;
  /** Prize ranks of the previous season this wallet claimed here. */
  claimed: number[];
}

export const fakeWallet: FakeWallet = {
  tokenBalance: 12_450n * TOKEN,
  lamports: 420_000_000,
  profile: null,
  sessions: {},
  ataExists: true,
  delayMs: 900,
  failNext: null,
  passes: null,
  minted: 0,
  pass: null,
  claimed: [],
};

/** Mints made here (they raise the collection's minted count). */
let extraMinted = 0;

/** The server's dev-fake collection state with this page's overrides and mints applied. */
export function fakePassStatus(chain: ChainStatus): PassStatus | null {
  if (!chain.pass) return null;
  const s = { ...chain.pass, ...fakeWallet.pass };
  return { ...s, minted: Math.min(s.supply, s.minted + extraMinted), seed: s.revealed ? s.seed : null };
}

/** The season with the claims made here marked in the previous season's mask. */
export function fakeSeason(season: SeasonInfo | null, _owner: string | null): SeasonInfo | null {
  if (!season?.previous || fakeWallet.claimed.length === 0) return season;
  const mask = fakeWallet.claimed.reduce((m, r) => m | (1 << r), season.previous.claimedMask);
  return { ...season, previous: { ...season.previous, claimedMask: mask } };
}

export function fakeConfig(chain: ChainStatus, pass: PassStatus | null = chain.pass): ConfigView {
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
    settleFeeLamports: 20_000,
    currentSeason: chain.currentSeason ?? 1,
    paused: false,
    passCollection: pass?.collection ?? null,
    passBaseUri: 'http://localhost:8787/pass/',
    passSupply: pass?.supply ?? 0,
    passMinted: pass?.minted ?? 0,
    passPerWallet: pass?.perWallet ?? 1,
    passMinTokens: 0n,
    passMintOpen: pass?.mintOpen ?? false,
    passMintStartTs: pass?.mintStartTs ?? 0,
    passMintOpened: true,
    passMintEnded: pass ? !pass.mintOpen && pass.minted > 0 : false,
    // a committed seed (its hash), as on a live collection
    passSeedHash: 'c0'.repeat(32),
    // the fake publishes only a trait seed: it stands for the final seed
    passSeed: pass?.seed ?? null,
    passRevealed: pass?.revealed ?? false,
    passSeedRevealed: pass?.revealed ?? false,
    passEntropyTargetSlot: 0,
    passEntropyCaptured: !!pass && !pass.mintOpen && pass.minted > 0,
    passEntropy: pass && !pass.mintOpen && pass.minted > 0 ? 'e0'.repeat(32) : null,
    passEntropySlot: 0,
    passFinalSeed: pass?.revealed ? pass.seed : null,
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
    settleFee: 20_000,
    feeBps: passAsset !== null ? 200 : 500,
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

/** "Mints" a Pass: the next number goes into this wallet (sealed until the collection is revealed). */
export async function fakeMintPass(
  chain: ChainStatus,
  current: OwnedPass[],
  owner: string | null,
  onPhase: (p: 'signing' | 'confirming', sig?: string) => void,
): Promise<{ ok: true; signature: string; pass: OwnedPass } | { ok: false; name: string }> {
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
  // the server's fake chain records the mint, so its owned-Pass list, Pass arenas and reveal follow it
  const server = owner ? await serverMint(owner) : null;
  if (server && !server.ok) return { ok: false, name: server.error };
  fakeWallet.minted++;
  if (server?.ok) return { ok: true, signature, pass: server.pass };
  // an older server without the dev mint route: keep the mint on this page only
  const status = fakePassStatus(chain);
  const number = (status?.minted ?? 0) + 1;
  extraMinted++;
  const pass: OwnedPass = { asset: `DevMintedPass${number}`, number };
  fakeWallet.passes = [...(fakeWallet.passes ?? current), pass];
  return { ok: true, signature, pass };
}

async function serverMint(owner: string): Promise<{ ok: true; pass: OwnedPass } | { ok: false; error: string } | null> {
  try {
    const res = await fetch(`${SERVER.http}/api/dev/pass/mint?wallet=${owner}`, { method: 'POST' });
    if (res.status === 404) return null;
    return (await res.json()) as { ok: true; pass: OwnedPass } | { ok: false; error: string };
  } catch {
    return null;
  }
}

/**
 * DEV ONLY: publishes the fake collection's seed (the reveal) on the server and
 * here. From the console: `__slanaChain.revealPasses()`.
 */
export async function fakeRevealPasses(): Promise<PassStatus | null> {
  try {
    const res = await fetch(`${SERVER.http}/api/dev/pass/reveal`, { method: 'POST' });
    if (!res.ok) return null;
    const { pass } = (await res.json()) as { pass: PassStatus };
    const chain = useUi.getState().chain;
    if (chain) useUi.setState({ chain: { ...chain, pass } });
    refreshChain();
    return pass;
  } catch {
    return null;
  }
}

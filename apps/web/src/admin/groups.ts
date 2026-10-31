import { formatHypeAmount } from '@elymum/sdk';
import { testTokenRefusal, type StatusSnapshot } from '@elymum/sdk/ops';
import type { ContractsRegistry, GameAccess, SiteCounts, SiteSettings } from '@elymum/shared';
import type { AdminNetwork } from './net';
import { setupSteps } from './setup';

/**
 * The admin panel's drawers, few and grouped (the owner runs everything from here): Network,
 * Setup (deploy), Mint, Game, Community (WL, Tasks, Collabs), Safety (integrity), Settings.
 */
export type AdminGroup = 'network' | 'setup' | 'mint' | 'game' | 'community' | 'safety' | 'settings';
export const ADMIN_GROUPS: readonly AdminGroup[] = ['network', 'setup', 'mint', 'game', 'community', 'safety', 'settings'];

/** The chain drawers (status for everyone, writes for the contract owner). */
export const CHAIN_GROUPS: readonly AdminGroup[] = ['network', 'setup', 'mint', 'game'];

export type CommunityTab = 'wl' | 'tasks' | 'collabs';
export const COMMUNITY_TABS: readonly CommunityTab[] = ['wl', 'tasks', 'collabs'];

export const GROUP_LABEL: Record<AdminGroup, string> = {
  network: 'Network',
  setup: 'Setup',
  mint: 'Mint',
  game: 'Game',
  community: 'Community',
  safety: 'Safety',
  settings: 'Settings',
};

/** Where an old drawer id (and the launch checklist's links) now lives. */
const LEGACY: Record<string, { group: AdminGroup; sub?: CommunityTab }> = {
  launch: { group: 'network' },
  deploy: { group: 'setup' },
  arena: { group: 'game' },
  play: { group: 'game' },
  wl: { group: 'community', sub: 'wl' },
  tasks: { group: 'community', sub: 'tasks' },
  collabs: { group: 'community', sub: 'collabs' },
  integrity: { group: 'safety' },
};

/** `#community/tasks`, `#game`, old `#deploy`… → the drawer (and the Community sub-tab). Unknown → Network. */
export function parseAdminHash(hash: string): { group: AdminGroup; sub: CommunityTab } {
  const [head, tail] = hash.replace(/^#/, '').split('/');
  const legacy = LEGACY[head];
  if (legacy) return { group: legacy.group, sub: legacy.sub ?? 'wl' };
  const group = (ADMIN_GROUPS as readonly string[]).includes(head) ? (head as AdminGroup) : 'network';
  const sub = (COMMUNITY_TABS as readonly string[]).includes(tail) ? (tail as CommunityTab) : 'wl';
  return { group, sub };
}

export function adminHash(group: AdminGroup, sub: CommunityTab = 'wl'): string {
  if (group === 'network') return '';
  return group === 'community' && sub !== 'wl' ? `#community/${sub}` : `#${group}`;
}

/** A drawer's opening lines: what is true now, and the one next step. */
export interface GroupSummary {
  now: string;
  next: string | null;
}

export interface SummaryInput {
  net: AdminNetwork;
  status: StatusSnapshot | null;
  /** The server's registered contracts (the game token among them). */
  registry?: ContractsRegistry | null;
  settings?: SiteSettings | null;
  gameAccessEnv?: GameAccess | null;
  counts?: SiteCounts | null;
  bots?: { bots: number; humans: number; rooms: number } | null;
}

const ACCESS: Record<GameAccess, string> = { admins: 'admins only', holders: 'emblem holders', public: 'everyone' };

/**
 * "Status now / next step" for each drawer (pure, tested). The next step is always something only
 * the owner can do (deploy, Finish setup, open the mint, fund the server key): never "register" or
 * "paste an address", which the panel does by itself.
 */
export function groupSummary(group: AdminGroup, i: SummaryInput): GroupSummary {
  const { net, status } = i;
  const a = status?.arena ?? null;
  const cfg = a?.config ?? null;
  const nft = status?.nft?.state ?? null;
  const chain = net.info ? `${net.mainnet ? 'MAINNET' : 'Testnet'} · ${net.info.name} (${net.info.id})` : 'No chain';
  switch (group) {
    case 'network': {
      if (!net.chain) return { now: 'The game server is not answering.', next: 'Check the server on Render, then reload.' };
      if (!net.info) return { now: 'The server has no chain.', next: 'Set EVM_RPC_URL in Render and redeploy.' };
      const bal = a?.serverBalance ?? null;
      const now = `${chain}${status ? ` · block ${status.block.toString()}` : ''}${bal !== null ? ` · server key ${formatHypeAmount(bal, 4)}` : ''}`;
      if (bal === 0n) return { now, next: 'Fund the server key with HYPE: it pays the gas of every settlement.' };
      if (!net.mainnet) return { now, next: 'Mainnet launch: follow the checklist below, step by step.' };
      return { now, next: null };
    }
    case 'setup': {
      const parts = [`Arena ${net.arenaAddress ? (a?.code === 'ok' ? 'ok' : (a?.code ?? '…')) : 'missing'}`, `NFT ${net.nftAddress ? (status?.nft?.code === 'ok' ? 'ok' : (status?.nft?.code ?? '…')) : 'missing'}`];
      if (cfg) parts.push(`token ${cfg.token ? 'set' : 'not set'}`, `holder perks ${cfg.holderNft ? `on (${cfg.holderFeeBps} bps)` : 'off'}`);
      const now = parts.join(' · ');
      if (!net.arenaAddress) return { now, next: 'Deploy ElymumArena from the owner wallet (below).' };
      if (!net.nftAddress) return { now, next: 'Deploy ElymumNFT from the owner wallet (below).' };
      if (!cfg) return { now, next: null };
      const steps = setupSteps({ net, status }, { openMint: !net.mainnet });
      if (!cfg.token && !steps.some((s) => s.id === 'token')) {
        const known = i.registry?.token?.address ?? status?.testToken?.address ?? null;
        if (known) return { now, next: 'Confirm the game token (one click, then your wallet).' };
        if (net.info && !testTokenRefusal(net.info.id)) return { now, next: 'Deploy a TestToken (below), then Finish setup.' };
        return { now, next: 'Set TOKEN_ADDRESS on the game server (Render) to $ELYMUM, then confirm it here.' };
      }
      if (steps.length > 0) return { now, next: `Finish setup: ${steps.length} step${steps.length === 1 ? '' : 's'} left, one button.` };
      return { now, next: null };
    }
    case 'mint': {
      if (!net.nftAddress) return { now: 'No NFT registered yet.', next: 'Deploy ElymumNFT in Setup.' };
      if (!nft) return { now: 'Reading the NFT…', next: null };
      const now = `Phase ${nft.phaseName} · ${nft.totalSupply} / ${nft.maxSupply} minted`;
      if (nft.phaseName === 'closed') return { now, next: net.mainnet ? 'Build and publish the allowlist, then open the allowlist mint.' : 'Open the mint (testnet: Public).' };
      if (nft.phaseName === 'allowlist') return { now, next: 'Go Public when the allowlist has had its turn.' };
      return { now, next: nft.soldOut ? null : 'Watch the supply; withdraw the proceeds to the treasury.' };
    }
    case 'game': {
      const access = i.gameAccessEnv ?? i.settings?.gameAccess ?? null;
      const parts = [access ? `Open to ${ACCESS[access]}${i.gameAccessEnv ? ' (GAME_ACCESS env)' : ''}` : 'Access unknown (sign in)'];
      if (cfg) parts.push(cfg.paused ? 'arena PAUSED' : 'arena taking joins');
      if (i.bots) parts.push(`${i.bots.humans} people · ${i.bots.bots} bots in ${i.bots.rooms} rooms`);
      const now = parts.join(' · ');
      if (cfg?.paused) return { now, next: 'Unpause the arena when it is safe to take joins again.' };
      if (access === 'admins') return { now, next: net.mainnet ? 'Open the game to holders when the mint is live.' : 'Testnet: open the game to everyone.' };
      return { now, next: null };
    }
    case 'community': {
      const c = i.counts;
      if (!c) return { now: 'Sign in as the admin to see the queue.', next: null };
      const now = `WL ${c.wl.approved} approved · ${c.wl.pending} waiting · collabs ${c.collab.pending ?? 0} waiting`;
      if (c.wl.pending > 0) return { now, next: `Review the ${c.wl.pending} waiting WL entries.` };
      if ((c.collab.pending ?? 0) > 0) return { now, next: 'Answer the waiting collab applications.' };
      return { now, next: null };
    }
    case 'safety':
      return { now: 'Flags, bans and held settlements.', next: 'Scan after busy rounds; held payouts wait for a person.' };
    case 'settings': {
      const st = i.settings;
      if (!st) return { now: 'Sign in as the admin to see the switches.', next: null };
      return { now: `WL ${st.wlOpen ? 'open' : 'closed'} · collabs ${st.collabOpen ? 'open' : 'closed'} · @${st.xHandle}`, next: null };
    }
  }
}

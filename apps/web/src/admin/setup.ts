import { DEFAULT_HOLDER_FEE_BPS, DEFAULT_HOLDERS_ONLY_ARENA_IDS, createDefaultArenaCalls, sameAddress, setArenaHoldersOnlyCall, setHolderNftCall, setHolderPerksCall, setMinterCall, setPhaseCall, setTokenCall, type ContractCall } from '@elymum/sdk';
import { arenaName, type StatusSnapshot } from '@elymum/sdk/ops';
import type { Address } from 'viem';
import type { AdminNetwork } from './net';

/** One step of the setup: what it does, and the call the owner's wallet signs. */
export interface SetupStep {
  id: string;
  label: string;
  call: ContractCall;
}

/**
 * What is still missing for a playable chain, in order: the game token on the arena, the four
 * arenas, the server key as TestToken minter (bots), the emblem as the faucet's 2x and as the arena's
 * holder perk, the Isles as holders-only, and (testnet) the mint opened to the public. Steps already
 * done on chain are left out, so the button can be pressed again after an interruption.
 */
export function setupSteps(ctx: { status: StatusSnapshot | null; net: Pick<AdminNetwork, 'serverKey'> }, opts: { openMint: boolean }): SetupStep[] {
  const s = ctx.status;
  const arena = s?.arena?.address ?? null;
  const cfg = s?.arena?.config ?? null;
  const nft = s?.nft?.address ?? null;
  const tt = s?.testToken ?? null;
  const serverKey = (cfg?.serverAuthority ?? ctx.net.serverKey ?? null) as Address | null;
  const out: SetupStep[] = [];
  if (!arena || !cfg) return out;
  const token = (cfg.token ?? tt?.address ?? null) as Address | null;
  if (!cfg.token && tt?.address) out.push({ id: 'token', label: 'Set tELYMUM as the game token', call: setTokenCall(arena, tt.address) });
  if (token) {
    const decimals = s?.arena?.token?.decimals ?? 18;
    const existing = (s?.arena?.arenas ?? []).filter((a) => a.exists).map((a) => a.id);
    for (const call of createDefaultArenaCalls(arena, decimals, existing)) {
      const id = Number((call.args as readonly unknown[])[0]);
      out.push({ id: `arena-${id}`, label: `Create ${arenaName(id)}`, call });
    }
  }
  if (tt?.address && serverKey && tt.serverIsMinter !== true) out.push({ id: 'minter', label: 'Let the server key mint tELYMUM (testnet bots)', call: setMinterCall(tt.address, serverKey, true) });
  if (tt?.address && nft && !sameAddress(tt.faucet?.holderNft ?? null, nft)) out.push({ id: 'faucet-nft', label: 'Emblem holders get 2x from the faucet', call: setHolderNftCall(tt.address, nft) });
  if (nft && !sameAddress(cfg.holderNft ?? null, nft)) out.push({ id: 'perks', label: `Emblem holders pay ${DEFAULT_HOLDER_FEE_BPS / 100} % instead of ${cfg.feeBps / 100} %`, call: setHolderPerksCall(arena, nft, DEFAULT_HOLDER_FEE_BPS) });
  if (nft) {
    const known = new Map((s?.arena?.arenas ?? []).map((a) => [a.id, a]));
    for (const id of DEFAULT_HOLDERS_ONLY_ARENA_IDS) {
      const a = known.get(id);
      // created in this run, or existing but still open to everyone
      if ((!a || !a.exists) && token) out.push({ id: `holders-${id}`, label: `${arenaName(id)}: emblem holders only`, call: setArenaHoldersOnlyCall(arena, id, true) });
      else if (a && a.exists && !a.holdersOnly) out.push({ id: `holders-${id}`, label: `${arenaName(id)}: emblem holders only`, call: setArenaHoldersOnlyCall(arena, id, true) });
    }
  }
  if (opts.openMint && nft && s?.nft?.state && s.nft.state.phaseName !== 'public') out.push({ id: 'mint', label: 'Open the mint to everyone (Public)', call: setPhaseCall(nft, 'public') });
  return out;
}

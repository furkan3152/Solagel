/**
 * The mint page's logic, pure (no React, no network) so every state is unit-tested.
 * See docs/specs/2026-10-29-elymum-on-elysium.md (sections 3.2, 4.4 and 5).
 */
import { MintPhase, elymumNFTAbi, mintRefusal } from '@elymum/sdk';
import type { GameAccess, MintContractState, MintProofResponse, MintState } from '@elymum/shared';
import { parseEventLogs, type Address, type Log } from 'viem';

/** What the page shows. `unavailable`: no NFT contract registered yet (or the chain is off). */
export type MintView = 'unavailable' | 'closed' | 'allowlist' | 'public' | 'soldout';

export function mintView(s: Pick<MintState, 'contract' | 'nftAddress' | 'soldOut'> | null): MintView {
  if (!s || !s.nftAddress || !s.contract) return 'unavailable';
  if (s.soldOut || s.contract.totalSupply >= s.contract.maxSupply) return 'soldout';
  return s.contract.phase;
}

export const phaseNumber = (p: MintContractState['phase']): MintPhase => (p === 'allowlist' ? MintPhase.Allowlist : p === 'public' ? MintPhase.Public : MintPhase.Closed);

/** Which mint function the wallet uses in this phase. */
export const mintKind = (view: MintView): 'allowlist' | 'public' | null => (view === 'allowlist' ? 'allowlist' : view === 'public' ? 'public' : null);

/** How many this wallet may still mint in `kind` (0 when none). */
export function remaining(c: Pick<MintContractState, 'maxSupply' | 'totalSupply' | 'wlLimit' | 'publicLimit'>, minted: { wl: number; pub: number }, kind: 'allowlist' | 'public'): number {
  const left = Math.max(0, c.maxSupply - c.totalSupply);
  const limit = kind === 'allowlist' ? c.wlLimit - minted.wl : c.publicLimit - minted.pub;
  return Math.max(0, Math.min(left, limit));
}

/**
 * Why this wallet cannot mint `qty` now (null when it can): the SDK's `mintRefusal` (mirrors the
 * contract) plus the proof checks of an allowlist mint (eligible, and the server's snapshot is the
 * root published on the contract).
 */
export function mintBlocker(
  c: MintContractState,
  minted: { wl: number; pub: number },
  p: { kind: 'allowlist' | 'public'; qty: number; proof: MintProofResponse | null },
): string | null {
  if (p.kind === 'allowlist') {
    if (!p.proof) return 'checking the allowlist';
    if (!p.proof.eligible) return 'this wallet is not on the allowlist';
    if (!p.proof.root || !p.proof.onchainRoot || p.proof.root.toLowerCase() !== p.proof.onchainRoot.toLowerCase()) {
      return 'the allowlist is not published on the contract yet; try again soon';
    }
  }
  return mintRefusal(
    { phase: phaseNumber(c.phase), maxSupply: c.maxSupply, totalSupply: c.totalSupply, wlLimit: c.wlLimit, publicLimit: c.publicLimit },
    minted,
    { kind: p.kind, qty: p.qty, eligible: p.kind === 'allowlist' ? p.proof?.eligible : undefined },
  );
}

/** Token ids minted to `to` in a receipt (ERC-721 `Transfer` from the zero address). */
export function mintedTokenIds(logs: readonly Log[], nft: Address, to: Address): bigint[] {
  const events = parseEventLogs({ abi: elymumNFTAbi, logs: logs as Log[], eventName: 'Transfer', strict: false });
  return events
    .filter((e) => e.address.toLowerCase() === nft.toLowerCase())
    .map((e) => e.args as { from?: Address; to?: Address; tokenId?: bigint })
    .filter((a) => a.from && /^0x0{40}$/i.test(a.from) && a.to && a.to.toLowerCase() === to.toLowerCase() && typeof a.tokenId === 'bigint')
    .map((a) => a.tokenId!);
}

/** The game is open to holders (or everyone): the success state offers Play. */
export const playOpenForHolders = (access: GameAccess | null | undefined): boolean => access === 'holders' || access === 'public';

/** `0.0312` HYPE ≈ `$1.00`: a USD amount for display (null when unknown). */
export function usdText(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

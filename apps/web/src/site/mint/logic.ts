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

/** One line of "What the emblem does". */
export interface EmblemPerk {
  id: 'access' | 'fee' | 'isles' | 'wl' | 'skin' | 'faucet';
  title: string;
  note: string;
}

/**
 * What an Elymum emblem does, for the mint page (and in one line on the landing). On a testnet
 * the game is open and the mint public, so the copy says what holds there and only promises the
 * mainnet WL; on mainnet the testnet-only lines (the WL import, the faucet bonus) are left out.
 * `testnet` null (unknown): the mainnet copy without the testnet lines.
 */
export function emblemPerks(testnet: boolean | null, fee: { holderBps?: number | null; feeBps?: number | null } = {}): EmblemPerk[] {
  const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const holder = pct(fee.holderBps ?? 300);
  const normal = pct(fee.feeBps ?? 500);
  const out: EmblemPerk[] = [
    testnet
      ? { id: 'access', title: 'Game access', note: 'On testnet the ring is open to everyone. On mainnet the emblem is the key.' }
      : { id: 'access', title: 'Game access', note: 'The emblem is your key to the ring when the doors are for holders.' },
    { id: 'fee', title: `${holder} fee instead of ${normal}`, note: 'On profit only, fixed into your ticket when you join.' },
    { id: 'isles', title: 'The Isles of the Blessed', note: 'The top arena is for holders only.' },
  ];
  if (testnet) out.push({ id: 'wl', title: 'Testnet emblem, mainnet WL', note: 'Holders are carried onto the mainnet allowlist.' });
  out.push({ id: 'skin', title: 'Your coin, in the game', note: 'Its face and colour as your skin, and a laurel on your name tag.' });
  if (testnet) out.push({ id: 'faucet', title: '2x from the faucet', note: 'Holders claim twice the test tokens.' });
  return out;
}

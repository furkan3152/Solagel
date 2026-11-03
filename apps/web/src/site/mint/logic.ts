/**
 * The mint page's logic, pure (no React, no network) so every state is unit-tested.
 * See docs/specs/2026-10-29-elymum-on-elysium.md (sections 3.2, 4.4 and 5).
 */
import { MintPhase, elymumNFTAbi, mintRefusal, type DescribedError } from '@elymum/sdk';
import { isMainnet, type GameAccess, type MintContractState, type MintProofResponse, type MintState } from '@elymum/shared';
import { parseEventLogs, type Address, type Log } from 'viem';
import { t } from '../../i18n';

/** The SDK's English refusal reasons (`mintRefusal`), in the reader's language. */
export function refusalText(why: string): string {
  let m: RegExpExecArray | null;
  if (why === 'choose at least one') return t('mn.why.qty');
  if (why === 'the mint is closed') return t('mn.why.closed');
  if (why === 'the public mint is not open yet') return t('mn.why.notPublic');
  if (why === 'this wallet is not on the allowlist') return t('mn.why.notListed');
  if (why === 'sold out') return t('mn.why.soldOut');
  if ((m = /^only (\d+) left$/.exec(why))) return t('mn.why.left', { n: Number(m[1]) });
  if ((m = /^allowlist limit is (\d+) per wallet \(minted (\d+)\)$/.exec(why))) return t('mn.why.wlLimit', { n: m[1], minted: m[2] });
  if ((m = /^public limit is (\d+) per wallet \(minted (\d+)\)$/.exec(why))) return t('mn.why.pubLimit', { n: m[1], minted: m[2] });
  return why;
}

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
    if (!p.proof) return t('mn.why.checking');
    if (!p.proof.eligible) return t('mn.why.notListed');
    if (!p.proof.root || !p.proof.onchainRoot || p.proof.root.toLowerCase() !== p.proof.onchainRoot.toLowerCase()) {
      return t('mn.why.unpublished');
    }
  }
  const why = mintRefusal(
    { phase: phaseNumber(c.phase), maxSupply: c.maxSupply, totalSupply: c.totalSupply, wlLimit: c.wlLimit, publicLimit: c.publicLimit },
    minted,
    { kind: p.kind, qty: p.qty, eligible: p.kind === 'allowlist' ? p.proof?.eligible : undefined },
  );
  return why === null ? null : refusalText(why);
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
export function emblemPerks(
  testnet: boolean | null,
  fee: { holderBps?: number | null; feeBps?: number | null; feeModel?: 'entry' | 'profit' | null; gameAccess?: GameAccess | null } = {},
): EmblemPerk[] {
  const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const holder = pct(fee.holderBps ?? 300);
  const normal = pct(fee.feeBps ?? 500);
  // "open to everyone" only while the server really lets everyone in (the admin may have closed it to holders)
  const openToAll = fee.gameAccess == null || fee.gameAccess === 'public';
  const out: EmblemPerk[] = [
    testnet && openToAll
      ? { id: 'access', title: t('mn.perk.access'), note: t('mn.perk.accessTest') }
      : testnet && fee.gameAccess === 'holders'
        ? { id: 'access', title: t('mn.perk.access'), note: t('mn.perk.accessHolders') }
      : { id: 'access', title: t('mn.perk.access'), note: t('mn.perk.accessMain') },
    {
      id: 'fee',
      title: t('mn.perk.fee', { holder, normal }),
      // the base follows the live arena (`ChainStatus.feeModel`): the legacy v1 arena takes it from the profit only
      note: fee.feeModel === 'profit' ? t('mn.perk.feeProfit') : t('mn.perk.feeEntry'),
    },
    { id: 'isles', title: t('mn.perk.isles'), note: t('mn.perk.islesNote') },
  ];
  if (testnet) out.push({ id: 'wl', title: t('mn.perk.wl'), note: t('mn.perk.wlNote') });
  out.push({ id: 'skin', title: t('mn.perk.skin'), note: t('mn.perk.skinNote') });
  if (testnet) out.push({ id: 'faucet', title: t('mn.perk.faucet'), note: t('mn.perk.faucetNote') });
  return out;
}

/* ── price copy ─────────────────────────────────────────────────────── */

/**
 * What the page may say about the price. `testnet`: a fixed test price (say it plainly, and that
 * mainnet is much cheaper). `dollar`: the price really tracks the USD target (within ±10 %), so
 * the "one dollar" story holds. `plain`: neither (the feed is off or the price drifted): state
 * the HYPE price and nothing more.
 */
export type PriceStory = 'testnet' | 'dollar' | 'plain';

/** How far the USD price may sit from the target and still be called "a dollar". */
export const DOLLAR_TOLERANCE = 0.1;

export function priceStory(s: Pick<MintState, 'priceUsd' | 'targetUsdCents' | 'chainId'>, testnet: boolean | null): PriceStory {
  const onTestnet = testnet ?? (s.chainId != null ? !isMainnet(s.chainId) : null);
  if (onTestnet) return 'testnet';
  const target = s.targetUsdCents / 100;
  if (s.priceUsd !== null && Number.isFinite(s.priceUsd) && target > 0 && Math.abs(s.priceUsd - target) <= target * DOLLAR_TOLERANCE) return 'dollar';
  return 'plain';
}

/** `1000000000000000000n` → `1`, `31250000000000000n` → `0.0313`: HYPE for prose (at most 4 decimals). */
export function hypeText(wei: bigint): string {
  if (wei < 0n) return `-${hypeText(-wei)}`;
  // ten-thousandths of a HYPE, rounded half up
  const units = (wei + 50_000_000_000_000n) / 100_000_000_000_000n;
  if (units === 0n && wei > 0n) return '<0.0001';
  const frac = (units % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${units / 10_000n}.${frac}` : (units / 10_000n).toString();
}

/* ── funds and errors ──────────────────────────────────────────────── */

/**
 * Why this wallet's HYPE cannot pay `value` (the price times the quantity, plus the buffer the
 * contract refunds), or null when it can, or when the balance is unknown (the wallet decides).
 */
export function fundsBlocker(balance: bigint | null, value: bigint): string | null {
  if (balance === null || balance >= value) return null;
  return t('mn.why.funds', { value: hypeText(value), balance: hypeText(balance) });
}

/**
 * Player-facing text for a failed mint: the cases that matter here get their own words, the
 * rest falls back to `fallback` (the wallet layer's translated text).
 */
export function mintErrorText(e: Pick<DescribedError, 'kind' | 'name' | 'message'>, fallback: string): string {
  if (e.kind === 'rejected') return t('mn.err.rejected');
  if (e.kind === 'insufficient-funds') return t('mn.err.funds');
  switch (e.name) {
    case 'SoldOut':
      return t('mn.err.SoldOut');
    case 'PublicLimitExceeded':
      return t('mn.err.PublicLimitExceeded');
    case 'WlLimitExceeded':
      return t('mn.err.WlLimitExceeded');
    case 'MintClosed':
      return t('mn.err.MintClosed');
    case 'InsufficientPayment':
      return t('mn.err.InsufficientPayment');
    default:
      return fallback;
  }
}

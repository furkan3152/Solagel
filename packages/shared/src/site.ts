/**
 * Elymum site: WL (allowlist) and collab applications, the NFT mint, the contracts registry and
 * player profiles. Types shared by the server (`/api/site/*`, `/api/admin/*`, `/api/profile`) and
 * the web app, plus the validation rules both apply.
 * See docs/specs/2026-10-29-elymum-on-elysium.md (section 4.4).
 */

/** The X account of the project (no `@`). */
export const SITE_X_HANDLE_DEFAULT = 'elymumio';

/**
 * Who may play (practice, arenas, private rooms, spectating): `admins` only, NFT `holders`
 * (wallets with `balanceOf > 0` on the NFT) plus admins, or the `public`.
 */
export type GameAccess = 'admins' | 'holders' | 'public';
export const GAME_ACCESS_MODES: readonly GameAccess[] = ['admins', 'holders', 'public'];
export const GAME_ACCESS_DEFAULT: GameAccess = 'admins';

export function isGameAccess(s: unknown): s is GameAccess {
  return typeof s === 'string' && (GAME_ACCESS_MODES as readonly string[]).includes(s);
}

/** Site switches the admin controls. */
export interface SiteSettings {
  /** WL applications accepted. */
  wlOpen: boolean;
  /** Collab applications accepted (the landing's Collab button reads it). */
  collabOpen: boolean;
  /** Who may play (server `GAME_ACCESS` overrides it). */
  gameAccess: GameAccess;
  /** The project's X handle, without `@`. */
  xHandle: string;
  /** The pinned launch post the `engage_x` task points at; null until it is live. */
  launchPostUrl: string | null;
}

export const SITE_SETTINGS_DEFAULT: SiteSettings = {
  wlOpen: true,
  collabOpen: false,
  gameAccess: GAME_ACCESS_DEFAULT,
  xHandle: SITE_X_HANDLE_DEFAULT,
  launchPostUrl: null,
};

export type WlTaskKind = 'follow_x' | 'post_x' | 'engage_x' | 'join_link' | 'text' | 'wallet';
export const WL_TASK_KINDS: readonly WlTaskKind[] = ['follow_x', 'post_x', 'engage_x', 'join_link', 'text', 'wallet'];

/** One WL task, as the admin edits it. */
export interface WlTask {
  id: string;
  kind: WlTaskKind;
  title: string;
  body: string;
  /** URL or handle the task points at. An `engage_x` task with no target uses `SiteSettings.launchPostUrl`. */
  target: string | null;
  required: boolean;
  enabled: boolean;
  order: number;
}

/** A task as the public sees it: enabled tasks only, the target resolved. */
export interface PublicWlTask {
  id: string;
  kind: WlTaskKind;
  title: string;
  body: string;
  target: string | null;
  required: boolean;
  /**
   * False when the task cannot be done yet (an `engage_x` task whose post is not live): the step shows
   * "opens when the post is live" and the server does not require it.
   */
  available: boolean;
}

/** Id of the seeded "Your X handle" task: its answer is the entry's `xHandle`. */
export const WL_TASK_X_HANDLE = 'x_handle';
/** Id of the seeded "Your EVM wallet" task: its answer is the signed-in wallet (0x address). */
export const WL_TASK_WALLET = 'wallet';

export type WlStatus = 'pending' | 'approved' | 'rejected';
export const WL_STATUSES: readonly WlStatus[] = ['pending', 'approved', 'rejected'];

/** A task as it was when the applicant answered it, with the answer. */
export interface WlTaskAnswer {
  id: string;
  kind: WlTaskKind;
  title: string;
  target: string | null;
  required: boolean;
  /** `true` for self-attested tasks (`follow_x`, `join_link`), else the text / URL / wallet given. */
  answer: string | true | null;
}

/** The applicant's own view of their WL entry. */
export interface WlEntryPublic {
  id: string;
  /** The applicant's wallet (an EVM address). */
  wallet: string;
  xHandle: string;
  status: WlStatus;
  tasks: WlTaskAnswer[];
  createdAt: number;
  updatedAt: number;
}

/** The admin view of a WL entry. */
export interface WlEntryAdmin extends WlEntryPublic {
  note: string;
  /** Ids of collabs whose wallet list holds this wallet (duplicate flag). */
  dupCollabs: string[];
}

/** `POST /api/site/wl` body. */
export interface WlSubmitRequest {
  /** The applicant's X handle (`@name`, `name` or an x.com profile URL; normalised by the server). */
  xHandle: string;
  /** Answers by task id. Self-attested tasks take `true`. Wallet tasks are filled by the server. */
  answers: Record<string, string | boolean>;
  /** Honeypot: must be absent or empty. */
  website?: string;
}

export type CollabType = 'dao' | 'guild' | 'alpha' | 'nft' | 'other';
export const COLLAB_TYPES: readonly CollabType[] = ['dao', 'guild', 'alpha', 'nft', 'other'];
export type CollabRole = 'founder' | 'community_manager' | 'moderator' | 'other';
export const COLLAB_ROLES: readonly CollabRole[] = ['founder', 'community_manager', 'moderator', 'other'];

/** Stored collab state: pending → rejected | approved{spots, deadline} → submitted{wallets, raffleUrl}. */
export type CollabStatus = 'pending' | 'rejected' | 'approved' | 'submitted';
export const COLLAB_STATUSES: readonly CollabStatus[] = ['pending', 'rejected', 'approved', 'submitted'];
/**
 * What the applicant sees: `in_review` (pending), `rejected` ("not this time"), `approved` (filling the
 * list), `submitted` (locked), `closed` (approved but the deadline passed without a submit).
 */
export type CollabPhase = 'in_review' | 'rejected' | 'approved' | 'submitted' | 'closed';

/** `POST /api/site/collab` body. */
export interface CollabApplyRequest {
  community: string;
  type: CollabType;
  members: number;
  /** The community's X handle. */
  communityX: string;
  /** The applicant's own X handle (at most 2 applications per handle). */
  contactX: string;
  discord?: string;
  role: CollabRole;
  /** A post about Elymum on the community's X (tags the project). */
  postUrl: string;
  about: string;
  /** Honeypot: must be absent or empty. */
  website?: string;
}

export interface CollabWalletRow {
  name: string;
  wallet: string;
}

export interface CollabPublic {
  id: string;
  /** The applicant's (signed-in) wallet. */
  wallet: string;
  community: string;
  type: CollabType;
  members: number;
  communityX: string;
  contactX: string;
  discord: string;
  role: CollabRole;
  postUrl: string;
  about: string;
  status: CollabStatus;
  phase: CollabPhase;
  /** Set on approval. */
  spots: number | null;
  /** Unix ms; set on approval. */
  deadline: number | null;
  wallets: CollabWalletRow[];
  raffleUrl: string | null;
  submittedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollabWalletRowAdmin extends CollabWalletRow {
  /** The wallet has a WL entry. */
  dupWl: boolean;
  /** Other collabs whose list holds the wallet. */
  dupCollabs: string[];
}

export interface CollabAdmin extends Omit<CollabPublic, 'wallets'> {
  note: string;
  wallets: CollabWalletRowAdmin[];
}

/** `PUT /api/site/collab/:id/wallets` body (a draft; allowed until submit). */
export interface CollabWalletsRequest {
  wallets: CollabWalletRow[];
  raffleUrl?: string | null;
}

/** `POST /api/site/collab/:id/submit` body. `wallets` omitted: the saved draft is submitted. */
export interface CollabSubmitRequest {
  wallets?: CollabWalletRow[];
  raffleUrl: string;
}

export interface SiteCounts {
  wl: Record<WlStatus, number> & { total: number };
  collab: Record<CollabStatus, number> & { total: number; closed: number; wallets: number };
}

/** Error codes of `/api/site/*`, `/api/admin/*` and `/api/auth/login` (`{ error, message?, field? }`). */
export type SiteErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'body_too_large'
  | 'rate_limited'
  | 'wl_closed'
  | 'collab_closed'
  | 'already_applied'
  | 'handle_taken'
  | 'collab_limit'
  | 'wrong_state'
  | 'deadline_passed'
  | 'too_many_wallets'
  | 'auth_failed'
  /** The game is not open to this wallet (`gameAccess`). */
  | 'game_closed'
  /** Contracts registry: the address holds no code, or code other than the bundled artifact. */
  | 'code_mismatch'
  /** Contracts registry: the contract's owner is not the signed-in admin. */
  | 'not_owner'
  /** Contracts registry: the arena's server authority is not the server key. */
  | 'wrong_authority'
  /** The server has no chain (`EVM_RPC_URL` unset) or the contract is not registered. */
  | 'chain_off'
  /** The upstream price feed (HYPE/USD) could not be read. */
  | 'price_unavailable';

export interface SiteError {
  error: SiteErrorCode;
  message?: string;
  /** The offending field (validation errors). */
  field?: string;
}

/** Limits shared by the forms and the server. */
export const SITE_LIMITS = {
  /** Max JSON body (bytes). */
  bodyBytes: 32 * 1024,
  taskTitle: 80,
  taskBody: 600,
  taskTarget: 200,
  maxTasks: 30,
  textAnswer: 500,
  community: 60,
  discord: 40,
  about: 600,
  members: 10_000_000,
  note: 1000,
  walletName: 40,
  maxSpots: 1000,
  /** Applications per contact X handle. */
  collabsPerHandle: 2,
  /** Ids per bulk status change. */
  bulk: 500,
  pageSizeMax: 200,
} as const;

/** An X post (status) link. */
export const X_STATUS_URL_RE = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/;

export function isXStatusUrl(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 300 && X_STATUS_URL_RE.test(s) && !/\s/.test(s);
}

/**
 * Normalises an X handle: trims, drops a leading `@` or an x.com / twitter.com profile URL,
 * lower-cases. Null when the result is not a valid handle (1-15 of A-Z, a-z, 0-9, _).
 */
export function normalizeXHandle(s: unknown): string | null {
  if (typeof s !== 'string' || s.length > 100) return null;
  let h = s.trim();
  const m = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(h);
  if (m) h = m[1];
  h = h.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
  return h.toLowerCase();
}

/* ------------------------------------------------------------------ */
/* EVM addresses                                                       */
/* ------------------------------------------------------------------ */

/** `0x` + 40 hex digits, any case. EIP-55 checksumming is done elsewhere (viem `getAddress`). */
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isEvmAddress(s: unknown): s is `0x${string}` {
  return typeof s === 'string' && EVM_ADDRESS_RE.test(s);
}

/** Lower-case form of an EVM address (trimmed) for comparing and keying; null when it is not one. */
export function normalizeEvmAddress(s: unknown): `0x${string}` | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return EVM_ADDRESS_RE.test(t) ? (t.toLowerCase() as `0x${string}`) : null;
}

/** Both are EVM addresses and name the same account (case-insensitive). */
export function sameEvmAddress(a: unknown, b: unknown): boolean {
  const x = normalizeEvmAddress(a);
  return x !== null && x === normalizeEvmAddress(b);
}

/* ------------------------------------------------------------------ */
/* Contracts registry (`GET /api/site/contracts`, `/api/admin/contracts`) */
/* ------------------------------------------------------------------ */

export type ContractKind = 'arena' | 'nft' | 'token';
export const CONTRACT_KINDS: readonly ContractKind[] = ['arena', 'nft', 'token'];

export interface ContractRecord {
  /** EIP-55 checksummed. */
  address: string;
  /** The deploy (or registering) transaction; null when registered without one. */
  txHash: string | null;
  /** Chain the contract lives on. */
  chainId: number;
  /** Unix ms. */
  registeredAt: number;
  /** The admin wallet that registered it. */
  registeredBy: string;
}

/** What `DATA_DIR/contracts.json` holds and `GET /api/site/contracts` returns. */
export type ContractsRegistry = Record<ContractKind, ContractRecord | null>;

/** `POST /api/admin/contracts` body. `DELETE /api/admin/contracts?kind=` clears a kind. */
export interface ContractRegisterRequest {
  kind: ContractKind;
  address: string;
  txHash: string | null;
}

/* ------------------------------------------------------------------ */
/* Mint (`/api/site/mint*`, `/api/admin/mint/*`)                        */
/* ------------------------------------------------------------------ */

/** `ElymumNFT.Phase`, in contract order (Closed = 0, Allowlist = 1, Public = 2). */
export type MintPhase = 'closed' | 'allowlist' | 'public';
export const MINT_PHASES: readonly MintPhase[] = ['closed', 'allowlist', 'public'];

/** Default mint target in US cents (`MINT_USD_CENTS`). */
export const MINT_USD_CENTS_DEFAULT = 100;

/**
 * `ElymumNFT.mintState()`. Wei amounts are decimal strings (JSON has no bigint);
 * addresses and the root are 0x hex.
 */
export interface MintContractState {
  phase: MintPhase;
  priceWei: string;
  minPriceWei: string;
  maxPriceWei: string;
  /** Price keeper (zero address when none). */
  keeper: string;
  /** Published allowlist root (bytes32; zero when unset). */
  merkleRoot: string;
  maxSupply: number;
  totalSupply: number;
  wlLimit: number;
  publicLimit: number;
  treasury: string;
  /** Metadata frozen forever. */
  frozen: boolean;
}

/** `GET /api/site/mint`. */
export interface MintState {
  /** Null until an NFT contract is registered. */
  nftAddress: string | null;
  chainId: number | null;
  /** Null when there is no contract (or the chain is off). */
  contract: MintContractState | null;
  /** HYPE price in USD; null when the feed is unavailable. */
  hypeUsd: number | null;
  /** Current mint price in USD at `hypeUsd`; null when either is unknown. */
  priceUsd: number | null;
  /** The target the price is kept at (`MINT_USD_CENTS`). */
  targetUsdCents: number;
  /** Distinct holders (wallets with `balanceOf > 0`). */
  holders: number;
  /** `totalSupply >= maxSupply`. */
  soldOut: boolean;
  gameAccess: GameAccess;
}

/** `GET /api/site/mint/proof?wallet=0x…`. */
export interface MintProofResponse {
  /** The wallet is in the server's latest allowlist snapshot. */
  eligible: boolean;
  /** Merkle proof (bytes32 hex) for `mintAllowlist`; empty when not eligible. */
  proof: string[];
  /** Root of the server's snapshot the proof is for; null when there is no snapshot. */
  root: string | null;
  /** Root published on the contract; the proof only works when it equals `root`. */
  onchainRoot: string | null;
}

/** A built allowlist: approved WL wallets plus submitted collab wallets, checksummed, de-duplicated, sorted. */
export interface AllowlistSnapshot {
  /** OpenZeppelin-compatible Merkle root (bytes32 hex). */
  root: string;
  count: number;
  wallets: string[];
  /** Unix ms. */
  builtAt: number;
  /** The admin wallet that built it. */
  builtBy: string;
  /** How many wallets came from each source (a wallet in both counts in both). */
  sources: { wl: number; collab: number };
}

/** `POST /api/admin/mint/allowlist` response. */
export interface AllowlistBuildResponse {
  root: string;
  count: number;
}

/** `GET /api/admin/mint/allowlist`. */
export interface AllowlistStatus {
  snapshot: AllowlistSnapshot | null;
  /** Current approvals vs the snapshot: wallets to add / drop on the next build. */
  diff: { added: string[]; removed: string[] };
  onchainRoot: string | null;
  /** The snapshot's root is the one on the contract. */
  published: boolean;
}

/** `GET /api/admin/mint/price`. */
export interface MintPriceQuote {
  /** HYPE price in USD; null when the feed is unavailable. */
  hypeUsd: number | null;
  targetUsdCents: number;
  /** `targetUsdCents` in wei at `hypeUsd` (decimal string); null without a price. */
  priceWei: string | null;
  /** Unix ms of the HYPE/USD reading. */
  fetchedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Profiles (`GET /api/profile`, `PUT /api/profile`)                    */
/* ------------------------------------------------------------------ */

export interface ProfileStats {
  games: number;
  kills: number;
  /** Best score. */
  best: number;
}

/** `GET /api/profile` (signed-in). `name` is null before the player picks one. */
export interface ProfileView {
  /** EIP-55 checksummed. */
  wallet: string;
  name: string | null;
  skin: number;
  stats: ProfileStats;
  /** Unix ms; null when never saved. */
  updatedAt: number | null;
}

/** `PUT /api/profile` body. */
export interface ProfileUpdate {
  name: string;
  skin: number;
}

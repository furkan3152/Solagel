/**
 * slana.io site: WL (allowlist) and collab applications. Types shared by the server
 * (`/api/site/*`, `/api/admin/*`) and the web app, plus the validation rules both apply.
 * See docs/specs/2026-10-17-slana-site-wl-collab-design.md.
 */

/** The X account of the project (no `@`). */
export const SITE_X_HANDLE_DEFAULT = 'slanaio';

/** Site switches the admin controls. */
export interface SiteSettings {
  /** WL applications accepted. */
  wlOpen: boolean;
  /** Collab applications accepted (the landing's Collab button reads it). */
  collabOpen: boolean;
  /** The game (practice, arenas, private rooms, spectating) is open to everyone, not only admins. */
  gamePublic: boolean;
  /** The project's X handle, without `@`. */
  xHandle: string;
  /** The pinned launch post the `engage_x` task points at; null until it is live. */
  launchPostUrl: string | null;
}

export const SITE_SETTINGS_DEFAULT: SiteSettings = {
  wlOpen: true,
  collabOpen: false,
  gamePublic: false,
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
/** Id of the seeded "Your Solana wallet" task: its answer is the signed-in wallet. */
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
  /** A post about Slana on the community's X (tags the project). */
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
  | 'auth_failed';

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

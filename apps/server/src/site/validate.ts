import { PublicKey } from '@solana/web3.js';
import {
  COLLAB_ROLES,
  COLLAB_TYPES,
  SITE_LIMITS,
  WL_TASK_KINDS,
  isXStatusUrl,
  normalizeXHandle,
  type CollabApplyRequest,
  type CollabWalletRow,
  type SiteErrorCode,
  type WlTaskKind,
} from '@slana/shared';
import { isValidPubkey } from '../auth';

/** A refused site / admin request: HTTP status, error code, message and the offending field. */
export class SiteFail extends Error {
  constructor(
    readonly status: number,
    readonly code: SiteErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export const bad = (field: string, message: string): SiteFail => new SiteFail(400, 'bad_request', message, field);

/** A base58 key of 32 bytes (any address, e.g. a program or a PDA). */
export function isAddress(s: unknown): s is string {
  return isValidPubkey(s);
}

/** A user wallet: a base58 32-byte key on the ed25519 curve (a PDA cannot sign, so it cannot be a wallet). */
export function isUserWallet(s: unknown): s is string {
  if (!isValidPubkey(s)) return false;
  try {
    return PublicKey.isOnCurve(new PublicKey(s).toBytes());
  } catch {
    return false;
  }
}

/** Removes control characters (keeps newlines when `multiline`) and trims. */
export function cleanText(s: string, multiline = false): string {
  // eslint-disable-next-line no-control-regex
  const re = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g : /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
  return s.replace(re, '').trim();
}

export function text(v: unknown, field: string, max: number, opts: { min?: number; multiline?: boolean } = {}): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(field, `${field} must be text`);
  const t = cleanText(v, opts.multiline);
  const min = opts.min ?? 0;
  if (t.length < min) throw bad(field, min <= 1 ? `${field} is required` : `${field} needs at least ${min} characters`);
  if (t.length > max) throw bad(field, `${field} is longer than ${max} characters`);
  return t;
}

export function handle(v: unknown, field: string): string {
  const h = normalizeXHandle(v);
  if (!h) throw bad(field, `${field} is not a valid X handle`);
  return h;
}

export function statusUrl(v: unknown, field: string): string {
  if (typeof v !== 'string' || !isXStatusUrl(v.trim())) throw bad(field, `${field} must be an X post link (https://x.com/<handle>/status/<id>)`);
  return v.trim();
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw bad(field, `${field} must be true or false`);
  return v;
}

export function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(field, `${field} must be a whole number from ${min} to ${max}`);
  return v;
}

export function oneOf<T extends string>(v: unknown, field: string, list: readonly T[]): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw bad(field, `${field} must be one of ${list.join(', ')}`);
  return v as T;
}

/** The honeypot (`website`) must be absent or empty: forms leave it hidden, bots fill it. */
export function honeypot(body: Record<string, unknown>): void {
  const v = body.website;
  if (v !== undefined && v !== null && v !== '') throw new SiteFail(400, 'bad_request', 'Request refused');
}

export function obj(v: unknown, field = 'body'): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(field, `${field} must be an object`);
  return v as Record<string, unknown>;
}

/** A task target: an https URL or an X handle (`@name`). */
export function taskTarget(v: unknown, kind: WlTaskKind): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > SITE_LIMITS.taskTarget) throw bad('target', `target must be text of at most ${SITE_LIMITS.taskTarget} characters`);
  const t = v.trim();
  if (/^https:\/\/[^\s<>"']+$/.test(t)) {
    try {
      new URL(t);
    } catch {
      throw bad('target', 'target is not a valid URL');
    }
    return t;
  }
  if (kind === 'follow_x') {
    const h = normalizeXHandle(t);
    if (h) return `https://x.com/${h}`;
  }
  throw bad('target', 'target must be an https:// link');
}

export const taskKind = (v: unknown): WlTaskKind => oneOf(v, 'kind', WL_TASK_KINDS);

/** Validates a collab application form. */
export function collabApply(body: Record<string, unknown>): Omit<CollabApplyRequest, 'website' | 'discord'> & { discord: string } {
  honeypot(body);
  return {
    community: text(body.community, 'community', SITE_LIMITS.community, { min: 2 }),
    type: oneOf(body.type, 'type', COLLAB_TYPES),
    members: int(body.members, 'members', 1, SITE_LIMITS.members),
    communityX: handle(body.communityX, 'communityX'),
    contactX: handle(body.contactX, 'contactX'),
    discord: text(body.discord, 'discord', SITE_LIMITS.discord),
    role: oneOf(body.role, 'role', COLLAB_ROLES),
    postUrl: statusUrl(body.postUrl, 'postUrl'),
    about: text(body.about, 'about', SITE_LIMITS.about, { min: 1, multiline: true }),
  };
}

/** Validates a collab wallet list (names optional, wallets on-curve and unique). */
export function walletRows(v: unknown, max: number): CollabWalletRow[] {
  if (!Array.isArray(v)) throw bad('wallets', 'wallets must be a list');
  if (v.length > max) throw new SiteFail(400, 'too_many_wallets', `At most ${max} wallets (your spots)`, 'wallets');
  const seen = new Set<string>();
  return v.map((row, i) => {
    const r = obj(row, `wallets[${i}]`);
    const wallet = typeof r.wallet === 'string' ? r.wallet.trim() : r.wallet;
    if (!isUserWallet(wallet)) throw bad(`wallets[${i}].wallet`, `Row ${i + 1}: not a Solana wallet address`);
    if (seen.has(wallet)) throw bad(`wallets[${i}].wallet`, `Row ${i + 1}: the wallet is listed twice`);
    seen.add(wallet);
    return { name: text(r.name, `wallets[${i}].name`, SITE_LIMITS.walletName), wallet };
  });
}

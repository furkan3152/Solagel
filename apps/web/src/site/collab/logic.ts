import { getAddress, isAddress } from 'viem';
import {
  COLLAB_ROLES,
  COLLAB_TYPES,
  SITE_LIMITS,
  isXStatusUrl,
  normalizeXHandle,
  type CollabApplyRequest,
  type CollabRole,
  type CollabType,
  type CollabWalletRow,
} from '@elymum/shared';

import { siteHost } from '../settings';

export { ROLE_LABEL, TYPE_LABEL } from './labels';

export interface ApplyDraft {
  community: string;
  type: CollabType | '';
  members: string;
  communityX: string;
  contactX: string;
  discord: string;
  role: CollabRole | '';
  postUrl: string;
  about: string;
}

export const EMPTY_DRAFT: ApplyDraft = { community: '', type: '', members: '', communityX: '', contactX: '', discord: '', role: '', postUrl: '', about: '' };

export type ApplyErrors = Partial<Record<keyof ApplyDraft, string>>;

const X_POST = 'Paste a link to an X post, like https://x.com/yourcommunity/status/1234567890.';

/** The apply form's inline errors: the server's rules (it checks them again). */
export function applyErrors(d: ApplyDraft): ApplyErrors {
  const e: ApplyErrors = {};
  const community = d.community.trim();
  if (community.length < 2) e.community = 'Give the community name (at least 2 characters).';
  else if (community.length > SITE_LIMITS.community) e.community = `Keep it under ${SITE_LIMITS.community} characters.`;
  if (!COLLAB_TYPES.includes(d.type as CollabType)) e.type = 'Pick a type.';
  const members = Number(d.members.replace(/[\s,._]/g, ''));
  if (!d.members.trim()) e.members = 'How many members does it have?';
  else if (!Number.isInteger(members) || members < 1 || members > SITE_LIMITS.members) e.members = 'Use a whole number from 1 to 10,000,000.';
  if (!normalizeXHandle(d.communityX)) e.communityX = "That is not an X handle. Use the community's handle, like @elymumio.";
  if (!normalizeXHandle(d.contactX)) e.contactX = 'That is not an X handle. Use your own handle, like @yourname.';
  if (d.discord.trim().length > SITE_LIMITS.discord) e.discord = `Keep it under ${SITE_LIMITS.discord} characters.`;
  if (!COLLAB_ROLES.includes(d.role as CollabRole)) e.role = 'Pick your role.';
  if (!d.postUrl.trim()) e.postUrl = "Post about Elymum on your community's X first, then paste the link.";
  else if (!isXStatusUrl(d.postUrl.trim())) e.postUrl = X_POST;
  const about = d.about.trim();
  if (!about) e.about = 'Tell us a little about your community.';
  else if (about.length > SITE_LIMITS.about) e.about = `Keep it under ${SITE_LIMITS.about} characters.`;
  return e;
}

export function applyBody(d: ApplyDraft, website: string): CollabApplyRequest {
  const body: CollabApplyRequest = {
    community: d.community.trim(),
    type: d.type as CollabType,
    members: Number(d.members.replace(/[\s,._]/g, '')),
    communityX: normalizeXHandle(d.communityX) ?? d.communityX.trim(),
    contactX: normalizeXHandle(d.contactX) ?? d.contactX.trim(),
    role: d.role as CollabRole,
    postUrl: d.postUrl.trim(),
    about: d.about.trim(),
  };
  if (d.discord.trim()) body.discord = d.discord.trim();
  if (website) body.website = website;
  return body;
}

/**
 * An EVM wallet: `0x` + 40 hex digits, not the zero address. All-lower or all-upper case is
 * accepted as is; a mixed-case address must carry a valid EIP-55 checksum (a wrong one is a typo).
 */
export function isUserWallet(s: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return false;
  if (/^0x0{40}$/i.test(s)) return false;
  const body = s.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return isAddress(s, { strict: true });
}

/** The checksummed form of a wallet (unchanged when it is not an address). */
export const checksumWallet = (s: string): string => (isAddress(s.trim(), { strict: false }) ? getAddress(s.trim()) : s.trim());

const ADDRESS_TOKEN = /0x[0-9a-fA-F]{40}/g;

/**
 * Parses a pasted list: one person per line, a name and a wallet ("alice 0xAbC…", "alice, 0xAbC…",
 * "0xAbC… alice", tabs from a sheet). Lines without anything that looks like a wallet are skipped.
 */
export function parsePastedList(text: string): CollabWalletRow[] {
  const out: CollabWalletRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = [...line.matchAll(ADDRESS_TOKEN)].filter((m) => {
      const before = line[(m.index ?? 0) - 1];
      const after = line[(m.index ?? 0) + m[0].length];
      return (!before || /[\s,;|\t:]/.test(before)) && (!after || /[\s,;|\t]/.test(after));
    });
    if (tokens.length === 0) continue;
    const m = tokens[tokens.length - 1];
    const wallet = m[0];
    const name = (line.slice(0, m.index) + line.slice((m.index ?? 0) + wallet.length))
      .replace(/^[\s,;|:\-–]+|[\s,;|:\-–]+$/g, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, SITE_LIMITS.walletName);
    out.push({ name, wallet });
  }
  return out;
}

/** Puts `rows` into `table` from `at` on, keeping the table at most `spots` rows. */
export function fillRows(table: CollabWalletRow[], at: number, rows: CollabWalletRow[], spots: number): CollabWalletRow[] {
  const next = table.slice();
  rows.forEach((r, k) => {
    const i = at + k;
    if (i < spots) next[i] = r;
  });
  return next.slice(0, spots);
}

/** Per-row errors (wallet shape, duplicates) for the rows that have something in them. */
export function rowErrors(rows: CollabWalletRow[]): (string | null)[] {
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const w = r.wallet.trim();
    if (!w && !r.name.trim()) return null;
    if (!w) return 'Add a wallet, or clear the name.';
    if (!isUserWallet(w)) return /^0x[0-9a-fA-F]{40}$/.test(w) ? 'Checksum mismatch: check this address for a typo.' : 'Not an EVM wallet address (0x followed by 40 hex characters).';
    if (r.name.trim().length > SITE_LIMITS.walletName) return `Keep the name under ${SITE_LIMITS.walletName} characters.`;
    const key = w.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) return `Listed twice (row ${first + 1}).`;
    seen.set(key, i);
    return null;
  });
}

/** The filled rows, trimmed and checksummed, as the server takes them. */
export const filledRows = (rows: CollabWalletRow[]): CollabWalletRow[] =>
  rows.filter((r) => r.wallet.trim() || r.name.trim()).map((r) => ({ name: r.name.trim(), wallet: checksumWallet(r.wallet) }));

/** "2d 04:12:09" / "04:12:09" left until `deadline`. */
export function countdown(deadline: number, now: number): string {
  let s = Math.max(0, Math.floor((deadline - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const hms = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** The raffle post the guide offers to copy. */
export function rafflePost(community: string, spots: number | null, deadline: number | null, host: string = siteHost()): string {
  const n = spots ? `${spots} ` : '';
  const when = deadline ? new Date(deadline).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : 'soon';
  return [
    `${community || 'Our community'} x @elymumio`,
    '',
    `We have ${n}Elymum WL spots to raffle. Coins eat coins on Elysium, and the arena opens soon.`,
    '',
    'To enter:',
    '1. Follow @elymumio',
    '2. Like and repost this post',
    '3. Reply with your EVM wallet (0x…)',
    '',
    `Winners picked by ${when}. ${host}`,
  ].join('\n');
}

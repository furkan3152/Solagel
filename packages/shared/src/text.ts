import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH } from './constants';

// Control chars, zero-width / bidi overrides and other invisible troublemakers.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g;

/** Take at most `max` user-perceived characters (code points). */
function takeCodePoints(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('');
}

/** Cleans a player name; returns the fallback when nothing usable remains. */
export function sanitizeName(raw: unknown, fallback = 'Coinie'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = takeCodePoints(raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim(), MAX_NAME_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Cleans a chat line; returns '' when nothing is left. */
export function sanitizeChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return takeCodePoints(raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim(), MAX_CHAT_LENGTH).trim();
}

/** UTF-8 byte length (profile names are limited to 16 bytes). */
export const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/** Truncates to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(s: string, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const len = utf8Length(ch);
    if (bytes + len > maxBytes) break;
    out += ch;
    bytes += len;
  }
  return out;
}

/** Shortens an EVM address: 0x12Ab…9fE0 (`head` counts the `0x`). */
export const shortAddress = (addr: string, head = 6, tail = 4): string =>
  addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;

import type { CustomRoomConfig, CustomRoomError, CustomRoomQuote, CustomRoomView } from '@elymum/shared';
import { SERVER } from '../config';

/** A refusal of the custom room API, with the server's code and friendly message. */
export class RoomApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: CustomRoomError | 'network' | 'rate_limited',
    message: string,
    readonly field?: string,
    /** `slots_busy` after a verified payment: the payment was kept unused for a retry. */
    readonly paid?: boolean,
  ) {
    super(message);
    this.name = 'RoomApiError';
  }
}

async function call<T>(path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; token?: string | null; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${SERVER.http}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new RoomApiError(0, 'network', 'Cannot reach the server right now. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = (typeof data.error === 'string' ? data.error : res.status === 429 ? 'rate_limited' : res.status === 401 ? 'unauthorized' : 'bad_request') as RoomApiError['code'];
    const fallback =
      code === 'unauthorized' ? 'Your sign-in expired. Verify your wallet again.' : code === 'rate_limited' ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong.';
    throw new RoomApiError(res.status, code, typeof data.message === 'string' ? data.message : fallback, typeof data.field === 'string' ? data.field : undefined, data.paid === true);
  }
  return data as T;
}

export const roomsApi = {
  /** What a room costs this wallet now (guests: the base price). */
  quote: (token: string | null) => call<CustomRoomQuote>('/api/rooms/custom/quote', { token }),
  /** Opens a room: `txHash` is the fee payment (absent for a free room). */
  create: (token: string, config: CustomRoomConfig, txHash: string | null) =>
    call<{ room: CustomRoomView; invite: string }>('/api/rooms/custom', { method: 'POST', token, body: txHash ? { config, txHash } : { config } }),
  get: (code: string) => call<{ room: CustomRoomView }>(`/api/rooms/custom/${encodeURIComponent(code)}`).then((r) => r.room),
  mine: (token: string) => call<{ rooms: CustomRoomView[] }>('/api/rooms/custom/mine', { token }).then((r) => r.rooms),
  close: (token: string, code: string) => call<{ closed: CustomRoomView }>(`/api/rooms/custom/${encodeURIComponent(code)}`, { method: 'DELETE', token }),
};

const PAY_KEY = 'elymum.room-payment.v1';

/** A fee payment that went through but has not opened a room yet (kept for a retry: never pay twice). */
export interface PendingRoomPayment {
  hash: string;
  wallet: string;
  wei: string;
  at: number;
}

export function loadPendingPayment(wallet: string | null): PendingRoomPayment | null {
  if (!wallet) return null;
  try {
    const p = JSON.parse(localStorage.getItem(PAY_KEY) ?? 'null') as PendingRoomPayment | null;
    // the server refuses payments older than two hours
    if (!p || p.wallet.toLowerCase() !== wallet.toLowerCase() || Date.now() - p.at > 2 * 3600_000) return null;
    return p;
  } catch {
    return null;
  }
}

export function savePendingPayment(p: PendingRoomPayment | null): void {
  try {
    if (p) localStorage.setItem(PAY_KEY, JSON.stringify(p));
    else localStorage.removeItem(PAY_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The share link of a room on this site. */
export function roomLink(code: string, origin = typeof location === 'undefined' ? 'https://elymum.io' : location.origin): string {
  return `${origin.replace(/\/+$/, '')}/play?room=${code}`;
}

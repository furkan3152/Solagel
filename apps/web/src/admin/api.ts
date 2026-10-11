import type { AdminSettings, AdminSnapshot, AdminStatus, TokenMintInspection } from '@solagel/shared';
import { SERVER } from '../config';

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

const messages: Record<string, string> = {
  forbidden: 'Permission denied. This wallet is not an authorized administrator.',
  admin_forbidden: 'Permission denied. This wallet is not an authorized administrator.',
  unauthorized: 'Your admin session has expired. Sign in again.',
  admin_session_required: 'Sign in with an authorized admin wallet to continue.',
  admin_session_expired: 'Your admin session has expired. Sign in again.',
  admin_signature_invalid: 'The admin signature could not be verified. Sign the latest challenge with the connected wallet.',
  revision_conflict: 'Another administrator saved a newer version. Reload the saved settings before making this change.',
  admin_not_configured: 'Admin access is not configured on this server.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  chain_unavailable: 'The server’s Solana RPC is unavailable. Mint inspection cannot run until it is configured.',
  journal_unavailable: 'Settlement storage is unavailable. Restore its health before requesting retries.',
  invalid_bot_limits: 'Bot settings must be whole numbers from 0 to 100. The private minimum cannot exceed the private population target.',
};

async function request<T>(path: string, options: { token?: string; body?: unknown; method?: 'GET' | 'POST' | 'PUT'; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; abort(); }, 20_000);
  try {
  const response = await fetch(`${SERVER.http}/api/admin/${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: controller.signal,
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : undefined;
    const detail = typeof data?.message === 'string' ? data.message : undefined;
    throw new AdminApiError(
      (code && messages[code]) || detail || (response.status === 403 ? messages.forbidden : response.status === 401 ? messages.unauthorized : code?.replaceAll('_', ' ')) || 'The admin request failed. Try again.',
      response.status,
      code,
    );
  }
  if (data === null) throw new AdminApiError('The server returned an unreadable response.', response.status);
  return data as T;
  } catch (error) {
    if (timedOut) throw new AdminApiError('The request timed out. A submitted change may still finish. Refresh the saved settings before retrying.', 0, 'request_timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export const adminApi = {
  challenge: (pubkey: string) => request<{ nonce: string; message: string; expiresAt?: number }>('challenge', { body: { pubkey } }),
  signIn: (pubkey: string, message: string, signature: string) => request<{ token: string; expiresAt: number }>('session', { body: { pubkey, message, signature } }),
  status: (token: string, signal?: AbortSignal) => request<AdminStatus>('status', { token, signal }),
  save: (token: string, expectedRevision: number, settings: AdminSettings) => request<AdminSnapshot>('settings', { token, method: 'PUT', body: { expectedRevision, settings } }),
  inspectToken: (token: string, mintAddress: string) => request<TokenMintInspection>('inspect-token', { token, body: { mintAddress } }),
  retrySettlements: (token: string) => request<Record<string, unknown>>('retry-settlements', { token, body: {} }),
};

export const adminErrorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

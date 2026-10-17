import type {
  CollabAdmin,
  CollabApplyRequest,
  CollabPublic,
  CollabStatus,
  CollabWalletRow,
  PublicWlTask,
  SiteCounts,
  SiteErrorCode,
  SiteSettings,
  WlEntryAdmin,
  WlEntryPublic,
  WlStatus,
  WlSubmitRequest,
  WlTask,
} from '@slana/shared';
import { SERVER } from '../config';

/**
 * The slana.io site API (`/api/site/*`, `/api/admin/*`, `/api/auth/*`). Every error is a
 * `SiteApiError` with the server's code, its short English message and the offending field.
 */
export class SiteApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: SiteErrorCode | 'network',
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'SiteApiError';
  }
}

/** User-facing fallbacks when the server sends no message. */
const FALLBACK: Partial<Record<SiteApiError['code'], string>> = {
  network: 'Cannot reach slana.io right now. Check your connection and try again.',
  unauthorized: 'Your sign-in expired. Sign in with your wallet again.',
  forbidden: 'This wallet is not an admin.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  wl_closed: 'Applications are closed. Follow @slanaio for the next round.',
  collab_closed: 'Collab applications are closed. Follow @slanaio for the next round.',
  already_applied: 'This wallet has already applied.',
  handle_taken: 'This X handle has already applied.',
  collab_limit: 'This X account has already applied twice.',
  wrong_state: 'This community cannot be changed right now.',
  deadline_passed: 'The deadline has passed.',
  too_many_wallets: 'There are more wallets than spots.',
  auth_failed: 'The wallet signature did not check out. Try again.',
  bad_request: 'Something in the form is not right.',
};

export interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

async function send(path: string, { method = 'GET', body, token, signal }: RequestOpts): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${SERVER.http}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new SiteApiError(0, 'network', FALLBACK.network!);
  }
  if (!res.ok) {
    let data: { error?: SiteErrorCode; message?: string; field?: string } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* not JSON */
    }
    const code = data.error ?? (res.status === 429 ? 'rate_limited' : res.status === 401 ? 'unauthorized' : 'bad_request');
    throw new SiteApiError(res.status, code, data.message || FALLBACK[code] || 'Something went wrong.', data.field);
  }
  return res;
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const res = await send(path, opts);
  return (await res.json()) as T;
}

/** Fetches a CSV with the session header and saves it (a plain link cannot carry the header). */
export async function downloadCsv(path: string, token: string, fallbackName: string): Promise<void> {
  const res = await send(path, { token });
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(disp)?.[1] ?? fallbackName;
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const q = (params: Record<string, string | number | undefined | null>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

/* ── auth ─────────────────────────────────────────────────────────── */

export const auth = {
  login: (pubkey: string, message: string, signature: string) =>
    request<{ pubkey: string; token: string; admin: boolean }>('/api/auth/login', { method: 'POST', body: { pubkey, message, signature } }),
  me: (token: string) => request<{ pubkey: string; admin: boolean }>('/api/auth/me', { token }),
};

/* ── public site ──────────────────────────────────────────────────── */

export const site = {
  settings: (signal?: AbortSignal) => request<{ settings: SiteSettings }>('/api/site/settings', { signal }).then((r) => r.settings),
  tasks: () => request<{ tasks: PublicWlTask[] }>('/api/site/tasks').then((r) => r.tasks),
  myWl: (token: string) => request<{ entry: WlEntryPublic | null }>('/api/site/wl', { token }).then((r) => r.entry),
  submitWl: (token: string, body: WlSubmitRequest) => request<{ entry: WlEntryPublic }>('/api/site/wl', { method: 'POST', token, body }).then((r) => r.entry),
  myCollabs: (token: string) => request<{ collabs: CollabPublic[] }>('/api/site/collab', { token }).then((r) => r.collabs),
  applyCollab: (token: string, body: CollabApplyRequest) =>
    request<{ collab: CollabPublic }>('/api/site/collab', { method: 'POST', token, body }).then((r) => r.collab),
  saveWallets: (token: string, id: string, wallets: CollabWalletRow[], raffleUrl: string | null) =>
    request<{ collab: CollabPublic }>(`/api/site/collab/${encodeURIComponent(id)}/wallets`, { method: 'PUT', token, body: { wallets, raffleUrl } }).then((r) => r.collab),
  submitWallets: (token: string, id: string, wallets: CollabWalletRow[], raffleUrl: string) =>
    request<{ collab: CollabPublic }>(`/api/site/collab/${encodeURIComponent(id)}/submit`, { method: 'POST', token, body: { wallets, raffleUrl } }).then((r) => r.collab),
};

/* ── admin ────────────────────────────────────────────────────────── */

export interface WlPage {
  items: WlEntryAdmin[];
  total: number;
  page: number;
  pageSize: number;
}

export type TaskInput = Partial<Pick<WlTask, 'kind' | 'title' | 'body' | 'target' | 'required' | 'enabled'>>;

export function adminApi(token: string) {
  const id = encodeURIComponent;
  return {
    me: () => request<{ pubkey: string; admin: true }>('/api/admin/me', { token }),
    counts: () => request<SiteCounts>('/api/admin/counts', { token }),
    settings: () => request<{ settings: SiteSettings; gamePublicEnv: boolean }>('/api/admin/settings', { token }),
    saveSettings: (patch: Partial<SiteSettings>) => request<{ settings: SiteSettings; gamePublicEnv: boolean }>('/api/admin/settings', { method: 'PUT', token, body: patch }),
    tasks: () => request<{ tasks: WlTask[] }>('/api/admin/tasks', { token }).then((r) => r.tasks),
    createTask: (t: TaskInput) => request<{ task: WlTask }>('/api/admin/tasks', { method: 'POST', token, body: t }).then((r) => r.task),
    updateTask: (taskId: string, t: TaskInput) => request<{ task: WlTask }>(`/api/admin/tasks/${id(taskId)}`, { method: 'PUT', token, body: t }).then((r) => r.task),
    deleteTask: (taskId: string) => request<{ ok: true }>(`/api/admin/tasks/${id(taskId)}`, { method: 'DELETE', token }),
    orderTasks: (ids: string[]) => request<{ tasks: WlTask[] }>('/api/admin/tasks/order', { method: 'PUT', token, body: { ids } }).then((r) => r.tasks),
    wl: (p: { status?: WlStatus | ''; q?: string; page?: number; pageSize?: number }) => request<WlPage>(`/api/admin/wl${q(p)}`, { token }),
    wlEntry: (entryId: string) => request<{ entry: WlEntryAdmin }>(`/api/admin/wl/${id(entryId)}`, { token }).then((r) => r.entry),
    wlStatus: (entryId: string, status: WlStatus) => request<{ entry: WlEntryAdmin }>(`/api/admin/wl/${id(entryId)}/status`, { method: 'PUT', token, body: { status } }).then((r) => r.entry),
    wlBulk: (ids: string[], status: WlStatus) => request<{ updated: number }>('/api/admin/wl/status', { method: 'POST', token, body: { ids, status } }),
    wlNote: (entryId: string, note: string) => request<{ entry: WlEntryAdmin }>(`/api/admin/wl/${id(entryId)}/note`, { method: 'PUT', token, body: { note } }).then((r) => r.entry),
    wlCsv: (scope: 'approved' | 'all') => downloadCsv(`/api/admin/wl.csv${q({ scope })}`, token, `slana-wl-${scope}.csv`),
    collabs: (p: { status?: CollabStatus | 'closed' | ''; q?: string }) => request<{ items: CollabAdmin[] }>(`/api/admin/collabs${q(p)}`, { token }).then((r) => r.items),
    collab: (cid: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}`, { token }).then((r) => r.collab),
    approveCollab: (cid: string, spots: number, deadline: number) =>
      request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/approve`, { method: 'POST', token, body: { spots, deadline } }).then((r) => r.collab),
    rejectCollab: (cid: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/reject`, { method: 'POST', token }).then((r) => r.collab),
    extendCollab: (cid: string, deadline: number, spots?: number) =>
      request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/extend`, { method: 'POST', token, body: spots === undefined ? { deadline } : { deadline, spots } }).then((r) => r.collab),
    unlockCollab: (cid: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/unlock`, { method: 'POST', token }).then((r) => r.collab),
    collabNote: (cid: string, note: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/note`, { method: 'PUT', token, body: { note } }).then((r) => r.collab),
    collabCsv: (cid: string) => downloadCsv(`/api/admin/collabs/${id(cid)}/wallets.csv`, token, `slana-collab-${cid}.csv`),
    allCollabsCsv: () => downloadCsv('/api/admin/collabs/wallets.csv', token, 'slana-collab-wallets.csv'),
  };
}
export type AdminApi = ReturnType<typeof adminApi>;

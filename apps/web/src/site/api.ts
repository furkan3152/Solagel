import type {
  CustomRoomSettings,
  CustomRoomView,
  AdminAvatarEntry,
  BoostKind,
  ShopSettings,
  IntegrityBan,
  IntegrityFlag,
  IntegrityFlagKind,
  IntegrityFlagStatus,
  IntegrityHeld,
  IntegrityOverview,
  IntegritySettings,
  IntegrityThresholds,
  IntegrityWalletView,
  CollabAdmin,
  CollabApplyRequest,
  CollabPublic,
  CollabStatus,
  CollabWalletRow,
  AllowlistBuildResponse,
  AllowlistStatus,
  ContractKind,
  ContractRegisterRequest,
  ContractsRegistry,
  FaucetConfig,
  HolderWlView,
  NetworkInfo,
  GameAccess,
  MintPriceQuote,
  MintProofResponse,
  MintState,
  PublicWlTask,
  SiteCounts,
  SiteErrorCode,
  SiteSettings,
  WlEntryAdmin,
  WlEntryPublic,
  WlStatus,
  WlSubmitRequest,
  WlTask,
} from '@elymum/shared';
import { SERVER } from '../config';

/**
 * The site API (`/api/site/*`, `/api/admin/*`, `/api/auth/*`). Every error is a
 * `SiteApiError` with the server's code, its short English message and the offending field.
 */
/** `GET /api/admin/custom-rooms`. */
export interface CustomRoomsAdminView {
  settings: CustomRoomSettings;
  /** Where fees go now: the setting, else the owner wallet (first ADMIN_WALLETS entry). */
  treasury: string | null;
  rooms: CustomRoomView[];
}

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
  network: 'Cannot reach the server right now. Check your connection and try again.',
  unauthorized: 'Your sign-in expired. Sign in with your wallet again.',
  forbidden: 'This wallet is not an admin.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  wl_closed: 'Applications are closed. Follow @elymumio for the next round.',
  collab_closed: 'Collab applications are closed. Follow @elymumio for the next round.',
  already_applied: 'This wallet has already applied.',
  handle_taken: 'This X handle has already applied.',
  collab_limit: 'This X account has already applied twice.',
  wrong_state: 'This community cannot be changed right now.',
  deadline_passed: 'The deadline has passed.',
  too_many_wallets: 'There are more wallets than spots.',
  auth_failed: 'The wallet signature did not check out. Try again.',
  bad_request: 'Something in the form is not right.',
  game_closed: 'The game is not open to this wallet yet.',
  code_mismatch: 'That address holds no code, or code other than the Elymum contract this server ships with.',
  not_owner: 'The contract owner is not the signed-in admin wallet.',
  wrong_authority: "The arena's server authority is not this server's key.",
  chain_off: 'The server has no chain configured, or the contract is not registered.',
  price_unavailable: 'The HYPE price feed is unavailable right now.',
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

export interface AuthMe {
  address: string;
  admin: boolean;
  /** The wallet may play under the current `gameAccess` (admins, NFT holders or everyone). */
  canPlay?: boolean;
  /** The wallet holds an Elymum NFT (`balanceOf > 0`). */
  holder?: boolean;
}

export const auth = {
  /** SIWE: `message` is the rebuilt `siweMessage`, `signature` the wallet's `personal_sign` (0x hex). */
  login: (address: string, message: string, signature: string) =>
    request<{ address: string; token: string; admin: boolean }>('/api/auth/login', { method: 'POST', body: { address, message, signature } }),
  me: (token: string) => request<AuthMe>('/api/auth/me', { token }),
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
  /** `GET /api/site/mint`: contract state, HYPE/USD, the price in USD, holders, game access. */
  mint: (signal?: AbortSignal) => request<MintState>('/api/site/mint', { signal }),
  /** `GET /api/site/mint/proof?wallet=0x…`. */
  mintProof: (wallet: string, signal?: AbortSignal) => request<MintProofResponse>(`/api/site/mint/proof${q({ wallet })}`, { signal }),
  /** `GET /api/site/faucet`: the TestToken faucet (testnet only; amounts in base units). */
  faucet: () => request<FaucetConfig>('/api/site/faucet'),
  /** `GET /api/site/contracts`: the registered contracts. */
  contracts: () => request<ContractsRegistry>('/api/site/contracts'),
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
    me: () => request<{ address: string; admin: true }>('/api/admin/me', { token }),
    counts: () => request<SiteCounts>('/api/admin/counts', { token }),
    /** `gameAccessEnv`: the server's `GAME_ACCESS` override (null when unset). */
    settings: () => request<AdminSettingsResponse>('/api/admin/settings', { token }),
    saveSettings: (patch: Partial<SiteSettings>) => request<AdminSettingsResponse>('/api/admin/settings', { method: 'PUT', token, body: patch }),
    /** `POST /api/admin/contracts`: the server checks the code hash, the owner and (arena) the server authority. */
    registerContract: (body: ContractRegisterRequest) => request<{ registry: ContractsRegistry } | ContractsRegistry>('/api/admin/contracts', { method: 'POST', token, body }).then(registryOf),
    clearContract: (kind: ContractKind) => request<{ registry: ContractsRegistry } | ContractsRegistry>(`/api/admin/contracts${q({ kind })}`, { method: 'DELETE', token }).then(registryOf),
    /** `POST /api/admin/mint/allowlist`: builds a snapshot of the allowlist. */
    buildAllowlist: () => request<AllowlistBuildResponse>('/api/admin/mint/allowlist', { method: 'POST', token, body: {} }),
    allowlist: () => request<AllowlistStatus>('/api/admin/mint/allowlist', { token }),
    /** `GET /api/admin/mint/price`: HYPE/USD and the $1 price in wei. */
    mintPrice: () => request<MintPriceQuote>('/api/admin/mint/price', { token }),
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
    wlCsv: (scope: 'approved' | 'all') => downloadCsv(`/api/admin/wl.csv${q({ scope })}`, token, `elymum-wl-${scope}.csv`),
    collabs: (p: { status?: CollabStatus | 'closed' | ''; q?: string }) => request<{ items: CollabAdmin[] }>(`/api/admin/collabs${q(p)}`, { token }).then((r) => r.items),
    collab: (cid: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}`, { token }).then((r) => r.collab),
    approveCollab: (cid: string, spots: number, deadline: number) =>
      request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/approve`, { method: 'POST', token, body: { spots, deadline } }).then((r) => r.collab),
    rejectCollab: (cid: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/reject`, { method: 'POST', token }).then((r) => r.collab),
    extendCollab: (cid: string, deadline: number, spots?: number) =>
      request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/extend`, { method: 'POST', token, body: spots === undefined ? { deadline } : { deadline, spots } }).then((r) => r.collab),
    unlockCollab: (cid: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/unlock`, { method: 'POST', token }).then((r) => r.collab),
    collabNote: (cid: string, note: string) => request<{ collab: CollabAdmin }>(`/api/admin/collabs/${id(cid)}/note`, { method: 'PUT', token, body: { note } }).then((r) => r.collab),
    collabCsv: (cid: string) => downloadCsv(`/api/admin/collabs/${id(cid)}/wallets.csv`, token, `elymum-collab-${cid}.csv`),
    allCollabsCsv: () => downloadCsv('/api/admin/collabs/wallets.csv', token, 'elymum-collab-wallets.csv'),
    integrity: integrityApi(token),
    /** `GET /api/admin/avatars`: players' profile pictures, newest first. */
    avatars: (limit = 200) => request<{ items: AdminAvatarEntry[]; total: number }>(`/api/admin/avatars${q({ limit })}`, { token }),
    /** `DELETE /api/admin/avatars/<wallet>`: removes (and blocks) the wallet's picture; its coin goes back to the basic skin. */
    removeAvatar: (wallet: string) => request<{ removed: string }>(`/api/admin/avatars/${id(wallet)}`, { method: 'DELETE', token }),
    /** `GET /api/admin/bots`: the bot settings, their env defaults and the live counts (shape: `BotAdminView`). */
    bots: () => request<BotAdminView>('/api/admin/bots', { token }),
    /** `PUT /api/admin/bots`: a partial settings update; answers like the GET. */
    saveBots: (patch: BotSettingsPatch) => request<BotAdminView>('/api/admin/bots', { method: 'PUT', token, body: patch }),
    /** `GET /api/admin/custom-rooms`: the custom room settings, the effective treasury and the live rooms. */
    customRooms: () => request<CustomRoomsAdminView>('/api/admin/custom-rooms', { token }),
    /** `PUT /api/admin/custom-rooms`: a partial settings update; answers like the GET. */
    saveCustomRooms: (patch: Partial<CustomRoomSettings>) => request<CustomRoomsAdminView>('/api/admin/custom-rooms', { method: 'PUT', token, body: patch }),
    /** `DELETE /api/admin/custom-rooms/<CODE>`: closes a live room (everyone in it goes back to the lobby). */
    closeCustomRoom: (code: string) => request<{ closed: CustomRoomView; rooms: CustomRoomView[] }>(`/api/admin/custom-rooms/${id(code)}`, { method: 'DELETE', token }),
    /** `GET /api/admin/shop`: power-up prices, sink, limits and the recent purchases. */
    shop: () => request<ShopAdminView>('/api/admin/shop', { token }),
    /** `PUT /api/admin/shop`: a partial settings update; answers like the GET. */
    saveShop: (patch: Partial<ShopSettings>) => request<ShopAdminView>('/api/admin/shop', { method: 'PUT', token, body: patch }),
    /**
     * `POST /api/admin/mint/import-holders` (`{ fromChainId? }`, default the testnet): adds every
     * testnet emblem holder to the mainnet allowlist, recorded per wallet with the source.
     * 409: no NFT on that chain; 502 / 503: the chain did not answer.
     */
    importHolders: (fromChainId?: number) =>
      request<HolderWlView>('/api/admin/mint/import-holders', { method: 'POST', token, body: fromChainId === undefined ? {} : { fromChainId } }),
    /** `GET /api/admin/mint/import-holders`: the last import; null when the server has no such route (404). */
    holderImport: async (): Promise<HolderWlView | null> => {
      try {
        return await request<HolderWlView>('/api/admin/mint/import-holders', { token });
      } catch (err) {
        if (err instanceof SiteApiError && (err.status === 404 || err.status === 405)) return err.status === 405 ? emptyImport() : null;
        throw err;
      }
    },
    /** `GET /api/admin/network`: the server's chain, RPC health, server key and the contracts' code checks. */
    network: () => request<NetworkInfo>('/api/admin/network', { token }),
  };
}

export type AdminApi = ReturnType<typeof adminApi>;

export interface AdminSettingsResponse {
  settings: SiteSettings;
  /** The server's `GAME_ACCESS` env override; it wins over the stored setting. */
  gameAccessEnv?: GameAccess | null;
}

/** The registry from either `{ registry }` or the bare registry. */
const registryOf = (r: { registry: ContractsRegistry } | ContractsRegistry): ContractsRegistry => ('registry' in r ? r.registry : r);

export interface IntegrityFilter {
  status?: IntegrityFlagStatus | '';
  kind?: IntegrityFlagKind | '';
  minScore?: number | null;
  q?: string;
}

export interface IntegritySettingsPatch {
  autoHold?: boolean;
  holdScore?: number;
  thresholds?: Partial<IntegrityThresholds>;
  reset?: true;
}

/** `/api/admin/integrity/*`: flags, bans, held settlements and the detector settings. */
function integrityApi(token: string) {
  const id = encodeURIComponent;
  const base = '/api/admin/integrity';
  return {
    overview: () => request<IntegrityOverview>(base, { token }),
    scan: () => request<IntegrityOverview>(`${base}/scan`, { method: 'POST', token, body: {} }),
    flags: (f: IntegrityFilter) => request<{ flags: IntegrityFlag[] }>(`${base}/flags${q({ ...f, minScore: f.minScore ?? undefined })}`, { token }).then((r) => r.flags),
    flagsCsv: (f: IntegrityFilter) => downloadCsv(`${base}/flags.csv${q({ ...f, minScore: f.minScore ?? undefined })}`, token, 'elymum-integrity-flags.csv'),
    setStatus: (flagId: string, status: IntegrityFlagStatus, note?: string) =>
      request<{ flag: IntegrityFlag }>(`${base}/flags/${id(flagId)}/status`, { method: 'POST', token, body: note === undefined ? { status } : { status, note } }).then((r) => r.flag),
    wallet: (wallet: string, other?: string) => request<IntegrityWalletView>(`${base}/wallet/${id(wallet)}${q({ other })}`, { token }),
    ban: (wallet: string, reason: string) => request<{ ban: IntegrityBan }>(`${base}/bans`, { method: 'POST', token, body: { wallet, reason } }).then((r) => r.ban),
    unban: (wallet: string) => request<{ ok: true }>(`${base}/bans/${id(wallet)}`, { method: 'DELETE', token }),
    release: (key: string) => request<{ ok: true; held: IntegrityHeld[] }>(`${base}/held/${id(key)}/release`, { method: 'POST', token, body: {} }).then((r) => r.held),
    settleZero: (key: string, reason: string) =>
      request<{ ok: true; forfeited: number; held: IntegrityHeld[] }>(`${base}/held/${id(key)}/settle-zero`, { method: 'POST', token, body: { reason } }),
    saveSettings: (patch: IntegritySettingsPatch) => request<{ settings: IntegritySettings }>(`${base}/settings`, { method: 'PUT', token, body: patch }).then((r) => r.settings),
  };
}
export type IntegrityApi = ReturnType<typeof integrityApi>;

/* ── power-up shop (`/api/admin/shop`) ─────────────────────────────── */

/** One credited power-up purchase. */
export interface ShopPurchase {
  tx: string;
  wallet: string;
  kind: BoostKind;
  charges: number;
  /** Raw base units (decimal string). */
  paid: string;
  at: number;
}

/** `GET /api/admin/shop`. */
export interface ShopAdminView {
  settings: ShopSettings;
  defaults: ShopSettings;
  /** Where payments go now (null: treasury chosen but no owner wallet). */
  sink: string | null;
  /** The first `ADMIN_WALLETS` entry (the treasury when none is set). */
  owner: string | null;
  purchases: ShopPurchase[];
  purchaseCount: number;
}

/* ── bots (`/api/admin/bots`) ─────────────────────────────────────── */

/** One kind of room's bot settings (`practiceRookie`, `practicePro`, `arena`, `private`). */
export interface BotKindSettings {
  enabled: boolean;
  /** Most bots in one room (0..64). */
  cap: number;
  /** Bots kept even when the room is busy (<= cap). */
  min: number;
  /** Wanted population, people + bots (0..200). */
  target: number;
  /** Difficulty mix, as weights. */
  mix: Record<string, number>;
  /** Most mass one bot keeps (0: no cap; older servers leave it out). */
  massCap?: number;
}

export interface BotSettings {
  kinds: Record<string, BotKindSettings>;
  testnet: {
    stakedPerArena: number;
    /** Whole tokens, decimal string. */
    bankroll: string;
    /** HYPE per bot wallet for gas, decimal string. */
    gasHype: string;
    arenas: Record<string, { stakedBots?: number; bankroll?: string }>;
  };
}

export interface BotRoomCount {
  id: string;
  kind: string;
  name: string;
  arenaId?: number;
  humans: number;
  bots: number;
  stakedBots: number;
}

export interface BotTotals {
  rooms: number;
  humans: number;
  bots: number;
  stakedBots: number;
}

export interface BotAdminView {
  settings: BotSettings;
  defaults?: BotSettings;
  /** The chain is Elysium Testnet: arenas may field staked bots. */
  testnet: boolean;
  /** Staked bots really run. */
  stakedActive?: boolean;
  /** The staked-bot wallets and what is in their way (`problem`: shown with its fix). */
  staked?: { active: boolean; chainId: number | null; wallets: number; playing: number; problem: string | null };
  live: { rooms: BotRoomCount[]; byKind?: Record<string, BotTotals>; totals?: BotTotals };
}

export type BotSettingsPatch = {
  kinds?: Record<string, Partial<Omit<BotKindSettings, 'mix'>> & { mix?: Record<string, number> }>;
  testnet?: Partial<Omit<BotSettings['testnet'], 'arenas'>> & { arenas?: Record<string, { stakedBots?: number; bankroll?: string } | null> };
};

const emptyImport = (): HolderWlView => ({ entries: [], counts: { wallets: 0, tokens: 0, alsoWl: 0 }, importedAt: null, importedFrom: null });

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLLAB_STATUSES,
  GAME_ACCESS_MODES,
  SITE_LIMITS,
  SITE_SETTINGS_DEFAULT,
  SITE_X_HANDLE_DEFAULT,
  WL_STATUSES,
  WL_TASK_WALLET,
  WL_TASK_X_HANDLE,
  isGameAccess,
  isXStatusUrl,
  normalizeXHandle,
  type CollabAdmin,
  type CollabPhase,
  type CollabPublic,
  type CollabRole,
  type CollabStatus,
  type CollabType,
  type CollabWalletRow,
  type PublicWlTask,
  type SiteCounts,
  type SiteSettings,
  type WlEntryAdmin,
  type WlEntryPublic,
  type WlStatus,
  type WlTask,
  type WlTaskAnswer,
} from '@elymum/shared';
import * as v from './validate';
import { SiteFail, bad } from './validate';

/** Index key of a stored wallet: EVM addresses compare case-insensitively. */
const wkey = (w: string): string => w.toLowerCase();

/**
 * Earlier defaults of the project's X handle. A stored `xHandle` equal to one of them is switched to
 * `SITE_X_HANDLE_DEFAULT` on load, and the seeded tasks' text and links that name one are rewritten to
 * the current handle (an admin-chosen handle, custom tasks and WL answers are never touched).
 */
export const PREVIOUS_X_HANDLES: readonly string[] = ['elymum'];

/** The ids of the seeded tasks (`defaultTasks`), the only ones the handle migration rewrites. */
const SEEDED_TASK_IDS = new Set(['follow_x', 'post_x', 'engage_launch', WL_TASK_X_HANDLE, WL_TASK_WALLET]);

/** `@old` and `x.com/old` (also twitter.com) as whole handles, case-insensitive (handles are `[A-Za-z0-9_]`). */
function handleRefs(old: string): RegExp[] {
  return [new RegExp(`@${old}(?![A-Za-z0-9_])`, 'gi'), new RegExp(`((?:x|twitter)\\.com/)${old}(?![A-Za-z0-9_])`, 'gi')];
}

/** Rewrites every reference to a previous default handle in `text` to `handle`. */
export function rewriteHandle(text: string, handle: string): string {
  let out = text;
  for (const old of PREVIOUS_X_HANDLES) {
    if (old === handle) continue;
    const [at, link] = handleRefs(old);
    out = out.replace(at, `@${handle}`).replace(link, `$1${handle}`);
  }
  return out;
}

/** A WL entry as stored. */
interface WlRecord {
  id: string;
  wallet: string;
  xHandle: string;
  status: WlStatus;
  tasks: WlTaskAnswer[];
  note: string;
  createdAt: number;
  updatedAt: number;
}

/** A collab as stored. */
interface CollabRecord {
  id: string;
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
  spots: number | null;
  deadline: number | null;
  wallets: CollabWalletRow[];
  raffleUrl: string | null;
  submittedAt: number | null;
  note: string;
  createdAt: number;
  updatedAt: number;
}

/** The seeded WL tasks (spec "Default tasks"). */
export function defaultTasks(): WlTask[] {
  return [
    {
      id: 'follow_x',
      kind: 'follow_x',
      title: `Follow @${SITE_X_HANDLE_DEFAULT}`,
      body: `Follow @${SITE_X_HANDLE_DEFAULT} on X.`,
      target: `https://x.com/${SITE_X_HANDLE_DEFAULT}`,
      required: true,
      enabled: true,
      order: 0,
    },
    {
      id: 'post_x',
      kind: 'post_x',
      title: 'Post about Elymum on X',
      body: `Post about Elymum on X, tag @${SITE_X_HANDLE_DEFAULT}, then paste the link to your post.`,
      target: null,
      required: true,
      enabled: true,
      order: 1,
    },
    {
      id: 'engage_launch',
      kind: 'engage_x',
      title: 'Like, repost and reply to the launch post',
      body: 'Like, repost and reply to the pinned launch post, then paste the link to your reply.',
      // null: the launch post link from the settings (`launchPostUrl`)
      target: null,
      required: true,
      enabled: true,
      order: 2,
    },
    {
      id: WL_TASK_X_HANDLE,
      kind: 'text',
      title: 'Your X handle',
      body: 'The X account you did the tasks with.',
      target: null,
      required: true,
      enabled: true,
      order: 3,
    },
    {
      id: WL_TASK_WALLET,
      kind: 'wallet',
      title: 'Your EVM wallet',
      body: 'The wallet you signed in with (0x…). Signing is free and sends no transaction.',
      target: null,
      required: true,
      enabled: true,
      order: 4,
    },
  ];
}

export const SITE_FILES = { settings: 'site/settings.json', tasks: 'site/tasks.json', wl: 'site/wl.json', collab: 'site/collab.json' } as const;

const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;

/** A CSV cell: quoted when needed; a leading `= + - @` is defused so spreadsheets do not run it as a formula. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csv = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const iso = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());

export interface SiteStoreOptions {
  /** Wall clock (Unix ms); tests inject one. */
  now?: () => number;
  /**
   * Defaults of settings the file does not hold yet (a fresh settings file). On Elysium Testnet the
   * app passes `gameAccess: 'public'`; a stored value always wins.
   */
  defaults?: Partial<SiteSettings>;
  log?: (m: string) => void;
}

/**
 * The site's data: settings, WL tasks, WL entries and collabs. Kept in memory and written as
 * small JSON files under `DATA_DIR/site/` with write-to-temp + rename (like the stake journal),
 * so each file on disk is always a complete snapshot. `dataDir` null: memory only (tests).
 */
export class SiteStore {
  private settingsV: SiteSettings;
  private readonly defaults: SiteSettings;
  private tasksV: WlTask[] = defaultTasks();
  private wl: WlRecord[] = [];
  private collabs: CollabRecord[] = [];
  private readonly wlByWallet = new Map<string, WlRecord>();
  private readonly wlByHandle = new Map<string, WlRecord>();
  private readonly now: () => number;
  private readonly log: (m: string) => void;

  constructor(
    private readonly dataDir: string | null,
    opts: SiteStoreOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.defaults = { ...SITE_SETTINGS_DEFAULT, ...opts.defaults };
    this.settingsV = { ...this.defaults };
    this.load();
  }

  // ---------- persistence ----------

  private path(file: keyof typeof SITE_FILES): string | null {
    return this.dataDir ? join(this.dataDir, SITE_FILES[file]) : null;
  }

  private read<T>(file: keyof typeof SITE_FILES, check: (x: unknown) => T | null): T | null {
    const p = this.path(file);
    if (!p || !existsSync(p)) return null;
    let parsed: T | null = null;
    try {
      parsed = check(JSON.parse(readFileSync(p, 'utf8')));
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      // keep the unreadable file for the operator and start that part fresh
      const backup = `${p}.corrupt-${Date.now()}`;
      renameSync(p, backup);
      this.log(`site: ${SITE_FILES[file]} is unreadable; moved to ${backup}`);
    }
    return parsed;
  }

  private load(): void {
    const settings = this.read('settings', (x) => (x && typeof x === 'object' ? (x as Partial<SiteSettings>) : null));
    if (settings) {
      const d = this.defaults;
      const handle = normalizeXHandle(settings.xHandle);
      const previous = handle !== null && handle !== SITE_X_HANDLE_DEFAULT && PREVIOUS_X_HANDLES.includes(handle);
      this.settingsV = {
        wlOpen: typeof settings.wlOpen === 'boolean' ? settings.wlOpen : d.wlOpen,
        collabOpen: typeof settings.collabOpen === 'boolean' ? settings.collabOpen : d.collabOpen,
        gameAccess: isGameAccess(settings.gameAccess) ? settings.gameAccess : d.gameAccess,
        xHandle: handle && !previous ? handle : d.xHandle,
        launchPostUrl: isXStatusUrl(settings.launchPostUrl) ? settings.launchPostUrl : null,
      };
      if (previous) {
        this.log(`site: xHandle @${handle} is a previous default; now @${this.settingsV.xHandle}`);
        this.save('settings');
      }
    }
    const tasks = this.read('tasks', (x) => (Array.isArray(x) ? (x as WlTask[]) : null));
    if (tasks) {
      const handle = this.settingsV.xHandle;
      let migrated = 0;
      this.tasksV = tasks.map((t) => {
        if (!SEEDED_TASK_IDS.has(t.id)) return t;
        const next = { ...t, title: rewriteHandle(t.title, handle), body: rewriteHandle(t.body, handle), target: t.target === null ? null : rewriteHandle(t.target, handle) };
        if (next.title === t.title && next.body === t.body && next.target === t.target) return t;
        migrated++;
        return next;
      });
      if (migrated > 0) {
        this.log(`site: ${migrated} seeded WL task(s) now name @${handle}`);
        this.save('tasks');
      }
    }
    const wl = this.read('wl', (x) => (Array.isArray(x) ? (x as WlRecord[]) : null));
    if (wl) this.wl = wl;
    const collabs = this.read('collab', (x) => (Array.isArray(x) ? (x as CollabRecord[]) : null));
    if (collabs) this.collabs = collabs;
    for (const e of this.wl) {
      this.wlByWallet.set(wkey(e.wallet), e);
      this.wlByHandle.set(e.xHandle, e);
    }
    this.sortTasks();
  }

  private save(file: keyof typeof SITE_FILES): void {
    const p = this.path(file);
    if (!p) return;
    const data = file === 'settings' ? this.settingsV : file === 'tasks' ? this.tasksV : file === 'wl' ? this.wl : this.collabs;
    mkdirSync(join(this.dataDir!, 'site'), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, p);
  }

  // ---------- settings ----------

  get settings(): SiteSettings {
    return { ...this.settingsV };
  }

  updateSettings(body: Record<string, unknown>): SiteSettings {
    const next = { ...this.settingsV };
    for (const key of Object.keys(body)) {
      switch (key) {
        case 'wlOpen':
        case 'collabOpen':
          next[key] = v.bool(body[key], key);
          break;
        case 'gameAccess':
          next.gameAccess = v.oneOf(body.gameAccess, 'gameAccess', GAME_ACCESS_MODES);
          break;
        case 'xHandle':
          next.xHandle = v.handle(body.xHandle, 'xHandle');
          break;
        case 'launchPostUrl':
          next.launchPostUrl = body.launchPostUrl === null || body.launchPostUrl === '' ? null : v.statusUrl(body.launchPostUrl, 'launchPostUrl');
          break;
        default:
          throw bad(key, `unknown setting ${key}`);
      }
    }
    this.settingsV = next;
    this.save('settings');
    return this.settings;
  }

  // ---------- tasks ----------

  private sortTasks(): void {
    this.tasksV.sort((a, b) => a.order - b.order);
    this.tasksV.forEach((t, i) => (t.order = i));
  }

  get tasks(): WlTask[] {
    return this.tasksV.map((t) => ({ ...t }));
  }

  private resolveTarget(t: WlTask): string | null {
    return t.target ?? (t.kind === 'engage_x' ? this.settingsV.launchPostUrl : null);
  }

  /** Enabled tasks in order, targets resolved; an `engage_x` task without a post is not available yet. */
  publicTasks(): PublicWlTask[] {
    return this.tasksV
      .filter((t) => t.enabled)
      .map((t) => {
        const target = this.resolveTarget(t);
        const available = !(t.kind === 'engage_x' && !target);
        return { id: t.id, kind: t.kind, title: t.title, body: t.body, target, required: t.required && available, available };
      });
  }

  private taskFields(body: Record<string, unknown>, base: WlTask): WlTask {
    const kind = body.kind === undefined ? base.kind : v.taskKind(body.kind);
    return {
      ...base,
      kind,
      title: body.title === undefined ? base.title : v.text(body.title, 'title', SITE_LIMITS.taskTitle, { min: 1 }),
      body: body.body === undefined ? base.body : v.text(body.body, 'body', SITE_LIMITS.taskBody, { multiline: true }),
      target: body.target === undefined ? base.target : v.taskTarget(body.target, kind),
      required: body.required === undefined ? base.required : v.bool(body.required, 'required'),
      enabled: body.enabled === undefined ? base.enabled : v.bool(body.enabled, 'enabled'),
    };
  }

  createTask(body: Record<string, unknown>): WlTask {
    if (this.tasksV.length >= SITE_LIMITS.maxTasks) throw bad('tasks', `At most ${SITE_LIMITS.maxTasks} tasks`);
    if (body.kind === undefined) throw bad('kind', 'kind is required');
    if (body.title === undefined) throw bad('title', 'title is required');
    const base: WlTask = { id: newId('t'), kind: 'text', title: '', body: '', target: null, required: true, enabled: true, order: this.tasksV.length };
    const task = this.taskFields(body, base);
    this.tasksV.push(task);
    this.sortTasks();
    this.save('tasks');
    return { ...task };
  }

  updateTask(id: string, body: Record<string, unknown>): WlTask {
    const i = this.tasksV.findIndex((t) => t.id === id);
    if (i < 0) throw new SiteFail(404, 'not_found', 'No such task');
    if (body.id !== undefined && body.id !== id) throw bad('id', 'the id cannot change');
    const task = this.taskFields(body, this.tasksV[i]);
    this.tasksV[i] = task;
    this.save('tasks');
    return { ...task };
  }

  deleteTask(id: string): void {
    const i = this.tasksV.findIndex((t) => t.id === id);
    if (i < 0) throw new SiteFail(404, 'not_found', 'No such task');
    this.tasksV.splice(i, 1);
    this.sortTasks();
    this.save('tasks');
  }

  /** New order: `ids` must list every task exactly once. */
  reorderTasks(ids: unknown): WlTask[] {
    if (!Array.isArray(ids) || ids.length !== this.tasksV.length || new Set(ids).size !== ids.length) throw bad('ids', 'ids must list every task once');
    const byId = new Map(this.tasksV.map((t) => [t.id, t]));
    const next = ids.map((id) => byId.get(id as string));
    if (next.some((t) => !t)) throw bad('ids', 'ids must list every task once');
    next.forEach((t, i) => (t!.order = i));
    this.tasksV = next as WlTask[];
    this.save('tasks');
    return this.tasks;
  }

  // ---------- WL ----------

  private wlPublic(e: WlRecord): WlEntryPublic {
    return {
      id: e.id,
      wallet: e.wallet,
      xHandle: e.xHandle,
      status: e.status,
      tasks: e.tasks.map((t) => ({ ...t })),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  private wlAdmin(e: WlRecord, dup = this.collabWalletIndex()): WlEntryAdmin {
    return { ...this.wlPublic(e), note: e.note, dupCollabs: dup.get(wkey(e.wallet)) ?? [] };
  }

  myWl(wallet: string): WlEntryPublic | null {
    const e = this.wlByWallet.get(wkey(wallet));
    return e ? this.wlPublic(e) : null;
  }

  submitWl(wallet: string, body: Record<string, unknown>): WlEntryPublic {
    v.honeypot(body);
    if (!this.settingsV.wlOpen) throw new SiteFail(403, 'wl_closed', `Applications are closed. Follow @${this.settingsV.xHandle}.`);
    if (this.wlByWallet.has(wkey(wallet))) throw new SiteFail(409, 'already_applied', 'This wallet already applied.');
    const xHandle = v.handle(body.xHandle, 'xHandle');
    if (this.wlByHandle.has(xHandle)) throw new SiteFail(409, 'handle_taken', 'This X handle already applied.', 'xHandle');
    const answers = body.answers === undefined ? {} : v.obj(body.answers, 'answers');
    if (Object.keys(answers).length > 60) throw bad('answers', 'too many answers');
    const tasks: WlTaskAnswer[] = this.publicTasks().map((t) => {
      const field = `answers.${t.id}`;
      const given = answers[t.id];
      let answer: string | true | null = null;
      if (t.kind === 'wallet' || t.id === WL_TASK_WALLET) answer = wallet;
      else if (t.id === WL_TASK_X_HANDLE) answer = xHandle;
      else if (!t.available) answer = null;
      else if (given === undefined || given === null || given === '' || given === false) {
        if (t.required) throw bad(field, `"${t.title}" is required`);
      } else if (t.kind === 'follow_x' || t.kind === 'join_link') {
        if (given !== true) throw bad(field, `"${t.title}": confirm it with true`);
        answer = true;
      } else if (t.kind === 'post_x' || t.kind === 'engage_x') {
        answer = v.statusUrl(given, field);
      } else {
        answer = v.text(given, field, SITE_LIMITS.textAnswer, { min: t.required ? 1 : 0, multiline: true }) || null;
      }
      return { id: t.id, kind: t.kind, title: t.title, target: t.target, required: t.required, answer };
    });
    const now = this.now();
    const e: WlRecord = { id: newId('wl'), wallet, xHandle, status: 'pending', tasks, note: '', createdAt: now, updatedAt: now };
    this.wl.push(e);
    this.wlByWallet.set(wkey(wallet), e);
    this.wlByHandle.set(xHandle, e);
    this.save('wl');
    return this.wlPublic(e);
  }

  listWl(q: { status?: string | null; q?: string | null; page?: number; pageSize?: number }): {
    items: WlEntryAdmin[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const status = q.status ? v.oneOf(q.status, 'status', WL_STATUSES) : null;
    const needle = (q.q ?? '').trim().toLowerCase().replace(/^@/, '');
    const pageSize = Math.min(Math.max(1, Math.floor(q.pageSize ?? 50) || 50), SITE_LIMITS.pageSizeMax);
    const page = Math.max(1, Math.floor(q.page ?? 1) || 1);
    const rows = this.wl
      .filter((e) => !status || e.status === status)
      .filter(
        (e) => !needle || e.wallet.toLowerCase().includes(needle) || e.xHandle.includes(needle) || e.id === needle || e.note.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    const dup = this.collabWalletIndex();
    return { items: rows.slice((page - 1) * pageSize, page * pageSize).map((e) => this.wlAdmin(e, dup)), total: rows.length, page, pageSize };
  }

  getWl(id: string): WlEntryAdmin {
    const e = this.wl.find((x) => x.id === id);
    if (!e) throw new SiteFail(404, 'not_found', 'No such entry');
    return this.wlAdmin(e);
  }

  /** Sets the status of one or more entries; unknown ids fail the whole call. */
  setWlStatus(ids: unknown, status: unknown): number {
    const st = v.oneOf(status, 'status', WL_STATUSES);
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > SITE_LIMITS.bulk) throw bad('ids', `ids must list 1 to ${SITE_LIMITS.bulk} entries`);
    const byId = new Map(this.wl.map((e) => [e.id, e]));
    const hits = ids.map((id) => byId.get(id as string));
    if (hits.some((e) => !e)) throw new SiteFail(404, 'not_found', 'Unknown entry id');
    const now = this.now();
    for (const e of hits) {
      e!.status = st;
      e!.updatedAt = now;
    }
    this.save('wl');
    return hits.length;
  }

  setWlNote(id: string, note: unknown): WlEntryAdmin {
    const e = this.wl.find((x) => x.id === id);
    if (!e) throw new SiteFail(404, 'not_found', 'No such entry');
    e.note = v.text(note, 'note', SITE_LIMITS.note, { multiline: true });
    e.updatedAt = this.now();
    this.save('wl');
    return this.wlAdmin(e);
  }

  wlCsv(scope: 'approved' | 'all'): string {
    const dup = this.collabWalletIndex();
    const rows = this.wl
      .filter((e) => scope === 'all' || e.status === 'approved')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => [e.wallet, e.xHandle, e.status, iso(e.createdAt), (dup.get(wkey(e.wallet)) ?? []).join(' '), e.note]);
    return csv([['wallet', 'x_handle', 'status', 'created_at', 'dup_collabs', 'note'], ...rows]);
  }

  // ---------- collabs ----------

  phase(c: CollabRecord): CollabPhase {
    if (c.status === 'pending') return 'in_review';
    if (c.status === 'approved' && c.deadline !== null && this.now() > c.deadline) return 'closed';
    return c.status;
  }

  private collabPublic(c: CollabRecord): CollabPublic {
    const { note: _note, ...rest } = c;
    return { ...rest, wallets: c.wallets.map((w) => ({ ...w })), phase: this.phase(c) };
  }

  /** Wallet (index key) → ids of the (not rejected) collabs whose list holds it. */
  private collabWalletIndex(): Map<string, string[]> {
    const idx = new Map<string, string[]>();
    for (const c of this.collabs) {
      if (c.status === 'rejected') continue;
      for (const w of c.wallets) idx.set(wkey(w.wallet), [...(idx.get(wkey(w.wallet)) ?? []), c.id]);
    }
    return idx;
  }

  private collabAdmin(c: CollabRecord, dup = this.collabWalletIndex()): CollabAdmin {
    return {
      ...this.collabPublic(c),
      note: c.note,
      wallets: c.wallets.map((w) => ({
        ...w,
        dupWl: this.wlByWallet.has(wkey(w.wallet)),
        dupCollabs: (dup.get(wkey(w.wallet)) ?? []).filter((id) => id !== c.id),
      })),
    };
  }

  private collab(id: string): CollabRecord {
    const c = this.collabs.find((x) => x.id === id);
    if (!c) throw new SiteFail(404, 'not_found', 'No such collab');
    return c;
  }

  /** The applicant's collab: someone else's reads as not found. */
  private ownCollab(wallet: string, id: string): CollabRecord {
    const c = this.collabs.find((x) => x.id === id && wkey(x.wallet) === wkey(wallet));
    if (!c) throw new SiteFail(404, 'not_found', 'No such collab');
    return c;
  }

  myCollabs(wallet: string): CollabPublic[] {
    return this.collabs.filter((c) => wkey(c.wallet) === wkey(wallet)).map((c) => this.collabPublic(c));
  }

  applyCollab(wallet: string, body: Record<string, unknown>): CollabPublic {
    if (!this.settingsV.collabOpen) {
      v.honeypot(body);
      throw new SiteFail(403, 'collab_closed', 'Collab applications are closed.');
    }
    const form = v.collabApply(body);
    if (this.collabs.filter((c) => c.contactX === form.contactX).length >= SITE_LIMITS.collabsPerHandle) {
      throw new SiteFail(409, 'collab_limit', `An X account can apply at most ${SITE_LIMITS.collabsPerHandle} times.`, 'contactX');
    }
    const now = this.now();
    const c: CollabRecord = {
      id: newId('co'),
      wallet,
      ...form,
      status: 'pending',
      spots: null,
      deadline: null,
      wallets: [],
      raffleUrl: null,
      submittedAt: null,
      note: '',
      createdAt: now,
      updatedAt: now,
    };
    this.collabs.push(c);
    this.save('collab');
    return this.collabPublic(c);
  }

  /** The list can change only while approved and before the deadline. */
  private assertEditable(c: CollabRecord): void {
    if (c.status === 'submitted') throw new SiteFail(409, 'wrong_state', 'The list is submitted and locked.');
    if (c.status !== 'approved') throw new SiteFail(409, 'wrong_state', 'This collab is not approved.');
    if (this.phase(c) === 'closed') throw new SiteFail(409, 'deadline_passed', 'The deadline has passed.');
  }

  /** Saves a draft of the list (and optionally the raffle link). */
  saveCollabWallets(wallet: string, id: string, body: Record<string, unknown>): CollabPublic {
    const c = this.ownCollab(wallet, id);
    this.assertEditable(c);
    c.wallets = v.walletRows(body.wallets, c.spots ?? 0);
    if (body.raffleUrl !== undefined) c.raffleUrl = body.raffleUrl === null || body.raffleUrl === '' ? null : v.statusUrl(body.raffleUrl, 'raffleUrl');
    c.updatedAt = this.now();
    this.save('collab');
    return this.collabPublic(c);
  }

  /** Submits (locks) the list: needs the raffle post, at least one wallet, at most `spots`. */
  submitCollab(wallet: string, id: string, body: Record<string, unknown>): CollabPublic {
    const c = this.ownCollab(wallet, id);
    this.assertEditable(c);
    const raffleUrl = v.statusUrl(body.raffleUrl, 'raffleUrl');
    const wallets = body.wallets === undefined ? c.wallets : v.walletRows(body.wallets, c.spots ?? 0);
    if (wallets.length === 0) throw bad('wallets', 'Add at least one wallet');
    if (wallets.length > (c.spots ?? 0)) throw new SiteFail(400, 'too_many_wallets', `At most ${c.spots} wallets (your spots)`, 'wallets');
    const now = this.now();
    Object.assign(c, { wallets, raffleUrl, status: 'submitted', submittedAt: now, updatedAt: now });
    this.save('collab');
    return this.collabPublic(c);
  }

  listCollabs(q: { status?: string | null; q?: string | null } = {}): CollabAdmin[] {
    const status = q.status ? v.oneOf(q.status, 'status', [...COLLAB_STATUSES, 'closed'] as const) : null;
    const needle = (q.q ?? '').trim().toLowerCase().replace(/^@/, '');
    const dup = this.collabWalletIndex();
    return this.collabs
      .filter((c) => !status || (status === 'closed' ? this.phase(c) === 'closed' : c.status === status))
      .filter(
        (c) =>
          !needle ||
          c.community.toLowerCase().includes(needle) ||
          c.contactX.includes(needle) ||
          c.communityX.includes(needle) ||
          c.wallet.toLowerCase().includes(needle) ||
          c.id === needle,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => this.collabAdmin(c, dup));
  }

  getCollab(id: string): CollabAdmin {
    return this.collabAdmin(this.collab(id));
  }

  private deadline(vl: unknown): number {
    if (typeof vl !== 'number' || !Number.isInteger(vl) || vl <= this.now()) throw bad('deadline', 'deadline must be a future time (Unix ms)');
    if (vl > this.now() + 366 * 86_400_000) throw bad('deadline', 'deadline must be within a year');
    return vl;
  }

  approveCollab(id: string, body: Record<string, unknown>): CollabAdmin {
    const c = this.collab(id);
    if (c.status === 'submitted') throw new SiteFail(409, 'wrong_state', 'Unlock the submitted list first.');
    const spots = v.int(body.spots, 'spots', Math.max(1, c.wallets.length), SITE_LIMITS.maxSpots);
    const deadline = this.deadline(body.deadline);
    Object.assign(c, { status: 'approved', spots, deadline, updatedAt: this.now() });
    this.save('collab');
    return this.getCollab(id);
  }

  rejectCollab(id: string): CollabAdmin {
    const c = this.collab(id);
    if (c.status === 'submitted') throw new SiteFail(409, 'wrong_state', 'Unlock the submitted list first.');
    Object.assign(c, { status: 'rejected', updatedAt: this.now() });
    this.save('collab');
    return this.getCollab(id);
  }

  /** A new deadline (and optionally more or fewer spots) for an approved or submitted collab. */
  extendCollab(id: string, body: Record<string, unknown>): CollabAdmin {
    const c = this.collab(id);
    if (c.status !== 'approved' && c.status !== 'submitted') throw new SiteFail(409, 'wrong_state', 'Only an approved collab has a deadline.');
    c.deadline = this.deadline(body.deadline);
    if (body.spots !== undefined) c.spots = v.int(body.spots, 'spots', Math.max(1, c.wallets.length), SITE_LIMITS.maxSpots);
    c.updatedAt = this.now();
    this.save('collab');
    return this.getCollab(id);
  }

  /** Reopens a submitted list for edits (back to approved; extend too when the deadline passed). */
  unlockCollab(id: string): CollabAdmin {
    const c = this.collab(id);
    if (c.status !== 'submitted') throw new SiteFail(409, 'wrong_state', 'Only a submitted list can be unlocked.');
    Object.assign(c, { status: 'approved', submittedAt: null, updatedAt: this.now() });
    this.save('collab');
    return this.getCollab(id);
  }

  setCollabNote(id: string, note: unknown): CollabAdmin {
    const c = this.collab(id);
    c.note = v.text(note, 'note', SITE_LIMITS.note, { multiline: true });
    c.updatedAt = this.now();
    this.save('collab');
    return this.getCollab(id);
  }

  private walletCsvRows(c: CollabRecord, dup: Map<string, string[]>): unknown[][] {
    return c.wallets.map((w) => [
      c.id,
      c.community,
      w.name,
      w.wallet,
      this.wlByWallet.has(wkey(w.wallet)) ? 'yes' : '',
      (dup.get(wkey(w.wallet)) ?? []).filter((x) => x !== c.id).join(' '),
    ]);
  }

  static readonly COLLAB_CSV_HEADER = ['collab_id', 'community', 'name', 'wallet', 'dup_wl', 'dup_collabs'];

  collabCsv(id: string): string {
    const c = this.collab(id);
    return csv([SiteStore.COLLAB_CSV_HEADER, ...this.walletCsvRows(c, this.collabWalletIndex())]);
  }

  /** Every submitted collab's wallets. */
  allCollabsCsv(): string {
    const dup = this.collabWalletIndex();
    const rows = this.collabs
      .filter((c) => c.status === 'submitted')
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
      .flatMap((c) => this.walletCsvRows(c, dup));
    return csv([SiteStore.COLLAB_CSV_HEADER, ...rows]);
  }

  /**
   * The allowlist sources: every approved WL wallet plus every wallet of a submitted collab list.
   * Not de-duplicated across sources; `buildMerkleTree` normalizes (checksums, de-duplicates and sorts).
   */
  allowlistSources(): { wl: string[]; collab: string[] } {
    const wl = this.wl.filter((e) => e.status === 'approved').map((e) => e.wallet);
    const collab = this.collabs.filter((c) => c.status === 'submitted').flatMap((c) => c.wallets.map((w) => w.wallet));
    return { wl, collab };
  }

  counts(): SiteCounts {
    const wl = { pending: 0, approved: 0, rejected: 0, total: this.wl.length };
    for (const e of this.wl) wl[e.status]++;
    const collab = { pending: 0, rejected: 0, approved: 0, submitted: 0, total: this.collabs.length, closed: 0, wallets: 0 };
    for (const c of this.collabs) {
      collab[c.status]++;
      if (this.phase(c) === 'closed') collab.closed++;
      if (c.status === 'submitted') collab.wallets += c.wallets.length;
    }
    return { wl, collab };
  }
}

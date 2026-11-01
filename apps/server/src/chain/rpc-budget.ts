import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * One request budget per RPC URL, shared by every viem client of the process (the server key, the bot
 * signers, the holder reader). The public Elysium RPC answers HTTP 429 ("Rate Limit Exceeded") as soon
 * as it is pushed, and the owner provides no private endpoint, so the server keeps itself under the
 * limit:
 *
 * - a token bucket (`RPC_MAX_RPS` calls per second, `RPC_BURST` burst) that every JSON-RPC call goes
 *   through (a JSON-RPC batch costs one token per call in it);
 * - priorities: `high` (paid joins, settlements, loot sweeps) is served before `normal` (config, arena
 *   list, mint state) and `low` (staked-bot purchases, holder index, stale sweeper, balance checks);
 *   low-priority calls also leave a reserve of the burst untouched, so a join never waits behind a bot;
 * - on a 429 (HTTP 429, or a JSON-RPC error with code 429 / -32005 / "rate limit"): a global cool-down
 *   (the `Retry-After` header when present, else exponential backoff with jitter), the rate is cut
 *   (multiplicative decrease, raised again slowly on success), and the request is retried in place
 *   (more attempts for higher priorities);
 * - a per-method counter, logged once a minute (`rpc: N calls/min, M 429s …`).
 */

export type RpcPriority = 'high' | 'normal' | 'low';

const priorityStore = new AsyncLocalStorage<RpcPriority>();

/** Runs `fn` with every RPC call it makes (also in its async continuations) at priority `p`. */
export function withRpcPriority<T>(p: RpcPriority, fn: () => Promise<T>): Promise<T> {
  return priorityStore.run(p, fn);
}

/** The RPC priority of the current async context (default `normal`). */
export function currentRpcPriority(): RpcPriority {
  return priorityStore.getStore() ?? 'normal';
}

const RATE_LIMIT_TEXT = /rate.?limit|too many requests|exceeded.*(capacity|quota|limit)|please get an api key/i;

/** True when an error (viem, fetch, our own) says the RPC rate-limited us. */
export function isRateLimited(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 6; depth++) {
    const o = e as { status?: number; code?: number; message?: string; details?: string; shortMessage?: string; cause?: unknown };
    if (o.status === 429 || o.code === 429 || o.code === -32005) return true;
    const text = `${o.shortMessage ?? ''} ${o.message ?? ''} ${o.details ?? ''}`;
    if (RATE_LIMIT_TEXT.test(text) || /\b429\b/.test(text)) return true;
    e = o.cause;
  }
  return false;
}

/** True for errors that are worth retrying later without changing anything (rate limits, timeouts, network). */
export function isTransientRpcError(err: unknown): boolean {
  if (isRateLimited(err)) return true;
  const text = String((err as Error)?.message ?? err);
  return /timed? ?out|timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|HTTP request failed|network/i.test(text);
}

export interface RpcBudgetOptions {
  /** Calls per second at most (the ceiling the adaptive rate climbs back to). Default 4. */
  ratePerSec?: number;
  /** Bucket size (calls that may go at once after a quiet period). Default 8. */
  burst?: number;
  /** Lowest rate the adaptive decrease goes to. Default 0.5 calls/s. */
  minRatePerSec?: number;
  /** Attempts per request (first try included), by priority. */
  attempts?: Partial<Record<RpcPriority, number>>;
  /** Backoff after a 429: base and cap (ms). Defaults 1 s and 30 s. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Timeout of one HTTP attempt (ms). Default 20 s. */
  attemptTimeoutMs?: number;
  now?: () => number;
  random?: () => number;
}

export interface RpcMinuteStats {
  calls: number;
  limited: number;
  /** Calls per JSON-RPC method (an `eth_call` merged by multicall counts once). */
  byMethod: Record<string, number>;
  /** Calls per priority. */
  byPriority: Record<RpcPriority, number>;
}

interface Waiter {
  priority: RpcPriority;
  cost: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal | null;
  onAbort?: () => void;
}

const ORDER: RpcPriority[] = ['high', 'normal', 'low'];
const DEFAULT_ATTEMPTS: Record<RpcPriority, number> = { high: 7, normal: 4, low: 2 };

export class RpcBudget {
  readonly maxRate: number;
  readonly burst: number;
  private readonly minRate: number;
  private rate: number;
  private tokens: number;
  private refilledAt: number;
  /** No call starts before this (a 429 was seen). */
  private cooldownUntil = 0;
  /** 429s in a row (the backoff exponent). */
  private streak = 0;
  private readonly waiters: Waiter[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly attempts: Record<RpcPriority, number>;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly attemptTimeoutMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private minute: RpcMinuteStats = emptyStats();
  /** Totals since the start (tests, `/api/config`). */
  readonly total = { calls: 0, limited: 0 };

  constructor(opts: RpcBudgetOptions = {}) {
    this.maxRate = Math.max(0.1, opts.ratePerSec ?? 4);
    this.burst = Math.max(1, opts.burst ?? 8);
    this.minRate = Math.min(this.maxRate, Math.max(0.05, opts.minRatePerSec ?? 0.5));
    this.rate = this.maxRate;
    this.tokens = this.burst;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.refilledAt = this.now();
    this.attempts = { ...DEFAULT_ATTEMPTS, ...(opts.attempts ?? {}) };
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 30_000;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? 20_000;
  }

  /** The current (adaptive) rate, calls per second. */
  get currentRate(): number {
    return this.rate;
  }

  /** Requests waiting for a token. */
  get queued(): number {
    return this.waiters.length;
  }

  private refill(): void {
    const now = this.now();
    const dt = Math.max(0, now - this.refilledAt) / 1000;
    this.refilledAt = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
  }

  /** Low-priority calls keep this many tokens for the others (at least one). */
  private reserveFor(p: RpcPriority): number {
    if (p === 'high') return 0;
    if (p === 'normal') return Math.min(this.burst - 1, 1);
    return Math.min(this.burst - 1, Math.max(1, Math.floor(this.burst * 0.4)));
  }

  /** Waits for `cost` tokens at priority `p` (rejects when `signal` aborts first). */
  acquire(cost: number, p: RpcPriority = currentRpcPriority(), signal?: AbortSignal | null): Promise<void> {
    const c = Math.max(1, Math.min(cost, this.burst));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    return new Promise<void>((resolve, reject) => {
      const w: Waiter = { priority: p, cost: c, resolve, reject, signal };
      if (signal) {
        w.onAbort = () => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(signal.reason ?? new Error('aborted'));
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.waiters.push(w);
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (;;) {
      if (this.waiters.length === 0) return;
      const now = this.now();
      if (now < this.cooldownUntil) {
        this.schedule(this.cooldownUntil - now);
        return;
      }
      this.refill();
      // the first waiter of the best priority (FIFO within one priority)
      let w: Waiter | null = null;
      for (const p of ORDER) {
        w = this.waiters.find((x) => x.priority === p) ?? null;
        if (w) break;
      }
      if (!w) return;
      const need = w.cost + this.reserveFor(w.priority);
      if (this.tokens + 1e-9 < Math.min(need, this.burst)) {
        const missing = Math.min(need, this.burst) - this.tokens;
        this.schedule(Math.max(5, Math.ceil((missing / this.rate) * 1000)));
        return;
      }
      this.tokens -= w.cost;
      this.waiters.splice(this.waiters.indexOf(w), 1);
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      w.resolve();
    }
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
    this.timer.unref?.();
  }

  /** Backoff delay of the current 429 streak (full jitter between half and all of it). */
  private backoffMs(): number {
    const exp = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** Math.min(this.streak - 1, 10));
    return Math.round(exp / 2 + (this.random() * exp) / 2);
  }

  /** Records a 429: global cool-down (`retryAfterMs` when the server said), and the rate is cut. Returns the delay. */
  noteRateLimited(retryAfterMs: number | null = null): number {
    this.streak++;
    this.total.limited++;
    this.minute.limited++;
    const delay = Math.min(this.backoffMaxMs * 2, Math.max(retryAfterMs ?? 0, this.backoffMs()));
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + delay);
    this.rate = Math.max(this.minRate, this.rate * 0.7);
    this.tokens = Math.min(this.tokens, 0);
    return delay;
  }

  /** Records an answered request: the streak ends and the rate climbs back slowly (additive increase). */
  noteOk(): void {
    this.streak = 0;
    if (this.rate < this.maxRate) this.rate = Math.min(this.maxRate, this.rate + 0.05);
  }

  /** Counts `methods` (one per JSON-RPC call sent). */
  count(methods: readonly string[], p: RpcPriority): void {
    const n = Math.max(1, methods.length);
    this.total.calls += n;
    this.minute.calls += n;
    this.minute.byPriority[p] += n;
    for (const m of methods.length > 0 ? methods : ['?']) this.minute.byMethod[m] = (this.minute.byMethod[m] ?? 0) + 1;
  }

  /** The counters since the last call (the minute log). */
  takeMinute(): RpcMinuteStats {
    const s = this.minute;
    this.minute = emptyStats();
    return s;
  }

  /**
   * A `fetch` for viem's `http` transport: every attempt waits for the budget, a 429 (HTTP status or a
   * JSON-RPC rate-limit error) is retried after the backoff, the rest is returned as it came. A request
   * holding `eth_sendRawTransaction` is retried only when the whole request was refused (the
   * transaction was not accepted), so a signed transaction is never sent twice.
   */
  fetchFn(inner: typeof fetch = fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const methods = methodsOf(init?.body);
      const p = currentRpcPriority();
      const attempts = Math.max(1, this.attempts[p]);
      const signal = init?.signal ?? null;
      for (let attempt = 1; ; attempt++) {
        await this.acquire(methods.length || 1, p, signal);
        this.count(methods, p);
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort(signal?.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
        const t = setTimeout(() => ctrl.abort(new Error(`RPC attempt timed out after ${Math.round(this.attemptTimeoutMs / 1000)} s`)), this.attemptTimeoutMs);
        t.unref?.();
        let res: Response;
        let text: string;
        try {
          res = await inner(input, { ...init, signal: ctrl.signal });
          text = await res.text();
        } finally {
          clearTimeout(t);
          signal?.removeEventListener('abort', onAbort);
        }
        const limited = res.status === 429 || bodyRateLimited(text);
        // the body is decoded text now: its transfer headers no longer apply
        const headers = new Headers(res.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        if (!limited) {
          this.noteOk();
          return new Response(text, { status: res.status, statusText: res.statusText, headers });
        }
        const delay = this.noteRateLimited(retryAfterMs(res.headers.get('retry-after'), this.now()));
        if (attempt >= attempts || signal?.aborted) {
          return new Response(text || JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: 429, message: 'Rate Limit Exceeded' } }), {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
        }
        // the cool-down (`delay`) holds every request; this one waits its own turn after it
        void delay;
      }
    }) as typeof fetch;
  }
}

function emptyStats(): RpcMinuteStats {
  return { calls: 0, limited: 0, byMethod: {}, byPriority: { high: 0, normal: 0, low: 0 } };
}

/** The JSON-RPC methods in a request body (one per call of a batch). */
export function methodsOf(body: unknown): string[] {
  if (typeof body !== 'string') return [];
  try {
    const j = JSON.parse(body) as unknown;
    const list = Array.isArray(j) ? j : [j];
    return list.map((x) => (x && typeof (x as { method?: unknown }).method === 'string' ? (x as { method: string }).method : '?'));
  } catch {
    return [];
  }
}

/** True when a JSON-RPC answer (single or batch) carries a rate-limit error. */
export function bodyRateLimited(text: string): boolean {
  if (!text || text.length > 64_000) return false;
  if (!/error/i.test(text)) return false;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return RATE_LIMIT_TEXT.test(text);
  }
  const list = Array.isArray(j) ? j : [j];
  return list.some((x) => {
    const e = (x as { error?: { code?: number; message?: string } } | null)?.error;
    if (!e) return false;
    if (typeof e === 'string') return RATE_LIMIT_TEXT.test(e);
    return e.code === 429 || e.code === -32005 || RATE_LIMIT_TEXT.test(String(e.message ?? ''));
  });
}

/** `Retry-After` (seconds or an HTTP date) in ms; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return Math.min(120_000, Math.round(s * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(120_000, Math.max(0, at - now)) : null;
}

/* ------------------------------------------------------------------ */
/* Process-wide budgets                                                */
/* ------------------------------------------------------------------ */

const budgets = new Map<string, RpcBudget>();
let logFn: ((m: string) => void) | null = null;
let logTimer: NodeJS.Timeout | null = null;
let defaults: RpcBudgetOptions = {};

/** Process defaults (`RPC_MAX_RPS`, `RPC_BURST`) for budgets created after this call. */
export function configureRpcBudgets(opts: RpcBudgetOptions): void {
  defaults = { ...defaults, ...opts };
}

/** The shared budget of an RPC URL (one per URL for the whole process). */
export function rpcBudgetFor(url: string): RpcBudget {
  const key = url.trim().toLowerCase();
  let b = budgets.get(key);
  if (!b) {
    b = new RpcBudget(defaults);
    budgets.set(key, b);
  }
  return b;
}

/** Formats one minute of counters (`rpc: 120 calls/min, 3 429s · eth_call 80, …`). */
export function formatRpcMinute(s: RpcMinuteStats, extra = ''): string {
  const top = Object.entries(s.byMethod)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([m, n]) => `${m} ${n}`)
    .join(', ');
  const prio = `high ${s.byPriority.high} / normal ${s.byPriority.normal} / low ${s.byPriority.low}`;
  return `rpc: ${s.calls} calls/min, ${s.limited} 429s${top ? ` · ${top}` : ''} · ${prio}${extra}`;
}

/** Logs every budget's counters once a minute (only minutes with traffic). Idempotent. */
export function startRpcMinuteLog(log: (m: string) => void, intervalMs = 60_000): () => void {
  logFn = log;
  if (!logTimer) {
    logTimer = setInterval(() => {
      for (const [url, b] of budgets) {
        const s = b.takeMinute();
        if (s.calls === 0 && s.limited === 0) continue;
        const host = url.replace(/^https?:\/\//, '').split('/')[0];
        logFn?.(formatRpcMinute(s, ` · rate ${b.currentRate.toFixed(2)}/s of ${b.maxRate}/s · queued ${b.queued}${budgets.size > 1 ? ` · ${host}` : ''}`));
      }
    }, intervalMs);
    logTimer.unref();
  }
  return () => {
    if (logTimer) clearInterval(logTimer);
    logTimer = null;
  };
}

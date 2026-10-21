// Deterministic capture, part 1: the journal.
//
// A live take used to be a real-time CDP screencast. Under load (a 1080p software raster plus
// the rival browsers) that ran at 15-25 fps, so the arena footage stuttered. Now a take records
// what the page *received* instead of what it drew:
//   - every WebSocket (game server, chain RPC): open/close times and each message (text, or
//     binary as base64), stamped with the page's performance.now();
//   - every fetch(): method, URL, the response (status, headers, body) and its latency;
//   - every input event (mouse, wheel, keys) the page saw;
//   - the clock mapping (performance.now() -> Date.now()).
// The game client is a pure interpolator of server snapshots (no prediction), so feeding the same
// messages and inputs at the same times into a fresh page reproduces the take. capture/replay.mjs
// does that on a virtual clock: it steps the page frame by frame (exactly 1/60 s, or finer for
// slow motion) and screenshots each frame. The recording page itself draws nothing (the canvas
// draw is skipped), so the machine stays light and the message times stay true.
// Nothing in apps/web changes: both halves are Playwright init scripts.
import { appendFileSync, writeFileSync } from 'node:fs';

/** Page side of the recorder (an init script; runs before the app). */
export function journalInit() {
  const J = (window.__journal = { buf: [], perf0: performance.now(), date0: Date.now() });
  const now = () => performance.now();
  const push = (e) => J.buf.push(e);
  push({ k: 'clock', perf: J.perf0, date: J.date0, href: location.href });
  const b64 = (buf) => {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  // WebSocket: keyed by URL and the nth socket opened to it
  const RealWS = window.WebSocket;
  const count = {};
  class JWS extends RealWS {
    constructor(url, protocols) {
      super(url, protocols);
      const u = String(url);
      const key = `${u}#${(count[u] = (count[u] ?? 0) + 1) - 1}`;
      push({ k: 'ws', key, t: now() });
      this.addEventListener('open', () => push({ k: 'wsopen', key, t: now() }));
      this.addEventListener('close', (e) => push({ k: 'wsclose', key, t: now(), code: e.code }));
      this.addEventListener('message', (e) => {
        const t = now();
        if (typeof e.data === 'string') push({ k: 'm', key, t, s: e.data });
        else if (e.data instanceof ArrayBuffer) push({ k: 'm', key, t, b: b64(e.data) });
        else if (e.data instanceof Blob) e.data.arrayBuffer().then((ab) => push({ k: 'm', key, t, b: b64(ab), blob: 1 }));
      });
    }
  }
  window.WebSocket = JWS;
  // fetch: the response body as base64
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const t = now();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body.slice(0, 4000) : null;
    try {
      const res = await realFetch(input, init);
      const copy = res.clone();
      copy.arrayBuffer().then((ab) => push({ k: 'fetch', t, dt: now() - t, method, url: new URL(url, location.href).href, body, status: res.status, headers: [...res.headers.entries()], res: b64(ab) }), () => {});
      return res;
    } catch (err) {
      push({ k: 'fetch', t, dt: now() - t, method, url: new URL(url, location.href).href, body, err: String(err?.message ?? err) });
      throw err;
    }
  };
  // input events, as the page saw them
  const mouse = (e) => push({ k: 'in', t: now(), type: e.type, x: e.clientX, y: e.clientY, b: e.button, bs: e.buttons });
  for (const ty of ['mousemove', 'mousedown', 'mouseup']) window.addEventListener(ty, mouse, true);
  window.addEventListener('wheel', (e) => push({ k: 'in', t: now(), type: 'wheel', x: e.clientX, y: e.clientY, dx: e.deltaX, dy: e.deltaY }), true);
  for (const ty of ['keydown', 'keyup']) window.addEventListener(ty, (e) => push({ k: 'in', t: now(), type: ty, code: e.code, key: e.key, rep: e.repeat }), true);
  // flush to Node twice a second
  const flush = () => {
    if (!J.buf.length || !window.__journalFlush) return;
    const out = J.buf;
    J.buf = [];
    window.__journalFlush(JSON.stringify(out)).catch(() => {});
  };
  setInterval(flush, 500);
  J.flush = flush;
}

/** Wires the journal into a browser context (before any page opens). Lines go to `file` (JSONL). */
export async function attachJournal(ctx, file) {
  writeFileSync(file, '');
  await ctx.exposeBinding('__journalFlush', (_src, json) => {
    const arr = JSON.parse(json);
    if (arr.length) appendFileSync(file, arr.map((e) => JSON.stringify(e)).join('\n') + '\n');
  });
  await ctx.addInitScript(journalInit);
}

/**
 * Page side of the replay (an init script, installed before everything else): a virtual clock
 * for performance.now / Date / timers / requestAnimationFrame, CSS and Web Animations driven by
 * it, WebSockets fed from the journal and fetch() answered from it. Node drives it through
 * `__replay.advance(toV, messages)` and `__replay.frame()`.
 */
export function replayShim(cfg) {
  const R = (window.__replay = { V: cfg.V0, E: cfg.E, seq: 1, timers: [], raf: new Map(), sockets: {}, pending: {}, anims: new WeakMap(), errors: 0 });
  const real = { setTimeout: window.setTimeout.bind(window), rAF: window.requestAnimationFrame.bind(window), fetch: window.fetch.bind(window) };
  R.real = real;
  const ch = new MessageChannel();
  const waiters = [];
  ch.port1.onmessage = () => waiters.shift()?.();
  /** One real macrotask: microtasks, React's scheduler and promise chains run in between. */
  const yieldReal = () => new Promise((r) => { waiters.push(r); ch.port2.postMessage(0); });
  R.yieldReal = yieldReal;
  // ── clocks ──
  performance.now = () => R.V;
  const RD = Date;
  function VDate(...a) {
    if (!new.target) return new RD(R.E + R.V).toString();
    return a.length ? new RD(...a) : new RD(R.E + R.V);
  }
  VDate.prototype = RD.prototype;
  VDate.now = () => Math.floor(R.E + R.V);
  VDate.parse = RD.parse;
  VDate.UTC = RD.UTC;
  window.Date = VDate;
  // ── timers ──
  const add = (fn, ms, args, repeat) => {
    if (typeof fn !== 'function') return 0;
    const d = Math.max(0, Number(ms) || 0);
    const id = R.seq++;
    R.timers.push({ id, at: R.V + d, fn, args, every: repeat ? Math.max(1, d) : 0 });
    return id;
  };
  R.add = add;
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => {
    const i = R.timers.findIndex((t) => t.id === id);
    if (i >= 0) R.timers.splice(i, 1);
  };
  window.requestAnimationFrame = (cb) => { const id = R.seq++; R.raf.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => void R.raf.delete(id);
  window.requestIdleCallback = (cb) => add(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1, [], false);
  window.cancelIdleCallback = window.clearTimeout;
  // ── WebSocket from the journal ──
  const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const count = {};
  class FakeWS extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.key = `${this.url}#${(count[this.url] = (count[this.url] ?? 0) + 1) - 1}`;
      this.readyState = 0;
      this.binaryType = 'blob';
      this.bufferedAmount = 0;
      this.protocol = '';
      this.extensions = '';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      R.sockets[this.key] = this;
      const meta = cfg.ws[this.key];
      if (meta && meta.open != null) add(() => this._open(), meta.open - R.V, [], false);
    }
    _emit(type, ev) {
      this.dispatchEvent(ev);
      const h = this['on' + type];
      if (typeof h === 'function') { try { h.call(this, ev); } catch (e) { R.errors++; console.error(e); } }
    }
    _open() {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this._emit('open', new Event('open'));
      const q = R.pending[this.key] || [];
      delete R.pending[this.key];
      for (const m of q) this._msg(m);
    }
    _msg(m) {
      if (this.readyState !== 1) return;
      let data = m.s;
      if (data == null) { const u = unb64(m.b); data = this.binaryType === 'arraybuffer' ? u.buffer : new Blob([u]); }
      this._emit('message', new MessageEvent('message', { data }));
    }
    _close(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this._emit('close', new CloseEvent('close', { code, wasClean: true }));
    }
    send() {}
    close() { if (this.readyState < 2) { this.readyState = 2; add(() => this._close(1000), 0, [], false); } }
  }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
  window.WebSocket = FakeWS;
  const deliver = (m) => {
    const s = R.sockets[m.key];
    if (m.k === 'wsclose') { if (s) s._close(m.code); return; }
    if (s && s.readyState === 1) s._msg(m);
    else if (!s || s.readyState === 0) (R.pending[m.key] ||= []).push(m);
  };
  // ── fetch from the journal (exact URL first, then the same path), at the recorded latency ──
  const qExact = {}, qPath = {};
  const pathKey = (method, url) => { const u = new URL(url, location.href); return `${method} ${u.origin}${u.pathname}`; };
  for (const f of cfg.fetches) {
    (qExact[`${f.method} ${f.url}`] ||= []).push(f);
    (qPath[pathKey(f.method, f.url)] ||= []).push(f);
  }
  const take = (q, f) => { const i = q ? q.indexOf(f) : -1; if (i >= 0) q.splice(i, 1); };
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).href;
    const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const f = qExact[`${method} ${url}`]?.[0] ?? qPath[pathKey(method, url)]?.[0];
    if (!f) return real.fetch(input, init);
    take(qExact[`${f.method} ${f.url}`], f);
    take(qPath[pathKey(f.method, f.url)], f);
    return new Promise((resolve, reject) => add(() => {
      if (f.err) return reject(new TypeError(f.err));
      const nobody = f.status === 204 || f.status === 304 || method === 'HEAD';
      resolve(new Response(nobody ? null : unb64(f.res || ''), { status: f.status, headers: f.headers }));
    }, f.dt, [], false));
  };
  // ── stepping ──
  /** Runs every timer and message due up to virtual time toV (ms), in time order. */
  R.advance = async (toV, msgs = []) => {
    let mi = 0;
    for (let guard = 0; guard < 500000; guard++) {
      let ti = -1, tt = Infinity;
      for (let i = 0; i < R.timers.length; i++) if (R.timers[i].at < tt) { tt = R.timers[i].at; ti = i; }
      const mt = mi < msgs.length ? msgs[mi].t : Infinity;
      const next = Math.min(tt, mt);
      if (next > toV) break;
      R.V = Math.max(R.V, next);
      if (mt <= tt) deliver(msgs[mi++]);
      else {
        const t = R.timers[ti];
        if (t.every) t.at = Math.max(t.at + t.every, R.V + 0.001); else R.timers.splice(ti, 1);
        try { t.fn(...t.args); } catch (e) { R.errors++; console.error(e); }
      }
      await yieldReal();
    }
    for (; mi < msgs.length; mi++) deliver(msgs[mi]);
    R.V = Math.max(R.V, toV);
  };
  /** Animations (CSS, transitions, Web Animations) follow the virtual clock. */
  R.syncAnimations = () => {
    for (const a of document.getAnimations()) {
      let s = R.anims.get(a);
      if (s === undefined) { s = R.V; R.anims.set(a, s); try { a.pause(); } catch {} }
      if (a.playState === 'finished') continue;
      const local = (R.V - s) * (a.playbackRate || 1);
      let end = Infinity;
      try { end = a.effect?.getComputedTiming().endTime ?? Infinity; } catch {}
      try {
        if (Number.isFinite(end) && local >= end) a.finish();
        else a.currentTime = local;
      } catch {}
    }
  };
  /** One display frame at the current virtual time: rAF callbacks, a real task for React, animations. */
  R.frame = async () => {
    const cbs = [...R.raf.values()];
    R.raf.clear();
    for (const cb of cbs) { try { cb(R.V); } catch (e) { R.errors++; console.error(e); } }
    await yieldReal();
    await yieldReal();
    R.syncAnimations();
  };
  /** Fast-forward: frames every `step` ms up to toV in one call (the messages are split by time). */
  R.ffwd = async (toV, msgs, step = 50) => {
    let mi = 0;
    while (R.V < toV - 1e-6) {
      const v = Math.min(toV, R.V + step);
      let j = mi;
      while (j < msgs.length && msgs[j].t <= v) j++;
      await R.advance(v, msgs.slice(mi, j));
      mi = j;
      await R.frame();
    }
  };
  /** Waits for a real composited frame (so a screenshot shows this state). */
  R.paint = () => new Promise((r) => real.rAF(() => real.setTimeout(r, 0)));
}

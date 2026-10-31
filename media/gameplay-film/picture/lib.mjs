// Shared bits of the film's picture pipeline: paths, the browser, the drawn cursor, smooth human
// input (eased mouse paths and wheel scrolls that the journal records), marks.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const WORK = process.env.FILM_WORK || resolve(ROOT, 'out/work/film');
export const TAKES = resolve(WORK, 'takes');
export const WEB = process.env.FILM_WEB || 'http://localhost:5437';
export const W = 1920, H = 1080;
const require = createRequire(resolve(ROOT, 'apps/web/package.json'));
export const { chromium } = require('playwright');
process.env.CHROME_PATH ||= '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
export const CHROME = process.env.CHROME_PATH;
export const ARGS = ['--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--disable-smooth-scrolling', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', '--font-render-hinting=none'];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
export const launch = () => chromium.launch({ executablePath: CHROME, args: ARGS });
mkdirSync(TAKES, { recursive: true });

/**
 * The drawn cursor (an init script): headless Chromium paints no pointer, so the film draws one
 * on the page, following the mouse events the page receives (live or replayed). It hides over
 * the arena (the coin follows the mouse there; a pointer on top of it reads as a UI demo).
 */
export function cursorInit() {
  // page turns (View Transitions) paint outside the replay's virtual clock: the film cuts instead
  try { delete Document.prototype.startViewTransition; } catch {}
  document.startViewTransition = undefined;
  const make = () => {
    if (document.getElementById('__film-cursor') || !document.body) return;
    const st = document.createElement('style');
    st.textContent = `#__film-cursor{position:fixed;left:0;top:0;width:34px;height:34px;pointer-events:none;z-index:2147483647;transform:translate(-200px,-200px);will-change:transform}
#__film-cursor svg{display:block;transform-origin:4px 3px;transition:transform 90ms ease-out;filter:drop-shadow(0 2px 2px rgba(4,24,28,.35))}
#__film-cursor.is-down svg{transform:scale(.82)}
#__film-cursor.is-off{opacity:0}
#__film-cursor i{position:absolute;left:-14px;top:-15px;width:34px;height:34px;border-radius:50%;border:3px solid rgba(242,193,78,.95);opacity:0;transform:scale(.3)}
#__film-cursor i.go{animation:__fc-ring .42s ease-out forwards}
@keyframes __fc-ring{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(1.35)}}`;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = '__film-cursor';
    el.innerHTML = '<i></i><svg width="30" height="34" viewBox="0 0 30 34"><path d="M3 2 L3 26 L9.2 20.4 L13.4 30.2 L18 28.2 L13.8 18.6 L22.2 18.4 Z" fill="#04181C" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/></svg>';
    document.body.appendChild(el);
    window.__filmCursor = el;
  };
  let x = -200, y = -200;
  const place = () => { const el = window.__filmCursor; if (el) el.style.transform = `translate(${x - 3}px,${y - 2}px)`; };
  const hidden = () => {
    const S = window.__elymum;
    if (!S) return false;
    const s = S.useUi.getState().screen;
    return s === 'playing' || s === 'dead' || s === 'roundover' || s === 'spectating';
  };
  window.addEventListener('mousemove', (e) => { make(); x = e.clientX; y = e.clientY; place(); }, true);
  window.addEventListener('mousedown', (e) => {
    make(); x = e.clientX; y = e.clientY; place();
    const el = window.__filmCursor; el?.classList.add('is-down');
    const ring = el?.querySelector('i'); if (ring) { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); }
  }, true);
  window.addEventListener('mouseup', () => window.__filmCursor?.classList.remove('is-down'), true);
  const tick = () => { make(); const el = window.__filmCursor; if (el) el.classList.toggle('is-off', hidden() || !!window.__filmCursorOff); };
  document.addEventListener('DOMContentLoaded', tick);
  setInterval(tick, 100);
}

/** Smooth human input on a page (the journal records these as input events). */
export class Hand {
  constructor(page, x = W * 0.62, y = H * 0.42) { this.page = page; this.x = x; this.y = y; }
  /** An eased, slightly curved path to (x, y) in `ms` (about 60 moves a second). */
  async move(x, y, ms = 700, { curve = 0.12 } = {}) {
    const sx = this.x, sy = this.y, d = Math.hypot(x - sx, y - sy);
    const nx = -(y - sy) / (d || 1), ny = (x - sx) / (d || 1);
    const bend = curve * d * (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4);
    const cx = (sx + x) / 2 + nx * bend, cy = (sy + y) / 2 + ny * bend;
    const t0 = Date.now();
    for (;;) {
      const u = Math.min(1, (Date.now() - t0) / ms);
      const t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * x;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * y;
      await this.page.mouse.move(px, py);
      if (u >= 1) break;
      await sleep(14);
    }
    this.x = x; this.y = y;
  }
  async click(x, y, ms = 650, { hold = 90, before = 120 } = {}) {
    if (x != null) await this.move(x, y, ms);
    await sleep(before);
    await this.page.mouse.down();
    await sleep(hold);
    await this.page.mouse.up();
  }
  async box(sel, nth = 0) {
    const loc = typeof sel === 'string' ? this.page.locator(sel).nth(nth) : sel;
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    return loc.boundingBox();
  }
  async clickEl(sel, { fx = 0.5, fy = 0.5, ms = 650, nth = 0, ...o } = {}) {
    const b = await this.box(sel, nth);
    await this.click(b.x + b.width * fx, b.y + b.height * fy, ms, o);
  }
  async hoverEl(sel, { fx = 0.5, fy = 0.5, ms = 650, nth = 0 } = {}) {
    const b = await this.box(sel, nth);
    await this.move(b.x + b.width * fx, b.y + b.height * fy, ms);
  }
  /** Scrolls by `dy` px in `ms`, eased, frame by frame in the page (the journal records the positions). */
  async scroll(dy, ms = 800) {
    await this.page.evaluate(({ dy, ms }) => new Promise((done) => {
      const y0 = scrollY, t0 = performance.now();
      window.__journal?.buf.push({ k: 'in', t: t0, type: 'scrollanim', y0, dy, ms });
      const f = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        const t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        scrollTo(0, y0 + dy * t);
        if (u < 1) requestAnimationFrame(f); else done();
      };
      requestAnimationFrame(f);
    }), { dy, ms });
  }
  /** Scrolls so that the element's top sits at `top` px in the viewport. */
  async scrollTo(sel, top = 90, ms = 800) {
    const y = await this.page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
    await this.scroll(y - top, ms);
  }
  async type(text, gap = 70) {
    for (const ch of text) { await this.page.keyboard.press(ch); await sleep(gap + Math.random() * 40); }
  }
}

/** Marks on a take's clock (seconds since the take's t0). */
export class Marks {
  constructor() { this.t0 = Date.now() / 1000; this.list = []; }
  mark(label, extra = {}) { const t = +(Date.now() / 1000 - this.t0).toFixed(3); this.list.push({ t, label, ...extra }); log('mark', label, t); return t; }
}

/** Records the page's scroll positions into the journal (replayed as `scrollto`). */
export function scrollJournalInit() {
  let last = -1;
  const rec = () => {
    const J = window.__journal;
    if (!J || scrollY === last) return;
    last = scrollY;
    J.buf.push({ k: 'in', t: performance.now(), type: 'scrollto', x: scrollX, y: scrollY });
  };
  window.addEventListener('scroll', rec, true);
}

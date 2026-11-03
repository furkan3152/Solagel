// In-page UI robustness detectors for scripts/ui-audit.mjs. This file is evaluated inside the page
// (`page.evaluate(source)`), so it is plain browser JavaScript with no imports. It defines
// `window.__uiAudit.detect(opts)`, which returns findings for what is on screen now:
//   overflow   horizontal page overflow (scrollWidth > clientWidth), with the widest culprits
//   text       text spilling out of its box (issue) or clipped by it (issue; with an ellipsis: info)
//   overlap    visible text / controls drawn over each other (not ancestors, not decorative)
//   offscreen  controls partly outside the viewport (no scroller can bring them in) or clipped by a container
//   contrast   WCAG contrast of visible text (and input text / placeholders) against what is behind it
//   touch      touch targets smaller than 40x40 css px (the real hit area, probed with elementFromPoint)
// `opts.pixels` (optional): { w, h, data } RGBA of a css-scale viewport screenshot, used to read
// the background behind text where the DOM cannot tell (gradients, images, canvas, positioned art).
(() => {
  const A = (window.__uiAudit = window.__uiAudit || {});

  // ───────────── helpers ─────────────
  const cssColorCache = new Map();
  let cc = null;
  /** Any CSS color (rgb, oklch, color-mix…) → [r, g, b, a(0..1)] via a 1x1 canvas. */
  function rgba(str) {
    if (!str) return [0, 0, 0, 0];
    if (str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return [0, 0, 0, 0];
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return [+m[1], +m[2], +m[3], a];
    }
    if (cssColorCache.has(str)) return cssColorCache.get(str);
    if (!cc) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      cc = c.getContext('2d', { willReadFrequently: true });
    }
    cc.clearRect(0, 0, 1, 1);
    cc.fillStyle = '#000';
    cc.fillStyle = str;
    cc.fillRect(0, 0, 1, 1);
    const d = cc.getImageData(0, 0, 1, 1).data;
    const out = [d[0], d[1], d[2], d[3] / 255];
    cssColorCache.set(str, out);
    return out;
  }
  const over = (top, bottom) => {
    // alpha-composite `top` (rgba) over an opaque `bottom` (rgb)
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a)];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  const vw = () => document.documentElement.clientWidth;
  const vh = () => window.innerHeight;

  function cls(el) {
    const c = typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '';
    return c
      .split(/\s+/)
      .filter((x) => x && !/^(is-|has-)/.test(x))
      .slice(0, 2)
      .map((x) => '.' + CSS.escape(x))
      .join('');
  }
  /** A short readable path: up to 3 ancestors with classes / test ids. */
  function sel(el) {
    const parts = [];
    let e = el;
    while (e && e.nodeType === 1 && parts.length < 4 && e !== document.body) {
      const tid = e.getAttribute('data-testid');
      let p = e.tagName.toLowerCase() + (tid ? `[data-testid="${tid}"]` : cls(e));
      parts.unshift(p);
      if (tid) break;
      e = e.parentElement;
    }
    return parts.join(' > ');
  }
  const snippet = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const R = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });

  let hiddenCache = new WeakMap();
  /** Not rendered for a viewer: display none, visibility hidden, opacity ~0, or inside such a subtree. */
  function invisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (hiddenCache.has(el)) return hiddenCache.get(el);
    const cs = getComputedStyle(el);
    let v = cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || parseFloat(cs.opacity) < 0.15 || cs.contentVisibility === 'hidden';
    if (!v && cs.overflow !== 'visible' && cs.position === 'absolute') {
      // visually hidden (.sr-only: a 1px clipped box)
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) v = true;
    }
    if (!v && cs.clip && cs.clip.startsWith('rect(0')) v = true;
    // closed <details>, content-visibility: hidden subtrees (skipped content still reports rects)
    if (!v && el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: false, opacityProperty: false, visibilityProperty: true })) v = true;
    if (!v && el.parentElement) v = invisible(el.parentElement);
    hiddenCache.set(el, v);
    return v;
  }
  const opacityOf = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0;
    return o;
  };
  let decorCache = new WeakMap();
  /** Decorative by markup: aria-hidden / role=presentation subtrees, svg art, our own overlay. */
  function decorative(el) {
    if (!el || el.nodeType !== 1) return false;
    if (decorCache.has(el)) return decorCache.get(el);
    let v = el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('data-ui-audit-ignore') || el.id === '__ui-audit-overlay' || el.tagName === 'svg' || el.tagName === 'CANVAS' || el.inert;
    if (!v && el.parentElement) v = decorative(el.parentElement);
    decorCache.set(el, v);
    return v;
  }
  const CONTROL = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="link"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const isControl = (el) => el.matches?.(CONTROL);
  /** The nearest fixed / sticky layer holding `el` (null: it scrolls with the page or its scroller). */
  const layerOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') return e;
    }
    return null;
  };
  /** The scroller `el` scrolls in (nearest scrollable ancestor; the page when none). */
  const scrollerOf = (el) => {
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (scrollsY(e, cs)) return e;
    }
    return document.scrollingElement;
  };
  const disabled = (el) => !!el.closest('[disabled], [aria-disabled="true"], fieldset[disabled]');

  function clipsX(cs) {
    return cs.overflowX !== 'visible';
  }
  function clipsY(cs) {
    return cs.overflowY !== 'visible';
  }
  const scrollsX = (el, cs) => (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
  const scrollsY = (el, cs) => (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;

  let clipCache = new WeakMap();
  /** The part of the viewport where `el` can paint: its overflow-clipping ancestors (and the viewport) intersected. */
  function clipRect(el) {
    if (clipCache.has(el)) return clipCache.get(el);
    let r = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
    const p = el.parentElement;
    if (p && p !== document.documentElement) {
      const pr = clipRect(p);
      r = { ...pr };
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = p.getBoundingClientRect();
        if (cs.overflowX !== 'visible') {
          r.left = Math.max(r.left, b.left);
          r.right = Math.min(r.right, b.right);
        }
        if (cs.overflowY !== 'visible') {
          r.top = Math.max(r.top, b.top);
          r.bottom = Math.min(r.bottom, b.bottom);
        }
      }
    }
    // a fixed element escapes the clips of its ancestors (unless a transform makes it their child: rare here)
    if (getComputedStyle(el).position === 'fixed') r = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
    clipCache.set(el, r);
    return r;
  }
  /** `r` cut to where `el` can paint; null when nothing of it shows. `self`: `el` clips its own content too (text runs). */
  function visiblePart(el, r, self = false) {
    let c = clipRect(el);
    if (self) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = el.getBoundingClientRect();
        c = { ...c };
        if (cs.overflowX !== 'visible') {
          c.left = Math.max(c.left, b.left);
          c.right = Math.min(c.right, b.right);
        }
        if (cs.overflowY !== 'visible') {
          c.top = Math.max(c.top, b.top);
          c.bottom = Math.min(c.bottom, b.bottom);
        }
      }
    }
    const left = Math.max(r.left, c.left, 0);
    const top = Math.max(r.top, c.top, 0);
    const right = Math.min(r.right, c.right, vw());
    const bottom = Math.min(r.bottom, c.bottom, vh());
    if (right - left < 2 || bottom - top < 2) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  }

  /** Text runs on screen: one item per text node (its line rects), with the element that holds it. */
  function textItems() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|OPTION)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('svg')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (invisible(el)) continue;
      range.selectNodeContents(n);
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 16;
      const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight) || fs * 1.2;
      // the glyph boxes are taller than the line when line-height < 1.2: use the line box (what layout reserves)
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => (r.height > lh + 1 ? new DOMRect(r.left, r.top + (r.height - Math.max(lh, fs * 0.9)) / 2, r.width, Math.max(lh, fs * 0.9)) : r));
      if (!rects.length) continue;
      const box = new DOMRect(
        Math.min(...rects.map((r) => r.left)),
        Math.min(...rects.map((r) => r.top)),
        Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)),
        Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)),
      );
      if (box.bottom < 0 || box.top > vh() || box.right < 0 || box.left > vw()) {
        out.push({ node: n, el, rects, box, onscreen: false });
        continue;
      }
      out.push({ node: n, el, rects, box, onscreen: true });
    }
    return out;
  }

  /** The element at (x, y) belongs to `el` (itself or a descendant), or `el` is the label of the hit. */
  function hits(el, x, y) {
    if (x < 0 || y < 0 || x >= vw() || y >= vh()) return false;
    const h = document.elementFromPoint(x, y);
    if (!h) return false;
    return h === el || el.contains(h) || (h.closest && h.closest('label') === el);
  }
  /** `el` is painted on top at one of a few points inside `r` (not covered by a sheet / backdrop). */
  function onTop(el, r) {
    const pts = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + Math.min(4, r.width / 2), r.top + r.height / 2],
      [r.right - Math.min(4, r.width / 2), r.top + r.height / 2],
    ];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= vw() || y >= vh()) continue;
      const stack = document.elementsFromPoint(x, y);
      if (!stack.length) continue;
      // the first non-pointer-events-none element; text in pointer-events:none layers: walk the stack
      for (const s of stack) {
        if (s === el || el.contains(s) || s.contains(el)) {
          // `s` is el (or inside it) or an ancestor (el is pointer-events:none, so the hit fell through to its holder)
          if (s.contains(el) && s !== el) {
            // an ancestor: el itself must not be covered by an unrelated sibling: the topmost hit is that ancestor
            return stack[0] === s || stack[0].contains(el) || el.contains(stack[0]);
          }
          return true;
        }
        break;
      }
    }
    return false;
  }

  /**
   * The background painted behind `el` at (x, y), read from the paint order (`elementsFromPoint`,
   * topmost first): { color, sure }. Not sure when an image, gradient, canvas, video or svg art
   * shows before an opaque background (the screenshot decides then).
   */
  function domBackground(el, x, y) {
    const layers = [];
    let sure = true;
    let found = false;
    let stack = x >= 0 && y >= 0 && x < vw() && y < vh() ? document.elementsFromPoint(x, y) : [];
    let i = stack.findIndex((s) => s === el || el.contains(s));
    if (i < 0) {
      // not hit-testable here (pointer-events: none): its ancestors, in DOM order
      stack = [];
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) stack.push(e);
      i = 0;
    }
    for (let k = i; k < stack.length; k++) {
      const e = stack[k];
      if (k > i && e !== el && el.contains(e)) continue;
      const cs = getComputedStyle(e);
      if (/^(IMG|CANVAS|VIDEO|svg|IFRAME)$/.test(e.tagName) && !(e === el)) {
        sure = false;
        break;
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        sure = false;
        break;
      }
      if (cs.backdropFilter && cs.backdropFilter !== 'none') sure = false;
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) {
        const o = parseFloat(cs.opacity);
        layers.push([c[0], c[1], c[2], c[3] * (isNaN(o) ? 1 : o)]);
        if (c[3] >= 0.99 && (isNaN(o) || o >= 0.99)) {
          found = true;
          break;
        }
      }
    }
    if (!found) sure = false;
    let base = [255, 255, 255];
    for (let j = layers.length - 1; j >= 0; j--) base = over(layers[j], base);
    return { color: base, sure };
  }

  /** The most common colour of the screenshot inside `r` that is not the text colour (the text's own background). */
  function pixelBackground(pixels, r, fg) {
    if (!pixels) return null;
    const { w, h, data } = pixels;
    const k = w / (window.visualViewport?.width || vw());
    const x0 = Math.max(0, Math.floor(r.left * k - 1));
    const x1 = Math.min(w - 1, Math.ceil(r.right * k + 1));
    const y0 = Math.max(0, Math.floor(r.top * k - 1));
    const y1 = Math.min(h - 1, Math.ceil(r.bottom * k + 1));
    if (x1 <= x0 || y1 <= y0) return null;
    const bins = new Map();
    const step = Math.max(1, Math.floor(((x1 - x0) * (y1 - y0)) / 4000));
    let i = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (i++ % step) continue;
        const k = (y * w + x) * 4;
        const c = [data[k], data[k + 1], data[k + 2]];
        if (fg && dist(c, fg) < 60) continue;
        const key = (c[0] >> 3) * 1024 + (c[1] >> 3) * 32 + (c[2] >> 3);
        const b = bins.get(key);
        if (b) {
          b.n++;
          b.r += c[0];
          b.g += c[1];
          b.b += c[2];
        } else bins.set(key, { n: 1, r: c[0], g: c[1], b: c[2] });
      }
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    if (!best) return null;
    return [best.r / best.n, best.g / best.n, best.b / best.n];
  }

  /** The darkest / lightest colour of a text-shadow or stroke that outlines the glyphs (a halo), if any. */
  function halo(cs) {
    const out = [];
    const ts = cs.textShadow;
    if (ts && ts !== 'none') {
      const re = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\)|color\([^)]*\))[^,]*?(?:,|$)/gi;
      let m;
      while ((m = re.exec(ts))) {
        const c = rgba(m[1]);
        if (c[3] >= 0.6) out.push(c);
      }
    }
    const sw = parseFloat(cs.webkitTextStrokeWidth || '0');
    if (sw >= 1) {
      const c = rgba(cs.webkitTextStrokeColor);
      if (c[3] >= 0.6) out.push(c);
    }
    return out;
  }

  // ───────────── the detectors ─────────────
  A.detect = function detect(opts = {}) {
    hiddenCache = new WeakMap();
    decorCache = new WeakMap();
    clipCache = new WeakMap();
    const touch = !!opts.touch;
    const pixels = opts.pixels || null;
    const findings = [];
    const add = (f) => findings.push(f);
    let needPixels = false;
    const W = vw();
    const H = vh();

    // (1) page overflow
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      // the culprits: the outermost elements reaching past the right edge with no clipping ancestor
      const culprits = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (culprits.length > 4) break;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= W + 1 + window.scrollX * 0) continue;
        if (invisible(el)) continue;
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (clipsX(cs)) {
            const pr = p.getBoundingClientRect();
            if (pr.right <= W + 1) {
              clipped = true;
              break;
            }
          }
        }
        if (clipped) continue;
        if (culprits.some((c) => c.contains(el))) continue;
        culprits.push(el);
      }
      add({
        detector: 'overflow',
        severity: 'issue',
        selector: culprits.length ? sel(culprits[0]) : 'html',
        text: culprits.length ? snippet(culprits[0].textContent) : '',
        detail: `page scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}; culprits: ${culprits.map(sel).join(' | ') || '?'}`,
        rect: culprits.length ? R(culprits[0].getBoundingClientRect()) : { x: 0, y: 0, w: W, h: 40 },
      });
    }

    // (1b) page-like scrollers (the game app scrolls inside its own roots): a vertical scroller that also scrolls sideways
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!(cs.overflowY === 'auto' || cs.overflowY === 'scroll')) continue;
      if (!(cs.overflowX === 'auto' || cs.overflowX === 'scroll')) continue;
      if (el.scrollWidth <= el.clientWidth + 1 || invisible(el)) continue;
      // sideways strips and table wraps scroll sideways by design; a scroller that also scrolls down is a page
      if (el.scrollHeight <= el.clientHeight + 1 || el.querySelector('table')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < W * 0.5 || r.height < 60) continue;
      add({ detector: 'overflow', severity: 'issue', kind: 'scroller', selector: sel(el), text: '', detail: `scroller ${sel(el)} scrolls sideways: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`, rect: R(r) });
    }

    const texts = textItems();

    // (2) text spilling out of / clipped by its box
    for (const t of texts) {
      if (!t.onscreen || decorative(t.el)) continue;
      const tb = t.box;
      let prev = null;
      for (let e = t.el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'contents') continue;
        const inline = cs.display === 'inline';
        const r = e.getBoundingClientRect();
        if (!inline && r.width > 0) {
          const outX = Math.max(r.left - tb.left, tb.right - r.right);
          const outY = Math.max(r.top - tb.top, tb.bottom - r.bottom);
          const sx = clipsX(cs);
          const sy = clipsY(cs);
          if (outX > 2 || outY > 2) {
            if ((outX > 2 && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')) || (outY > 2 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll'))) break; // scrollable: fine
            const clipped = (outX > 2 && sx) || (outY > 2 && sy);
            const holder = prev && getComputedStyle(prev).textOverflow === 'ellipsis' ? prev : e;
            const ellipsis = getComputedStyle(holder).textOverflow === 'ellipsis' || getComputedStyle(t.el).textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
            if (clipped && ellipsis) {
              add({ detector: 'text', severity: 'info', kind: 'truncated', selector: sel(t.el), text: snippet(t.node.nodeValue), detail: `truncated with an ellipsis in ${sel(e)}${t.el.closest('[title]') ? ' (title set)' : ' (no title)'}`, rect: R(r) });
            } else if (clipped) {
              add({ detector: 'text', severity: 'issue', kind: 'clipped', selector: sel(t.el), text: snippet(t.node.nodeValue), detail: `text cut off by ${sel(e)} (overflow ${cs.overflowX}/${cs.overflowY}) by ${Math.round(Math.max(outX, outY))}px`, rect: R(r), rect2: R(tb) });
            } else {
              add({ detector: 'text', severity: 'issue', kind: 'spill', selector: sel(t.el), text: snippet(t.node.nodeValue), detail: `text spills ${Math.round(Math.max(outX, outY))}px out of ${sel(e)}`, rect: R(r), rect2: R(tb) });
            }
            break;
          }
          if (sx || sy) break; // a clipping box that holds the text: its ancestors clip it at most
        }
        if (cs.position === 'absolute' || cs.position === 'fixed') break;
        // a rotated / scaled sticker hangs over its holder by design (its corners stick out)
        if (cs.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(cs.transform)) break;
        prev = e;
      }
    }

    // controls on screen
    const controls = [];
    for (const el of document.body.querySelectorAll(CONTROL)) {
      if (invisible(el) || decorative(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      controls.push({ el, r });
    }

    // (3) overlap: text runs and controls drawn over each other
    const items = [];
    for (const t of texts) {
      if (!t.onscreen || decorative(t.el)) continue;
      for (const r0 of t.rects) {
        const r = visiblePart(t.el, r0, true);
        if (r) items.push({ el: t.el, r, kind: 'text', label: snippet(t.node.nodeValue) });
      }
    }
    for (const c of controls) {
      // a cover button (an empty, transparent control stretched over a card to make it clickable) layers on purpose
      if (!c.el.textContent.trim() && rgba(getComputedStyle(c.el).backgroundColor)[3] < 0.1 && !/^(INPUT|SELECT|TEXTAREA)$/.test(c.el.tagName)) continue;
      const r = visiblePart(c.el, c.r);
      if (r) items.push({ el: c.el, r, kind: 'control', label: snippet(c.el.textContent || c.el.getAttribute('aria-label') || c.el.value) });
    }
    const seenPairs = new Set();
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (a.el === b.el) continue;
        const x0 = Math.max(a.r.left, b.r.left);
        const x1 = Math.min(a.r.right, b.r.right);
        const y0 = Math.max(a.r.top, b.r.top);
        const y1 = Math.min(a.r.bottom, b.r.bottom);
        const w = x1 - x0;
        const h = y1 - y0;
        // line boxes carry leading: a sliver under 5 px is two lines touching, not text over text
        if (w < 5 || h < 5) continue;
        const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if (w * h < small * 0.12) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // a fading / cross-fading layer (a transition in flight, a ghosted card) is not a layout overlap
        if (opacityOf(a.el) < 0.9 || opacityOf(b.el) < 0.9) continue;
        // two text runs of one control / label share the control: that is one target, not an overlap
        const ca = a.el.closest(CONTROL);
        const cb = b.el.closest(CONTROL);
        if (ca && ca === cb) continue;
        if ((a.kind === 'control' && b.el.closest('label') === a.el.closest('label') && a.el.closest('label')) || (ca && cb && (ca.contains(cb) || cb.contains(ca)))) continue;
        const key = [sel(a.el), sel(b.el)].sort().join(' ~ ');
        if (seenPairs.has(key)) continue;
        // a fixed / sticky bar over content that scrolls under it: fine while a scroll can still reveal it
        const la = layerOf(a.el);
        const lb = layerOf(b.el);
        let underBar = null;
        if (la !== lb) {
          let bar = null;
          let content = null;
          if (la && !lb) [bar, content] = [a, b];
          else if (lb && !la) [bar, content] = [b, a];
          else if (la.contains(lb)) [bar, content] = [b, a];
          else if (lb.contains(la)) [bar, content] = [a, b];
          // a sheet / modal layer over the page: covering it is the point (only bars count)
          if (bar) {
            const lr = layerOf(bar.el).getBoundingClientRect();
            if (lr.width >= W * 0.6 && lr.height >= H * 0.6) continue;
          }
          if (bar && content) {
            const sc = scrollerOf(content.el);
            const barR = layerOf(bar.el).getBoundingClientRect();
            const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
            const atStart = sc.scrollTop <= 1;
            const bottomBar = barR.top + barR.height / 2 > H / 2;
            if ((bottomBar && !atEnd) || (!bottomBar && !atStart)) continue;
            underBar = bottomBar ? 'bottom' : 'top';
          } else continue; // two separate fixed layers (a sheet over the HUD…): their own stacking
        }
        // painted where they meet: at least one of them is on top there (else a sheet covers both)
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const stack = document.elementsFromPoint(cx, cy).slice(0, 6);
        const ina = stack.findIndex((s) => s === a.el || a.el.contains(s));
        const inb = stack.findIndex((s) => s === b.el || b.el.contains(s));
        if (ina < 0 && inb < 0) continue;
        const top = stack[0];
        const holderOk = (s) => s && (s === a.el || s === b.el || a.el.contains(s) || b.el.contains(s) || s.contains(a.el) || s.contains(b.el));
        if (!holderOk(top)) continue;
        seenPairs.add(key);
        add({
          detector: 'overlap',
          severity: 'issue',
          selector: sel(a.el),
          text: `${a.label}  ×  ${b.label}`,
          kind: underBar ? 'under-bar' : undefined,
          detail: `${a.kind} ${sel(a.el)} overlaps ${b.kind} ${sel(b.el)} by ${Math.round(w)}x${Math.round(h)}px${underBar ? ` (still under the ${underBar} bar at the end of the scroll)` : ''}`,
          rect: R(a.r),
          rect2: R(b.r),
        });
      }
    }

    // (4) controls partly off screen or clipped by a container
    for (const { el, r } of controls) {
      const inX = r.right > 0 && r.left < W;
      const inY = r.bottom > 0 && r.top < H;
      // in a fixed layer (sheets, HUD) nothing scrolls it into view except its own scroller
      let fixed = false;
      let scrollerX = false;
      let scrollerY = false;
      let clipX = null;
      let clipY = null;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        if (sx && p.scrollWidth > p.clientWidth + 1) scrollerX = true;
        if (sy && p.scrollHeight > p.clientHeight + 1) scrollerY = true;
        if (!clipX && !scrollerX && !sx && (cs.overflowX === 'hidden' || cs.overflowX === 'clip')) clipX = p;
        if (!clipY && !scrollerY && !sy && (cs.overflowY === 'hidden' || cs.overflowY === 'clip')) clipY = p;
        if (cs.position === 'fixed') fixed = true;
      }
      if (getComputedStyle(el).position === 'fixed') fixed = true;
      const partX = inX && (r.left < -1 || r.right > W + 1);
      const partY = inY && (r.top < -1 || r.bottom > H + 1);
      if (partX && !scrollerX) {
        add({ detector: 'offscreen', severity: 'issue', kind: 'viewport-x', selector: sel(el), text: snippet(el.textContent || el.getAttribute('aria-label')), detail: `control reaches past the viewport (${Math.round(r.left)}..${Math.round(r.right)} of ${W})`, rect: R(r) });
      } else if (partY && fixed && !scrollerY) {
        add({ detector: 'offscreen', severity: 'issue', kind: 'viewport-y', selector: sel(el), text: snippet(el.textContent || el.getAttribute('aria-label')), detail: `control in a fixed layer reaches past the viewport (${Math.round(r.top)}..${Math.round(r.bottom)} of ${H})`, rect: R(r) });
      } else if (!inY && fixed && !scrollerY && r.top >= H && opacityOf(el) > 0.5) {
        add({ detector: 'offscreen', severity: 'info', kind: 'unreachable', selector: sel(el), text: snippet(el.textContent || el.getAttribute('aria-label')), detail: `control in a fixed layer sits below the viewport (top ${Math.round(r.top)} of ${H})`, rect: R(r) });
      }
      if (inX && inY && !el.closest('[data-ui-audit-clip-ok]')) {
        const cx = clipX ? clipX.getBoundingClientRect() : null;
        const cy = clipY ? clipY.getBoundingClientRect() : null;
        const cutX = cx ? Math.max(cx.left - r.left, r.right - cx.right) : 0;
        const cutY = cy ? Math.max(cy.top - r.top, r.bottom - cy.bottom) : 0;
        const visW = cx ? Math.min(r.right, cx.right) - Math.max(r.left, cx.left) : r.width;
        const visH = cy ? Math.min(r.bottom, cy.bottom) - Math.max(r.top, cy.top) : r.height;
        const cut = Math.max(cutX, cutY);
        if (cut > 3 && visW > 4 && visH > 4) {
          const by = cutX >= cutY ? clipX : clipY;
          add({ detector: 'offscreen', severity: 'issue', kind: 'clipped', selector: sel(el), text: snippet(el.textContent || el.getAttribute('aria-label')), detail: `control cut ${Math.round(cut)}px by ${sel(by)}`, rect: R(r), rect2: R(by.getBoundingClientRect()) });
        }
      }
    }

    // (5) contrast
    const checked = new Set();
    const contrastOf = (el, r, fgStr, label, kind) => {
      const cs = getComputedStyle(el);
      const fg0 = rgba(fgStr);
      if (fg0[3] < 0.05) return; // transparent text (gradient text via background-clip): skipped
      const op = opacityOf(el);
      // a slip fading in or out (an exit animation, an entrance in flight) is not its resting colour
      if (op < 0.95 && op > 0) {
        add({ detector: 'contrast', severity: 'info', kind: 'fading', selector: sel(el), text: label, detail: `opacity ${op.toFixed(2)}: in a fade, not checked`, rect: R(r) });
        return;
      }
      const dom = domBackground(el, r.left + r.width / 2, r.top + r.height / 2);
      const fgOnDom = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], dom.color);
      let bg = dom.color;
      let src = 'dom';
      if (!dom.sure && !pixels) {
        needPixels = true;
        return;
      }
      const px = pixelBackground(pixels, r, fgOnDom);
      if (px && !dom.sure) {
        bg = px;
        src = 'pixels';
      }
      const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
      let cr = ratio(fg, bg);
      // an outline / halo (text-shadow, stroke) carries the glyphs on busy backgrounds
      for (const h of halo(cs)) cr = Math.max(cr, Math.min(ratio(fg, h), 21));
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = kind === 'placeholder' ? 3 : large ? 3 : 4.5;
      if (cr >= need) return;
      const dis = disabled(el);
      add({
        detector: 'contrast',
        severity: dis ? 'info' : cr < need - 0.25 || src === 'dom' ? 'issue' : 'info',
        kind,
        selector: sel(el),
        text: label,
        detail: `${kind} contrast ${cr.toFixed(2)} < ${need} (fg ${hex(fg)} on ${hex(bg)} from ${src}; ${size}px${bold ? ' bold' : ''}${dis ? '; disabled' : ''})`,
        ratio: +cr.toFixed(2),
        rect: R(r),
      });
    };
    for (const t of texts) {
      if (!t.onscreen || decorative(t.el)) continue;
      const r = t.rects.map((x) => visiblePart(t.el, x, true)).find(Boolean);
      if (!r) continue;
      if (!onTop(t.el, r)) continue;
      const key = sel(t.el) + '|' + snippet(t.node.nodeValue);
      if (checked.has(key)) continue;
      checked.add(key);
      contrastOf(t.el, r, getComputedStyle(t.el).color, snippet(t.node.nodeValue), 'text');
    }
    for (const el of document.body.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, select')) {
      if (invisible(el) || decorative(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !visiblePart(el, r)) continue;
      if (!onTop(el, visiblePart(el, r))) continue;
      const cs = getComputedStyle(el);
      // the text area of the field (padding inset), so the pixel read sees the field, not its frame
      const inner = new DOMRect(r.left + parseFloat(cs.paddingLeft) + 2, r.top + parseFloat(cs.paddingTop) + 1, Math.max(4, r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4), Math.max(4, r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2));
      contrastOf(el, inner, cs.color, `input value: ${snippet(el.value || el.placeholder || el.name)}`, 'input');
      if (!el.value && el.placeholder) contrastOf(el, inner, getComputedStyle(el, '::placeholder').color, `placeholder: ${snippet(el.placeholder)}`, 'placeholder');
    }

    // (6) touch targets
    if (touch) {
      for (const { el, r } of controls) {
        if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
        if (r.width >= 40 && r.height >= 40) continue;
        if (disabled(el)) continue;
        // half scrolled under a sheet's header: judge it where it rests, not mid-scroll
        const vis = visiblePart(el, r);
        if (!vis || vis.width * vis.height < r.width * r.height * 0.95) continue;
        if (el.matches('input[type=range]')) continue;
        // inline text links inside running text
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /\S/.test([...el.parentElement.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(''))) continue;
        // a checkbox / radio inside a label: the label is the target
        const label = el.closest('label');
        const tgt = label && el.matches('input') ? label : el;
        const tr = tgt.getBoundingClientRect();
        if (tr.width >= 40 && tr.height >= 40) continue;
        if (!onTop(tgt, tr)) continue;
        const cx = tr.left + tr.width / 2;
        const cy = tr.top + tr.height / 2;
        const reach = (dx, dy) => {
          let n = 0;
          for (let s = 1; s <= 24; s++) {
            if (!hits(tgt, cx + dx * s, cy + dy * s)) break;
            n = s;
          }
          return n;
        };
        const ew = reach(-1, 0) + reach(1, 0) + 1;
        const eh = reach(0, -1) + reach(0, 1) + 1;
        // the probe walks whole pixels from a fractional centre: 38 measured is a 40 px target
        if (ew >= 38 && eh >= 38) continue;
        add({
          detector: 'touch',
          severity: ew < 24 || eh < 24 ? 'issue' : 'issue',
          selector: sel(el),
          text: snippet(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title')),
          detail: `touch target ${Math.round(tr.width)}x${Math.round(tr.height)} (hit area ${ew}x${eh}) < 40x40`,
          rect: R(tr),
        });
      }
    }
    return { findings, needPixels };
  };

  /** Scroll containers worth stepping through (visible, scrollable, largest first). */
  A.scrollers = function scrollers() {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!(cs.overflowY === 'auto' || cs.overflowY === 'scroll')) continue;
      if (el.scrollHeight <= el.clientHeight + 20 || el.clientHeight < 80) continue;
      if (invisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh() || r.width < 80) continue;
      out.push({ el, area: r.width * r.height });
    }
    out.sort((a, b) => b.area - a.area);
    A._scrollers = out.slice(0, 2).map((x) => x.el);
    return A._scrollers.length;
  };
  A.scrollStep = function scrollStep(i, step) {
    const el = A._scrollers[i];
    if (!el) return false;
    const before = el.scrollTop;
    el.scrollTop = before + Math.max(60, el.clientHeight * 0.85) * (step ? 1 : 0);
    if (!step) el.scrollTop = 0;
    return step ? el.scrollTop > before + 1 : true;
  };
  A.reset = () => {
    // computed-style caches only hold for one layout
  };

  /** Draws outlines over the finding's rects (for its screenshot). */
  A.highlight = function highlight(rects) {
    A.unhighlight();
    const o = document.createElement('div');
    o.id = '__ui-audit-overlay';
    o.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    rects.forEach((r, i) => {
      if (!r) return;
      const b = document.createElement('div');
      b.style.cssText = `position:fixed;left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px;outline:3px solid ${i ? '#00a2ff' : '#ff1f6b'};outline-offset:0;background:${i ? 'rgba(0,162,255,.08)' : 'rgba(255,31,107,.08)'}`;
      o.appendChild(b);
    });
    document.documentElement.appendChild(o);
  };
  A.unhighlight = () => document.getElementById('__ui-audit-overlay')?.remove();
})();

/* Elymum "Roadmap Chomp" (14 s, 120 BPM: a beat is 0.5 s, downbeats on the even seconds).
 *
 * Modern and minimal: flat paper, a faint dot grid, one ink, lots of air. The X profile coin
 * (the sun coin of brand/out/x, the face) with a Pac-Man bite wakas
 * along a dotted line and eats the roadmap one heading at a time:
 *   01 WL OPEN (eaten by 4.0) -> 02 $1 MINT (6.0) -> 03 GAME LIVE (8.0)  (the product flow: WL -> Mint -> Play)
 * Each heading is eaten letter by letter as the mouth reaches it (a faint trace stays) and the
 * coin grows with a pop on the downbeat. 9.0 the big bite, 10.0 the closing card: the coin grins,
 * the wordmark, the site's host (SITE_HOST), @elymumio.
 *
 * Landscape (one row), portrait and square (three rows, a snake) from the same code (?w=&h=).
 */
'use strict';
(() => {
  const MODE = H > W ? 'portrait' : W === H ? 'square' : 'landscape';
  const HEAD = ['WL OPEN', '$1 MINT', 'GAME LIVE'];
  const EAT = [4.0, 6.0, 8.0]; // the coin's centre leaves each heading's end on these downbeats
  const T0 = 1.0; // the coin pops in and starts
  const BIG = 9.0, CARD = 10.0, END = 14.0;
  const INK = C.ink, PAPER = C.paper;
  let LAY = null;

  /* ── layout: a polyline path, the headings on it and the pellets between ── */
  function layout(ctx) {
    const L = { fs: 0, rows: [], head: [], pellets: [], r: [], segs: [] };
    if (MODE === 'landscape') {
      L.fs = 64; L.r = [36, 48, 62, 80];
      L.rows = [[[90, 560], [1830, 560]]];
      L.closing = { cx: 960, cy: 380, r: 150, wm: 180, wy: 700, url: 790, at: 860 };
    } else if (MODE === 'portrait') {
      L.fs = 76; L.r = [40, 52, 64, 80];
      L.rows = [[[120, 760], [960, 760]], [[960, 1000], [120, 1000]], [[120, 1240], [960, 1240]]];
      L.closing = { cx: 540, cy: 820, r: 200, wm: 200, wy: 1200, url: 1305, at: 1380 };
    } else {
      L.fs = 66; L.r = [34, 44, 56, 70];
      L.rows = [[[110, 360], [970, 360]], [[970, 560], [110, 560]], [[110, 760], [970, 760]]];
      L.closing = { cx: 540, cy: 360, r: 150, wm: 170, wy: 690, url: 790, at: 860 };
    }
    // the path: rows joined by quarter turns
    const pts = [];
    L.rows.forEach((row) => { pts.push(row[0], row[1]); });
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      L.segs.push({ a, b, s0: s, len, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) });
      s += len;
    }
    L.total = s;
    font(ctx, L.fs, 800, 'display', 'semi-condensed'); ctx.letterSpacing = (-L.fs * 0.01) + 'px';
    const widths = HEAD.map((h) => ctx.measureText(h).width);
    // headings: one row (landscape) spread with equal gaps, or one per row (snake) centred
    if (L.rows.length === 1) {
      const [a, b] = L.rows[0];
      const span = b[0] - a[0] - 150;
      const gap = (span - widths.reduce((p, q) => p + q, 0)) / 3;
      let x = a[0] + 150 + gap * 0.45;
      HEAD.forEach((h, i) => { L.head.push({ text: h, s0: x - a[0], s1: x - a[0] + widths[i], w: widths[i] }); x += widths[i] + gap; });
    } else {
      HEAD.forEach((h, i) => {
        const seg = L.segs[i * 2];
        const mid = seg.s0 + seg.len / 2;
        L.head.push({ text: h, s0: mid - widths[i] / 2, s1: mid + widths[i] / 2, w: widths[i] });
      });
    }
    // pellets every 44 px, kept clear of the headings
    for (let p = 70; p < L.total - 10; p += 40) {
      if (L.head.some((h) => p > h.s0 - 40 && p < h.s1 + 40)) continue;
      L.pellets.push(p);
    }
    return L;
  }
  function at(L, s) {
    s = clamp(s, 0, L.total);
    for (const g of L.segs) {
      if (s <= g.s0 + g.len + 1e-6) {
        const k = (s - g.s0) / g.len;
        return { x: lerp(g.a[0], g.b[0], k), y: lerp(g.a[1], g.b[1], k), dir: g.dir, seg: g };
      }
    }
    const g = L.segs[L.segs.length - 1];
    return { x: g.b[0], y: g.b[1], dir: g.dir, seg: g };
  }
  /** Distance along the path at time t (keys: the start, each heading's end on its downbeat, the end). */
  function sAt(L, t) {
    const keys = [[T0, 0], ...L.head.map((h, i) => [EAT[i], h.s1 + 10]), [BIG - 0.35, L.total]];
    if (t <= keys[0][0]) return 0;
    for (let i = 0; i < keys.length - 1; i++) {
      const [ta, sa] = keys[i], [tb, sb] = keys[i + 1];
      if (t <= tb) {
        const k = (t - ta) / (tb - ta);
        // ease out of the start, otherwise a steady waka
        const e = i === 0 ? (k < 0.25 ? (k * k) / 0.5 : k - 0.125) / 0.875 : k;
        return lerp(sa, sb, e);
      }
    }
    return L.total;
  }
  function radiusAt(L, t) {
    let r = L.r[0];
    for (let i = 0; i < 3; i++) {
      const dt = t - EAT[i];
      if (dt < 0) break;
      // the grow: a quick overshoot spring to the next size
      r = lerp(L.r[i], L.r[i + 1], spring(dt, 2.4, 7));
    }
    return r;
  }
  /** The mouth: open and close every eighth note while moving, wide on a bite. */
  function mouthAt(t) {
    if (t < T0 || t > CARD) return 0;
    const ph = ((t - T0) / 0.25) % 1;
    let m = 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * ph)); // shut on each 8th note (the waka)
    for (const e of EAT) { const d = t - e; if (d > -0.18 && d < 0.12) m = d < 0 ? 1 : 1 - d / 0.12; }
    return m;
  }

  /* ── drawing ── */
  function bg(ctx) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    // the faint dot grid
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ctx.createPattern(TEX.dots, 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  function headings(ctx, L, t, sC, fade) {
    font(ctx, L.fs, 800, 'display', 'semi-condensed'); ctx.letterSpacing = (-L.fs * 0.01) + 'px';
    ctx.textBaseline = 'middle';
    L.head.forEach((h, i) => {
      const a = at(L, (h.s0 + h.s1) / 2);
      const seg = a.seg;
      const rev = Math.cos(seg.dir) < 0; // the row runs right to left
      const xL = rev ? a.x - h.w / 2 : a.x - h.w / 2;
      const intro = prog(t, 0.0 + i * 0.1, 0.45 + i * 0.1);
      if (intro <= 0) return;
      const yOff = (1 - E.outExpo(intro)) * L.fs * 0.6;
      // eaten part: the mouth's front along the row
      const r = radiusAt(L, t);
      const front = sC + r * 0.15;
      const eatenTo = clamp((front - h.s0) / (h.s1 - h.s0)); // fraction of the heading behind the mouth
      ctx.save();
      ctx.globalAlpha = clamp(intro * 2) * fade;
      // small step number above
      font(ctx, Math.round(L.fs * 0.3), 500, 'mono'); ctx.letterSpacing = '4px';
      ctx.fillStyle = C.ink2; ctx.textAlign = 'left';
      ctx.globalAlpha *= 1 - 0.75 * (eatenTo >= 1 ? 1 : 0);
      ctx.fillText('0' + (i + 1), xL, a.y - L.fs * 0.95 + yOff);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = clamp(intro * 2) * fade;
      font(ctx, L.fs, 800, 'display', 'semi-condensed'); ctx.letterSpacing = (-L.fs * 0.01) + 'px';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      // a faint trace of what was eaten
      ctx.save();
      ctx.beginPath();
      const cut = rev ? xL + h.w * (1 - eatenTo) : xL + h.w * eatenTo;
      if (rev) ctx.rect(cut, 0, W, H); else ctx.rect(0, 0, cut, H);
      ctx.clip();
      ctx.globalAlpha *= 0.1;
      ctx.fillStyle = INK; ctx.fillText(h.text, xL, a.y + 3 + yOff);
      ctx.restore();
      ctx.beginPath();
      if (rev) ctx.rect(0, 0, cut, H); else ctx.rect(cut, 0, W, H);
      ctx.clip();
      ctx.fillStyle = INK; ctx.fillText(h.text, xL, a.y + 3 + yOff);
      ctx.restore();
    });
  }
  function pellets(ctx, L, t, sC, fade) {
    ctx.save();
    L.pellets.forEach((p, i) => {
      const pop = E.outBack(prog(t, 0.1 + i * 0.012, 0.3 + i * 0.012), 2.5);
      if (pop <= 0) return;
      if (t >= T0 && p < sC + 4) return; // eaten
      const a = at(L, p);
      ctx.globalAlpha = fade;
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(a.x, a.y, 5.5 * pop, 0, TAU); ctx.fill();
    });
    ctx.restore();
  }
  /** Pop: a ring of short ink ticks and a soft ring, at a grow. */
  function popRing(ctx, x, y, r, dt, color = INK) {
    if (dt < 0 || dt > 0.45) return;
    const k = E.outCubic(dt / 0.45);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = 5 * (1 - k) + 1.5;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3;
      const r0 = r * (1.15 + k * 0.6), r1 = r * (1.3 + k * 0.95);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.lineWidth = 2; ctx.globalAlpha = (1 - k) * 0.5;
    ctx.beginPath(); ctx.arc(x, y, r * (1.1 + k * 1.2), 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function coinPose(L, t) {
    const s = sAt(L, t);
    const p = at(L, s);
    let x = p.x, y = p.y, dir = p.dir, r = radiusAt(L, t), mouth = mouthAt(t), scale = 1;
    if (t < T0) {
      // pops in at the start of the line
      scale = E.outBack(prog(t, 0.55, 0.9), 2.2);
    }
    // smooth turns at the corners (direction eases over the last few px of a segment)
    const g = p.seg, idx = L.segs.indexOf(g);
    if (idx > 0) {
      const into = s - g.s0;
      if (into < 40) { const prev = L.segs[idx - 1].dir; let d = dir - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); dir = prev + d * E.inOutCubic(into / 40); }
    }
    // after the last pellet: the coin swings to the closing spot and grows big
    const c = L.closing;
    if (t > BIG - 0.35) {
      const k = E.inOutCubic(prog(t, BIG - 0.35, CARD - 0.1));
      const end = at(L, L.total);
      x = lerp(end.x, c.cx, k); y = lerp(end.y, c.cy, k) - Math.sin(Math.PI * k) * (MODE === 'landscape' ? 80 : 140);
      const ddx = c.cx - end.x, ddy = c.cy - end.y;
      const travel = Math.atan2(ddy, ddx);
      let d = travel - p.dir; d = Math.atan2(Math.sin(d), Math.cos(d));
      dir = p.dir + d * clamp(k * 4);
      // the big bite at BIG (beat), then the mouth closes into the grin on the card
      r = lerp(L.r[3], c.r, E.outBack(prog(t, BIG - 0.1, CARD - 0.2), 1.6));
      const bb = t - BIG;
      mouth = bb < 0 ? lerp(mouth, 1, prog(t, BIG - 0.35, BIG)) : bb < 0.18 ? 1 - 0.3 * Math.sin(bb / 0.18 * Math.PI) : 1 - E.inOutCubic(prog(t, BIG + 0.2, CARD));
      if (t >= CARD) { x = c.cx; y = c.cy + Math.sin((t - CARD) * 2.2) * 6; r = c.r; mouth = 0; dir = 0; }
    }
    return { x, y, dir, r: r * scale, mouth, scale };
  }
  function closing(ctx, L, t) {
    const c = L.closing;
    const k = prog(t, CARD, CARD + 0.45);
    if (k <= 0) return;
    // the wordmark rises into place, in register
    ctx.save();
    const m = wordmarkMetrics(ctx, c.wm);
    ctx.globalAlpha = clamp(k * 2);
    const y = c.wy + (1 - E.outExpo(k)) * 60;
    wordmark(ctx, W / 2 - m.total / 2, y, c.wm, { reg: (1 - spring(t - CARD, 1.6, 6.5)) * 0.6 });
    ctx.restore();
    const k2 = prog(t, CARD + 0.5, CARD + 0.9);
    if (k2 > 0) {
      ctx.save();
      ctx.globalAlpha = E.outCubic(k2);
      font(ctx, Math.round(c.wm * 0.3), 800, 'display'); ctx.letterSpacing = '-1px';
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(window.SITE_HOST, W / 2, c.url + (1 - E.outExpo(k2)) * 24);
      ctx.restore();
    }
    const k3 = prog(t, CARD + 1.0, CARD + 1.4);
    if (k3 > 0) {
      ctx.save();
      ctx.globalAlpha = E.outCubic(k3);
      font(ctx, Math.round(c.wm * 0.17), 500, 'mono'); ctx.letterSpacing = '6px';
      ctx.fillStyle = C.pinkText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('@ELYMUMIO', W / 2, c.at + (1 - E.outExpo(k3)) * 20);
      ctx.restore();
    }
  }

  window.SCENES_INIT = async () => {};
  window.SCENE_DRAW = (ctx, t) => {
    if (!LAY) LAY = layout(ctx);
    const L = LAY;
    bg(ctx);
    const s = sAt(L, t);
    const fade = 1 - prog(t, BIG - 0.2, BIG + 0.3);
    // kicker
    const kk = prog(t, 0.0, 0.3) * (1 - prog(t, BIG - 0.4, BIG));
    if (kk > 0) {
      ctx.save();
      ctx.globalAlpha = kk;
      font(ctx, MODE === 'landscape' ? 24 : 26, 500, 'mono'); ctx.letterSpacing = '8px';
      ctx.fillStyle = C.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ky = MODE === 'landscape' ? 300 : MODE === 'portrait' ? 520 : 180;
      ctx.fillText('ELYMUM  /  ROADMAP', W / 2, ky);
      ctx.fillStyle = C.pink;
      ctx.beginPath(); ctx.arc(W / 2 - ctx.measureText('ELYMUM  /  ROADMAP').width / 2 - 22, ky, 6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    pellets(ctx, L, t, s, fade);
    headings(ctx, L, t, s, fade);
    const cp = coinPose(L, t);
    if (cp.scale > 0.01) {
      for (let i = 0; i < 3; i++) popRing(ctx, cp.x, cp.y, cp.r, t - EAT[i]);
      popRing(ctx, cp.x, cp.y, cp.r, t - BIG, C.pink);
      // facing left: mirror the bite, keep the face upright
      NFT.heroCoin(ctx, cp.x, cp.y, cp.r, { mouth: cp.mouth, dir: cp.dir, eyesOnly: t >= T0 && t < CARD - 0.25, expr: t >= CARD - 0.2 ? 'happy' : 'hungry', ghostOver: false, rot: t >= CARD ? Math.sin((t - CARD) * 1.6) * 0.04 : 0 });
    }
    closing(ctx, L, t);
  };
  // minimal grain, no vignette
  window.SCENE_GRAIN = (ctx, t) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const k = Math.floor(t * 15 + 1e-6);
    const g = TEX.grain[((k % TEX.grain.length) + TEX.grain.length) % TEX.grain.length];
    const pat = ctx.createPattern(g, 'repeat');
    pat.setTransform(new DOMMatrix().translate((k * 137) % 512, (k * 251) % 512).scale(2, 2));
    ctx.globalAlpha = 0.25; ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };
  window.SCENE_DARK = () => false;
  window.SCENE_BLUR = (t) => {
    for (const e of [...EAT, BIG]) if (t >= e - 0.05 && t <= e + 0.2) return { k: 3, shutter: 0.008 };
    if (t >= BIG - 0.35 && t <= CARD) return { k: 4, shutter: 0.01 };
    return { k: 1, shutter: 0 };
  };
  window.SCENE_ASSETS = () => [];
  window.CHOMP = { EAT, T0, BIG, CARD, END };
})();

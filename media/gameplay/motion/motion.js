// Slana motion graphics: Paper Ticket components drawn as a pure function of time.
//
// The page is driven frame by frame (render/overlays.mjs):
//   setup(items)  builds every item once; an item is {id, type, start, dur, z?, props}
//   frame(t)      shows the items alive at t (seconds), poses them for that instant and returns
//                 {n, opaque, box} (how many are visible, whether one covers the frame, their bounds)
// No CSS animations or timers: the same t always gives the same picture, so frames can be captured
// in any order. Every visible string is ASCII.
(() => {
  const W = 1920, H = 1080;
  const stage = document.getElementById('stage');
  const C = {}; // component factories
  const live = [];
  const ART = window.SlanaArt;
  const INKC = '#1b1732', PAPER = '#fcf4df', CARD = '#fffdf6';
  const COL = { pink: '#fb2f85', teal: '#01aca4', mustard: '#ffb413', blue: '#3055fc', green: '#17ad65', red: '#f72e1c', ink: INKC, paper: PAPER, card: CARD, pinkInk: '#d1166b', tealInk: '#0f736e' };
  const col = (c) => COL[c] || c || COL.pink;

  // ── easing ──
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
    // a damped spring settling at 1
    spring: (t, f = 4.2, d = 6.5) => (t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(2 * Math.PI * f * t * 0.5)),
  };
  /** In/out envelope: 0 before, eased 0..1 over `a` s, 1, then 1..0 over the last `b` s. */
  const env = (lt, dur, a = 0.35, b = 0.3, ein = E.outCubic, eout = E.inCubic) => {
    if (lt < a) return ein(seg(lt, 0, a));
    if (lt > dur - b) return 1 - eout(seg(lt, dur - b, dur));
    return 1;
  };
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = (w, h) => { const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('width', w); s.setAttribute('height', h); s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.style.overflow = 'visible'; return s; };
  const path = (d, stroke, sw, extra = {}) => { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', sw); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); for (const k in extra) p.setAttribute(k, extra[k]); return p; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  /** Paper stock: flat paper, riso grain and (optionally) the arena's graph grid. */
  function paperBg(grid = true, tone = PAPER) {
    const d = el('div');
    d.style.cssText = `position:absolute;inset:0;background:${tone};`;
    if (grid) {
      const g = el('div');
      g.style.cssText = 'position:absolute;inset:-60px;background-image:linear-gradient(rgba(48,85,252,.13) 2px,transparent 2px),linear-gradient(90deg,rgba(48,85,252,.13) 2px,transparent 2px),linear-gradient(rgba(48,85,252,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(48,85,252,.06) 1px,transparent 1px);background-size:240px 240px,240px 240px,48px 48px,48px 48px;';
      d.appendChild(g);
      d._grid = g;
    }
    const s = svg(W, H);
    s.setAttribute('class', 'grain');
    s.innerHTML = `<rect width="${W}" height="${H}" filter="url(#grainF)"/>`;
    d.appendChild(s);
    return d;
  }

  /** A coin character on its own canvas (packages/art), posed per frame. */
  function coin(skin, r, { expression = 'happy', seed = 1 } = {}) {
    const pad = r * 0.6;
    const cv = el('canvas');
    const size = Math.ceil((r + pad) * 2);
    cv.width = size; cv.height = size;
    cv.style.cssText = `position:absolute;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;`;
    const look = ART.lookForBasicSkin(skin);
    const ctx = cv.getContext('2d');
    const draw = (t, lookX = 0, lookY = 0, expr = expression) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.translate(size / 2, size / 2);
      ART.drawRisoCoin(ctx, look, r, { time: t * 1000, lookX, lookY, expression: expr, seed, pxPerUnit: 1 });
    };
    return { cv, draw, size };
  }

  // ════════════════════════════ components ════════════════════════════

  /** Full-frame title cards: intro / chapter / outro (opaque). */
  C.card = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const bg = paperBg(p.grid !== false);
    root.appendChild(bg);
    const layer = el('div');
    layer.style.cssText = `position:absolute;inset:0;`;
    root.appendChild(layer);
    const parts = { coins: [] };
    const v = p.variant;
    if (v === 'intro' || v === 'outro') {
      // the wordmark: ink letters over a misregistered pink print
      const wm = el('div');
      wm.style.cssText = 'position:absolute;left:0;right:0;top:300px;text-align:center;height:330px;';
      const word = p.word || 'slana';
      const mk = (color) => {
        const w = el('div', 'disp');
        w.style.cssText = `position:absolute;left:0;right:0;top:0;font-size:330px;letter-spacing:-.045em;color:${color};white-space:nowrap;`;
        w.innerHTML = [...word].map((c) => `<span style="display:inline-block">${esc(c)}</span>`).join('');
        return w;
      };
      const pinkW = mk(COL.pink), inkW = mk(INKC);
      pinkW.style.mixBlendMode = 'multiply';
      wm.appendChild(pinkW); wm.appendChild(inkW);
      layer.appendChild(wm);
      parts.wm = { pinkW, inkW, wm };
      // the dot over the word (the lobby logo's coin)
      const dot = el('div');
      dot.style.cssText = `position:absolute;width:74px;height:74px;border-radius:50%;background:${INKC};box-shadow:-9px -7px 0 ${COL.pink};`;
      layer.appendChild(dot);
      parts.dot = dot;
      const kick = el('div', 'tag mono');
      kick.style.cssText += 'position:absolute;left:50%;top:228px;transform:translateX(-50%);';
      kick.innerHTML = `${p.live ? '<span class="dot"></span>' : ''}<span class="tx">${esc(p.kicker || '')}</span>`;
      layer.appendChild(kick);
      parts.kick = kick;
      const tagline = el('div', 'disp');
      tagline.style.cssText = 'position:absolute;left:0;right:0;top:688px;text-align:center;font-size:84px;';
      const words = (p.tagline || '').split(' ');
      tagline.innerHTML = words.map((w) => `<span style="display:inline-block;margin:0 .14em">${esc(w)}</span>`).join('');
      layer.appendChild(tagline);
      parts.tagline = tagline;
      if (p.foot) {
        const foot = el('div', 'mono');
        foot.style.cssText = `position:absolute;left:0;right:0;top:${p.footY || 820}px;text-align:center;font-size:${p.footSize || 34}px;color:${INKC};font-weight:500;`;
        foot.textContent = p.foot;
        layer.appendChild(foot);
        parts.foot = foot;
      }
      // coins around the word
      const spots = p.coins || [
        { skin: 4, r: 92, x: 300, y: 330, expression: 'happy' },
        { skin: 2, r: 58, x: 330, y: 830, expression: 'hungry' },
        { skin: 7, r: 120, x: 1630, y: 380, expression: 'proud' },
        { skin: 9, r: 52, x: 1600, y: 860, expression: 'love' },
        { skin: 1, r: 36, x: 190, y: 600, expression: 'happy' },
        { skin: 6, r: 40, x: 1780, y: 690, expression: 'scared' },
      ];
      for (const [i, s] of spots.entries()) {
        const c = coin(s.skin, s.r, { expression: s.expression, seed: i + 3 });
        c.cv.style.left = s.x + 'px'; c.cv.style.top = s.y + 'px';
        layer.appendChild(c.cv);
        parts.coins.push({ ...s, c, i });
      }
    } else if (v === 'chapter') {
      const num = el('div', 'disp');
      num.style.cssText = 'position:absolute;left:150px;top:250px;font-size:520px;letter-spacing:-.06em;';
      num.innerHTML = `<span style="position:absolute;left:14px;top:14px;color:${COL.pink};mix-blend-mode:multiply">${esc(p.num)}</span><span style="position:relative;color:${INKC}">${esc(p.num)}</span>`;
      layer.appendChild(num);
      parts.num = num;
      // the ticket
      const tk = el('div');
      tk.style.cssText = `position:absolute;left:820px;top:300px;width:960px;height:440px;`;
      tk.innerHTML = `
        <div style="position:absolute;inset:0;background:${CARD};border:5px solid ${INKC};border-radius:22px;box-shadow:14px 14px 0 ${INKC};overflow:hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:26px;background:${col(p.accent)};border-right:5px solid ${INKC}"></div>
          <div class="mono" style="position:absolute;left:74px;top:52px;font-size:26px;color:#5b5577">${esc(p.kicker || '')}</div>
          <div class="ttl disp" style="position:absolute;left:68px;top:108px;font-size:${p.titleSize || 128}px;white-space:nowrap">${esc(p.title)}</div>
          <div class="sub" style="position:absolute;left:74px;top:${p.titleSize > 130 ? 290 : 272}px;width:640px;font-size:38px;font-weight:600;line-height:1.18;color:${INKC}">${esc(p.sub || '')}</div>
          <div style="position:absolute;right:186px;top:24px;bottom:24px;border-left:5px dashed rgba(27,23,50,.35)"></div>
          <div class="mono" style="position:absolute;right:0;top:0;bottom:0;width:186px;display:flex;align-items:center;justify-content:center;font-size:24px;writing-mode:vertical-rl;transform:rotate(180deg)">${esc(p.stub || 'HOW TO PLAY')}</div>
        </div>
        <div style="position:absolute;right:${186 - 19}px;top:-22px;width:42px;height:42px;border-radius:50%;background:${PAPER};border-bottom:5px solid ${INKC}"></div>
        <div style="position:absolute;right:${186 - 19}px;bottom:-22px;width:42px;height:42px;border-radius:50%;background:${PAPER};border-top:5px solid ${INKC}"></div>`;
      layer.appendChild(tk);
      parts.tk = tk;
      const tape = el('div', 'tape');
      tape.style.left = '1580px'; tape.style.top = '280px'; tape.style.width = '170px'; tape.style.height = '46px';
      layer.appendChild(tape);
      parts.tape = tape;
      if (p.stamp) {
        const st = el('div', 'stamp disp');
        st.style.cssText += `position:absolute;left:1240px;top:610px;font-size:58px;color:${col(p.stampColor || 'teal')};padding:8px 22px 4px;border-width:5px;outline-width:2px;outline-offset:5px;filter:url(#inkF);`;
        st.textContent = p.stamp;
        layer.appendChild(st);
        parts.stamp = st;
      }
      if (p.coin) {
        const c = coin(p.coin.skin, p.coin.r || 70, { expression: p.coin.expression || 'happy', seed: 5 });
        c.cv.style.left = (p.coin.x || 1700) + 'px'; c.cv.style.top = (p.coin.y || 820) + 'px';
        layer.appendChild(c.cv);
        parts.coins.push({ ...p.coin, x: p.coin.x || 1700, y: p.coin.y || 820, c, i: 0 });
      }
    }
    stage.appendChild(root);
    const update = (lt, dur) => {
      const bgShift = lt * 18;
      if (bg._grid) bg._grid.style.transform = `translate(${-bgShift % 48}px, ${(-bgShift * 0.4) % 48}px)`;
      if (parts.wm) {
        const { pinkW, inkW } = parts.wm;
        const spans = [...inkW.children], pspans = [...pinkW.children];
        spans.forEach((s, i) => {
          const a = seg(lt, 0.12 + i * 0.07, 0.62 + i * 0.07);
          const y = lerp(-140, 0, E.outBack(a, 2.2));
          const r = lerp(i % 2 ? 9 : -9, 0, E.outCubic(a));
          s.style.transform = `translateY(${y}px) rotate(${r}deg)`;
          s.style.opacity = a > 0 ? 1 : 0;
          // misregistration: the pink plate lags and settles 12 px off
          const b = seg(lt, 0.2 + i * 0.07, 0.95 + i * 0.07);
          const off = lerp(46, 12, E.outCubic(b));
          pspans[i].style.transform = `translate(${off}px, ${lerp(-110, 0, E.outBack(b, 1.6)) + off * 0.8}px) rotate(${r}deg)`;
          pspans[i].style.opacity = b > 0 ? 1 : 0;
        });
        // the dot lands over the last letter
        const box = spans[spans.length - 1].getBoundingClientRect();
        const da = E.outBack(seg(lt, 0.7, 1.05), 2.6);
        parts.dot.style.left = box.right - 40 + 'px';
        parts.dot.style.top = 300 + lerp(-260, 14, da) + 'px';
        parts.dot.style.transform = `scale(${lerp(0.3, 1, da)})`;
        parts.dot.style.opacity = lt > 0.7 ? 1 : 0;
      }
      if (parts.kick) {
        const a = seg(lt, 0.05, 0.4);
        parts.kick.style.opacity = a > 0 ? 1 : 0;
        parts.kick.style.transform = `translateX(-50%) translateY(${lerp(-20, 0, E.outBack(a))}px)`;
        const tx = parts.kick.querySelector('.tx');
        const n = Math.round((p.kicker || '').length * seg(lt, 0.1, 0.7));
        tx.textContent = (p.kicker || '').slice(0, n);
        const dot = parts.kick.querySelector('.dot');
        if (dot) dot.style.opacity = Math.floor(lt * 2.2) % 2 ? 0.25 : 1;
      }
      if (parts.tagline) {
        [...parts.tagline.children].forEach((s, i) => {
          const a = seg(lt, (p.tagAt ?? 0.95) + i * (p.tagGap ?? 0.12), (p.tagAt ?? 0.95) + 0.22 + i * (p.tagGap ?? 0.12));
          s.style.opacity = a > 0 ? 1 : 0;
          s.style.transform = `scale(${lerp(1.6, 1, E.outBack(a, 2))}) rotate(${lerp(i % 2 ? 6 : -6, 0, a)}deg)`;
          s.style.color = i === (p.tagAccent ?? -1) ? COL.pinkInk : INKC;
        });
      }
      if (parts.foot) { const a = seg(lt, (p.footAt ?? 1.6), (p.footAt ?? 1.6) + 0.4); parts.foot.style.opacity = a; parts.foot.style.transform = `translateY(${lerp(14, 0, E.outCubic(a))}px)`; }
      if (parts.num) {
        const a = seg(lt, 0, 0.55);
        parts.num.style.transform = `translateX(${lerp(-700, 0, E.outBack(a, 1.4))}px) rotate(${lerp(-12, 0, E.outCubic(a))}deg)`;
        const pk = parts.num.children[0];
        const b = seg(lt, 0.1, 0.8);
        const off = lerp(60, 14, E.outCubic(b));
        pk.style.left = off + 'px'; pk.style.top = off + 'px';
      }
      if (parts.tk) {
        const a = seg(lt, 0.15, 0.75);
        parts.tk.style.transform = `translateY(${lerp(820, 0, E.outBack(a, 1.25))}px) rotate(${lerp(7, -1.6, E.outCubic(a))}deg)`;
        const ttl = parts.tk.querySelector('.ttl');
        const c = seg(lt, 0.45, 0.85);
        ttl.style.clipPath = `inset(0 ${100 - c * 100}% 0 0)`;
        const sub = parts.tk.querySelector('.sub');
        sub.style.opacity = seg(lt, 0.75, 1.05);
        sub.style.transform = `translateY(${lerp(16, 0, E.outCubic(seg(lt, 0.75, 1.05)))}px)`;
        parts.tape.style.opacity = lt > 0.8 ? 1 : 0;
        parts.tape.style.transform = `rotate(8deg) scale(${lerp(1.3, 1, E.outCubic(seg(lt, 0.8, 0.95)))})`;
      }
      if (parts.stamp) {
        const a = seg(lt, 1.0, 1.14);
        parts.stamp.style.opacity = a > 0 ? 0.92 : 0;
        parts.stamp.style.transform = `rotate(-9deg) scale(${lerp(2.3, 1, E.outCubic(a))})`;
      }
      for (const k of parts.coins) {
        const a = seg(lt, 0.3 + k.i * 0.09, 0.85 + k.i * 0.09);
        const bob = Math.sin(lt * 2.1 + k.i * 1.7) * 9;
        k.c.cv.style.transform = `translateY(${bob}px) scale(${E.outBack(a, 2.4)}) rotate(${Math.sin(lt * 1.3 + k.i) * 5}deg)`;
        k.c.draw(lt + k.i * 0.37, Math.sin(lt * 0.9 + k.i) * 0.7, Math.cos(lt * 0.7 + k.i) * 0.4);
      }
      // exit: the card lifts slightly before the cut (the wipe covers it)
      const out = seg(lt, dur - 0.35, dur);
      layer.style.transform = `translateY(${-E.inCubic(out) * 60}px) scale(${1 + E.inCubic(out) * 0.03})`;
    };
    return { root, update, opaque: true };
  };

  /** Transition: a paper sheet with a perforated edge sweeps across; the cut happens under it at dur/2. */
  C.wipe = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const colors = p.colors || ['pink', 'paper'];
    const sheets = colors.map((c, i) => {
      const s = el('div');
      const tone = col(c);
      s.style.cssText = `position:absolute;top:-40px;bottom:-40px;left:0;width:${W + 260}px;background:${tone};`;
      // perforated leading and trailing edges (scalloped)
      const edge = (side) => {
        const e = el('div');
        e.style.cssText = `position:absolute;top:0;bottom:0;${side}:-29px;width:30px;background:radial-gradient(circle at ${side === 'right' ? '0' : '100%'} 50%, transparent 0 13px, ${tone} 14px) 0 0/30px 36px;`;
        return e;
      };
      s.appendChild(edge('right'));
      s.appendChild(edge('left'));
      if (c === 'paper' || c === 'card') {
        const g = paperBg(true, tone);
        g.style.inset = '0';
        s.appendChild(g);
        if (p.label) {
          const l = el('div', 'disp');
          l.style.cssText = `position:absolute;left:${130 + W / 2 - 600}px;top:${H / 2 - 40}px;width:1200px;text-align:center;font-size:110px;color:${INKC};`;
          l.textContent = p.label;
          s.appendChild(l);
        }
      }
      root.appendChild(s);
      return s;
    });
    stage.appendChild(root);
    const update = (lt, dur) => {
      const h = dur / 2;
      sheets.forEach((s, i) => {
        const lag = i * 0.055 * (dur / 0.7);
        // in: from the left edge to covering; out: on to the right
        let x;
        const tin = seg(lt, lag, h);
        const tout = seg(lt, h + (sheets.length - 1 - i) * 0.0, dur - (sheets.length - 1 - i) * 0.0 - (i === 0 ? lag : 0));
        if (lt < h) x = lerp(-(W + 300), -130, E.inOutCubic(tin));
        else x = lerp(-130, W + 300, E.inOutCubic(seg(lt, h + lag * 0.6, dur - (sheets.length - 1 - i) * 0.05)));
        if (p.dir === 'left') x = W - x - (W + 260);
        s.style.transform = `translateX(${x}px) skewX(${p.skew ?? -6}deg)`;
      });
    };
    return { root, update, opaque: false, coverAt: (lt, dur) => Math.abs(lt - dur / 2) < 0.04 };
  };

  /** Lower third: a ticket stub with a mono kicker and a big value (counts up). */
  C.lower = (p) => {
    const root = el('div', 'it lt');
    const w = p.w || 640;
    root.style.width = w + 'px';
    root.innerHTML = `<div class="body"><div class="bar" style="background:${col(p.accent)}"></div>
      <div class="k mono">${esc(p.kicker || '')}</div><div class="v disp"><span class="num"></span><small>${esc(p.unit || '')}</small></div>
      <div class="perf" style="right:${p.stub ? 110 : -10}px"></div>${p.stub ? `<div class="stub mono" style="right:0;width:110px">${esc(p.stub)}</div>` : ''}</div>
      <div class="tape" style="left:${w - 150}px;top:-16px"></div>`;
    const x0 = p.x ?? 84, y0 = p.y ?? H - 132 - 84;
    root.style.left = x0 + 'px'; root.style.top = y0 + 'px';
    stage.appendChild(root);
    const num = root.querySelector('.num');
    const tape = root.querySelector('.tape');
    const update = (lt, dur) => {
      const a = seg(lt, 0, 0.5);
      const o = seg(lt, dur - 0.32, dur);
      root.style.transform = `translateX(${lerp(-(w + 160), 0, E.outBack(a, 1.3))}px) translateY(${E.inCubic(o) * 220}px) rotate(${lerp(-4, 0, E.outCubic(a)) + o * 4}deg)`;
      root.style.opacity = 1 - E.inCubic(o);
      if (p.count) {
        const c = E.outExpo(seg(lt, p.countAt ?? 0.25, (p.countAt ?? 0.25) + (p.countDur ?? 0.9)));
        const v = lerp(p.count[0], p.count[1], c);
        num.textContent = (p.sign || '') + (p.dec ? v.toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec }) : fmt(v));
      } else num.textContent = p.value ?? '';
      tape.style.opacity = lt > 0.35 ? 1 : 0;
      tape.style.transform = `rotate(-7deg) scale(${lerp(1.4, 1, E.outCubic(seg(lt, 0.35, 0.5)))})`;
    };
    return { root, update };
  };

  /** A small mono label (kicker); dot = live dot; anchor tr/tl/br/bl. */
  C.tag = (p) => {
    const root = el('div', `it tag mono${p.ink ? ' ink' : ''}${p.kick ? ' kick' : ''}`);
    root.innerHTML = `${p.dot ? '<span class="dot"></span>' : ''}<span class="tx"></span>`;
    root.style.fontSize = (p.size || 22) + 'px';
    stage.appendChild(root);
    const tx = root.querySelector('.tx');
    const dot = root.querySelector('.dot');
    tx.textContent = p.text;
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) {
        const r = root.getBoundingClientRect();
        const x = p.anchor && p.anchor.includes('r') ? p.x - r.width : p.x;
        const y = p.anchor && p.anchor.includes('b') ? p.y - r.height : p.y;
        root.style.left = x + 'px'; root.style.top = y + 'px';
        root.style.transformOrigin = p.anchor && p.anchor.includes('r') ? 'right center' : 'left center';
        placed = true;
      }
      const a = seg(lt, 0, 0.3);
      const o = seg(lt, dur - 0.25, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `scale(${lerp(0.6, 1, E.outBack(a, 2.2)) - o * 0.1}) rotate(${(p.rot || 0) * (1 - a * 0.3)}deg)`;
      if (p.scramble) {
        // the promo's kicker: letters arrive left to right, each flickering through a few glyphs first
        const G = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%';
        let out = '';
        for (let i = 0; i < p.text.length; i++) {
          const ti = lt - 0.05 - i * 0.018;
          const ch = p.text[i];
          if (ti < 0) { out += '\u00a0'; continue; }
          out += ti < 0.1 && ch !== ' ' ? G[Math.floor(Math.abs(Math.sin(i * 12.9898 + Math.floor(lt * 40) * 78.233)) * 43758.5453) % G.length] : ch;
        }
        tx.textContent = out;
      } else {
        const n = Math.round(p.text.length * seg(lt, 0.05, 0.05 + Math.min(0.6, p.text.length * 0.022)));
        tx.textContent = p.text.slice(0, n) + (n < p.text.length ? '_' : '');
      }
      if (dot) dot.style.opacity = p.kick ? 1 : Math.floor(lt * 2.4) % 2 ? 0.25 : 1;
      if (dot && p.kick) dot.style.transform = `scale(${E.outBack(seg(lt, 0, 0.3), 2.5)})`;
    };
    return { root, update };
  };

  /** A rubber stamp slammed onto the frame. */
  C.stamp = (p) => {
    const root = el('div', 'it stamp disp');
    root.style.fontSize = (p.size || 120) + 'px';
    root.style.color = col(p.color || 'pink');
    root.style.filter = 'url(#inkF)';
    root.textContent = p.text;
    stage.appendChild(root);
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) { const r = root.getBoundingClientRect(); root.style.left = p.x - r.width / 2 + 'px'; root.style.top = p.y - r.height / 2 + 'px'; placed = true; }
      const a = seg(lt, 0, 0.13);
      const o = seg(lt, dur - 0.3, dur);
      const shake = lt > 0.13 && lt < 0.32 ? Math.sin(lt * 120) * 4 * (1 - seg(lt, 0.13, 0.32)) : 0;
      root.style.opacity = (a > 0 ? 0.95 : 0) * (1 - o);
      root.style.transform = `translate(${shake}px, ${shake * 0.5}px) rotate(${p.rot ?? -8}deg) scale(${lerp(2.6, 1, E.outCubic(a)) + o * 0.08})`;
    };
    return { root, update };
  };

  /** Keycap(s) with presses at local times; label tag beside. */
  C.key = (p) => {
    const root = el('div', 'it keywrap');
    const keys = (p.keys || [p.key]).map((k) => {
      const kc = el('div', 'key disp');
      const wide = k.length > 2;
      kc.style.cssText += `min-width:${wide ? 260 : 112}px;font-size:${wide ? 38 : 50}px;box-shadow:8px 8px 0 ${INKC};`;
      kc.innerHTML = `<span>${esc(k)}</span>`;
      const ring = el('div');
      ring.style.cssText = `position:absolute;inset:-6px;border:5px solid ${col(p.color || 'pink')};border-radius:24px;opacity:0;`;
      kc.appendChild(ring);
      kc._ring = ring;
      root.appendChild(kc);
      return kc;
    });
    if (p.plus) keys.slice(1).forEach((k) => root.insertBefore(Object.assign(el('div', 'disp'), { textContent: '+', style: 'font-size:56px' }), k));
    if (p.label) {
      const lab = el('div', 'keylabel mono');
      lab.textContent = p.label;
      root.appendChild(lab);
    }
    stage.appendChild(root);
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) {
        const r = root.getBoundingClientRect();
        root.style.left = (p.anchor === 'center' ? p.x - r.width / 2 : p.x) + 'px';
        root.style.top = p.y - r.height / 2 + 'px';
        placed = true;
      }
      const a = seg(lt, 0, 0.32);
      const o = seg(lt, dur - 0.25, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${lerp(40, 0, E.outBack(a, 2))}px) scale(${1 - o * 0.08})`;
      keys.forEach((kc, ki) => {
        let down = 0, ringA = 0, ringS = 1;
        for (const pr of p.presses || []) {
          const t0 = Array.isArray(pr) ? pr[0] : pr;
          const hold = Array.isArray(pr) ? pr[1] : 0.12;
          const which = Array.isArray(pr) && pr.length > 2 ? pr[2] : null;
          if (which !== null && which !== ki) continue;
          const d = lt - t0;
          if (d >= 0 && d < hold + 0.18) down = Math.max(down, d < 0.05 ? d / 0.05 : d < hold ? 1 : 1 - (d - hold) / 0.18);
          if (d >= 0 && d < 0.5) { ringA = Math.max(ringA, 1 - d / 0.5); ringS = 1 + d * 0.9; }
        }
        kc.style.transform = `translate(${down * 6}px, ${down * 6}px)`;
        kc.style.boxShadow = `${8 - down * 6}px ${8 - down * 6}px 0 ${INKC}`;
        kc.style.background = down > 0.5 ? col(p.color || 'pink') : CARD;
        kc._ring.style.opacity = ringA;
        kc._ring.style.transform = `scale(${ringS})`;
      });
    };
    return { root, update };
  };

  /** Mouse callout: a mouse with steering arrows that follow a direction track. */
  C.mouse = (p) => {
    const root = el('div', 'it keywrap');
    const box = el('div');
    box.style.cssText = `position:relative;width:150px;height:150px;`;
    const s = svg(150, 150);
    s.innerHTML = `<g transform="translate(75 75)">
      <rect x="-30" y="-46" width="60" height="92" rx="30" fill="${CARD}" stroke="${INKC}" stroke-width="5"/>
      <path d="M0 -46 V-12 M-30 -12 H30" stroke="${INKC}" stroke-width="4" fill="none"/>
      <g class="ar" fill="${col(p.color || 'pink')}" stroke="${INKC}" stroke-width="3"></g></g>`;
    box.appendChild(s);
    root.appendChild(box);
    if (p.label) { const lab = el('div', 'keylabel mono'); lab.textContent = p.label; root.appendChild(lab); }
    stage.appendChild(root);
    const ar = s.querySelector('.ar');
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) { const r = root.getBoundingClientRect(); root.style.left = p.x + 'px'; root.style.top = p.y - r.height / 2 + 'px'; placed = true; }
      const a = seg(lt, 0, 0.32), o = seg(lt, dur - 0.25, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${lerp(40, 0, E.outBack(a, 2))}px)`;
      // an arrow orbiting the mouse: the steering direction
      const ang = p.track ? p.track(lt) : lt * 2.2;
      const r = 62 + Math.sin(lt * 7) * 3;
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      const deg = (ang * 180) / Math.PI;
      ar.innerHTML = `<path transform="translate(${x} ${y}) rotate(${deg})" d="M-8 -12 L12 0 L-8 12 Z"/>`;
      box.style.transform = `translate(${Math.cos(ang) * 6}px, ${Math.sin(ang) * 6}px)`;
    };
    return { root, update };
  };

  /** Rough closed loop around (0,0): a marker ellipse drawn a bit more than once. */
  function roughLoop(rx, ry, seed, turns = 1.12) {
    const r = rng(seed);
    const pts = [];
    const n = 48;
    const ph = r() * Math.PI * 2;
    const wob = [r() * 0.06, r() * 0.05, r() * 0.04];
    for (let i = 0; i <= n * turns; i++) {
      const a = ph + (i / n) * Math.PI * 2;
      const k = 1 + wob[0] * Math.sin(a * 2 + 1) + wob[1] * Math.sin(a * 3 + 2) + (i / n) * 0.06;
      pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
    }
    return 'M' + pts.map((q) => q.map((v) => v.toFixed(1)).join(' ')).join(' L');
  }

  /** Hand-drawn ring that tracks a target: track = [[lt, x, y, r], ...] (frame pixels). */
  C.ring = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const s = svg(W, H);
    root.appendChild(s);
    const g = document.createElementNS(svgNS, 'g');
    s.appendChild(g);
    const mk = (color, sw, op) => { const q = path('', color, sw, { opacity: op }); g.appendChild(q); return q; };
    const under = mk(col(p.color2 || 'teal'), p.sw || 9, 0.85);
    under.style.mixBlendMode = 'multiply';
    const over = mk(col(p.color || 'pink'), p.sw || 9, 1);
    let lab = null;
    if (p.label) { lab = el('div', 'tag mono'); lab.style.cssText += `position:absolute;font-size:20px;`; lab.textContent = p.label; root.appendChild(lab); }
    stage.appendChild(root);
    const at = (lt) => {
      const tr = p.track;
      if (!tr || !tr.length) return [p.x, p.y, p.r];
      if (lt <= tr[0][0]) return tr[0].slice(1);
      for (let i = 1; i < tr.length; i++) if (lt <= tr[i][0]) { const k = (lt - tr[i - 1][0]) / (tr[i][0] - tr[i - 1][0] || 1); return [1, 2, 3].map((j) => lerp(tr[i - 1][j], tr[i][j], k)); }
      return tr[tr.length - 1].slice(1);
    };
    let len = 0;
    const update = (lt, dur) => {
      const [x, y, r0] = at(lt);
      const r = Math.max(30, r0 * (p.pad || 1.25));
      const d = roughLoop(r * (p.sx || 1.08), r * (p.sy || 0.94), p.seed || 7);
      over.setAttribute('d', d);
      under.setAttribute('d', d);
      len = over.getTotalLength();
      const draw = E.outCubic(seg(lt, 0, p.drawDur || 0.42));
      for (const q of [over, under]) { q.style.strokeDasharray = `${len} ${len}`; q.style.strokeDashoffset = `${len * (1 - draw)}`; }
      g.setAttribute('transform', `translate(${x} ${y}) rotate(${p.rot ?? -8})`);
      under.setAttribute('transform', 'translate(5 4)');
      const o = seg(lt, dur - 0.25, dur);
      root.style.opacity = 1 - o;
      if (lab) {
        lab.style.left = x + r * 0.78 + 'px';
        lab.style.top = y - r * 0.95 - 30 + 'px';
        const la = seg(lt, 0.25, 0.5);
        lab.style.opacity = la > 0 ? 1 : 0;
        lab.style.transform = `scale(${lerp(0.6, 1, E.outBack(la, 2))}) rotate(-3deg)`;
      }
    };
    return { root, update };
  };

  /** Hand-drawn arrow from a label to a point. */
  C.arrow = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const s = svg(W, H);
    root.appendChild(s);
    const [x0, y0] = p.from, [x1, y1] = p.to;
    const mx = (x0 + x1) / 2 + (y1 - y0) * (p.bend ?? 0.25), my = (y0 + y1) / 2 - (x1 - x0) * (p.bend ?? 0.25);
    const d = `M${x0} ${y0} Q${mx} ${my} ${x1} ${y1}`;
    const ang = Math.atan2(y1 - my, x1 - mx);
    const hl = 34;
    const h1 = [x1 - Math.cos(ang - 0.45) * hl, y1 - Math.sin(ang - 0.45) * hl], h2 = [x1 - Math.cos(ang + 0.45) * hl, y1 - Math.sin(ang + 0.45) * hl];
    const head = `M${h1[0]} ${h1[1]} L${x1} ${y1} L${h2[0]} ${h2[1]}`;
    const under = path(d, col(p.color2 || 'teal'), 8, { transform: 'translate(4 4)', opacity: 0.85 });
    under.style.mixBlendMode = 'multiply';
    const over = path(d, col(p.color || 'pink'), 8);
    const hd = path(head, col(p.color || 'pink'), 8);
    s.appendChild(under); s.appendChild(over); s.appendChild(hd);
    let lab = null;
    if (p.label) { lab = el('div', 'tag mono'); lab.style.cssText += `position:absolute;font-size:${p.size || 22}px;`; lab.textContent = p.label; root.appendChild(lab); }
    stage.appendChild(root);
    let placed = false;
    const update = (lt, dur) => {
      const len = over.getTotalLength();
      const a = E.outCubic(seg(lt, 0.12, 0.5));
      for (const q of [over, under]) { q.style.strokeDasharray = `${len} ${len}`; q.style.strokeDashoffset = `${len * (1 - a)}`; }
      hd.style.opacity = a > 0.97 ? 1 : 0;
      if (lab) {
        if (!placed) { const r = lab.getBoundingClientRect(); lab.style.left = x0 - r.width / 2 + 'px'; lab.style.top = y0 + (y0 > y1 ? 10 : -r.height - 10) + 'px'; placed = true; }
        const la = seg(lt, 0, 0.25);
        lab.style.opacity = la > 0 ? 1 : 0;
        lab.style.transform = `scale(${lerp(0.6, 1, E.outBack(la, 2))})`;
      }
      root.style.opacity = 1 - seg(lt, dur - 0.25, dur);
    };
    return { root, update };
  };

  /** Hand-drawn highlight box with a label tag. */
  C.box = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const s = svg(W, H);
    root.appendChild(s);
    const r = rng(p.seed || 11);
    const j = () => (r() - 0.5) * 10;
    const { x, y, w, h } = p;
    const o = 14;
    const d = `M${x - o + j()} ${y + j()} L${x + w + o + j()} ${y + j()} M${x + w + j()} ${y - o + j()} L${x + w + j()} ${y + h + o + j()} M${x + w + o + j()} ${y + h + j()} L${x - o + j()} ${y + h + j()} M${x + j()} ${y + h + o + j()} L${x + j()} ${y - o + j()}`;
    const under = path(d, col(p.color2 || 'teal'), 7, { transform: 'translate(4 4)', opacity: 0.8 });
    under.style.mixBlendMode = 'multiply';
    const over = path(d, col(p.color || 'pink'), 7);
    s.appendChild(under); s.appendChild(over);
    let lab = null;
    if (p.label) { lab = el('div', 'tag mono ink'); lab.style.cssText += `position:absolute;font-size:${p.size || 22}px;left:${x - 4}px;`; lab.textContent = p.label; root.appendChild(lab); }
    stage.appendChild(root);
    const update = (lt, dur) => {
      const len = over.getTotalLength();
      const a = E.outCubic(seg(lt, 0, 0.45));
      for (const q of [over, under]) { q.style.strokeDasharray = `${len} ${len}`; q.style.strokeDashoffset = `${len * (1 - a)}`; }
      if (lab) {
        const rr = lab.getBoundingClientRect();
        lab.style.top = (p.labelBelow ? y + h + 22 : y - rr.height - 22) + 'px';
        const la = seg(lt, 0.2, 0.45);
        lab.style.opacity = la > 0 ? 1 : 0;
        lab.style.transform = `scale(${lerp(0.6, 1, E.outBack(la, 2))}) rotate(-2deg)`;
      }
      root.style.opacity = 1 - seg(lt, dur - 0.25, dur);
    };
    return { root, update };
  };

  /** On-screen text that echoes the voiceover: words pop in; *word* is inked pink. */
  C.caption = (p) => {
    const root = el('div', 'it cap disp');
    root.style.fontSize = (p.size || 50) + 'px';
    const words = p.text.split(' ');
    root.innerHTML = words.map((w) => (w.startsWith('*') ? `<span class="w"><em>${esc(w.replace(/\*/g, ''))}</em></span>` : `<span class="w">${esc(w)}</span>`)).join(' ');
    stage.appendChild(root);
    const ws = [...root.querySelectorAll('.w')];
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) { const r = root.getBoundingClientRect(); root.style.left = (p.x ?? W / 2) - (p.align === 'left' ? 0 : r.width / 2) + 'px'; root.style.top = (p.y ?? 900) + 'px'; placed = true; }
      const a = seg(lt, 0, 0.3), o = seg(lt, dur - 0.28, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - E.inCubic(o));
      root.style.transform = `translateY(${lerp(30, 0, E.outBack(a, 1.6)) + E.inCubic(o) * 30}px) rotate(${p.rot ?? -1}deg)`;
      ws.forEach((w, i) => {
        const b = seg(lt, 0.08 + i * (p.gap ?? 0.07), 0.3 + i * (p.gap ?? 0.07));
        w.style.opacity = b > 0 ? 1 : 0;
        w.style.transform = `translateY(${lerp(18, 0, E.outBack(b, 2))}px)`;
      });
    };
    return { root, update };
  };

  /** Chapter progress chip: "03 / 08  CONTROLS" with ticks. */
  C.chip = (p) => {
    const root = el('div', 'it chip mono');
    root.innerHTML = `<span>${esc(p.n)} / ${esc(p.total)}</span><span class="ticks">${Array.from({ length: +p.total }, (_, i) => `<i class="${i < +p.n ? 'on' : ''}"></i>`).join('')}</span><span>${esc(p.label)}</span>`;
    stage.appendChild(root);
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) { const r = root.getBoundingClientRect(); root.style.left = W - 64 - r.width + 'px'; root.style.top = (p.y ?? 52) + 'px'; placed = true; }
      const a = seg(lt, 0, 0.35), o = seg(lt, dur - 0.25, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${lerp(-40, 0, E.outBack(a, 1.8))}px)`;
    };
    return { root, update };
  };

  /** A receipt that prints line by line; optional stamp at the end. */
  C.receipt = (p) => {
    const root = el('div', 'it');
    const rc = el('div', 'rc');
    rc.style.width = (p.w || 520) + 'px';
    const rows = (p.rows || []).map((r) => {
      if (r === '-') return '<div class="rule"></div>';
      if (r === '=') return '<div class="rule2"></div>';
      const [l, v, style] = r;
      return `<div class="row" style="${style === 'dim' ? 'color:#5b5577' : style === 'pink' ? 'color:#c71466' : style === 'teal' ? 'color:#0f736e' : ''}"><span class="l">${esc(l)}</span><span class="d"></span><span class="r">${esc(v)}</span></div>`;
    });
    rc.innerHTML = `<div class="in"><h3>${esc(p.title || 'SLANA CASH-OUT')}</h3><div class="sub mono">${esc(p.sub || '')}</div>${rows.join('')}
      ${p.net ? `<div class="rule2"></div><div class="net"><span class="mono" style="font-size:22px">${esc(p.netLabel || 'NET')}</span><span><b>${esc(p.net)}</b> <span class="mono" style="font-size:20px">$SLANA</span></span></div>` : ''}</div><div class="zig"></div>`;
    const clip = el('div');
    clip.style.cssText = 'position:relative;overflow:hidden;padding:0 30px 40px 30px;margin:0 -30px;';
    clip.appendChild(rc);
    // the printer slot
    const slot = el('div');
    slot.style.cssText = `position:relative;height:22px;margin:0 -24px;background:${INKC};border-radius:12px;z-index:2;`;
    root.appendChild(slot);
    root.appendChild(clip);
    let st = null;
    if (p.stamp) {
      st = el('div', 'stamp disp');
      st.style.cssText += `position:absolute;right:-40px;bottom:${p.stampBottom ?? 120}px;font-size:${p.stampSize || 76}px;color:${col(p.stampColor || 'teal')};filter:url(#inkF);border-radius:50%;padding:30px 30px 24px;`;
      st.textContent = p.stamp;
      root.appendChild(st);
    }
    root.style.left = p.x + 'px'; root.style.top = p.y + 'px';
    stage.appendChild(root);
    let full = 0;
    const update = (lt, dur) => {
      if (!full) full = rc.getBoundingClientRect().height + 20;
      const a = seg(lt, 0, 0.3), o = seg(lt, dur - 0.3, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${lerp(-30, 0, E.outBack(a))}px) rotate(${p.rot ?? 0}deg)`;
      // printing: the paper feeds out in small jerks (one per line)
      const pd = p.printDur ?? 1.8;
      const pr = seg(lt, 0.25, 0.25 + pd);
      const steps = 14;
      const q = Math.floor(pr * steps) / steps + E.outCubic((pr * steps) % 1) / steps * 0.6;
      const hgt = full * Math.min(1, pr >= 1 ? 1 : q);
      clip.style.height = hgt + 40 + 'px';
      rc.style.transform = `translateY(${hgt - full}px)`;
      if (st) {
        const s0 = (p.stampAt ?? 0.4 + pd);
        const sa = seg(lt, s0, s0 + 0.13);
        st.style.opacity = sa > 0 ? 0.92 : 0;
        st.style.transform = `rotate(-14deg) scale(${lerp(2.4, 1, E.outCubic(sa))})`;
      }
    };
    return { root, update };
  };

  /** Fee split bar: segments grow in turn with their labels. */
  C.splitbar = (p) => {
    const root = el('div', 'it');
    const w = p.w || 900;
    root.style.cssText += `width:${w}px;`;
    const bar = el('div');
    bar.style.cssText = `position:relative;height:74px;border:5px solid ${INKC};border-radius:12px;box-shadow:8px 8px 0 ${INKC};background:${CARD};overflow:hidden;display:flex;`;
    const segs = p.parts.map((q) => { const s = el('div'); s.style.cssText = `height:100%;width:0;background:${col(q.color)};border-right:5px solid ${INKC};box-sizing:border-box;`; bar.appendChild(s); return s; });
    root.appendChild(bar);
    const labs = el('div');
    labs.style.cssText = 'position:relative;height:110px;margin-top:22px;';
    let acc = 0;
    const ls = p.parts.map((q) => {
      const l = el('div');
      l.style.cssText = `position:absolute;left:${(acc / 100) * w}px;top:0;`;
      l.innerHTML = `<div class="disp" style="font-size:56px">${esc(q.pct)}%</div><div class="mono" style="font-size:20px;margin-top:6px">${esc(q.label)}</div>`;
      acc += q.pct;
      labs.appendChild(l);
      return l;
    });
    root.appendChild(labs);
    if (p.title) { const t = el('div', 'mono'); t.style.cssText = 'position:absolute;left:0;top:-52px;font-size:24px;'; t.textContent = p.title; root.appendChild(t); }
    root.style.left = p.x + 'px'; root.style.top = p.y + 'px';
    stage.appendChild(root);
    const update = (lt, dur) => {
      const a = seg(lt, 0, 0.3), o = seg(lt, dur - 0.3, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${lerp(30, 0, E.outBack(a))}px)`;
      p.parts.forEach((q, i) => {
        const b = E.outCubic(seg(lt, 0.3 + i * 0.4, 0.75 + i * 0.4));
        segs[i].style.width = (q.pct / 100) * w * b + 'px';
        ls[i].style.opacity = b > 0.05 ? 1 : 0;
        ls[i].style.transform = `translateY(${lerp(16, 0, b)}px)`;
      });
    };
    return { root, update };
  };

  /** Rank counter: "#4" rolls to "#1". */
  C.rank = (p) => {
    const root = el('div', 'it');
    root.innerHTML = `<div class="mono" style="font-size:22px;margin-bottom:6px">${esc(p.label || 'RANK')}</div>
      <div style="position:relative;height:150px;overflow:hidden;width:${p.w || 260}px"><div class="roll disp" style="position:absolute;left:0;top:0;font-size:150px;line-height:150px"></div></div>`;
    const roll = root.querySelector('.roll');
    const seq = p.seq || [p.from, p.to];
    roll.innerHTML = seq.map((n) => `<div style="height:150px">#${esc(n)}</div>`).join('');
    root.style.cssText += `left:${p.x}px;top:${p.y}px;background:${CARD};border:4px solid ${INKC};border-radius:14px;box-shadow:8px 8px 0 ${INKC};padding:18px 26px 10px;`;
    stage.appendChild(root);
    const update = (lt, dur) => {
      const a = seg(lt, 0, 0.35), o = seg(lt, dur - 0.3, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `scale(${lerp(0.7, 1, E.outBack(a, 2))}) rotate(${p.rot ?? 2}deg)`;
      const times = p.at || seq.slice(1).map((_, i) => 0.5 + i * 0.5);
      let idx = 0;
      for (let i = 0; i < times.length; i++) idx += E.outBack(seg(lt, times[i], times[i] + 0.35), 1.8);
      roll.style.transform = `translateY(${-idx * 150}px)`;
      roll.style.color = idx >= seq.length - 1.01 ? COL.pinkInk : INKC;
    };
    return { root, update };
  };

  /** An explainer board: paper stock with an optional kicker and headline (opaque). */
  C.board = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const bg = paperBg(p.grid !== false);
    root.appendChild(bg);
    let k = null, h = null;
    if (p.kicker) { k = el('div', 'tag mono kick'); k.style.cssText += 'position:absolute;left:96px;top:86px;font-size:26px;'; k.innerHTML = `<span class="dot"></span><span>${esc(p.kicker)}</span>`; root.appendChild(k); }
    if (p.title) { h = el('div', 'disp'); h.style.cssText = `position:absolute;left:96px;top:150px;font-size:${p.titleSize || 84}px;white-space:nowrap;`; h.innerHTML = esc(p.title).replace(/\*(.+?)\*/g, `<span style="color:${COL.pinkInk}">$1</span>`); root.appendChild(h); }
    stage.appendChild(root);
    const update = (lt, dur) => {
      if (bg._grid) bg._grid.style.transform = `translate(${-(lt * 14) % 48}px, ${-(lt * 6) % 48}px)`;
      if (k) { const a = seg(lt, 0.1, 0.4); k.style.opacity = a > 0 ? 1 : 0; k.style.transform = `translateY(${lerp(-18, 0, E.outBack(a))}px)`; }
      if (h) { const a = seg(lt, 0.2, 0.6); h.style.clipPath = `inset(0 ${100 - E.outCubic(a) * 100}% 0 0)`; }
    };
    return { root, update, opaque: true };
  };

  /** The eating rule as a picture: a bigger coin covers a smaller one, which shrinks into it. */
  C.eatrule = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;`;
    const big = coin(p.bigSkin ?? 4, 150, { expression: 'hungry', seed: 3 });
    const small = coin(p.smallSkin ?? 2, 120, { expression: 'scared', seed: 8 });
    const bigW = el('div'); bigW.style.cssText = 'position:absolute;'; bigW.appendChild(big.cv);
    const smW = el('div'); smW.style.cssText = 'position:absolute;'; smW.appendChild(small.cv);
    root.appendChild(smW); root.appendChild(bigW);
    const mk = (txt, x, y, size = 30) => { const t = el('div', 'tag mono'); t.style.cssText += `position:absolute;left:${x}px;top:${y}px;font-size:${size}px;`; t.textContent = txt; root.appendChild(t); return t; };
    const l1 = mk(p.bigLabel || 'MASS 125', 0, 0), l2 = mk(p.smallLabel || 'MASS 100', 0, 0);
    const rule = el('div', 'disp');
    rule.style.cssText = `position:absolute;left:0;right:0;top:${p.ruleY ?? 820}px;text-align:center;font-size:64px;`;
    rule.innerHTML = esc(p.rule || 'At least 1.25x the mass, and mostly cover it.').replace(/\*(.+?)\*/g, `<span style="color:${COL.pinkInk}">$1</span>`);
    root.appendChild(rule);
    stage.appendChild(root);
    const update = (lt, dur) => {
      const cy = p.cy ?? 470;
      const a = seg(lt, 0.0, 0.5), m = seg(lt, p.moveAt ?? 1.4, (p.moveAt ?? 1.4) + 1.2), g = seg(lt, (p.moveAt ?? 1.4) + 0.9, (p.moveAt ?? 1.4) + 1.4);
      const bx = lerp(640, 1060, E.inOutCubic(m)), sx = 1240;
      const bs = E.outBack(a, 2) * (1 + 0.12 * E.outBack(g, 3));
      bigW.style.left = bx + 'px'; bigW.style.top = cy + 'px'; bigW.style.transform = `scale(${bs})`;
      const ss = E.outBack(seg(lt, 0.15, 0.6), 2) * (1 - E.inCubic(g));
      smW.style.left = lerp(sx, bx + 40, E.inCubic(g)) + 'px'; smW.style.top = cy + 'px'; smW.style.transform = `scale(${ss})`;
      big.draw(lt, 1, 0, g > 0.1 ? 'love' : 'hungry');
      small.draw(lt + 1, -1, 0, 'scared');
      l1.style.left = bx - 110 + 'px'; l1.style.top = cy + 190 + 'px'; l1.style.opacity = seg(lt, 0.4, 0.6);
      l2.style.left = sx - 100 + 'px'; l2.style.top = cy + 160 + 'px'; l2.style.opacity = seg(lt, 0.5, 0.7) * (1 - g);
      const r = seg(lt, p.ruleAt ?? 0.7, (p.ruleAt ?? 0.7) + 0.4);
      rule.style.opacity = r; rule.style.transform = `translateY(${lerp(24, 0, E.outBack(r))}px)`;
      root.style.opacity = 1 - seg(lt, dur - 0.25, dur);
    };
    return { root, update };
  };

  /** Full-frame flash (impact). */
  C.flash = (p) => {
    const root = el('div', 'it');
    root.style.cssText += `width:${W}px;height:${H}px;background:${col(p.color || 'card')};mix-blend-mode:${p.blend || 'normal'};`;
    stage.appendChild(root);
    const update = (lt, dur) => { root.style.opacity = (p.peak ?? 0.6) * (1 - E.outCubic(seg(lt, 0, dur))); };
    return { root, update };
  };

  /** Free text block (display or mono) with a pop-in. */
  C.text = (p) => {
    const root = el('div', `it ${p.mono ? 'mono' : 'disp'}`);
    root.style.cssText += `font-size:${p.size || 64}px;color:${col(p.color || 'ink')};white-space:pre;line-height:${p.lh || 1};text-align:${p.align || 'left'};${p.bg ? `background:${col(p.bg)};padding:14px 24px 16px;border:4px solid ${INKC};border-radius:12px;box-shadow:8px 8px 0 ${INKC};` : ''}`;
    root.innerHTML = esc(p.text).replace(/\*(.+?)\*/g, `<span style="color:${COL.pinkInk}">$1</span>`);
    stage.appendChild(root);
    let placed = false;
    const update = (lt, dur) => {
      if (!placed) { const r = root.getBoundingClientRect(); root.style.left = (p.align === 'center' ? p.x - r.width / 2 : p.align === 'right' ? p.x - r.width : p.x) + 'px'; root.style.top = p.y + 'px'; placed = true; }
      const a = seg(lt, p.at || 0, (p.at || 0) + 0.32), o = seg(lt, dur - 0.25, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${lerp(26, 0, E.outBack(a, 1.7))}px) rotate(${p.rot || 0}deg)`;
    };
    return { root, update };
  };

  /** A coin character as a graphic (for diagrams): props skin, r, x, y, expression, path. */
  /** A loot coin (mustard disc, pink riso ghost, inner ring) that pops in and bobs. */
  C.loot = (p) => {
    const root = el('div', 'it');
    const r = p.r || 26;
    root.innerHTML = `<div style="position:absolute;left:${r * 0.2}px;top:${r * 0.2}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;background:${COL.pink};mix-blend-mode:multiply"></div>
      <div style="position:absolute;left:0;top:0;width:${2 * r}px;height:${2 * r}px;box-sizing:border-box;border-radius:50%;background:${COL.mustard};border:${Math.max(3, r * 0.14)}px solid ${INKC}"></div>
      <div style="position:absolute;left:${r * 0.4}px;top:${r * 0.4}px;width:${1.2 * r}px;height:${1.2 * r}px;box-sizing:border-box;border-radius:50%;border:${Math.max(2, r * 0.1)}px solid rgba(27,23,50,.45)"></div>`;
    root.style.left = p.x - r + 'px'; root.style.top = p.y - r + 'px';
    stage.appendChild(root);
    const update = (lt, dur) => {
      const a = seg(lt, 0, 0.35), o = seg(lt, dur - 0.25, dur);
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `translateY(${Math.sin(lt * 3 + p.x) * 5}px) scale(${E.outBack(a, 2.4)}) scaleX(${Math.abs(Math.cos(lt * 1.6 + p.x * 0.01)) * 0.5 + 0.5})`;
    };
    return { root, update };
  };

  C.coin = (p) => {
    const root = el('div', 'it');
    const c = coin(p.skin ?? 4, p.r || 60, { expression: p.expression || 'happy', seed: p.seed || 2 });
    root.appendChild(c.cv);
    if (p.name) { const n = el('div', 'disp'); n.style.cssText = `position:absolute;left:-200px;width:400px;text-align:center;top:${(p.r || 60) * 0.25}px;font-size:${Math.max(18, (p.r || 60) * 0.32)}px;color:#fff;-webkit-text-stroke:${Math.max(3, (p.r || 60) * 0.06)}px ${INKC};paint-order:stroke fill;`; n.textContent = p.name; root.appendChild(n); }
    stage.appendChild(root);
    const update = (lt, dur) => {
      const a = seg(lt, p.at || 0, (p.at || 0) + 0.4), o = seg(lt, dur - 0.25, dur);
      const pos = p.path ? p.path(lt) : [p.x, p.y, 1];
      root.style.left = pos[0] + 'px'; root.style.top = pos[1] + 'px';
      root.style.opacity = (a > 0 ? 1 : 0) * (1 - o);
      root.style.transform = `scale(${E.outBack(a, 2.2) * (pos[2] ?? 1)})`;
      c.draw(lt + (p.seed || 0), Math.sin(lt) * 0.6, 0, p.exprAt ? p.exprAt(lt) : p.expression || 'happy');
    };
    return { root, update };
  };

  // ════════════════════════════ driver ════════════════════════════
  window.setup = (items) => {
    stage.innerHTML = '';
    live.length = 0;
    for (const it of items) {
      const f = C[it.type];
      if (!f) throw new Error('unknown item type ' + it.type);
      // paths/tracks may come as data: rebuild functions
      const props = { ...it.props };
      if (props.trackFn) props.track = new Function('t', props.trackFn);
      if (props.pathFn) props.path = new Function('t', props.pathFn);
      const made = f(props);
      made.root.style.zIndex = String(it.z ?? 10);
      live.push({ ...it, ...made });
    }
    return live.length;
  };
  window.frame = (t) => {
    let n = 0, opaque = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of live) {
      const lt = t - it.start;
      const on = lt >= 0 && lt < it.dur;
      it.root.style.display = on ? 'block' : 'none';
      if (it.root.classList.contains('keywrap') && on) it.root.style.display = 'flex';
      if (it.root.classList.contains('tag') && on) it.root.style.display = 'flex';
      if (it.root.classList.contains('chip') && on) it.root.style.display = 'flex';
    }
    for (const it of live) {
      const lt = t - it.start;
      if (lt < 0 || lt >= it.dur) continue;
      it.update(lt, it.dur);
      n++;
      if (it.opaque && lt >= 0) opaque = true;
    }
    if (n) {
      for (const it of live) {
        const lt = t - it.start;
        if (lt < 0 || lt >= it.dur) continue;
        const full = it.type === 'card' || it.type === 'wipe' || it.type === 'flash';
        const r = full ? { left: 0, top: 0, right: W, bottom: H } : it.root.getBoundingClientRect();
        const inner = it.root.querySelectorAll('*');
        let bx0 = r.left, by0 = r.top, bx1 = r.right, by1 = r.bottom;
        if (!full) for (const c of inner) { if (c.tagName === 'path' || c.tagName === 'g') continue; const q = c.getBoundingClientRect(); if (!q.width && !q.height) continue; bx0 = Math.min(bx0, q.left); by0 = Math.min(by0, q.top); bx1 = Math.max(bx1, q.right); by1 = Math.max(by1, q.bottom); }
        if (it.type === 'ring' || it.type === 'arrow' || it.type === 'box') { bx0 = 0; by0 = 0; bx1 = W; by1 = H; }
        x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
      }
    }
    const pad = 40;
    const box = n ? [Math.max(0, Math.floor(x0 - pad)), Math.max(0, Math.floor(y0 - pad)), Math.min(W, Math.ceil(x1 + pad)), Math.min(H, Math.ceil(y1 + pad))] : null;
    return { n, opaque, box };
  };
  window.ready = document.fonts.ready.then(() => true);
})();

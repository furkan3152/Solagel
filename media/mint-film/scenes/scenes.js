/* Elymum "Mint film" (about 19.5 s, 120 BPM: a beat is 0.5 s, the downbeats sit at 0.5 + 2k).
 *
 *  0.0  $1 MINT       the stock, $1 / MINT slam in, the mascot (the X pfp coin) rises and falls in love
 *  4.5  SEALED        a paper wipe; five sealed cards dealt, the seals crack and the cards turn, $1 IN HYPE stamp
 *  8.5  ROADMAP       an ink flood to night; three tickets, the mascot hops 01 WL OPEN, 02 $1 MINT,
 *                     03 GAME LIVE (each prints in its ink as it lands), then leaps at the camera
 * 12.5  WL OPEN       the coin pulls back to reveal the pink: "WL open.", the <site>/wl ticket,
 *                     the wordmark and @elymum
 *
 * Landscape (1920x1080) and portrait (1080x1920) from the same code (?w=&h=). Draws with the promo
 * kit (media/promo/scenes/lib.js) and the NFT kit (nft.js). Deterministic.
 */
'use strict';
(() => {
  const P = H > W; // portrait
  const T = { s2: 4.5, s3: 8.5, s4: 12.5, end: 19.5 };
  const night = (ctx, t) => {
    ctx.fillStyle = C.night; ctx.fillRect(-50, -50, W + 100, H + 100);
    ctx.save();
    ctx.globalAlpha = 0.4; ctx.globalCompositeOperation = 'screen';
    const pd = ctx.createPattern(TEX.dots, 'repeat');
    ctx.fillStyle = pd; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };
  /** Giant slam word: card ink with an ink lip, riso ghosts that snap into register. */
  function slamWord(ctx, text, x, y, size, t, at, o = {}) {
    const dt = t - at;
    if (dt < -0.12) return;
    const k = dt < 0 ? 0 : 1;
    const s = dt < 0 ? lerp(2.2, 1.6, prog(dt, -0.12, 0)) : dt < 0.2 ? lerp(1.6, 1, E.outExpo(dt / 0.2)) : 1 + 0.03 * Math.exp(-dt * 8) * Math.cos(dt * 30);
    const a = dt < 0 ? prog(dt, -0.12, 0) * 0.5 : 1;
    const reg = dt < 0 ? 1 : 1 - spring(dt, 1.6, 6);
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(o.rot || 0);
    ctx.globalAlpha = a;
    font(ctx, size, 800, 'display', 'semi-condensed'); ctx.letterSpacing = (-size * 0.035) + 'px';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const yb = size * 0.36;
    if (Math.abs(reg) > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = C.teal; ctx.fillText(text, reg * size * 0.08, yb + reg * size * 0.05);
      ctx.fillStyle = C.mustard; ctx.fillText(text, -reg * size * 0.06, yb - reg * size * 0.04);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = C.ink; ctx.fillText(text, size * 0.04, yb + size * 0.045);
    ctx.fillStyle = o.color || C.card; ctx.fillText(text, 0, yb);
    ctx.restore();
    void k;
  }
  /** Paper wipe: two perforated sheets sweep across; the cut happens under them at `mid`. */
  function paperWipe(ctx, t, mid, colors, dur = 0.5) {
    const a = mid - dur / 2, b = mid + dur / 2;
    if (t < a || t > b) return;
    colors.forEach((c, i) => {
      const lag = i * 0.05;
      let x;
      if (t < mid) x = lerp(-W * 1.3, -W * 0.08, E.inOutCubic(prog(t, a + lag, mid)));
      else x = lerp(-W * 0.08, W * 1.1, E.inOutCubic(prog(t, mid + lag * 0.6, b)));
      ctx.save();
      ctx.translate(x, 0);
      ctx.transform(1, 0, -0.1, 1, 0, 0);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.rect(0, -100, W * 1.2, H + 200);
      ctx.fill();
      // scalloped edges
      for (let yy = -100; yy < H + 120; yy += 36) {
        ctx.beginPath(); ctx.arc(W * 1.2, yy, 15, -Math.PI / 2, Math.PI / 2); ctx.fill();
      }
      ctx.restore();
    });
  }
  /** The mascot with a squash on landing and an optional hop arc. */
  function mascot(ctx, x, y, r, o = {}) {
    NFT.heroCoin(ctx, x, y, r, { ghostOver: o.ghostOver, expr: o.expr, lookX: o.lookX, lookY: o.lookY, rot: o.rot, sx: o.sx, sy: o.sy, mouth: o.mouth, dir: o.dir });
  }

  /* ───────────── 1. $1 MINT (0 - 4.5) ───────────── */
  function s1(ctx, t) {
    const sh = shake(t, [0.5, 1.0], 16);
    ctx.save(); ctx.translate(sh.x, sh.y);
    NFT.pinkStock(ctx, t, W / 2, P ? H * 0.42 : H * 0.48);
    const cx = W / 2;
    const y1 = P ? 640 : 380, y2 = P ? 950 : 690, sz = P ? 330 : 330;
    shockDots(ctx, cx, (y1 + y2) / 2, t - 0.5, C.card, 1300, 0.35);
    shockDots(ctx, cx, (y1 + y2) / 2, t - 1.0, C.ink, 1300, 0.3);
    // slow push on the words after the slams
    const push = 1 + 0.035 * E.inOutCubic(prog(t, 1.2, 4.5));
    ctx.save();
    ctx.translate(cx, (y1 + y2) / 2); ctx.scale(push, push); ctx.translate(-cx, -(y1 + y2) / 2);
    slamWord(ctx, '$1', cx, y1, sz, t, 0.5, { rot: -0.03 });
    slamWord(ctx, 'MINT', cx, y2, sz, t, 1.0, { rot: 0.02, color: C.mustard });
    ctx.restore();
    burst(ctx, cx, y2 - 60, t - 1.0, { seed: 4, n: 40, speed: 1500, size: 14, life: 1.3, colors: [C.card, C.mustard, C.teal, C.ink] });
    NFT.pill(ctx, 'THE ELYMUM NFT', cx, P ? 330 : 120, P ? 28 : 24, t, 0.15, { align: 'center' });
    // pre-roll: a sealed card spins up at the camera and its seal cracks into $1
    if (t < 0.62) {
      const k = E.outCubic(prog(t, 0, 0.45));
      const gone = E.inBack(prog(t, 0.45, 0.62));
      const sc = lerp(0.5, 1.25, k) * (1 - gone);
      if (sc > 0.01) NFT.card(ctx, cx, (y1 + y2) / 2 + (1 - k) * 200, P ? 360 : 300, P ? 504 : 420, { i: 0, rot: (1 - k) * -0.9 + Math.sin(t * 9) * 0.03, flip: 0, crack: t >= 0.42 ? t - 0.42 : null, scale: sc, t });
    }
    // the mascot rises on the downbeat, looks up at the words, falls in love
    if (t > 2.4) {
      const k = spring(t - 2.5, 1.5, 6);
      const mx = P ? cx : 1560, my0 = P ? 1500 : 900, r = P ? 230 : 190;
      const my = lerp(H + r * 1.3, my0, k);
      const love = t > 3.5;
      mascot(ctx, mx, my, r, { ghostOver: true, expr: love ? 'love' : 'hungry', lookX: P ? 0 : -0.8, lookY: -0.9, rot: Math.sin(t * 4) * 0.04 });
      if (love) {
        // little hearts float off
        for (let i = 0; i < 4; i++) {
          const lt = t - 3.5 - i * 0.12;
          if (lt < 0 || lt > 1) continue;
          ctx.save();
          ctx.globalAlpha = 1 - lt;
          ctx.translate(mx + (i - 1.5) * r * 0.45 + Math.sin(lt * 6 + i) * 10, my - r * 1.05 - lt * 180);
          ctx.scale(r / 230, r / 230);
          ctx.fillStyle = i % 2 ? C.card : C.mustard;
          ctx.beginPath(); ctx.moveTo(0, 12); ctx.bezierCurveTo(-30, -10, -12, -32, 0, -14); ctx.bezierCurveTo(12, -32, 30, -10, 0, 12); ctx.fill();
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  /* ───────────── 2. SEALED (4.5 - 8.5) ───────────── */
  const S2 = { deal: 4.5, flip: [6.0, 6.25, 6.5, 6.75, 7.0], stamp: 7.5 };
  function s2Cards() {
    if (P) {
      const cw = 300, ch = 420;
      return { cw, ch, at: [[230, 1080, -0.14], [540, 1020, 0], [850, 1080, 0.14], [385, 1430, -0.07], [695, 1430, 0.07]] };
    }
    const cw = 250, ch = 350;
    return { cw, ch, at: [[960, 600, -0.2], [1170, 545, -0.1], [1390, 525, 0], [1610, 545, 0.1], [1820, 600, 0.2]] };
  }
  function s2(ctx, t) {
    drawPaper(ctx, 0, 0);
    const L = s2Cards();
    const order = P ? [3, 4, 0, 1, 2] : [0, 1, 2, 3, 4];
    order.forEach((i, n) => {
      const [x, y, rot] = L.at[i];
      const at = S2.deal + n * 0.08;
      if (t < at) return;
      const k = spring(t - at, 1.4, 6.5);
      const fl = E.inOutCubic(prog(t, S2.flip[i], S2.flip[i] + 0.4));
      const crack = t >= S2.flip[i] - 0.05 ? t - (S2.flip[i] - 0.05) : null;
      const xs = lerp(P ? W / 2 : W + 300, x, k), ys = lerp(P ? H + 400 : y + 200, y, k);
      NFT.card(ctx, xs, ys, L.cw, L.ch, { i: [0, 1, 2, 3, 4][i], rot: rot * k + (1 - k) * 0.6, flip: fl, crack, t });
    });
    const st = t - S2.stamp;
    if (st > -0.2) stamp(ctx, '$1 IN HYPE', P ? W / 2 : 1390, P ? 1260 : 600, -0.16, st, C.ink, { size: P ? 110 : 100, scale: 1, alpha: 0.95 });
    const hx = P ? 70 : 150, hy = P ? 420 : 380;
    kicker(ctx, 'ELYMUM NFT / SEALED CARDS', hx, P ? 250 : 220, t, 4.55);
    headline(ctx, [{ text: 'Sealed.', at: 4.6 }, { text: '$1 in HYPE.', at: 5.2, color: C.pink }], hx, hy, t, { size: P ? 128 : 112, lh: 1.0 });
  }

  /* ───────────── 3. ROADMAP (8.5 - 12.5) ───────────── */
  const STEPS = [
    { n: '01', title: 'WL OPEN', ink: C.teal, land: 9.5 },
    { n: '02', title: '$1 MINT', ink: C.mustard, land: 10.5 },
    { n: '03', title: 'GAME LIVE', ink: C.pink, land: 11.5 },
  ];
  function roadLayout() {
    // portrait: the tickets stack on the right and the mascot hops down the left beside them
    if (P) return { w: 700, h: 230, pos: [[630, 800], [630, 1160], [630, 1520]], r: 92, title: 64, perch: (i) => [165, [800, 1160, 1520][i]], start: [-220, 800] };
    const L = { w: 540, h: 240, pos: [[370, 770], [960, 770], [1550, 770]], r: 96, title: 50 };
    L.perch = (i) => [L.pos[i][0], L.pos[i][1] - L.h / 2 - L.r * 0.92];
    L.start = [-L.r * 2, L.perch(0)[1]];
    return L;
  }
  const L0 = () => roadLayout();
  function roadTicket(ctx, s, x, y, w, h, t, i) {
    const appear = 8.7 + i * 0.12;
    if (t < appear) return;
    const a = E.outBack(prog(t, appear, appear + 0.35), 1.3);
    const printed = t >= s.land;
    const pk = printed ? 1 - spring(t - s.land, 2, 7) : 1;
    ctx.save();
    ctx.translate(x, y + (printed ? Math.sin(Math.min(1, (t - s.land) * 4) * Math.PI) * 14 : 0));
    ctx.scale(a, a);
    ctx.rotate((i - 1) * 0.02);
    const x0 = -w / 2, y0 = -h / 2, stub = h * 0.62;
    // ghost (unprinted) or printed
    if (!printed) {
      ticketPath(ctx, x0, y0, w, h, 16, stub, 14);
      ctx.setLineDash([12, 10]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(246,238,218,0.45)'; ctx.stroke(); ctx.setLineDash([]);
      font(ctx, h * 0.28, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(246,238,218,0.45)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.n, x0 + stub / 2, 0);
      font(ctx, L0().title, 800, 'display'); ctx.letterSpacing = '-1px'; ctx.textAlign = 'left';
      ctx.fillText(s.title, x0 + stub + 34, 4);
    } else {
      ctx.save(); ctx.translate(8, 10); ticketPath(ctx, x0, y0, w, h, 16, stub, 14); ctx.fillStyle = '#000507'; ctx.globalAlpha = 0.6; ctx.fill(); ctx.restore();
      ticketPath(ctx, x0, y0, w, h, 16, stub, 14); ctx.fillStyle = C.card; ctx.fill();
      ctx.save(); ticketPath(ctx, x0, y0, w, h, 16, stub, 14); ctx.clip();
      ctx.fillStyle = s.ink; ctx.fillRect(x0, y0, stub, h);
      ctx.restore();
      ticketPath(ctx, x0, y0, w, h, 16, stub, 14); ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.stroke();
      dashed(ctx, x0 + stub, y0 + 22, x0 + stub, y0 + h - 22, 'rgba(4,24,28,0.6)', 3, [8, 7]);
      font(ctx, h * 0.3, 800, 'display'); ctx.letterSpacing = '0px'; ctx.fillStyle = C.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.n, x0 + stub / 2, 6);
      font(ctx, L0().title, 800, 'display'); ctx.letterSpacing = '-1px'; ctx.textAlign = 'left';
      // misregistered print on the land
      if (pk > 0.02) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = s.ink; ctx.fillText(s.title, x0 + stub + 34 + pk * 14, 4 + pk * 8);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = C.ink; ctx.fillText(s.title, x0 + stub + 34, 4);
      font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2;
      ctx.fillText('ROADMAP / STEP ' + s.n, x0 + stub + 36, -h * 0.28);
    }
    ctx.restore();
    if (printed) shockDots(ctx, x, y, t - s.land, s.ink, 520, 0.45);
  }
  /** Where the mascot is: hops between the tickets (0.5 s arcs), then the leap at the camera. */
  function hopPose(t, L) {
    const pts = [L.start, L.perch(0), L.perch(1), L.perch(2)];
    const lands = [9.5, 10.5, 11.5];
    let x, y, sq = 0, air = false;
    if (t < 9.0) { x = L.start[0]; y = L.start[1]; }
    else {
      let seg = -1;
      for (let i = 0; i < 3; i++) if (t >= lands[i] - 0.5) seg = i;
      const a = pts[seg], b = pts[seg + 1];
      const p = prog(t, lands[seg] - 0.5, lands[seg]);
      if (p < 1) {
        const e = E.inOutCubic(p);
        x = lerp(a[0], b[0], e); y = lerp(a[1], b[1], e) - Math.sin(Math.PI * p) * (P ? 150 : 140);
        air = true;
      } else { x = b[0]; y = b[1]; }
      const dl = t - lands[seg];
      if (dl >= 0) sq = Math.exp(-dl * 7) * Math.cos(dl * 22) * 0.18;
    }
    return { x, y, sx: 1 + sq, sy: 1 - sq, air };
  }
  function s3(ctx, t) {
    night(ctx, t);
    const L = roadLayout();
    // the path between the tickets
    ctx.save();
    ctx.strokeStyle = 'rgba(246,238,218,0.35)'; ctx.lineWidth = 4; ctx.setLineDash([4, 16]); ctx.lineCap = 'round';
    const dp = E.outCubic(prog(t, 8.7, 9.4));
    ctx.beginPath();
    if (P) { ctx.moveTo(165, L.pos[0][1]); ctx.lineTo(165, lerp(L.pos[0][1], L.pos[2][1], dp)); }
    else { ctx.moveTo(L.pos[0][0], L.pos[0][1]); ctx.lineTo(lerp(L.pos[0][0], L.pos[2][0], dp), L.pos[0][1]); }
    ctx.stroke();
    ctx.restore();
    STEPS.forEach((s, i) => roadTicket(ctx, s, L.pos[i][0], L.pos[i][1], L.w, L.h, t, i));
    // the NFT step gets its tag
    const tg = E.outBack(prog(t, 11.75, 12.0), 2);
    if (tg > 0) {
      const [x, y] = L.pos[2];
      ctx.save();
      ctx.translate(x + L.w * 0.18, y + L.h / 2 + 4); ctx.rotate(-0.06); ctx.scale(tg, tg);
      rrect(ctx, -110, -26, 220, 52, 26); ctx.fillStyle = C.pink; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
      font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$1 MINT', 0, 2);
      ctx.restore();
    }
    kicker(ctx, 'ELYMUM / WHAT IS NEXT', P ? 70 : 150, P ? 250 : 190, t, 8.55, { color: C.nightInk });
    headline(ctx, [{ text: 'The roadmap.', at: 8.6, color: C.nightInk }], P ? 70 : 150, P ? 420 : 340, t, { size: P ? 128 : 112 });
    // the mascot (drawn last; the leap is drawn in s3Leap so it can cover the cut)
    if (t < 12.0) {
      const m = hopPose(t, L);
      mascot(ctx, m.x, m.y + L.r * (1 - m.sy), L.r, { ghostOver: true, expr: 'hungry', lookX: P ? 0.2 : 1, lookY: m.air ? 0.6 : 0.3, sx: m.sx, sy: m.sy });
    }
  }
  /** The leap: from the NFT ticket at the camera; the gold body fills the frame by 12.5. */
  function leapCoin(ctx, t) {
    const L = roadLayout();
    const p = prog(t, 12.0, 12.5);
    const [x0, y0] = L.perch(2);
    const e = E.inCubic(p);
    const x = lerp(x0, W / 2, E.inOutCubic(p)), y = lerp(y0, H / 2, E.inOutCubic(p)) - Math.sin(Math.PI * p) * 120;
    const r = lerp(L.r, Math.hypot(W, H) * 1.35, e);
    mascot(ctx, x, y, r, { ghostOver: true, expr: 'happy', lookX: 0, lookY: 0, rot: p * 0.4 });
  }

  /* ───────────── 4. WL OPEN (12.5 - 19.5) ───────────── */
  function s4(ctx, t) {
    NFT.pinkStock(ctx, t, P ? W / 2 : 480, P ? 560 : 560);
    const mx = P ? W / 2 : 470, my = P ? 560 : 560, r = P ? 230 : 250;
    // the pull back from the leap: the coin shrinks into place
    const pb = prog(t, 12.5, 12.95);
    const big = Math.hypot(W, H) * 1.35;
    const rr = pb < 1 ? lerp(big, r, E.outExpo(pb)) : r;
    const bob = Math.sin((t - 13) * 2.4) * 8;
    const wink = t > 16.0 && t < 16.35;
    const hx = P ? W / 2 : 860, al = P ? 'center' : 'left';
    NFT.riseLine(ctx, 'WL open.', hx, P ? 1040 : 420, P ? 190 : 190, C.card, t, 12.8, { align: al });
    const tp = E.outBack(prog(t, 13.6, 14.05), 1.4);
    if (P) NFT.wlTicket(ctx, W / 2 - 430, 1120, 860, 190, tp, { size: 112, underline: prog(t, 15.1, 15.6) });
    else NFT.wlTicket(ctx, 860, 500, 860, 190, tp, { size: 104, underline: prog(t, 15.1, 15.6) });
    shockDots(ctx, P ? W / 2 : 1290, P ? 1215 : 595, t - 13.7, C.card, 700, 0.3);
    // the sign-off: wordmark + @elymum
    const wk = prog(t, 16.0, 16.4);
    if (wk > 0) {
      const wy = P ? 1540 : 900, wx = P ? W / 2 - 330 : 860;
      const sz = P ? 170 : 150;
      ctx.save();
      ctx.globalAlpha = clamp(wk * 2);
      const m = wordmarkMetrics(ctx, sz);
      wordmark(ctx, wx + (P ? (660 - m.total) / 2 : 0), wy + (1 - E.outBack(wk)) * 40, sz, { reg: 1 - spring(t - 16.0, 1.5, 6), dark: true, color: C.card });
      ctx.restore();
      NFT.pill(ctx, '@ELYMUM', P ? W / 2 : 860 + m.total + 60, P ? 1660 : wy - sz * 0.3, P ? 34 : 32, t, 16.2, { align: P ? 'center' : 'left', dot: C.teal });
    }
    // foot line: the whole call to action in one row
    const fa = prog(t, 16.5, 16.9);
    if (fa > 0) {
      ctx.save();
      ctx.globalAlpha = fa;
      font(ctx, P ? 28 : 28, 500, 'mono'); ctx.letterSpacing = (P ? 5 : 7) + 'px';
      ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`WL OPEN  ·  ${window.SITE_HOST.toUpperCase()}/WL  ·  @ELYMUM`, W / 2, P ? 1800 : 1022);
      ctx.restore();
    }
    mascot(ctx, mx, my + (pb < 1 ? 0 : bob), rr, { ghostOver: true, expr: wink ? 'happy' : 'proud', lookX: P ? 0 : 0.7, lookY: 0.2, rot: Math.sin(t * 1.7) * 0.03 });
    if (t > 16.5) burst(ctx, mx, my - r, t - 16.5, { seed: 9, n: 36, speed: 1200, size: 12, life: 1.4, colors: [C.card, C.mustard, C.teal, C.ink] });
  }

  window.SCENES_INIT = async () => {};
  window.SCENE_DRAW = (ctx, t) => {
    if (t < T.s2) s1(ctx, t);
    else if (t < 8.0) s2(ctx, t);
    else if (t < T.s3) {
      // ink flood out of the centre card
      s2(ctx, t);
      const p = E.inCubic(prog(t, 8.0, 8.5));
      const cx = P ? 540 : 1390, cy = P ? 1020 : 525, R = 30 + p * 2600;
      ctx.save();
      blobPath(ctx, cx, cy, R, 12, 0.12, 140, t * 3); ctx.clip();
      s3(ctx, t);
      ctx.restore();
    } else if (t < T.s4) {
      s3(ctx, t);
      if (t >= 12.0) leapCoin(ctx, t);
    } else s4(ctx, t);
    // the wipe from $1 MINT to the cards
    paperWipe(ctx, t, T.s2, [C.teal, C.paper]);
  };
  window.SCENE_DARK = (t) => t >= 8.3 && t < 12.3;
  window.SCENE_BLUR = (t) => {
    const win = [[0.38, 0.72, 4, 0.01], [0.9, 1.2, 4, 0.01], [4.2, 4.8, 6, 0.012], [4.5, 5.0, 4, 0.01], [5.95, 7.45, 3, 0.01], [9.0, 9.5, 3, 0.01], [10.0, 10.5, 3, 0.01], [11.0, 11.5, 3, 0.01], [12.0, 12.95, 6, 0.012]];
    for (const [a, b, k, s] of win) if (t >= a && t <= b) return { k, shutter: s };
    return { k: 1, shutter: 0 };
  };
  window.SCENE_ASSETS = () => [];
})();

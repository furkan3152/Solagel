/* Elymum NFT kit: the sealed cards, the hero coin (the X profile coin, brand/out/x) and the NFT beat.
 *
 * Shared by the promo (media/promo/scenes), the gameplay kit's motion graphics (the vertical promo
 * and how-to-play, media/gameplay/motion) and the mint film (media/mint-film). It draws with the
 * promo's drawing kit (media/promo/scenes/lib.js: inks, type, tickets, stamps, coins) and the art
 * package bundle (window.ElymumArt). Deterministic: every pose is a pure function of time.
 *
 * Facts on screen (keep them exactly so): the Elymum NFT mints at $1 IN HYPE, the WL is open at
 * <site>/wl (SITE_HOST). No price other than "$1 in HYPE", no supply, no dates, no perks.
 */
'use strict';
// The site's host for the films' on-screen address (no domain is hard-coded: the site is served at
// whatever PUBLIC_URL says). The renderers pass it as ?site=<host> from the SITE_HOST env var.
window.SITE_HOST = window.SITE_HOST || new URLSearchParams(location.search).get('site') || 'elymum.io';
(() => {
  const A = () => window.ElymumArt;

  /* ───────────── the hero coin (the X profile coin, ported) ─────────────
   * A gold coin with a reeded edge, a teal misregistered pass, the inner rim, the halftone shade,
   * the paper shine, the star on the forehead and the oversized face.
   * o.mouth: 0 = closed (the pfp's grin), > 0 = a Pac-Man wedge opened by that fraction (the
   * wedge faces o.dir radians). The face slides up and back so the eyes stay clear of the bite. */
  function edgePath(ctx, rr, teeth = 56) {
    ctx.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU;
      const rad = i % 2 === 0 ? rr : rr * 0.975;
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  /** Wedge-less coin outline with a bite of half-angle `half` facing angle 0 (local). */
  function bitePath(ctx, rr, half, teeth = 56) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const n = teeth * 2;
    for (let i = 0; i <= n; i++) {
      const a = half + (i / n) * (TAU - 2 * half);
      const rad = i % 2 === 0 ? rr : rr * 0.975;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
  }
  function heroCoin(ctx, x, y, r, o = {}) {
    const S = A();
    const GOLD = C.mustard, TEAL = C.teal, PINK = C.pink, CARD = C.card, INK = C.ink;
    const mouth = clamp(o.mouth ?? 0);
    const half = mouth * 0.62; // half-angle of the bite (35 degrees fully open)
    const dir = o.dir ?? 0;
    const rimW = r * 0.075;
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.sx != null || o.sy != null) ctx.scale(o.sx ?? 1, o.sy ?? 1);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    const shape = (rr) => {
      if (half > 0.004) { ctx.save(); ctx.rotate(dir); bitePath(ctx, rr, half); ctx.restore(); }
      else edgePath(ctx, rr);
    };
    // the teal pass, off register (laid over a dark flood, multiplied on paper)
    if (o.ghost !== false) {
      ctx.save();
      ctx.globalCompositeOperation = o.ghostOver ? 'source-over' : 'multiply';
      ctx.fillStyle = o.ghostColor || TEAL;
      ctx.translate(0.085 * r, 0.075 * r);
      shape(r);
      ctx.fill();
      ctx.restore();
    }
    // body: paper then gold ink
    shape(r);
    ctx.fillStyle = CARD; ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = o.body || GOLD; ctx.fill(); ctx.restore();
    ctx.save();
    shape(r - rimW * 0.5);
    ctx.clip();
    // inner rim ring and the dashed reeding
    ctx.save();
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.85; ctx.lineWidth = r * 0.028;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.setLineDash([r * 0.075, r * 0.05]); ctx.lineWidth = r * 0.022;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.915, 0, TAU); ctx.stroke();
    ctx.restore();
    // halftone shade
    if (o.halftone !== false) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.34;
      S.drawHalftoneDots(ctx, r, r * 0.06);
      ctx.restore();
    }
    // shine: a paper knock-out on the upper left
    ctx.save();
    ctx.strokeStyle = CARD; ctx.lineCap = 'round'; ctx.globalAlpha = 0.95; ctx.lineWidth = r * 0.075;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, Math.PI * 1.08, Math.PI * 1.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, Math.PI * 1.37, Math.PI * 1.42); ctx.stroke();
    ctx.restore();
    // the inside of the mouth: an ink throat with a pink tongue, seen through the bite
    ctx.restore();
    // rim
    shape(r);
    ctx.lineWidth = rimW; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.stroke();
    // face: closed = the pfp's grin; open = the face slides away from the bite (back and up) and
    // shrinks a touch, the cheek and the star are left out where the bite would cut them
    const k = clamp(mouth * 2.2);
    const cd = Math.cos(dir), sd = Math.sin(dir);
    const fdx = -0.24 * r * cd * k, fdy = (-0.24 * sd - 0.24 * Math.abs(cd)) * r * k;
    const inBite = (px, py, pad) => {
      if (half <= 0.004) return false;
      let a = Math.atan2(py, px) - dir; a = Math.atan2(Math.sin(a), Math.cos(a));
      return Math.abs(a) < half + pad && Math.hypot(px, py) > r * 0.05;
    };
    if (o.symbol !== false) {
      const sx0 = fdx * 0.6, sy0 = -r * 0.5 + fdy * 0.4;
      if (!inBite(sx0, sy0, 0.55)) {
        ctx.save();
        ctx.translate(sx0, sy0);
        S.drawSymbol(ctx, 'star', r * 0.13, { fill: CARD, ink: INK, overprint: TEAL, lineW: r * 0.028, offX: r * 0.02, offY: r * 0.02 });
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(fdx, r * 0.12 + fdy);
    const fr = r * 1.34 * lerp(1, 0.78, k);
    const lookX = o.lookX ?? (k > 0 ? cd : 0.2), lookY = o.lookY ?? (k > 0 ? sd * 0.8 : 0.1);
    // o.eyesOnly: no drawn mouth at all (while it chomps, so the grin does not flicker on each bite)
    if (k < 0.5 && !o.eyesOnly) {
      S.drawFace(ctx, fr, { expression: o.expr || 'hungry', eyes: 'round', mouth: 'grin', lookX, lookY, time: 0, seed: 0, detail: fr, blush: PINK });
    } else {
      // the eyes only (the face clipped above the mouth line), then the cheeks by hand
      ctx.save();
      ctx.beginPath(); ctx.rect(-fr * 2, -fr * 2, fr * 4, fr * 2.17); ctx.clip();
      S.drawFace(ctx, fr, { expression: o.expr || 'hungry', eyes: 'round', mouth: 'grin', lookX, lookY, time: 0, seed: 0, detail: fr, blush: 'rgba(0,0,0,0)' });
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.8; ctx.fillStyle = PINK;
      for (const sg of [-1, 1]) {
        const bx = sg * fr * 0.53, by = fr * 0.24;
        if (inBite(bx + fdx, by + r * 0.12 + fdy, 0.3)) continue;
        ctx.beginPath(); ctx.ellipse(bx, by, fr * 0.1, fr * 0.065, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }

  /* ───────────── the cards ───────────── */
  const CARD_LOOKS = [
    { skin: 1, accessory: 'crown', flood: C.teal, name: 'Goldie' },
    { skin: 4, accessory: 'headphones', flood: C.mustard, name: 'Bubbles' },
    { skin: 3, accessory: 'partyHat', flood: C.blue, name: 'Minty' },
    { skin: 7, accessory: 'halo', flood: C.pink, name: 'Grape' },
    { skin: 2, accessory: 'cowboy', flood: C.purple, name: 'Penny' },
  ];
  const lookOf = (i) => {
    const d = CARD_LOOKS[((i % CARD_LOOKS.length) + CARD_LOOKS.length) % CARD_LOOKS.length];
    return { ...d, look: { ...A().lookForBasicSkin(d.skin), accessory: d.accessory } };
  };
  function cardPath(ctx, w, h) { rrect(ctx, -w / 2, -h / 2, w, h, w * 0.07); }

  /** The sealed back: night stock, a pink halftone field, the brand mark, a teal band and a wax seal. */
  function cardBack(ctx, w, h, o) {
    cardPath(ctx, w, h);
    ctx.fillStyle = C.nightCard; ctx.fill();
    ctx.save();
    cardPath(ctx, w, h); ctx.clip();
    // pink halftone, heavier toward the edges
    ctx.fillStyle = C.pink;
    const sp = w * 0.055;
    for (let yy = -h / 2; yy <= h / 2 + sp; yy += sp) {
      for (let xx = -w / 2; xx <= w / 2 + sp; xx += sp) {
        const ox = ((Math.round(yy / sp) % 2) * sp) / 2;
        const d = Math.hypot((xx + ox) / (w / 2), yy / (h / 2));
        const rad = sp * 0.42 * clamp((d - 0.35) / 0.9);
        if (rad < 0.4) continue;
        ctx.beginPath(); ctx.arc(xx + ox, yy, rad, 0, TAU); ctx.fill();
      }
    }
    // inner frame
    ctx.strokeStyle = 'rgba(246,238,218,0.55)'; ctx.lineWidth = w * 0.008; ctx.setLineDash([w * 0.025, w * 0.018]);
    rrect(ctx, -w / 2 + w * 0.06, -h / 2 + w * 0.06, w - w * 0.12, h - w * 0.12, w * 0.04); ctx.stroke();
    ctx.setLineDash([]);
    // the band and the mark
    ctx.fillStyle = C.teal;
    ctx.fillRect(-w / 2, -h * 0.07, w, h * 0.14);
    ctx.fillStyle = 'rgba(4,24,28,0.35)';
    ctx.fillRect(-w / 2, h * 0.07 - 3, w, 3);
    font(ctx, w * 0.068, 500, 'mono'); ctx.letterSpacing = (w * 0.012) + 'px';
    ctx.fillStyle = C.nightInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ELYMUM NFT', 0, -h * 0.36);
    ctx.fillText('SEALED', 0, h * 0.36);
    ctx.restore();
    cardPath(ctx, w, h);
    ctx.lineWidth = w * 0.016; ctx.strokeStyle = C.ink; ctx.stroke();
  }
  /** The wax seal on the band; dt = time since it cracked (< 0: intact). */
  function waxSeal(ctx, w, dt, seed) {
    const R = w * 0.17;
    if (dt > 0.45) return;
    const k = dt < 0 ? 0 : E.outCubic(dt / 0.45);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    // two halves split apart
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * k * R * 1.3, k * R * 0.9);
      ctx.rotate(s * k * 0.8);
      ctx.beginPath();
      if (dt < 0) blobPath(ctx, 0, 0, R, seed, 0.1, 40);
      else { ctx.save(); ctx.beginPath(); ctx.rect(s < 0 ? -R * 1.4 : 0, -R * 1.4, R * 1.4, R * 2.8); ctx.clip(); blobPath(ctx, 0, 0, R, seed, 0.1, 40); }
      ctx.fillStyle = C.pinkInk; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.7, 0, TAU); ctx.fillStyle = C.pink; ctx.fill();
      ctx.lineWidth = R * 0.07; ctx.strokeStyle = 'rgba(4,24,28,0.35)'; ctx.stroke();
      ctx.save();
      ctx.fillStyle = C.pinkInk;
      starPath5(ctx, R * 0.36, R * 0.16);
      ctx.fill();
      ctx.restore();
      if (dt >= 0) ctx.restore();
      ctx.restore();
      if (dt < 0) break;
    }
    ctx.restore();
  }
  function starPath5(ctx, ro, ri) {
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? ri : ro;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  /** Sunburst rays in one ink. */
  function sunburst(ctx, cx, cy, R, color, rays = 20, rot = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.fillStyle = color;
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * TAU, a1 = a0 + (TAU / rays) * 0.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  /** The face: card stock, a riso flood window with a sunburst, the coin character in its trait. */
  function cardFront(ctx, w, h, o, t) {
    const L = lookOf(o.i ?? 0);
    cardPath(ctx, w, h);
    ctx.fillStyle = C.card; ctx.fill();
    const wx = -w / 2 + w * 0.07, wy = -h / 2 + h * 0.13, ww = w * 0.86, wh = h * 0.6;
    ctx.save();
    rrect(ctx, wx, wy, ww, wh, w * 0.035); ctx.clip();
    ctx.fillStyle = L.flood; ctx.fillRect(wx, wy, ww, wh);
    ctx.globalCompositeOperation = 'multiply';
    sunburst(ctx, 0, wy + wh * 0.55, wh * 1.2, L.flood, 16, (t || 0) * 0.15 + (o.i || 0), 0.45);
    ctx.globalCompositeOperation = 'source-over';
    // halftone ground
    ctx.fillStyle = 'rgba(4,24,28,0.16)';
    const sp = w * 0.04;
    for (let yy = wy + wh * 0.62; yy < wy + wh + sp; yy += sp) for (let xx = wx; xx < wx + ww + sp; xx += sp) {
      const ox = ((Math.round(yy / sp) % 2) * sp) / 2;
      const rad = sp * 0.38 * clamp((yy - (wy + wh * 0.62)) / (wh * 0.38));
      ctx.beginPath(); ctx.arc(xx + ox, yy, rad, 0, TAU); ctx.fill();
    }
    // the character
    const cr = w * 0.26;
    const bob = Math.sin((t || 0) * 3 + (o.i || 0)) * w * 0.01;
    halftoneShadow(ctx, 0, wy + wh * 0.9, cr * 0.8, cr * 0.18, 0.25, 6);
    ctx.save();
    ctx.translate(0, wy + wh * 0.56 + bob);
    A().drawRisoCoin(ctx, L.look, cr, { time: (t || 0) * 1000, lookX: o.lookX ?? 0, lookY: o.lookY ?? 0.2, expression: o.expr || 'happy', pxPerUnit: 1, seed: o.i || 0, flags: 0 });
    ctx.restore();
    ctx.restore();
    rrect(ctx, wx, wy, ww, wh, w * 0.035);
    ctx.lineWidth = w * 0.012; ctx.strokeStyle = C.ink; ctx.stroke();
    // header: ELYMUM NFT and the mark
    font(ctx, w * 0.06, 500, 'mono'); ctx.letterSpacing = (w * 0.008) + 'px';
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('ELYMUM NFT', wx + w * 0.01, -h / 2 + h * 0.068);
    brandMark(ctx, wx + ww - w * 0.04, -h / 2 + h * 0.066, w * 0.035, 1, 1);
    // name + the $1-mint tag (o.tag === false: the name and the barcode only)
    font(ctx, w * 0.13, 800, 'display'); ctx.letterSpacing = (-w * 0.003) + 'px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(L.name, wx + w * 0.01, wy + wh + h * 0.11);
    const tw0 = w * 0.5, th0 = h * 0.065, tx0 = wx + w * 0.01, ty0 = wy + wh + h * 0.145;
    if (o.tag !== false) {
      rrect(ctx, tx0, ty0, tw0, th0, th0 / 2); ctx.fillStyle = C.pink; ctx.fill();
      font(ctx, w * 0.052, 500, 'mono'); ctx.letterSpacing = (w * 0.008) + 'px';
      ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$1 MINT', tx0 + tw0 / 2, ty0 + th0 / 2 + 1);
    }
    barcode(ctx, wx + ww - w * 0.3, ty0 - h * 0.005, w * 0.3, th0, 11 + (o.i || 0), C.ink);
    cardPath(ctx, w, h);
    ctx.lineWidth = w * 0.016; ctx.strokeStyle = C.ink; ctx.stroke();
  }
  /**
   * A card at (x, y), w x h. o: {i, rot, scale, flip (0 = back, 1 = face), crack (s since the seal
   * cracked, or null), t, shadow, ghost, tag (false: no $1 MINT tag on the face)}.
   */
  function card(ctx, x, y, w, h, o = {}) {
    const flip = clamp(o.flip ?? 0);
    const sx = Math.cos(Math.PI * flip);
    const lift = Math.sin(Math.PI * flip);
    const s = (o.scale ?? 1) * (1 + 0.1 * lift);
    ctx.save();
    ctx.translate(x, y - lift * h * 0.06);
    ctx.rotate((o.rot ?? 0) + lift * 0.06);
    ctx.scale(s, s);
    // shadow (hard ink lip and a soft drop) and the misregistered pink pass
    if (o.shadow !== false) {
      ctx.save();
      ctx.scale(Math.max(0.02, Math.abs(sx)), 1);
      ctx.fillStyle = `rgba(4,24,28,${0.32 + lift * 0.1})`;
      ctx.translate(w * 0.045 + lift * w * 0.05, w * 0.05 + lift * w * 0.08);
      cardPath(ctx, w, h); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.scale(Math.max(0.0001, Math.abs(sx)), 1);
    if (flip < 0.5) {
      cardBack(ctx, w, h, o);
      waxSeal(ctx, w, o.crack == null ? -1 : o.crack, 7 + (o.i || 0));
    } else {
      cardFront(ctx, w, h, o, o.t);
    }
    // the turn darkens the face edge-on
    if (lift > 0.02) {
      cardPath(ctx, w, h);
      ctx.fillStyle = `rgba(4,24,28,${0.35 * lift * lift})`;
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    // seal shards and a pop of riso confetti from the crack
    if (o.crack != null && o.crack >= 0 && o.crack < 0.9) {
      burst(ctx, x, y, o.crack, { seed: 30 + (o.i || 0), n: 22, speed: w * 3.2, size: w * 0.04, life: 0.8, gravity: 1400, colors: [C.pink, C.pinkInk, C.mustard, C.card] });
    }
  }

  /* ───────────── the WL ticket ───────────── */
  /** A card ticket: the teal stub reads WL OPEN, the body reads <SITE_HOST>/wl. p: 0..1 in. */
  function wlTicket(ctx, x, y, w, h, p, o = {}) {
    if (p <= 0) return;
    const stub = h * 1.02;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2 + (1 - p) * h * 0.6);
    ctx.rotate((o.rot ?? -0.02) + (1 - p) * 0.08);
    ctx.globalAlpha = clamp(p * 2.5);
    ctx.translate(-w / 2, -h / 2);
    ctx.save();
    ctx.translate(h * 0.06, h * 0.08);
    ticketPath(ctx, 0, 0, w, h, h * 0.12, stub, h * 0.11);
    ctx.fillStyle = C.ink; ctx.fill();
    ctx.restore();
    ticketPath(ctx, 0, 0, w, h, h * 0.12, stub, h * 0.11);
    ctx.fillStyle = C.card; ctx.fill();
    ctx.save();
    ticketPath(ctx, 0, 0, w, h, h * 0.12, stub, h * 0.11); ctx.clip();
    ctx.fillStyle = C.teal; ctx.fillRect(0, 0, stub, h);
    ctx.restore();
    ticketPath(ctx, 0, 0, w, h, h * 0.12, stub, h * 0.11);
    ctx.lineWidth = Math.max(3, h * 0.025); ctx.strokeStyle = C.ink; ctx.stroke();
    dashed(ctx, stub, h * 0.16, stub, h * 0.84, 'rgba(4,24,28,0.6)', Math.max(2.5, h * 0.02), [h * 0.06, h * 0.05]);
    font(ctx, h * 0.2, 500, 'mono'); ctx.letterSpacing = (h * 0.03) + 'px';
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WL', stub / 2, h * 0.36);
    ctx.fillText('OPEN', stub / 2, h * 0.64);
    font(ctx, o.size || h * 0.5, 800, 'display'); ctx.letterSpacing = (-h * 0.01) + 'px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ink;
    const label = o.text || `${window.SITE_HOST}/wl`;
    ctx.fillText(label, stub + h * 0.24, h * 0.53);
    // a pink marker underline drawn under the address when it is read out
    const u = clamp(o.underline ?? 0);
    if (u > 0) {
      const lw = ctx.measureText(label).width;
      const x0 = stub + h * 0.2, x1 = x0 + (lw + h * 0.08) * E.outCubic(u), yy = h * 0.8;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = C.pink; ctx.lineCap = 'round'; ctx.lineWidth = h * 0.075;
      ctx.beginPath(); ctx.moveTo(x0, yy);
      for (let xx = x0; xx <= x1; xx += 8) ctx.lineTo(xx, yy + Math.sin(xx * 0.03) * h * 0.012 - (xx - x0) * 0.012);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ───────────── backgrounds ───────────── */
  const HT = {};
  /** The pfp's stock: riso pink flood, a slow second-pass sunburst, teal halftone in the corners. */
  function pinkStock(ctx, t, cx, cy, o = {}) {
    ctx.fillStyle = o.base || C.pink;
    ctx.fillRect(-50, -50, W + 100, H + 100);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    sunburst(ctx, cx, cy, Math.hypot(W, H), o.ray || C.pink, 22, t * 0.06, 0.3);
    ctx.restore();
    // teal halftone, heaviest in the corners (drawn once per frame size)
    if (!HT.c || HT.w !== W || HT.h !== H) {
      HT.c = mkCanvas(W, H); HT.w = W; HT.h = H;
      const g = HT.c.getContext('2d');
      const sp = 30, R0 = Math.hypot(W, H) / 2;
      g.fillStyle = C.teal;
      for (let yy = 0; yy < H + sp; yy += sp) for (let xx = 0; xx < W + sp; xx += sp) {
        const ox = ((Math.round(yy / sp) % 2) * sp) / 2;
        const d = Math.hypot(xx + ox - W / 2, yy - H / 2) / R0;
        const rad = sp * 0.5 * clamp((d - 0.62) / 0.45);
        if (rad < 0.5) continue;
        g.beginPath(); g.arc(xx + ox, yy, rad, 0, TAU); g.fill();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = o.dots ?? 0.7;
    ctx.drawImage(HT.c, 0, 0);
    ctx.restore();
    // fibre so the flood reads as printed paper
    if (TEX.fibre) {
      ctx.save();
      ctx.globalAlpha = 0.5; ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = ctx.createPattern(TEX.fibre, 'repeat');
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /** Text with an ink offset print under it (the brand's hard lip). */
  function inkText(ctx, text, x, y, size, color, o = {}) {
    font(ctx, size, 800, 'display'); ctx.letterSpacing = (-size * 0.02) + 'px';
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = o.shadow || C.ink;
    ctx.fillText(text, x + size * 0.045, y + size * 0.05);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  /** A word-by-word rising line in one ink with an ink lip; at = start time. */
  function riseLine(ctx, text, x, y, size, color, t, at, o = {}) {
    const words = text.split(' ');
    font(ctx, size, 800, 'display'); ctx.letterSpacing = (-size * 0.02) + 'px';
    const sp = ctx.measureText(' ').width * 0.9;
    const ws = words.map((w) => ctx.measureText(w).width);
    const total = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
    let wx = o.align === 'center' ? x - total / 2 : x;
    words.forEach((w, i) => {
      const t0 = at + i * (o.stagger ?? 0.08);
      const p = prog(t, t0, t0 + 0.55);
      if (p > 0) {
        const e = E.outExpo(p);
        let dy = (1 - e) * size * 0.9, a = 1;
        if (o.out != null) { const po = E.inCubic(prog(t, o.out + i * 0.03, o.out + i * 0.03 + 0.3)); dy -= po * size; a = 1 - po; }
        ctx.save();
        ctx.beginPath(); ctx.rect(wx - 20, y - size * 1.0, ws[i] + size * 0.2, size * 1.3); ctx.clip();
        ctx.globalAlpha = a;
        inkText(ctx, w, wx, y + dy, size, color, { shadow: o.shadow });
        ctx.restore();
      }
      wx += ws[i] + sp;
    });
    return total;
  }
  /** Ink pill kicker with a pink dot (the gameplay kit's tag, drawn). */
  function pill(ctx, text, x, y, size, t, at, o = {}) {
    const p = prog(t, at, at + 0.35);
    if (p <= 0) return;
    font(ctx, size, 500, 'mono'); ctx.letterSpacing = (size * 0.2) + 'px';
    const n = Math.max(1, Math.round(text.length * E.outCubic(p)));
    const shown = text.slice(0, n);
    const tw0 = ctx.measureText(text).width;
    const padX = size * 0.75, h = size * 2.1, dotW = size * 1.3;
    const w = tw0 + padX * 2 + dotW;
    const x0 = o.align === 'center' ? x - w / 2 : x;
    ctx.save();
    ctx.globalAlpha = clamp(p * 3) * (o.alpha ?? 1);
    rrect(ctx, x0 + size * 0.22, y - h / 2 + size * 0.22, w, h, size * 0.35); ctx.fillStyle = o.lip || C.card; ctx.fill();
    rrect(ctx, x0, y - h / 2, w, h, size * 0.35); ctx.fillStyle = C.ink; ctx.fill();
    ctx.fillStyle = o.dot || C.pink;
    ctx.beginPath(); ctx.arc(x0 + padX + size * 0.3, y, size * 0.3 * E.outBack(p), 0, TAU); ctx.fill();
    ctx.fillStyle = C.card; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(shown, x0 + padX + dotW, y + 1);
    ctx.restore();
  }

  /* ───────────── the NFT beat (about 4.8 s; t = 0 on the downbeat) ─────────────
   * Three sealed cards are dealt face down, "Elymum NFT." / "$1 in HYPE." rise, the seals crack and
   * the cards turn over one by one, then the WL ticket lands with its stamp. Landscape or portrait.
   *
   * Options (all optional; leaving them out draws the beat exactly as above):
   *   out      time the beat starts to leave
   *   times    beat times (BEAT_T keys)
   *   kicker   the pill's text
   *   plain    the plain mention instead: the cards dealt face up with no $1 MINT tag, one
   *            headline line, no WL ticket, on the promo's paper stock (ink type on a light
   *            ground, so the brand mark's pink disc stays legible). Its own fields:
   *            {head: 'Elymum NFTs.', layout: {...beatLayout overrides}} */
  const BEAT_T = { deal: [0.0, 0.12, 0.24], l1: 0.08, l2: 1.2, flip: [1.2, 1.5, 1.8], ticket: 1.95, underline: 3.75 };
  function beatLayout() {
    if (H > W) {
      // portrait 1080 x 1920
      const cw = 300, ch = 420;
      return {
        portrait: true, kx: W / 2, ky: 250, hx: W / 2, hy1: 470, hy2: 620, hs: 150, align: 'center',
        cards: [[W / 2 - 300, 1060, -0.13, 28], [W / 2, 1015, 0, 0], [W / 2 + 300, 1060, 0.13, 28]], cw, ch,
        tk: [W / 2 - 420, 1400, 840, 190], st: [W / 2 + 290, 1380, 0.18], sun: [W / 2, 1040],
      };
    }
    const cw = 270, ch = 378;
    return {
      portrait: false, kx: 150, ky: 250, hx: 150, hy1: 450, hy2: 600, hs: 150, align: 'left',
      cards: [[1215, 560, -0.13, 26], [1470, 520, 0, 0], [1725, 560, 0.13, 26]], cw, ch,
      tk: [150, 700, 760, 170], st: [800, 690, 0.18], sun: [1470, 540],
    };
  }
  function drawBeat(ctx, t, o = {}) {
    if (o.plain) return drawPlain(ctx, t, o);
    const L = beatLayout();
    const T = { ...BEAT_T, ...(o.times || {}) };
    pinkStock(ctx, t, L.sun[0], L.sun[1]);
    const out = o.out ?? null; // time the beat starts to leave (optional)
    // cards
    L.cards.forEach(([cx, cy, rot, dy], i) => {
      const at = T.deal[i];
      if (t < at) return;
      const k = spring(t - at, 1.5, 6.5);
      const fromY = H + L.ch;
      const x = cx + (1 - k) * (i - 1) * 120;
      const y = lerp(fromY, cy + dy, k);
      const fl = E.inOutCubic(prog(t, T.flip[i], T.flip[i] + 0.42));
      const crack = t >= T.flip[i] - 0.05 ? t - (T.flip[i] - 0.05) : null;
      let sc = 1;
      if (out != null) sc *= 1 - E.inBack(prog(t, out + i * 0.06, out + i * 0.06 + 0.35));
      if (sc <= 0.01) return;
      card(ctx, x, y, L.cw, L.ch, { i: o.cardSet ? o.cardSet[i] : i, rot: rot * k + (1 - k) * (i - 1) * 0.5, flip: fl, crack, t, scale: sc });
    });
    // kicker + headline
    pill(ctx, o.kicker || 'COMING SOON / ELYMUM NFT', L.kx, L.ky, L.portrait ? 26 : 24, t, T.l1, { align: L.align === 'center' ? 'center' : 'left' });
    riseLine(ctx, 'Elymum NFT.', L.hx, L.hy1, L.hs, C.card, t, T.l1, { align: L.align, out });
    riseLine(ctx, '$1 in HYPE.', L.hx, L.hy2, L.hs, C.mustard, t, T.l2, { align: L.align, out });
    // the ticket and its stamp
    const tp = E.outBack(prog(t, T.ticket, T.ticket + 0.45), 1.4) * (out != null ? 1 - E.inCubic(prog(t, out, out + 0.3)) : 1);
    const [tx, ty, tw0, th] = L.tk;
    wlTicket(ctx, tx, ty, tw0, th, tp, { size: L.portrait ? 112 : 96, underline: prog(t, T.underline, T.underline + 0.5) });
    shockDots(ctx, tx + tw0 * 0.6, ty + th / 2, t - T.ticket - 0.12, C.card, L.portrait ? 700 : 600, 0.3);
  }

  /** The plain NFT mention (drawBeat with o.plain): paper stock, the three cards dealt face up
   *  (no tags), a small kicker and one ink headline. Times: deal, l1 (kicker + headline). */
  function drawPlain(ctx, t, o) {
    const P = o.plain === true ? {} : o.plain;
    const L = { ...beatLayout(), ...(P.layout || {}) };
    const T = { ...BEAT_T, ...(o.times || {}) };
    const out = o.out ?? null;
    drawPaper(ctx, -t * 10, 0, C.paper);
    L.cards.forEach(([cx, cy, rot, dy], i) => {
      const at = T.deal[i];
      if (t < at) return;
      const k = spring(t - at, 1.5, 6.5);
      const x = cx + (1 - k) * (i - 1) * 120;
      const y = lerp(H + L.ch, cy + dy, k);
      let sc = 1;
      if (out != null) sc *= 1 - E.inBack(prog(t, out + i * 0.06, out + i * 0.06 + 0.35));
      if (sc <= 0.01) return;
      card(ctx, x, y, L.cw, L.ch, { i: o.cardSet ? o.cardSet[i] : i, rot: rot * k + (1 - k) * (i - 1) * 0.5, flip: 1, t, scale: sc, tag: false });
    });
    pill(ctx, o.kicker || 'COMING SOON', L.kx, L.ky, L.portrait ? 26 : 24, t, T.l1, { align: L.align === 'center' ? 'center' : 'left', lip: C.pink });
    riseLine(ctx, P.head || 'Elymum NFTs.', L.hx, L.hy1, L.hs, C.ink, t, T.l1, { align: L.align, out, shadow: C.pink });
  }

  window.NFT = { heroCoin, card, cardFront, cardBack, waxSeal, wlTicket, pinkStock, sunburst, inkText, riseLine, pill, drawBeat, BEAT_T, lookOf, edgePath };
})();

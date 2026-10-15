/* Slana promo: the ten scenes and their transitions.
 * Timeline (100 BPM, one beat = 0.6 s) lives in timeline.json; the cue times
 * below are the same beats the music and SFX are scored to. */
'use strict';

const S = {}; // shared state built in init
const LOOK = {};

/* ───────────── shared helpers ───────────── */
function drift(t, amp = 1) {
  return { x: Math.sin(t * 0.52) * 6 * amp + Math.sin(t * 1.3) * 1.5 * amp, y: Math.sin(t * 0.37 + 1) * 4.5 * amp, r: Math.sin(t * 0.21) * 0.0025 * amp };
}
function camera(ctx, cx, cy, zoom, rot = 0, sx = 0, sy = 0) {
  ctx.translate(W / 2 + sx, H / 2 + sy);
  ctx.scale(zoom, zoom);
  ctx.rotate(rot);
  ctx.translate(-cx, -cy);
}
function toScreen(px, py, cx, cy, zoom) {
  return { x: (px - cx) * zoom + W / 2, y: (py - cy) * zoom + H / 2 };
}
function bg(ctx, t, color = C.paper, dark = false, par = 1) {
  const d = drift(t, 1);
  drawPaper(ctx, -t * 10 * par + d.x * 0.4, d.y * 0.4, color, dark);
}
/** Footage frame for a shot at local time lt (seconds). */
function footUrl(shot, lt) {
  const sh = S.shots[shot];
  const n = clamp(Math.floor(Math.max(0, lt) * 30), 0, Math.round(sh.dur * 30) - 1) + 1;
  return `/cache/footage/${shot}/${String(n).padStart(4, '0')}.jpg`;
}
function drawFoot(ctx, shot, lt, x, y, w, h, zoom = 1, fx = 0.5, fy = 0.5) {
  const im = getImg(footUrl(shot, lt));
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (im) {
    const iw = im.width / zoom, ih = im.height / zoom;
    const sx = clamp(fx * im.width - iw / 2, 0, im.width - iw), sy = clamp(fy * im.height - ih / 2, 0, im.height - ih);
    ctx.drawImage(im, sx, sy, iw, ih, x, y, w, h);
  } else {
    ctx.fillStyle = '#d9d1c0'; ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}
/** Small label chip (mono text in a rounded ink-outlined box). */
function chip(ctx, text, x, y, o = {}) {
  font(ctx, o.size || 18, 500, 'mono');
  ctx.letterSpacing = (o.ls ?? 2) + 'px';
  const tw0 = ctx.measureText(text).width;
  const pw = o.pad ?? 12, h = (o.size || 18) * 1.9;
  const w = tw0 + pw * 2;
  const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  rrect(ctx, x0, y - h / 2, w, h, 6);
  if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
  if (o.stroke !== false) { ctx.strokeStyle = o.strokeColor || o.color || C.ink; ctx.lineWidth = 2; ctx.setLineDash(o.dash || []); ctx.stroke(); }
  ctx.fillStyle = o.color || C.ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x0 + pw, y + 1);
  ctx.restore();
  return w;
}
/** Bottom HUD (persistent print marks). */
function hud(ctx, t, idx, dark = false, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.75;
  const col = dark ? C.nightInk2 : C.ink2;
  font(ctx, 15, 500, 'mono');
  ctx.letterSpacing = '3px';
  ctx.fillStyle = col;
  ctx.textBaseline = 'middle';
  ctx.fillText('SLANA  /  ON-CHAIN AGAR.IO', 64, H - 46);
  ctx.textAlign = 'right';
  ctx.fillText(String(idx).padStart(2, '0') + ' / 09', W - 64 - 96, H - 46);
  [C.pink, C.teal, C.mustard].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(W - 64 - 78 + i * 28, H - 52, 22, 12);
  });
  // registration marks
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  [[40, 40], [W - 40, 40]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
  });
  ctx.restore();
}
/** Simple loot coin (mustard disc, riso ghost). */
function lootCoin(ctx, x, y, r, a = 1, spin = 0) {
  if (r <= 0.3 || a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(x, y);
  ctx.scale(Math.max(0.25, Math.abs(Math.cos(spin))), 1);
  ctx.fillStyle = C.pink;
  ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath(); ctx.arc(r * 0.18, r * 0.18, r, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = C.mustard;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.2, r * 0.14);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,27,46,0.45)'; ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, TAU); ctx.stroke();
  ctx.restore();
}
/** Bot antenna drawn above a coin of radius r at (x,y). */
function antenna(ctx, x, y, r, t, dark) {
  ctx.save();
  ctx.strokeStyle = dark ? C.nightInk : C.ink;
  ctx.lineWidth = r * 0.06; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y - r * 0.96); ctx.quadraticCurveTo(x + r * 0.08, y - r * 1.2, x + r * 0.02, y - r * 1.36); ctx.stroke();
  const on = Math.sin(t * 9) > 0;
  ctx.fillStyle = on ? C.red : '#7a2a22';
  ctx.beginPath(); ctx.arc(x + r * 0.02, y - r * 1.42, r * 0.09, 0, TAU); ctx.fill();
  if (on) { ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x + r * 0.02, y - r * 1.42, r * 0.2, 0, TAU); ctx.fill(); }
  ctx.restore();
}

/* ───────────── init ───────────── */
window.SCENES_INIT = async () => {
  const A = window.SlanaArt;
  for (let i = 0; i < 8; i++) LOOK['b' + i] = A.lookForBasicSkin(i);
  LOOK.hunter = A.lookForBasicSkin(4); // Bubbles: fluo pink, teal overprint
  LOOK.prey = A.lookForBasicSkin(3); // Minty
  LOOK.player = A.lookForBasicSkin(2); // Penny
  LOOK.bot = { body: '#9A95AE', overprint: '#3B5BDB', offset: { dx: 3, dy: 3 }, symbol: 'bolt', eyes: 'sleepy', mouth: 'flat', accessory: 'none', special: null };
  S.shots = {};
  (TL.footage || []).forEach((s) => (S.shots[s.id] = s));
  // the Pass card art (rendered once)
  const n = 412;
  let traits = null;
  for (let k = 0; k < 60 && !traits; k++) {
    const tr = A.passTraits('5a1a7a0000000000000000000000000000000000000000000000000000000412', n + k * 7, 3333);
    if (tr.accessory !== 'none' && tr.rarity !== 'common') traits = tr;
  }
  if (!traits) traits = A.passTraits('5a1a7a0000000000000000000000000000000000000000000000000000000412', n, 3333);
  S.passTraits = traits;
  S.passCard = mkCanvas(520, 520);
  A.drawPassCard(S.passCard.getContext('2d'), traits, n, 520);
  S.passLook = A.lookForPass(traits);
};

/* ───────────── 1. HOOK (0 – 4.8) ───────────── */
function logoLayout(ctx) {
  const size = 300;
  const m = wordmarkMetrics(ctx, size);
  const x = W / 2 - m.total / 2, y = 560 + size * 0.28;
  return { x, y, size, markX: x + m.markX, markY: y + m.markY, mr: m.mr };
}
function sceneHook(ctx, t) {
  const L = logoLayout(ctx);
  // background paper → card as we approach the logo
  const toCard = tw(t, 3.9, 4.55, E.inOutCubic);
  bg(ctx, t);
  if (toCard > 0) { ctx.save(); ctx.globalAlpha = toCard; ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, H); ctx.restore(); }

  const d = drift(t);
  const push = 1 + 0.035 * E.inOutCubic(prog(t, 0, 3.6));
  ctx.save();
  ctx.translate(W / 2 + d.x, H / 2 + d.y);
  ctx.scale(push, push);
  ctx.translate(-W / 2, -H / 2);

  // food pellets (game food), drifting; fade before the logo
  const fa = 1 - tw(t, 3.55, 4.1);
  if (fa > 0) {
    const r = rng(11);
    const cols = [C.pink, C.teal, C.mustard, C.blue, C.green, C.orange, C.purple];
    for (let i = 0; i < 70; i++) {
      const x0 = r() * W, y0 = r() * H, s = 4 + r() * 6, ph = r() * TAU;
      const x = x0 + Math.sin(t * 0.6 + ph) * 8, y = y0 + Math.cos(t * 0.5 + ph) * 8;
      if (x < 1000 && y > 230 && y < 700) continue; // keep headline area calm
      ctx.globalAlpha = fa * 0.85 * tw(t, 0.05 + r() * 0.5, 0.6 + r() * 0.5);
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── characters ──
  const hx0 = 1430, hy0 = 560, hr0 = 170;
  const px0 = 1080, py0 = 820, pr = 62;
  const T_ANT = 1.7, T_LUNGE = 2.12, T_GULP = 2.4;
  let hx = hx0, hy = hy0, hr = hr0, hsx = 1, hsy = 1, hrot = 0;
  // idle bob
  hy += Math.sin(t * 2.4) * 6;
  // anticipation: lean back, squash
  const ant = E.inOutCubic(prog(t, T_ANT, T_LUNGE));
  // lunge
  const lun = E.inQuad(prog(t, T_LUNGE, T_GULP));
  // settle after gulp
  const set = prog(t, T_GULP, T_GULP + 1.0);
  const lungeX = 1250, lungeY = 720;
  if (t < T_LUNGE) {
    hx += ant * 26; hy -= ant * 18; hsx = 1 - ant * 0.07; hsy = 1 + ant * 0.07; hrot = ant * 0.06;
  } else if (t < T_GULP) {
    hx = lerp(hx0 + 26, lungeX, lun); hy = lerp(hy0 - 18, lungeY, lun);
    hsx = 1 + lun * 0.16; hsy = 1 - lun * 0.12; hrot = lerp(0.06, -0.62, lun);
  } else {
    const sp = spring(t - T_GULP, 2.0, 5.5);
    hx = lerp(lungeX, 1400, sp); hy = lerp(lungeY, 600, sp) + Math.sin(t * 2.4) * 6;
    hr = lerp(hr0, 205, spring(t - T_GULP, 2.6, 6));
    const wob = Math.exp(-(t - T_GULP) * 5) * Math.sin((t - T_GULP) * 30);
    hsx = 1 + wob * 0.12; hsy = 1 - wob * 0.12; hrot = lerp(-0.62, 0, sp) * 0.5;
  }
  // flight to the logo mark
  const fly = E.inOutExpo(prog(t, 3.72, 4.62));
  let markA = 0;
  if (fly > 0) {
    hx = lerp(hx, L.markX, fly); hy = lerp(hy, L.markY, fly); hr = lerp(hr, L.mr, fly);
    hrot = lerp(hrot, TAU, fly);
    markA = tw(t, 4.3, 4.6);
  }
  // prey
  if (t < T_GULP + 0.02) {
    const fear = Math.sin(t * 38) * 2.2 * tw(t, 1.2, 1.6);
    let x = px0 + fear, y = py0 + Math.sin(t * 3 + 1) * 7;
    let s = 1;
    const sw = E.inCubic(prog(t, T_GULP - 0.16, T_GULP));
    x = lerp(x, lungeX - 40, sw); y = lerp(y, lungeY + 40, sw); s = 1 - sw;
    halftoneShadow(ctx, x + 6, y + pr * 1.05, pr * 0.8 * s, pr * 0.14 * s, 0.16, 6);
    coin(ctx, x, y, { look: LOOK.prey, r: pr * s, expr: t > 1.3 ? 'scared' : 'happy', lookX: 0.8, lookY: -0.6, time: t, seed: 3 });
    // carried tokens tag
    const ta = tw(t, 0.5, 0.8) * (1 - sw);
    if (ta > 0.01) chip(ctx, '1,750 $SLANA', x, y - pr - 34, { align: 'center', fill: C.card, alpha: ta, size: 17 });
  }
  // gulp burst
  burst(ctx, lungeX - 30, lungeY + 30, t - T_GULP, { seed: 4, n: 30, speed: 800, size: 10 });
  // hunter (fades into the brand mark)
  const ha = 1 - markA;
  if (ha > 0) {
    halftoneShadow(ctx, hx + 10, hy + hr * 1.06, hr * 0.8 * (1 - fly), hr * 0.13 * (1 - fly), 0.17 * (1 - fly), 7);
    const expr = t < T_GULP ? 'hungry' : t < 3.9 ? 'proud' : 'happy';
    coin(ctx, hx, hy, { look: LOOK.hunter, r: hr, expr, lookX: t < T_GULP ? -0.85 : 0.1, lookY: t < T_GULP ? 0.7 : 0, time: t, sx: hsx, sy: hsy, rot: hrot, alpha: ha, seed: 1 });
  }
  if (markA > 0) {
    ctx.restore();
    ctx.save();
    brandMark(ctx, L.markX, L.markY, L.mr, 1, markA);
    ctx.restore();
    ctx.save();
    ctx.translate(W / 2 + d.x, H / 2 + d.y); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  }
  // hunter's purse
  const ca = tw(t, 0.7, 1.0) * (1 - tw(t, 3.6, 3.85));
  if (ca > 0.01) {
    const v = lerp(1200, 2950, E.outCubic(prog(t, T_GULP + 0.08, T_GULP + 0.9)));
    const bx = (t < 3.6 ? hx : 1400), by = (t < 3.6 ? hy : 600) + hr + 60;
    ctx.save();
    ctx.globalAlpha = ca;
    const pop = 1 + 0.12 * Math.exp(-(t - T_GULP - 0.1) * 6) * (t > T_GULP ? 1 : 0);
    ctx.translate(bx, by); ctx.scale(pop, pop);
    rrect(ctx, -150, -34, 300, 68, 10);
    ctx.fillStyle = C.ink; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = ca;
    ctx.translate(bx, by); ctx.scale(pop, pop);
    font(ctx, 40, 800, 'display'); ctx.letterSpacing = '-1px'; ctx.fillStyle = C.card; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(fmt(Math.round(v / 10) * 10), 40, 16); ctx.textAlign = 'left';
    font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.pink; ctx.textBaseline = 'alphabetic';
    ctx.fillText('$SLANA', 52, 12);
    ctx.restore();
  }
  ctx.restore();

  // type (screen space, no push so it stays crisp)
  kicker(ctx, 'ON-CHAIN AGAR.IO  /  SOLANA', 150, 300, t, 0.2, { out: 3.55 });
  headline(ctx, [
    { text: 'Eat a player.', at: 0.45 },
    { text: 'Keep their tokens.', at: 2.5, color: C.pink },
  ], 150, 470, t, { size: 118, out: 3.55 });
}

/* ───────────── 2+3. LOGO → TICKET (4.8 – 14.4) ───────────── */
const TK = { w: 1500, h: 600, stub: 1170, nr: 30, r: 26 }; // ticket in world coords, centred on 0,0
const TK_HOLE = { x: 250, y: 150, r: 40 };
const CAM_FINAL = { x: 0, y: -190, z: 0.84 };
function ticketCam(t) {
  // logo phase: zoomed deep into the card; pull back; settle; dive into the punch hole
  const p = E.inOutExpo(prog(t, 7.7, 8.75));
  let z = Math.exp(lerp(Math.log(6), Math.log(CAM_FINAL.z), p));
  let x = lerp(-160, CAM_FINAL.x, p), y = lerp(-40, CAM_FINAL.y, p);
  // gentle settle drift after landing
  const s = prog(t, 8.75, 12.3);
  z *= 1 + 0.025 * E.inOutCubic(s);
  // dive
  const dv = prog(t, 12.3, 13.55);
  if (dv > 0) {
    const e = E.inQuart(dv);
    z = Math.exp(lerp(Math.log(z), Math.log(46), e));
    const c = E.inOutCubic(Math.min(1, dv * 1.6));
    x = lerp(x, TK_HOLE.x, c); y = lerp(y, TK_HOLE.y, c);
  }
  return { x, y, z };
}
function drawTicketBody(ctx, t) {
  const x0 = -TK.w / 2, y0 = -TK.h / 2;
  // shadow + card
  paperShadow(ctx, () => ticketPath(ctx, x0, y0, TK.w, TK.h, TK.r, TK.stub, TK.nr), 1.2, 0.3);
  ticketPath(ctx, x0, y0, TK.w, TK.h, TK.r, TK.stub, TK.nr);
  ctx.fillStyle = C.card; ctx.fill();
  // fibre on the card
  ctx.save();
  ticketPath(ctx, x0, y0, TK.w, TK.h, TK.r, TK.stub, TK.nr); ctx.clip();
  const pf = ctx.createPattern(TEX.fibre, 'repeat');
  const z = ctx.getTransform().a;
  pf.setTransform(new DOMMatrix().scale(1 / z, 1 / z));
  ctx.globalAlpha = 0.45; ctx.fillStyle = pf; ctx.fillRect(x0, y0, TK.w, TK.h);
  ctx.restore();
  // perforation
  dashed(ctx, x0 + TK.stub, y0 + TK.nr + 8, x0 + TK.stub, y0 + TK.h - TK.nr - 8, C.line, 3, [9, 9]);
}
function drawTicketPrint(ctx, t, a) {
  // printed content of the ticket (world coords); a = visibility 0..1
  if (a <= 0) return;
  const x0 = -TK.w / 2 + 80, y0 = -TK.h / 2;
  ctx.save();
  ctx.globalAlpha = a;
  font(ctx, 20, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.fillText('ADMIT ONE  /  LIVE ROOM', x0 + 1010, y0 + 118);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink; ctx.fillRect(x0, y0 + 160, 1010, 3);
  ctx.fillRect(x0, y0 + 168, 1010, 1.2);
  font(ctx, 150, 800, 'display'); ctx.letterSpacing = '-5px'; ctx.fillStyle = C.ink;
  ctx.fillText('Penny Pond', x0 - 6, y0 + 330);
  font(ctx, 21, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink2;
  ctx.fillText('23 PLAYERS  /  OPEN 24/7  /  EAT A PLAYER, KEEP THEIR TOKENS', x0, y0 + 392);
  font(ctx, 20, 500, 'mono'); ctx.fillStyle = C.ink;
  ctx.fillText('No. 0412', x0, y0 + 520);
  ctx.fillStyle = C.pinkText;
  ctx.fillText('SEASON 01', x0 + 170, y0 + 520);
  // stub
  const sx = -TK.w / 2 + TK.stub + (TK.w - TK.stub) / 2;
  ctx.textAlign = 'center';
  font(ctx, 20, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2;
  ctx.fillText('ENTRY', sx, y0 + 150);
  font(ctx, 104, 800, 'display'); ctx.letterSpacing = '-3px'; ctx.fillStyle = C.ink;
  ctx.fillText('1,000', sx, y0 + 300);
  font(ctx, 24, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.pinkText;
  ctx.fillText('$SLANA', sx, y0 + 345);
  ctx.textAlign = 'left';
  barcode(ctx, sx - 110, y0 + 420, 220, 80, 9);
  ctx.restore();
}
function sceneTicket(ctx, t) {
  const cam = ticketCam(t);
  const d = drift(t, 0.8);
  const sh = shake(t, [4.8, 10.8, 11.4], 10);
  bg(ctx, t);
  ctx.save();
  camera(ctx, cam.x, cam.y, cam.z, d.r + sh.r, d.x + sh.x, d.y + sh.y);
  drawTicketBody(ctx, t);
  // ticket print appears as we pull back
  const printA = tw(t, 7.95, 8.6);
  drawTicketPrint(ctx, t, printA);
  // the room's players: little coins on the ticket
  for (let i = 0; i < 5; i++) {
    const tp = 9.55 + i * 0.09;
    const k = spring(t - tp, 2.4, 6.5);
    if (t < tp) continue;
    const x = -TK.w / 2 + 560 + i * 74, y = 200 + Math.sin(t * 3 + i) * 3;
    coin(ctx, x, y + (1 - k) * 30, { look: LOOK['b' + [0, 1, 5, 6, 7][i]], r: 30 * clamp(k, 0, 1.2), expr: 'happy', time: t + i, seed: i, lookX: -0.3 });
  }
  // tape on the corners
  tape(ctx, -TK.w / 2 + 40, -TK.h / 2 + 10, 190, 52, -0.6, prog(t, 8.55, 8.75));
  tape(ctx, TK.w / 2 - 40, -TK.h / 2 + 14, 190, 52, 0.55, prog(t, 8.72, 8.92));
  // PAID stamp on the stub
  const sx = -TK.w / 2 + TK.stub + (TK.w - TK.stub) / 2;
  stamp(ctx, 'PAID', 262, -28, -0.2, t - 10.8, C.pinkInk, { size: 84, mono: false });
  // punch hole: footage seen through it
  if (t >= 11.4) {
    const hs = toScreen(TK_HOLE.x, TK_HOLE.y, cam.x, cam.y, cam.z);
    ctx.save();
    ctx.beginPath(); ctx.arc(TK_HOLE.x, TK_HOLE.y, TK_HOLE.r, 0, TAU); ctx.clip();
    // draw the footage in screen space centred on the hole
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fw = W * 1.0, fh = H * 1.0;
    drawFoot(ctx, 'A', t - 11.4, hs.x - fw / 2, hs.y - fh / 2, fw, fh, 1, 0.5, 0.5);
    ctx.restore();
    // hole rim + inner shadow
    ctx.save();
    ctx.beginPath(); ctx.arc(TK_HOLE.x, TK_HOLE.y, TK_HOLE.r, 0, TAU);
    ctx.strokeStyle = 'rgba(30,27,46,0.55)'; ctx.lineWidth = 3; ctx.stroke();
    const g = ctx.createRadialGradient(TK_HOLE.x, TK_HOLE.y - 6, TK_HOLE.r * 0.6, TK_HOLE.x, TK_HOLE.y, TK_HOLE.r);
    g.addColorStop(0, 'rgba(30,27,46,0)'); g.addColorStop(1, 'rgba(30,27,46,0.35)');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    // the punched-out chad flies off
    const cd = t - 11.4;
    if (cd < 0.9) {
      const e = E.outCubic(cd / 0.9);
      ctx.save();
      ctx.translate(TK_HOLE.x + e * 260, TK_HOLE.y - e * 120 + cd * cd * 900);
      ctx.rotate(cd * 9);
      ctx.scale(1 + e * 1.4, (1 + e * 1.4) * Math.abs(Math.cos(cd * 11)));
      ctx.globalAlpha = 1 - prog(cd, 0.6, 0.9);
      ctx.beginPath(); ctx.arc(0, 0, TK_HOLE.r, 0, TAU);
      ctx.fillStyle = C.card; ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
  } else if (t > 10.9) {
    // a dashed "punch here" ring
    ctx.save();
    ctx.globalAlpha = tw(t, 10.9, 11.1);
    ctx.setLineDash([6, 6]); ctx.strokeStyle = C.pinkInk; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(TK_HOLE.x, TK_HOLE.y, TK_HOLE.r + 10 - tw(t, 10.9, 11.35) * 6, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // logo (screen space): slams at 4.8, then flies into the ticket header
  const L = logoLayout(ctx);
  if (t >= 4.8 && t < 7.95) {
    const a = tw(t, 4.8, 5.3) * (1 - tw(t, 7.6, 7.9));
    const R = 560, sp = 15;
    const rot = (t - 4.8) * 0.05;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = C.pink;
    ctx.globalAlpha = 0.16 * a;
    ctx.translate(W / 2 + d.x, 560 + d.y); ctx.rotate(rot);
    for (let gx = -R; gx <= R; gx += sp) for (let gy = -R; gy <= R; gy += sp) {
      const dd = Math.hypot(gx, gy) / R;
      if (dd >= 1) continue;
      const rr = sp * 0.42 * Math.pow(1 - dd, 1.3) * (0.6 + 0.4 * E.outCubic(prog(t, 4.8, 5.6)));
      if (rr < 0.4) continue;
      ctx.beginPath(); ctx.arc(gx, gy, rr, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  const q = E.inOutExpo(prog(t, 7.7, 8.75));
  const hdr = { x: -TK.w / 2 + 80, y: -TK.h / 2 + 120 }; // header slot (world), size 100
  const hs = toScreen(hdr.x, hdr.y, cam.x, cam.y, cam.z);
  const size1 = 100 * cam.z;
  if (t < 12.3 || true) {
    const size = lerp(L.size, size1, q);
    const lx = lerp(L.x, hs.x, q), ly = lerp(L.y, hs.y, q);
    const slam = t - 4.8;
    const s0 = (slam < 0.25 ? lerp(1.12, 1, E.outExpo(slam / 0.25)) : 1) * (1 + 0.035 * E.inOutCubic(prog(t, 4.8, 7.7)) * (1 - q));
    const reg = 1 - spring(slam, 1.4, 5.5);
    ctx.save();
    ctx.translate(lx + sh.x * (1 - q), ly + sh.y * (1 - q));
    if (q > 0) { ctx.translate(d.x * q, d.y * q); }
    ctx.scale(s0, s0);
    if (t > 12.3) {
      // during the dive the logo rides along with the ticket
      ctx.restore(); ctx.save();
      ctx.translate(W / 2 + d.x + sh.x, H / 2 + d.y + sh.y); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
      ctx.translate(hdr.x, hdr.y);
      wordmark(ctx, 0, 0, 100, { reg: 0, layers: 1 });
    } else {
      wordmark(ctx, 0, 0, size, { reg: Math.max(0, reg), layers: clamp(slam / 0.08) });
    }
    ctx.restore();
  }
  // logo extras: shock dots + tagline
  if (t < 8.0) {
    shockDots(ctx, L.markX, L.markY, t - 4.8, C.pink, 1100, 0.35);
    shockDots(ctx, W / 2, 560, t - 4.82, C.ink, 1300, 0.14);
    const ta = 1 - tw(t, 7.45, 7.7);
    ctx.save(); ctx.globalAlpha = ta;
    kicker(ctx, 'EAT  /  GROW  /  GET PAID', W / 2, 760, t, 5.35, { align: 'center', dot: false, size: 26, ls: 10, speed: 0.022 });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ta * tw(t, 5.9, 6.2);
    chip(ctx, 'LIVE ON SOLANA', W / 2, 840, { align: 'center', size: 17, color: C.tealInk, ls: 4 });
    ctx.restore();
  }
  // headline for the ticket beat
  kicker(ctx, 'FIXED PRICE  /  PAID IN $SLANA', 150, 112, t, 8.7, { out: 12.15 });
  headline(ctx, [
    { text: 'Buy a ticket.', at: 8.85 },
    { text: 'Enter a live room.', at: 9.65, color: C.pink },
  ], 150, 250, t, { size: 104, out: 12.15 });
  hud(ctx, t, 2, false, tw(t, 9.0, 9.4) * (1 - tw(t, 12.2, 12.5)));
}

/* ───────────── 4. PLAY (13.55 – 20.4) ───────────── */
const WIN = { cx: 1250, cy: 560, w: 1180, h: 664 };
const SHOTS = [
  { id: 'A', t0: 11.4, t1: 15.6, zoom: [1.0, 1.1], f: [0.45, 0.45] },
  { id: 'B', t0: 15.6, t1: 16.8, zoom: [1.12, 1.2], f: [0.4, 0.45] },
  { id: 'C', t0: 16.8, t1: 18.0, zoom: [1.05, 1.15], f: [0.5, 0.5] },
  { id: 'D', t0: 18.0, t1: 19.2, zoom: [1.15, 1.06], f: [0.45, 0.5] },
  { id: 'E', t0: 19.2, t1: 20.6, zoom: [1.25, 1.38], f: [0.48, 0.5] },
];
function shotAt(t) {
  for (const s of SHOTS) if (t >= s.t0 && t < s.t1) return s;
  return SHOTS[SHOTS.length - 1];
}
function scenePlay(ctx, t) {
  bg(ctx, t);
  const d = drift(t, 0.7);
  // window: fills the screen right after the dive, slams into its frame on 14.4
  const k0 = E.outCubic(prog(t, 13.55, 14.4));
  const slam = spring(t - 14.4, 1.5, 7);
  const fillS = W / WIN.w; // 1.5
  const s = t < 14.4 ? fillS * (1 + 0.05 * k0) : lerp(fillS * 1.05, 1, slam);
  const cx = t < 14.4 ? W / 2 : lerp(W / 2, WIN.cx, slam);
  const cy = t < 14.4 ? H / 2 : lerp(H / 2, WIN.cy, slam);
  const ww = WIN.w * s, wh = WIN.h * s;
  const exit = E.inBack(prog(t, 20.1, 20.45), 1.4);
  ctx.save();
  ctx.translate(d.x, d.y + exit * -80);
  // frame (card with side notches), only once it is visible
  const fa = t < 14.4 ? 0 : clamp(slam * 1.4);
  const bx = cx - ww / 2, by = cy - wh / 2;
  if (fa > 0) {
    const m = 30 * s;
    ctx.save();
    ctx.globalAlpha = fa;
    paperShadow(ctx, () => sideTicketPath(ctx, bx - m, by - m - 34 * s, ww + m * 2, wh + m * 2 + 34 * s, 20, 26, 0.55), 1.2, 0.3);
    sideTicketPath(ctx, bx - m, by - m - 34 * s, ww + m * 2, wh + m * 2 + 34 * s, 20, 26, 0.55);
    ctx.fillStyle = C.card; ctx.fill();
    // label row
    font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.textBaseline = 'middle';
    const ly = by - 30 * s;
    ctx.fillStyle = C.red;
    if (Math.sin(t * 6) > -0.2) { ctx.beginPath(); ctx.arc(bx + 10, ly, 7, 0, TAU); ctx.fill(); }
    ctx.fillStyle = C.ink;
    ctx.fillText('LIVE  /  PENNY POND  /  ROOM 01', bx + 28, ly);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.ink2;
    ctx.fillText('REAL GAMEPLAY', bx + ww, ly);
    ctx.textAlign = 'left';
    ctx.restore();
  }
  // footage
  const sh = shotAt(t);
  const lt = t - sh.t0;
  const z = lerp(sh.zoom[0], sh.zoom[1], E.inOutCubic(prog(t, sh.t0, sh.t1)));
  const cutPunch = 1 + 0.035 * Math.exp(-(t - sh.t0) * 9) * (sh.t0 > 14 ? 1 : 0);
  drawFoot(ctx, sh.id, lt, bx, by, ww, wh, z * cutPunch, sh.f[0], sh.f[1]);
  // flash on cuts
  if (sh.t0 > 14 && t - sh.t0 < 0.1) {
    ctx.save(); ctx.globalAlpha = 0.35 * (1 - (t - sh.t0) / 0.1); ctx.fillStyle = C.card; ctx.fillRect(bx, by, ww, wh); ctx.restore();
  }
  if (fa > 0) {
    ctx.save(); ctx.globalAlpha = fa;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.strokeRect(bx, by, ww, wh);
    ctx.restore();
    tape(ctx, bx - 10, by - 44, 170, 46, -0.5, prog(t, 14.5, 14.7));
    tape(ctx, bx + ww + 10, by + wh + 18, 170, 46, -0.5, prog(t, 14.6, 14.8));
    stamp(ctx, 'EATEN', bx + ww - 200, by + 130, 0.16, t - 16.2, C.pinkInk, { size: 70, fade: 1.6 });
  }
  ctx.restore();

  // words column
  const wa = 1 - E.inCubic(prog(t, 19.9, 20.25));
  if (wa > 0 && t > 14.3) {
    ctx.save(); ctx.globalAlpha = wa;
    kicker(ctx, 'LIVE  /  24/7', 150, 300, t, 14.55);
    const words = [['Eat.', 14.8, C.ink], ['Take.', 16.05, C.ink], ['Grow.', 17.15, C.pink]];
    words.forEach(([w, at, col], i) => {
      headline(ctx, [{ text: w, at, color: col === C.ink ? null : col }], 150, 450 + i * 128, t, { size: 128 });
    });
    ctx.restore();
  }
  hud(ctx, t, 3, false, tw(t, 14.5, 14.9) * wa);
}

/* ───────────── 5. ROUNDS (20.1 – 26.4) ───────────── */
// A round clock runs the last of a five-minute round down to the bell (22.2), the clock swings
// away and the "Round over" receipt prints: everyone alive at the bell is paid their till, the
// fee only touches the profit.
const RC = { cx: 1400, w: 600, slot: 1000, len: 900 };
const RC_STAMP = { x: 1270, y: 0 }; // y resolved at draw time
const BELL_AT = 22.2;
const CLK = { cx: 1390, cy: 440, w: 640, h: 340 };
function receiptFeed(t) {
  const N = 22;
  const p = prog(t, 22.45, 23.9) * N;
  const i = Math.floor(p), f = p - i;
  return Math.min(1, (i + E.outCubic(clamp(f * 1.6))) / N);
}
function receiptTop(t) { return RC.slot - RC.len * receiptFeed(t); }
/** Seconds left on the round clock: 5:00 spins down to 0:03, then 3, 2, 1 on the clock, 0 at the bell. */
function clockLeft(t) {
  if (t < 20.55) return 300;
  if (t < 21.6) return 3 + 297 * (1 - E.outQuart(prog(t, 20.55, 21.6)));
  if (t < BELL_AT) return 3 - Math.floor((t - 21.6) / 0.2);
  return 0;
}
function bellGlyph(ctx, x, y, s, rot, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = color; ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-34, 26);
  ctx.quadraticCurveTo(-30, 18, -27, 4);
  ctx.bezierCurveTo(-24, -26, -16, -38, 0, -38);
  ctx.bezierCurveTo(16, -38, 24, -26, 27, 4);
  ctx.quadraticCurveTo(30, 18, 34, 26);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -42, 6, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 32, 8, 0, Math.PI); ctx.fillStyle = C.ink; ctx.fill();
  ctx.restore();
}
function drawRoundClock(ctx, t) {
  const inK = spring(t - 20.2, 1.6, 6.5);
  if (t < 20.2) return;
  const out = E.inCubic(prog(t, 22.75, 23.2));
  if (out >= 1) return;
  const v = clockLeft(t);
  const bell = t >= BELL_AT;
  const final = v <= 60;
  const ring = bell ? Math.exp(-(t - BELL_AT) * 5) * Math.sin((t - BELL_AT) * 52) : 0;
  const x0 = CLK.cx - CLK.w / 2, y0 = CLK.cy - CLK.h / 2;
  ctx.save();
  ctx.translate(CLK.cx + out * 220, CLK.cy - out * 900 + (1 - clamp(inK)) * 60);
  ctx.rotate(-0.025 + ring * 0.05 - out * 0.35);
  const sc = lerp(0.82, 1, clamp(inK, 0, 1.2)) * 1.18;
  ctx.scale(sc, sc);
  ctx.translate(-CLK.cx, -CLK.cy);
  paperShadow(ctx, () => ticketPath(ctx, x0, y0, CLK.w, CLK.h, 18, CLK.w - 150, 20), 1.1, 0.3);
  ticketPath(ctx, x0, y0, CLK.w, CLK.h, 18, CLK.w - 150, 20);
  ctx.fillStyle = C.card; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
  // the stub: the room
  dashed(ctx, x0 + CLK.w - 150, y0 + 30, x0 + CLK.w - 150, y0 + CLK.h - 30, 'rgba(30,27,46,0.45)', 2.5, [7, 7]);
  ctx.save(); ctx.translate(x0 + CLK.w - 75, CLK.cy); ctx.rotate(-Math.PI / 2);
  font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PENNY POND', 0, 0);
  ctx.restore();
  // label row
  const lx = x0 + 44;
  font(ctx, 20, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = bell ? C.pinkText : final ? C.mustardInk : C.ink2;
  ctx.fillText(bell ? 'ROUND OVER' : final ? 'FINAL MINUTE  /  JOINS CLOSED' : 'ROUND CLOCK', lx, y0 + 62);
  // digits
  const sec = Math.max(0, Math.ceil(v - 1e-6));
  const txt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const tick = t >= 21.6 && t < BELL_AT ? Math.exp(-((t - 21.6) % 0.2) * 22) : 0;
  ctx.save();
  ctx.translate(lx - 4, y0 + 212);
  ctx.scale(1 + tick * 0.06, 1 + tick * 0.06);
  font(ctx, 170, 800, 'display'); ctx.letterSpacing = '-5px';
  if (final || bell) {
    // riso ghost on the hot digits
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = bell ? C.pink : C.mustard; ctx.globalAlpha = 0.85;
    ctx.fillText(txt, 6, 5);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = bell ? C.pinkInk : C.ink;
  ctx.fillText(txt, 0, 0);
  ctx.restore();
  // the round as a bar: the final minute hatched in mustard, a playhead
  const bx = lx, by = y0 + 252, bw = CLK.w - 150 - 88, bh = 26;
  rrect(ctx, bx, by, bw, bh, 6); ctx.fillStyle = C.paper; ctx.fill();
  ctx.save(); rrect(ctx, bx, by, bw, bh, 6); ctx.clip();
  ctx.fillStyle = C.mustard; ctx.fillRect(bx + bw * 0.8, by, bw * 0.2, bh);
  ctx.strokeStyle = 'rgba(30,27,46,0.35)'; ctx.lineWidth = 2;
  for (let hx = bx + bw * 0.8 - 30; hx < bx + bw; hx += 9) { ctx.beginPath(); ctx.moveTo(hx, by + bh); ctx.lineTo(hx + 26, by); ctx.stroke(); }
  const k = 1 - v / 300;
  ctx.fillStyle = C.ink; ctx.globalAlpha = 0.85; ctx.fillRect(bx, by, bw * k, bh);
  ctx.restore();
  rrect(ctx, bx, by, bw, bh, 6); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.stroke();
  font(ctx, 15, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2;
  ctx.fillText('5:00', bx, by + bh + 26);
  ctx.textAlign = 'right'; ctx.fillText('BELL', bx + bw, by + bh + 26);
  ctx.fillStyle = C.mustardInk; ctx.textAlign = 'center'; ctx.fillText('LAST MINUTE', bx + bw * 0.9 - 6, by - 10);
  ctx.textAlign = 'left';
  // the bell, top right, rings at 0:00
  const bk = E.outBack(prog(t, BELL_AT, BELL_AT + 0.25), 2.4);
  if (bk > 0) {
    const gx = x0 + CLK.w - 210, gy = y0 + 92;
    bellGlyph(ctx, gx, gy, bk * 1.1, ring * 0.5, C.mustard);
    ctx.save(); ctx.strokeStyle = C.pinkInk; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const wa = Math.exp(-(t - BELL_AT) * 2.2);
    ctx.globalAlpha = clamp(wa * 1.4);
    for (let i = 0; i < 2; i++) {
      const r = 52 + i * 18 + (t - BELL_AT) * 40;
      ctx.beginPath(); ctx.arc(gx, gy, r, -0.6, 0.25); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, gy, r, Math.PI - 0.25, Math.PI + 0.6); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
function sceneRounds(ctx, t) {
  bg(ctx, t);
  const d = drift(t, 0.8);
  const sh = shake(t, [BELL_AT, 24.0], 14);
  ctx.save();
  ctx.translate(d.x + sh.x, d.y + sh.y);
  const top = receiptTop(t);
  const x0 = RC.cx - RC.w / 2;
  // receipt
  if (top < RC.slot) {
    ctx.save();
    // flutter: tiny sway around the slot
    const sway = Math.sin(t * 2.3) * 0.004 * (1 - receiptFeed(t) * 0.5);
    ctx.translate(RC.cx, RC.slot); ctx.rotate(sway); ctx.translate(-RC.cx, -RC.slot);
    const path = () => {
      ctx.beginPath();
      const zz = 16, n = Math.floor(RC.w / zz);
      ctx.moveTo(x0, RC.slot);
      ctx.lineTo(x0, top + 10);
      for (let i = 0; i <= n; i++) ctx.lineTo(x0 + i * zz, top + (i % 2 ? 0 : 10));
      ctx.lineTo(x0 + RC.w, RC.slot);
      ctx.closePath();
    };
    paperShadow(ctx, path, 1.0, 0.18);
    path(); ctx.fillStyle = C.card; ctx.fill();
    ctx.save(); path(); ctx.clip();
    // thermal print content (local y from the top)
    const ly = (y) => top + y;
    const L = x0 + 46, R = x0 + RC.w - 46;
    ctx.textBaseline = 'alphabetic';
    const row = (y, a, b, o = {}) => {
      font(ctx, o.size || 23, 500, 'mono'); ctx.letterSpacing = '1.5px';
      ctx.fillStyle = o.color || C.ink;
      ctx.textAlign = 'left'; ctx.fillText(a, L, ly(y));
      ctx.textAlign = 'right'; ctx.fillText(b, R, ly(y));
      ctx.textAlign = 'left';
    };
    const rule = (y) => dashed(ctx, L, ly(y), R, ly(y), 'rgba(30,27,46,0.5)', 2, [5, 6]);
    font(ctx, 34, 800, 'display'); ctx.letterSpacing = '0px'; ctx.fillStyle = C.ink; ctx.textAlign = 'center';
    ctx.fillText('ROUND  OVER', RC.cx, ly(92));
    font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2;
    ctx.fillText('PENNY POND  /  TICKET No. 0412', RC.cx, ly(128));
    ctx.textAlign = 'left';
    rule(160);
    row(214, 'ENTRY FEE', '1,000.0');
    row(258, 'TOKENS EATEN', '+750.0');
    row(302, 'TILL AT THE BELL', '1,750.0');
    rule(334);
    row(384, 'PROFIT', '750.0');
    row(428, 'FEE  5% OF PROFIT', '-37.5', { color: C.pinkText });
    rule(462);
    font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink; ctx.fillText('PAID', L, ly(548));
    font(ctx, 88, 800, 'display'); ctx.letterSpacing = '-2px'; ctx.textAlign = 'right';
    ctx.fillText('1,712.5', R, ly(552));
    font(ctx, 19, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.pinkText;
    ctx.fillText('$SLANA', R, ly(584));
    ctx.textAlign = 'left';
    rule(612);
    barcode(ctx, L, ly(646), R - L, 86, 21);
    font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink2; ctx.textAlign = 'center';
    ctx.fillText('ALIVE AT THE BELL', RC.cx, ly(780));
    ctx.fillText('SETTLED ON SOLANA', RC.cx, ly(812));
    ctx.textAlign = 'left';
    // marker underline on the fee line
    const mk = tw(t, 24.25, 24.6, E.inOutCubic);
    if (mk > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = 'rgba(255,79,135,0.55)'; ctx.lineWidth = 20; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(L - 6, ly(420)); ctx.lineTo(L - 6 + (R - L + 12) * mk, ly(420) + Math.sin(mk * 3) * 2); ctx.stroke();
      ctx.restore();
    }
    // print head darkening line at the slot
    const g = ctx.createLinearGradient(0, RC.slot - 60, 0, RC.slot);
    g.addColorStop(0, 'rgba(30,27,46,0)'); g.addColorStop(1, 'rgba(30,27,46,0.22)');
    ctx.fillStyle = g; ctx.fillRect(x0, RC.slot - 60, RC.w, 60);
    ctx.restore();
    RC_STAMP.y = ly(770);
    // PAID stamp (on the receipt)
    stamp(ctx, 'PAID', RC_STAMP.x, RC_STAMP.y, -0.2, t - 24.0, C.tealInk, { size: 54, round: true, mono: true, scale: 1.25 });
    // "2% with a Pass" sticker
    const st = prog(t, 24.6, 24.85);
    if (st > 0) {
      ctx.save();
      const ss = lerp(1.3, 1, E.outBack(st));
      ctx.translate(x0 - 40, ly(486)); ctx.rotate(-0.07); ctx.scale(ss, ss);
      ctx.globalAlpha = clamp(st * 3);
      paperShadow(ctx, () => ticketPath(ctx, -200, -36, 250, 72, 10, 190, 9), 0.6, 0.25);
      ticketPath(ctx, -200, -36, 250, 72, 10, 190, 9); ctx.fillStyle = C.teal; ctx.fill();
      dashed(ctx, -10, -26, -10, 26, 'rgba(255,252,244,0.6)', 2, [4, 4]);
      font(ctx, 30, 800, 'display'); ctx.fillStyle = C.card; ctx.textBaseline = 'middle';
      ctx.fillText('2%', -184, 2);
      font(ctx, 15, 500, 'mono'); ctx.letterSpacing = '2px';
      ctx.fillText('WITH A PASS', -126, 2);
      ctx.restore();
      tape(ctx, x0 - 220, ly(458), 90, 32, -0.4, prog(t, 24.68, 24.85));
    }
    ctx.restore();
  } else {
    RC_STAMP.y = RC.slot - 230;
  }
  // printer body (front), in ink
  ctx.save();
  const px = RC.cx - 400;
  paperShadow(ctx, () => rrect(ctx, px, RC.slot - 14, 800, 140, 26), 1.3, 0);
  rrect(ctx, px, RC.slot - 14, 800, 140, 26); ctx.fillStyle = C.ink; ctx.fill();
  ctx.fillStyle = '#0f0d18'; ctx.fillRect(RC.cx - RC.w / 2 - 20, RC.slot - 6, RC.w + 40, 12);
  font(ctx, 16, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.nightInk2; ctx.textBaseline = 'middle';
  ctx.fillText('SLANA  /  ROUND OVER', px + 40, RC.slot + 50);
  const busy = t > 22.45 && t < 23.95;
  ctx.fillStyle = busy && Math.sin(t * 30) > 0 ? C.mustard : t > 23.95 ? C.green : '#3a3550';
  ctx.beginPath(); ctx.arc(px + 760, RC.slot + 48, 8, 0, TAU); ctx.fill();
  ctx.restore();
  // the round clock rides on top until it swings away
  drawRoundClock(ctx, t);
  ctx.restore();

  kicker(ctx, 'ROUNDS  /  5 MINUTES', 150, 300, t, 20.45, { out: 25.45 });
  headline(ctx, [
    { text: 'Five-minute rounds.', at: 20.75 },
    { text: 'Alive at the bell?', at: 22.4 },
    { text: 'Get paid.', at: 23.0, color: C.pink },
  ], 150, 440, t, { size: 96, out: 25.45 });
  ctx.save(); ctx.globalAlpha = tw(t, 23.4, 23.8) * (1 - tw(t, 25.45, 25.7));
  font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Everyone alive at the bell keeps their till.', 154, 760);
  ctx.fillText('Fee on profit only: 5%, or 2% with a Pass.', 154, 794);
  ctx.restore();
  hud(ctx, t, 4, false, tw(t, 20.45, 20.85) * (1 - tw(t, 25.6, 25.8)));
}

/* ───────────── 6. BOTS (25.75 – 31.2), night print ───────────── */
const LOOT = (() => {
  const r = rng(77), out = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU, v = 260 + r() * 820;
    out.push({ a, v: v * 1.1, s: 12 + r() * 10, spin: r() * 10, d: r() * 0.06 });
  }
  return out;
})();
const BOT_EAT = 28.8;
function lootPos(p, t) {
  const dt = Math.max(0, t - BOT_EAT - p.d);
  const k = (1 - Math.exp(-3.4 * dt)) / 3.4;
  return { x: 1330 + Math.cos(p.a) * p.v * k, y: 690 + Math.sin(p.a) * p.v * k * 0.62, dt };
}
function sceneBots(ctx, t) {
  bg(ctx, t, C.night, true);
  // a lighter dot screen for night print
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = 'screen';
  const pd = ctx.createPattern(TEX.dots, 'repeat');
  ctx.fillStyle = pd; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const d = drift(t, 0.8);
  const sh = shake(t, [BOT_EAT], 12);
  ctx.save();
  ctx.translate(d.x + sh.x, d.y + sh.y);
  // map grid
  ctx.save();
  ctx.strokeStyle = 'rgba(241,234,219,0.06)'; ctx.lineWidth = 1.5;
  for (let x = 1000; x < W + 40; x += 64) { ctx.beginPath(); ctx.moveTo(x - (t * 6) % 64, 0); ctx.lineTo(x - (t * 6) % 64, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(1000, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  // player (Penny) with tokens
  const pa = t < BOT_EAT ? 1 : 0;
  const shiver = Math.sin(t * 40) * 2.5 * tw(t, 27.3, 27.7);
  const ppx = 1330 + shiver, ppy = 690 + Math.sin(t * 2.6) * 5;
  // bot drifts in
  const app = E.inOutCubic(prog(t, 26.8, BOT_EAT));
  let bx = lerp(1900, 1470, app), by = lerp(480, 620, app) + Math.sin(t * 1.8) * 6;
  const bite = prog(t, BOT_EAT - 0.12, BOT_EAT);
  bx = lerp(bx, 1400, E.inQuad(bite));
  if (t > BOT_EAT) { const sp = spring(t - BOT_EAT, 1.6, 4); bx = lerp(1400, 1560, sp); by = lerp(640, 520, sp) + Math.sin(t * 1.8) * 6; }
  const br = 165;
  // loot
  if (t >= BOT_EAT) {
    shockDots(ctx, ppx, ppy, t - BOT_EAT, C.mustard, 700, 0.5);
    LOOT.forEach((p, i) => {
      const q = lootPos(p, t);
      // collectors eat some of the loot later
      const eatenAt = S.lootEaten ? S.lootEaten[i] : null;
      let a = 1, s = 1;
      if (eatenAt != null && t > eatenAt) { const k = prog(t, eatenAt, eatenAt + 0.12); s = 1 - k; a = 1 - k; }
      const pop = q.dt < 0.2 ? E.outBack(q.dt / 0.2) : 1;
      lootCoin(ctx, q.x, q.y, p.s * pop * s, a, p.spin + q.dt * 14 * Math.exp(-q.dt * 1.5));
    });
  }
  if (pa) {
    coin(ctx, ppx, ppy, { look: LOOK.player, r: 100, expr: t > 27.4 ? 'scared' : 'happy', lookX: 0.8, lookY: -0.4, time: t, seed: 2 });
    chip(ctx, 'DAPHNE  1,750 $SLANA', ppx, ppy - 150, { align: 'center', size: 16, color: C.nightInk, fill: 'rgba(38,35,49,0.9)' });
  }
  burst(ctx, ppx, ppy, t - BOT_EAT, { seed: 9, n: 24, speed: 900, colors: [C.mustard, C.pink, C.card] });
  // collectors (two small players) sweep through the loot
  const cols = [
    { look: LOOK.b3, r: 54, t0: 29.85, t1: 30.75, from: [1960, 940], to: [1120, 560], seed: 5 },
    { look: LOOK.b1, r: 46, t0: 30.0, t1: 30.9, from: [1060, 1120], to: [1700, 520], seed: 6 },
  ];
  if (!S.lootEaten) {
    // which loot gets eaten by which collector, and when (precomputed path test)
    S.lootEaten = LOOT.map(() => null);
    cols.forEach((c) => {
      for (let k = 0; k <= 60; k++) {
        const tt = lerp(c.t0, c.t1, k / 60);
        const e = E.inOutCubic(k / 60);
        const x = lerp(c.from[0], c.to[0], e), y = lerp(c.from[1], c.to[1], e) + Math.sin(e * 5) * 40;
        LOOT.forEach((p, i) => {
          if (S.lootEaten[i] != null) return;
          const q = lootPos(p, tt);
          if (Math.hypot(q.x - x, q.y - y) < c.r + 14) S.lootEaten[i] = tt;
        });
      }
    });
  }
  cols.forEach((c, ci) => {
    if (t < c.t0 || t > c.t1 + 0.6) return;
    const e = E.inOutCubic(prog(t, c.t0, c.t1));
    const x = lerp(c.from[0], c.to[0], e), y = lerp(c.from[1], c.to[1], e) + Math.sin(e * 5) * 40;
    const eaten = S.lootEaten.filter((v) => v != null && v < t && v >= c.t0 && v <= c.t1).length;
    coin(ctx, x, y, { look: c.look, r: c.r + eaten * 0.6, expr: 'hungry', lookX: c.to[0] > c.from[0] ? 0.8 : -0.8, lookY: 0, time: t, seed: c.seed });
  });
  // bot
  coin(ctx, bx, by, { look: LOOK.bot, r: br, expr: t > BOT_EAT && t < BOT_EAT + 0.5 ? 'proud' : 'hungry', lookX: -0.9, lookY: 0.3, time: t, seed: 8, sx: 1 + bite * 0.08, sy: 1 - bite * 0.06 });
  antenna(ctx, bx, by, br, t, true);
  chip(ctx, 'BOT  0 $SLANA', bx, by + br + 44, { align: 'center', size: 16, color: C.nightInk2, dash: [5, 4], fill: 'rgba(27,25,36,0.9)' });
  if (t > BOT_EAT + 0.1) {
    const k = tw(t, BOT_EAT + 0.1, BOT_EAT + 0.4, E.outBack);
    ctx.save(); ctx.globalAlpha = clamp(k) * (1 - tw(t, 30.2, 30.5));
    font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.mustard; ctx.textAlign = 'center';
    ctx.fillText('1,750 $SLANA ON THE FLOOR', 1330, 690 + 290 + (1 - k) * 20);
    ctx.restore();
  }
  ctx.restore();
  kicker(ctx, 'BOTS  /  ZERO VALUE', 150, 330, t, 26.55, { color: C.nightInk, out: 30.35 });
  headline(ctx, [
    { text: 'Bots carry no value.', at: 26.75, color: C.nightInk },
    { text: 'Their kills spill loot.', at: 28.9, color: C.nightPink },
  ], 150, 480, t, { size: 96, out: 30.35 });
  hud(ctx, t, 5, true, tw(t, 26.6, 27.0));
}

/* ───────────── 7. PASS (30.55 – 37.2) ───────────── */
const PB = { w: 390, h: 540 }; // passport, closed
function drawEnvelope(ctx, t, x, y, rot, flapOpen, part) {
  const w = 680, h = 420;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  if (part === 'back') {
    paperShadow(ctx, () => rrect(ctx, -w / 2, -h / 2, w, h, 14), 1.3, 0.25);
    rrect(ctx, -w / 2, -h / 2, w, h, 14); ctx.fillStyle = '#EFE4CC'; ctx.fill();
    // open flap (behind, flipped up)
    if (flapOpen > 0.5) {
      const k = (flapOpen - 0.5) * 2;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(0, -h / 2 - h * 0.55 * k); ctx.closePath();
      ctx.fillStyle = '#E6D9BD'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,27,46,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    }
  } else {
    // front pocket
    ctx.save();
    rrect(ctx, -w / 2, -h / 2, w, h, 14); ctx.clip();
    ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + 30); ctx.lineTo(0, 30); ctx.lineTo(w / 2, -h / 2 + 30); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
    ctx.fillStyle = C.card; ctx.fill();
    ctx.strokeStyle = 'rgba(30,27,46,0.18)'; ctx.lineWidth = 2; ctx.stroke();
    // airmail border
    ctx.lineWidth = 14;
    for (let i = -40; i < 80; i++) {
      ctx.strokeStyle = i % 2 ? C.pink : C.teal;
      ctx.setLineDash([26, 26 * 3]);
      ctx.lineDashOffset = -i * 0;
    }
    ctx.setLineDash([]);
    const stripe = (x1, y1, x2, y2) => {
      const len = Math.hypot(x2 - x1, y2 - y1), n = Math.floor(len / 36);
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 0.55) / n;
        ctx.strokeStyle = i % 2 ? C.pink : C.blue;
        ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(lerp(x1, x2, a), lerp(y1, y2, a)); ctx.lineTo(lerp(x1, x2, b), lerp(y1, y2, b)); ctx.stroke();
      }
    };
    stripe(-w / 2 + 6, h / 2 - 6, w / 2 - 6, h / 2 - 6);
    stripe(-w / 2 + 6, -h / 2 + 30, -w / 2 + 6, h / 2 - 6);
    stripe(w / 2 - 6, -h / 2 + 30, w / 2 - 6, h / 2 - 6);
    ctx.restore();
    font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
    ctx.fillText('TO: YOU, PLAYER ONE', -w / 2 + 60, 110);
    ctx.fillText('FREE MINT  /  SLANA PASS', -w / 2 + 60, 145);
    ctx.fillStyle = 'rgba(30,27,46,0.4)'; ctx.fillRect(-w / 2 + 60, 160, 300, 2);
    // postage stamp with the coin
    ctx.save();
    ctx.translate(w / 2 - 120, 90);
    ctx.rotate(0.05);
    ctx.fillStyle = C.card; ctx.strokeStyle = C.ink2; ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]); ctx.fillRect(-56, -66, 112, 132); ctx.strokeRect(-56, -66, 112, 132); ctx.setLineDash([]);
    ctx.fillStyle = '#DDF2E8'; ctx.fillRect(-46, -56, 92, 112);
    coin(ctx, 0, 6, { look: LOOK.b0, r: 30, expr: 'happy', time: t });
    ctx.restore();
    // closed flap
    if (flapOpen <= 0.5) {
      const k = 1 - flapOpen * 2;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(0, -h / 2 + h * 0.55 * k); ctx.closePath();
      ctx.fillStyle = '#F6EEDC'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,27,46,0.22)'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  ctx.restore();
}
function waxSeal(ctx, x, y, r, broken, t) {
  const halves = broken > 0 ? [-1, 1] : [0];
  halves.forEach((side) => {
    ctx.save();
    const k = broken;
    ctx.translate(x + side * k * 90, y + k * k * 380);
    ctx.rotate(side * k * 1.4);
    ctx.globalAlpha = 1 - prog(k, 0.6, 1);
    if (side !== 0) { ctx.beginPath(); ctx.rect(side < 0 ? -r * 1.3 : 0, -r * 1.3, r * 1.3, r * 2.6); ctx.clip(); }
    blobPath(ctx, 0, 0, r, 3, 0.08, 60);
    ctx.fillStyle = C.pinkInk; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, TAU); ctx.strokeStyle = 'rgba(30,27,46,0.35)'; ctx.lineWidth = 3; ctx.stroke();
    font(ctx, r * 0.9, 800, 'display'); ctx.fillStyle = '#9e1846'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('S', 0, 4);
    ctx.restore();
  });
}
function drawPassportCover(ctx, w, h) {
  rrect(ctx, 0, 0, w, h, 18); ctx.fillStyle = C.cover; ctx.fill();
  ctx.save(); rrect(ctx, 0, 0, w, h, 18); ctx.clip();
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
  for (let x = 6; x < w; x += 9) for (let y = 6; y < h; y += 9) { ctx.beginPath(); ctx.arc(x + ((y / 9) % 2) * 4, y, 1.1, 0, TAU); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = C.mustard; ctx.lineWidth = 2.5;
  rrect(ctx, 18, 18, w - 36, h - 36, 10); ctx.stroke();
  ctx.fillStyle = C.mustard; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '8px';
  ctx.fillText('SEASON 01', w / 2 + 4, 92);
  // emblem
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(w / 2, h * 0.43, 74, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2, h * 0.43, 52, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - 40, h * 0.43 - 90); ctx.lineTo(w / 2 - 28, h * 0.43 - 120); ctx.lineTo(w / 2 - 12, h * 0.43 - 100); ctx.lineTo(w / 2, h * 0.43 - 128); ctx.lineTo(w / 2 + 12, h * 0.43 - 100); ctx.lineTo(w / 2 + 28, h * 0.43 - 120); ctx.lineTo(w / 2 + 40, h * 0.43 - 90); ctx.closePath();
  ctx.fill();
  font(ctx, 74, 800, 'display'); ctx.letterSpacing = '-1px';
  ctx.fillText('SLANA', w / 2, h * 0.76);
  font(ctx, 24, 500, 'mono'); ctx.letterSpacing = '12px';
  ctx.fillText('PASS', w / 2 + 6, h * 0.76 + 46);
  font(ctx, 16, 500, 'mono'); ctx.letterSpacing = '4px';
  ctx.fillText('No. 0412', w / 2 + 2, h - 44);
  ctx.textAlign = 'left';
}
function drawPassportPage(ctx, w, h, side, t) {
  rrect(ctx, 0, 0, w, h, side === 'L' ? [18, 0, 0, 18] : [0, 18, 18, 0]);
  ctx.fillStyle = C.card; ctx.fill();
  ctx.save(); ctx.clip();
  // guilloche-ish lines
  ctx.strokeStyle = 'rgba(14,156,154,0.10)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 18; i++) { ctx.beginPath(); for (let x = 0; x <= w; x += 8) { const y = 40 + i * 30 + Math.sin(x / 36 + i) * 8; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
  // spine shading
  const g = side === 'L' ? ctx.createLinearGradient(w - 40, 0, w, 0) : ctx.createLinearGradient(0, 0, 40, 0);
  g.addColorStop(side === 'L' ? 0 : 1, 'rgba(30,27,46,0)'); g.addColorStop(side === 'L' ? 1 : 0, 'rgba(30,27,46,0.16)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  if (side === 'R') {
    font(ctx, 16, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
    ctx.fillText('HOLDER', 34, 50);
    font(ctx, 34, 800, 'display'); ctx.letterSpacing = '-0.5px'; ctx.fillStyle = C.ink;
    ctx.fillText('Daphne', 34, 88);
    const s = 300;
    ctx.save();
    ctx.translate(w / 2 - s / 2, 118);
    ctx.drawImage(S.passCard, 0, 0, s, s);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(0, 0, s, s);
    ctx.restore();
    font(ctx, 15, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink2;
    ctx.fillText('<<SLANA<PASS<<0412<<<<<<<', 34, h - 60);
    ctx.fillText('<<FREE<MINT<<SEASON<01<<<', 34, h - 34);
  } else {
    font(ctx, 16, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
    ctx.fillText('PERKS', 34, 50);
  }
}
const PERKS = [
  ['PASS ROOMS', C.pinkInk, -0.12, 0.30, 0.22, false, 34.8],
  ['2% FEE', C.tealInk, 0.10, 0.70, 0.36, true, 34.2],
  ['SEASON PRIZES', C.blue, -0.05, 0.42, 0.52, false, 36.0],
  ['+15% START', C.mustardInk, 0.16, 0.36, 0.70, false, 35.4],
  ['COIN LOOK', C.red, -0.14, 0.58, 0.86, false, 36.6],
];
function scenePass(ctx, t) {
  bg(ctx, t);
  const d = drift(t, 0.8);
  const sh = shake(t, [31.45], 6);
  ctx.save();
  ctx.translate(d.x + sh.x, d.y + sh.y);
  const ex = 1330, ey = 660;
  // envelope arrival / exit
  const arr = prog(t, 30.95, 31.45);
  const ea = E.outBack(arr, 1.2);
  let envX = lerp(2300, ex, ea), envY = lerp(1300, ey, ea), envR = lerp(0.5, -0.04, ea);
  const fall = E.inBack(prog(t, 32.95, 33.4), 1.2);
  envY += fall * 900; envR += fall * 0.3;
  const flap = tw(t, 32.45, 32.8, E.inOutCubic);
  // passport: slides out of the envelope then moves to the stage
  const out = E.outCubic(prog(t, 32.6, 33.05));
  const toStage = E.inOutExpo(prog(t, 32.95, 33.45));
  const open = E.inOutCubic(prog(t, 33.3, 33.85));
  const bookS = lerp(lerp(0.85, 0.95, out), 1.22, toStage);
  // closed book centre → open spread centre
  const stageX = 1310, stageY = 540;
  const inEnvX = envX, inEnvY = envY - out * 230;
  const bx = lerp(inEnvX, stageX + PB.w * 0.5 * (1 - open) * 0 , toStage) ;
  const by = lerp(inEnvY, stageY, toStage);
  if (t >= 30.95 && t < 33.45) drawEnvelope(ctx, t, envX, envY, envR, flap, 'back');
  // passport (clip to above the envelope pocket while inside)
  if (t >= 32.55) {
    ctx.save();
    if (toStage < 0.05) {
      ctx.translate(envX, envY); ctx.rotate(envR);
      ctx.beginPath(); ctx.rect(-400, -900, 800, 900 + 30); ctx.clip();
      ctx.rotate(-envR); ctx.translate(-envX, -envY);
    }
    ctx.translate(bx, by);
    ctx.rotate(lerp(envR, 0, toStage));
    ctx.scale(bookS, bookS);
    // book geometry: spine at x = 0 when open; closed book spans 0..w (shifted -w/2 to centre)
    const shift = lerp(-PB.w / 2, 0, open);
    ctx.translate(shift, -PB.h / 2);
    const cxs = Math.cos(open * Math.PI);
    const left = Math.min(0, cxs) * PB.w;
    paperShadow(ctx, () => rrect(ctx, left, 0, PB.w - left, PB.h, 18), 1.1 * (0.6 + toStage * 0.4), 0.25);
    // right page (always under the cover)
    if (open > 0) drawPassportPage(ctx, PB.w, PB.h, 'R', t);
    // cover / left page rotating around the spine (x = 0)
    const ang = open * Math.PI;
    const cx = Math.cos(ang);
    ctx.save();
    if (cx > 0) {
      ctx.scale(cx, 1);
      drawPassportCover(ctx, PB.w, PB.h);
      // shade as it turns
      ctx.fillStyle = `rgba(0,0,0,${0.35 * (1 - cx)})`; rrect(ctx, 0, 0, PB.w, PB.h, 18); ctx.fill();
    } else {
      ctx.scale(cx, 1);
      // the inside of the cover is the left page, mirrored back
      ctx.translate(PB.w, 0); ctx.scale(-1, 1);
      drawPassportPage(ctx, PB.w, PB.h, 'L', t);
      ctx.fillStyle = `rgba(30,27,46,${0.25 * (1 + cx)})`; ctx.fillRect(0, 0, PB.w, PB.h);
    }
    ctx.restore();
    // perks stamps on the left page
    if (open >= 1) {
      PERKS.forEach(([txt, col, rot, fx, fy, round, at]) => {
        stamp(ctx, txt, -PB.w + PB.w * fx, PB.h * fy, rot, t - at, col, { size: round ? 30 : 34, mono: true, round, specks: true, scale: round ? 1.2 : 0.95 });
      });
    }
    ctx.restore();
  }
  if (t >= 30.95 && t < 33.45) {
    drawEnvelope(ctx, t, envX, envY, envR, flap, 'front');
    // wax seal on the flap tip
    if (t < 33.2) {
      ctx.save(); ctx.translate(envX, envY); ctx.rotate(envR);
      waxSeal(ctx, 0, -210 + 420 * 0.55 * (1 - Math.min(1, flap * 2)), 40, E.inQuad(prog(t, 32.4, 33.1)), t);
      ctx.restore();
    }
  }
  burst(ctx, envX, envY - 210 + 231, t - 32.4, { seed: 12, n: 18, speed: 500, colors: [C.pinkInk, C.pink], size: 7, life: 0.8 });
  burst(ctx, stageX - 200, 300, t - 33.8, { seed: 14, n: 36, speed: 900, size: 11, life: 1.4 });
  ctx.restore();

  kicker(ctx, 'SLANA PASS  /  FREE MINT', 150, 340, t, 31.0);
  headline(ctx, [
    { text: 'Free to mint.', at: 31.6 },
    { text: 'Plays better.', at: 32.1, color: C.pink },
  ], 150, 490, t, { size: 110 });
  ctx.save(); ctx.globalAlpha = tw(t, 33.6, 34.0);
  font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ['Pass rooms. A 2% fee.', 'Season prizes.', '+15% head start, your own coin.'].forEach((s, i) => ctx.fillText(s, 154, 650 + i * 36));
  ctx.restore();
  hud(ctx, t, 6, false, tw(t, 31.4, 31.8));
}

/* ───────────── 8. SEASON (36.85 – 42.0) ───────────── */
const NAMES = ['pennyhunter', 'ser_sprinkles', 'hodl_hamster', 'blinky_block', 'lambo_luna', 'puffy_pda', 'muffin_mev', 'gm_gummy', 'jelly_bean', 'diamond_dot'];
const SHARES = ['30%', '20%', '14%', '10%', '8%', '6%', '4.5%', '3%', '2.5%', '2%'];
const SHARE_V = [30, 20, 14, 10, 8, 6, 4.5, 3, 2.5, 2];
const SB = { x: 1150, y: 120, w: 640, row: 74 };
const POOL = { x: 150, y: 560, w: 760, h: 300 };
function sceneSeason(ctx, t) {
  bg(ctx, t);
  const d = drift(t, 0.8);
  ctx.save();
  ctx.translate(d.x, d.y);
  const exitX = E.inBack(prog(t, 41.35, 41.85), 1.3) * 900;
  // standings sheet
  ctx.save();
  ctx.translate(exitX, 0);
  const sh = SB.row * 10 + 150;
  paperShadow(ctx, () => rrect(ctx, SB.x, SB.y, SB.w, sh, 14), 1.1, 0.25);
  rrect(ctx, SB.x, SB.y, SB.w, sh, 14); ctx.fillStyle = C.card; ctx.fill();
  font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ctx.fillText('STANDINGS  /  SEASON 01', SB.x + 36, SB.y + 52);
  ctx.textAlign = 'right'; ctx.fillText('PRIZE', SB.x + SB.w - 36, SB.y + 52); ctx.textAlign = 'left';
  ctx.fillStyle = C.ink; ctx.fillRect(SB.x + 36, SB.y + 72, SB.w - 72, 3);
  for (let i = 0; i < 10; i++) {
    const at = 37.4 + i * 0.1;
    const k = prog(t, at, at + 0.25);
    if (k <= 0) continue;
    const y = SB.y + 120 + i * SB.row;
    ctx.save();
    ctx.globalAlpha = E.outCubic(k);
    ctx.translate(0, (1 - E.outCubic(k)) * 14);
    // arrival flash
    const arrive = 40.5 + i * 0.05;
    const fl = t > arrive ? Math.exp(-(t - arrive) * 4) : 0;
    const barW = (SB.w - 72) * (SHARE_V[i] / 30) * tw(t, arrive - 0.05, arrive + 0.35, E.outCubic);
    ctx.fillStyle = 'rgba(242,183,5,0.28)';
    ctx.fillRect(SB.x + 36, y - 26, barW, 52);
    if (fl > 0) { ctx.fillStyle = `rgba(255,79,135,${0.25 * fl})`; ctx.fillRect(SB.x + 36, y - 26, SB.w - 72, 52); }
    const rc = i === 0 ? C.pink : i === 1 ? C.mustard : i === 2 ? C.teal : null;
    ctx.beginPath(); ctx.arc(SB.x + 60, y, 19, 0, TAU);
    if (rc) { ctx.fillStyle = rc; ctx.fill(); }
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    font(ctx, 20, 800, 'display'); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), SB.x + 60, y + 1);
    ctx.textAlign = 'left';
    coin(ctx, SB.x + 112, y, { look: LOOK['b' + ((i * 3) % 8)], r: 20, expr: 'happy', time: t + i, seed: i });
    font(ctx, 28, 700, 'display'); ctx.letterSpacing = '-0.3px'; ctx.fillStyle = C.ink;
    ctx.fillText(NAMES[i], SB.x + 148, y + 2);
    font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '1px'; ctx.textAlign = 'right';
    ctx.fillStyle = fl > 0.1 ? C.pinkText : C.ink;
    ctx.fillText(SHARES[i], SB.x + SB.w - 36, y + 2);
    ctx.textAlign = 'left';
    if (i < 9) dashed(ctx, SB.x + 36, y + SB.row / 2, SB.x + SB.w - 36, y + SB.row / 2, C.line, 1.2, [3, 5]);
    ctx.restore();
  }
  ctx.restore();
  // pool ticket (morphs into the fee bar on exit)
  const mo = E.inOutExpo(prog(t, 41.35, 42.0));
  const px = lerp(POOL.x, 150, mo), py = lerp(POOL.y, 560, mo), pw = lerp(POOL.w, 1620, mo), ph = lerp(POOL.h, 160, mo);
  const pin = E.outBack(prog(t, 37.6, 38.0), 1.2);
  if (pin > 0) {
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2); ctx.scale(pin, pin); ctx.translate(-px - pw / 2, -py - ph / 2);
    paperShadow(ctx, () => ticketPath(ctx, px, py, pw, ph, 18, pw - 170 * (1 - mo), 20), 1.1, 0.3);
    ticketPath(ctx, px, py, pw, ph, 18, pw - 170 * (1 - mo), 20); ctx.fillStyle = C.card; ctx.fill();
    ctx.save(); ctx.globalAlpha = 1 - E.inCubic(mo); ctx.fillStyle = C.mustard; ctx.fill(); ctx.restore();
    const ca = 1 - tw(t, 41.35, 41.6);
    ctx.globalAlpha = ca;
    dashed(ctx, px + pw - 170, py + 28, px + pw - 170, py + ph - 28, 'rgba(30,27,46,0.45)', 2.5, [7, 7]);
    font(ctx, 20, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    ctx.fillText('SEASON POOL', px + 44, py + 62);
    const v = 84200 * E.outCubic(prog(t, 38.2, 39.8));
    odometer(ctx, v, px + 40, py + 210, 150, { color: C.ink });
    font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink;
    ctx.fillText('$SLANA', px + 48, py + 262);
    ctx.save(); ctx.translate(px + pw - 85, py + ph / 2); ctx.rotate(-Math.PI / 2);
    font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.textAlign = 'center';
    ctx.fillText('TOP 10 SPLIT', 0, 6);
    ctx.restore();
    ctx.restore();
  }
  // payout streams: coins fly from the pool to each row
  for (let i = 0; i < 10; i++) {
    const t0 = 40.15 + i * 0.05, t1 = 40.5 + i * 0.05;
    for (let j = 0; j < 4; j++) {
      const tt = prog(t, t0 + j * 0.03, t1 + j * 0.03);
      if (tt <= 0 || tt >= 1) continue;
      const e = E.inOutCubic(tt);
      const sx = POOL.x + POOL.w - 80, sy = POOL.y + 60;
      const tx = SB.x + SB.w - 100, ty = SB.y + 120 + i * SB.row;
      const x = lerp(sx, tx, e), y = lerp(sy, ty, e) - Math.sin(e * Math.PI) * (160 + i * 8);
      lootCoin(ctx, x, y, 11, 1, tt * 12 + j);
    }
  }
  ctx.restore();
  kicker(ctx, 'SEASON 01  /  TOP 10', 150, 200, t, 37.4, { out: 41.25 });
  headline(ctx, [
    { text: 'Play the season.', at: 37.55 },
    { text: 'Top 10 split the pool.', at: 38.55, color: C.pink },
  ], 150, 340, t, { size: 88, out: 41.25 });
  hud(ctx, t, 7, false, 1);
}

/* ───────────── 9. SPLIT (41.35 – 46.8) ───────────── */
const BAR = { x: 150, y: 560, w: 1620, h: 160 };
const SEG = [
  { p: 0.5, col: C.teal, txt: C.card, label: 'TREASURY', at: 41.8 },
  { p: 0.3, col: C.mustard, txt: C.ink, label: 'SEASON POOL', at: 42.2 },
  { p: 0.2, col: C.pink, txt: C.ink, label: 'BURNED', at: 42.6 },
];
const BURN_AT = 44.4;
function burnFront(ctx, cx, cy, R, seed, t) {
  blobPath(ctx, cx, cy, R, seed, 0.22, 160, t * 2);
}
function sceneSplit(ctx, t, own = true) {
  if (own) bg(ctx, t);
  const d = drift(t, 0.8);
  ctx.save();
  ctx.translate(d.x, d.y);
  // bar shell (ticket, perforated between segments)
  const segX = [];
  let acc = BAR.x;
  SEG.forEach((s) => { segX.push(acc); acc += BAR.w * s.p; });
  const shellA = tw(t, 41.8, 41.95);
  ctx.save();
  ctx.globalAlpha = shellA;
  paperShadow(ctx, () => rrect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 18), 1.1, 0.3);
  rrect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 18); ctx.fillStyle = C.card; ctx.fill();
  ctx.restore();
  SEG.forEach((s, i) => {
    const x = segX[i], w = BAR.w * s.p;
    const k = spring(t - s.at, 1.3, 6.5);
    if (t < s.at) return;
    ctx.save();
    // burned segment: carve a growing hole
    rrect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 18); ctx.clip();
    ctx.beginPath(); ctx.rect(x, BAR.y, w * clamp(k, 0, 1.03), BAR.h); ctx.clip();
    ctx.fillStyle = s.col; ctx.fillRect(x, BAR.y, w, BAR.h);
    // halftone texture on the ink
    ctx.globalAlpha = 0.14; ctx.fillStyle = C.ink;
    for (let xx = x + 6; xx < x + w; xx += 10) for (let yy = BAR.y + 6; yy < BAR.y + BAR.h; yy += 10) { ctx.beginPath(); ctx.arc(xx + ((yy / 10) % 2) * 5, yy, 1.4, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    // percent
    const pv = Math.round(s.p * 100 * E.outCubic(prog(t, s.at, s.at + 0.5)));
    font(ctx, 104, 800, 'display'); ctx.letterSpacing = '-3px'; ctx.fillStyle = s.txt; ctx.textBaseline = 'alphabetic';
    ctx.fillText(pv + '%', x + 30, BAR.y + BAR.h - 34);
    ctx.restore();
    // perforation + notches between segments
    if (i > 0) {
      dashed(ctx, x, BAR.y + 22, x, BAR.y + BAR.h - 22, 'rgba(30,27,46,0.55)', 3, [8, 8]);
    }
    // label
    const la = tw(t, s.at + 0.1, s.at + 0.4);
    ctx.save(); ctx.globalAlpha = la;
    font(ctx, 20, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s.label, x + 4, BAR.y + BAR.h + 52);
    font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2;
    ctx.fillText(['runs the game', 'paid to the top 10', 'gone for good'][i], x + 4, BAR.y + BAR.h + 84);
    ctx.restore();
  });
  // notches
  [segX[1], segX[2]].forEach((x) => {
    if (shellA <= 0) return;
    ctx.save(); ctx.globalAlpha = shellA;
    ctx.fillStyle = C.paper;
    ctx.beginPath(); ctx.arc(x, BAR.y, 16, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, BAR.y + BAR.h, 16, 0, TAU); ctx.fill();
    ctx.restore();
  });
  // the burn
  const bx = segX[2] + BAR.w * 0.1, by = BAR.y + BAR.h / 2;
  const bt = t - BURN_AT;
  if (bt > 0) {
    const R = 10 + E.outCubic(clamp(bt / 1.3)) * 150 + Math.max(0, t - 45.9) * 0;
    ctx.save();
    rrect(ctx, BAR.x, BAR.y - 4, BAR.w, BAR.h + 8, 18); ctx.clip();
    // char ring + glow
    burnFront(ctx, bx, by, R + 14, 5, t);
    ctx.fillStyle = 'rgba(30,27,46,0.85)'; ctx.fill();
    burnFront(ctx, bx, by, R + 6, 5, t);
    ctx.fillStyle = C.orange; ctx.fill();
    burnFront(ctx, bx, by, R + 2, 5, t);
    ctx.fillStyle = C.mustard; ctx.fill();
    burnFront(ctx, bx, by, R, 5, t);
    ctx.fillStyle = C.paper; ctx.fill();
    // fibre in the hole (we see the paper under the ticket)
    ctx.restore();
    // embers
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const life = 0.9 + r() * 0.8, start = r() * 2.2;
      const lt = bt - start;
      if (lt < 0 || lt > life) continue;
      const a = r() * TAU;
      const x = bx + Math.cos(a) * (R * 0.9) + Math.sin(lt * 5 + i) * 10;
      const y = by + Math.sin(a) * (R * 0.6) - lt * (120 + r() * 140);
      ctx.fillStyle = i % 3 ? C.orange : C.mustard;
      ctx.globalAlpha = 1 - lt / life;
      ctx.beginPath(); ctx.arc(x, y, 2 + r() * 3.5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    stamp(ctx, 'BURNED', bx + 10, by - 110, -0.12, t - 44.7, C.red, { size: 48, mono: true });
  }
  // footer
  const fa = tw(t, 43.7, 44.0);
  if (fa > 0) {
    ctx.save(); ctx.globalAlpha = fa;
    kicker(ctx, 'NO TEAM MONEY PAYS REWARDS  /  TOKENS MOVE BETWEEN PLAYERS', 150, 900, t, 43.7, { size: 19, ls: 3, dotColor: C.teal });
    ctx.restore();
  }
  ctx.restore();
  kicker(ctx, 'WHERE THE FEE GOES', 150, 230, t, 41.8);
  headline(ctx, [
    { text: 'One fee, three ways.', at: 41.95 },
    { text: 'A fifth is burned.', at: 43.55, color: C.pink },
  ], 150, 370, t, { size: 96 });
  if (own) hud(ctx, t, 8, false, 1);
}

/* ───────────── 10. END (45.9 – 52.8) ───────────── */
function sceneEnd(ctx, t) {
  bg(ctx, t, C.night, true);
  ctx.save();
  ctx.globalAlpha = 0.45; ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = ctx.createPattern(TEX.dots, 'repeat'); ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const d = drift(t, 0.7);
  const sh = shake(t, [46.8], 12);
  const push = 1 + 0.04 * E.inOutCubic(prog(t, 46.8, 52.8));
  ctx.save();
  ctx.translate(W / 2 + d.x + sh.x, H / 2 + d.y + sh.y); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  const size = 260;
  const m = wordmarkMetrics(ctx, size);
  const lx = W / 2 - m.total / 2, ly = 500;
  const slam = t - 46.8;
  const reg = t < 46.8 ? 1 : 1 - spring(slam, 1.4, 5.5);
  const s0 = slam < 0 ? 1.15 : slam < 0.25 ? lerp(1.15, 1, E.outExpo(slam / 0.25)) : 1;
  ctx.save();
  ctx.translate(W / 2, ly - size * 0.3); ctx.scale(s0, s0); ctx.translate(-W / 2, -(ly - size * 0.3));
  if (t >= 46.8) wordmark(ctx, lx, ly, size, { reg, layers: clamp(slam / 0.08), dark: true, color: C.nightInk });
  ctx.restore();
  shockDots(ctx, W / 2, ly - 80, slam, C.pink, 1100, 0.45);
  // tagline words
  const words = [['Eat.', 47.95, C.nightInk], ['Grow.', 48.4, C.nightInk], ['Last the round.', 48.83, C.pink]];
  font(ctx, 84, 800, 'display'); ctx.letterSpacing = '-2.4px';
  const sp = 30;
  const ws = words.map(([w]) => ctx.measureText(w).width);
  let x = W / 2 - (ws.reduce((a, b) => a + b, 0) + sp * 2) / 2;
  words.forEach(([w, at, col], i) => {
    const k = prog(t, at, at + 0.4);
    if (k > 0) {
      const s = E.outBack(k, 2.2);
      ctx.save();
      ctx.translate(x + ws[i] / 2, 660); ctx.scale(s, s); ctx.rotate((1 - k) * (i % 2 ? 0.1 : -0.1));
      font(ctx, 84, 800, 'display'); ctx.letterSpacing = '-2.4px';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = col;
      ctx.globalAlpha = clamp(k * 3);
      ctx.fillText(w, 0, 0);
      ctx.restore();
    }
    x += ws[i] + sp;
  });
  // URL ticket + ticker chip
  const uk = E.outBack(prog(t, 49.6, 50.05), 1.4);
  if (uk > 0) {
    const tw0 = 600, th = 104, tx = W / 2 - tw0 / 2, ty = 760 + (1 - uk) * 60;
    ctx.save();
    ctx.globalAlpha = clamp(uk * 2);
    paperShadow(ctx, () => ticketPath(ctx, tx, ty, tw0, th, 12, tw0 - 170, 12), 0.9, 0.3);
    ticketPath(ctx, tx, ty, tw0, th, 12, tw0 - 190, 13); ctx.fillStyle = C.card; ctx.fill();
    dashed(ctx, tx + tw0 - 190, ty + 18, tx + tw0 - 190, ty + th - 18, C.line, 2.5, [6, 6]);
    font(ctx, 54, 800, 'display'); ctx.letterSpacing = '-1px'; ctx.fillStyle = C.ink; ctx.textBaseline = 'middle';
    ctx.fillText('slana.xyz', tx + 44, ty + th / 2 + 2);
    font(ctx, 26, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.pinkText; ctx.textAlign = 'center';
    ctx.fillText('$SLANA', tx + tw0 - 95, ty + th / 2 + 2);
    ctx.restore();
  }
  ctx.restore();
  // coins peeking from the bottom edge
  [[300, 0, 50.5, 'b1', 0.15], [560, 1, 50.62, 'b4', -0.1], [1380, 2, 50.74, 'b5', 0.08], [1640, 3, 50.86, 'b3', -0.12]].forEach(([x, i, at, lk, rot]) => {
    const k = spring(t - at, 1.6, 5);
    if (t < at) return;
    const y = H + 70 - k * 130 + Math.sin(t * 2.2 + i) * 6;
    coin(ctx, x, y, { look: LOOK[lk], r: 78, expr: i % 2 ? 'love' : 'happy', lookX: x < W / 2 ? 0.6 : -0.6, lookY: -0.8, time: t + i, seed: i, rot });
  });
  ctx.save(); ctx.globalAlpha = tw(t, 50.6, 51.0);
  font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '5px'; ctx.fillStyle = C.nightInk2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FREE PRACTICE ROOM OPEN  /  PLAY ON SOLANA', W / 2, 920);
  ctx.restore();
  hud(ctx, t, 9, true, tw(t, 50.6, 51.0));
}

/* ───────────── composition: scenes + transitions ───────────── */
function pageTurn(ctx, t, a, b, drawA, drawB) {
  // fold sweeps right → left; the page being turned shows its cream back
  const p = E.inOutCubic(prog(t, a, b));
  const ang = -0.16;
  const fx = lerp(W + 80, -W * 0.9, p);
  drawA();
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(ang); ctx.translate(-W / 2, -H / 2);
  // revealed new page (right of the fold)
  ctx.save();
  ctx.beginPath(); ctx.rect(fx, -600, W * 3, H + 1200); ctx.clip();
  ctx.translate(W / 2, H / 2); ctx.rotate(-ang); ctx.translate(-W / 2, -H / 2);
  drawB();
  ctx.restore();
  // shadow cast on the new page by the flap
  const sg = ctx.createLinearGradient(fx, 0, fx + 160, 0);
  sg.addColorStop(0, 'rgba(30,27,46,0.32)'); sg.addColorStop(1, 'rgba(30,27,46,0)');
  ctx.fillStyle = sg; ctx.fillRect(fx, -600, 160, H + 1200);
  // crease highlight
  ctx.fillStyle = 'rgba(255,252,244,0.55)'; ctx.fillRect(fx - 3, -600, 3, H + 1200);
  // flap (back of the turning page), mirrored to the left of the fold
  const fw = Math.min((W + 400 - fx) * 0.55, fx + 900);
  if (fw > 0) {
    ctx.beginPath(); ctx.rect(fx - fw, -600, fw, H + 1200);
    const fg = ctx.createLinearGradient(fx - fw, 0, fx, 0);
    fg.addColorStop(0, '#E4D8BE'); fg.addColorStop(0.35, C.card); fg.addColorStop(0.8, '#EFE6D3'); fg.addColorStop(1, '#C9BEA5');
    ctx.fillStyle = fg; ctx.fill();
    // flap edge shadow on the old page
    const eg = ctx.createLinearGradient(fx - fw - 60, 0, fx - fw, 0);
    eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = eg; ctx.fillRect(fx - fw - 60, -600, 60, H + 1200);
  }
  ctx.restore();
}

window.SCENE_DRAW = (ctx, t) => {
  if (t < 4.8) return sceneHook(ctx, t);
  if (t < 13.55) return sceneTicket(ctx, t);
  if (t < 20.1) return scenePlay(ctx, t);
  if (t < 20.5) {
    // paper feeds up over the montage
    scenePlay(ctx, t);
    const p = E.inOutCubic(prog(t, 20.1, 20.5));
    const y = lerp(H + 40, -40, p);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y, W, H + 200); ctx.clip();
    sceneRounds(ctx, t);
    ctx.restore();
    // torn edge
    ctx.save();
    ctx.fillStyle = C.paper;
    ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, y - ((x / 24) % 2 ? 12 : 0));
    ctx.lineTo(W, y + 2); ctx.lineTo(0, y + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(30,27,46,0.18)'; ctx.fillRect(0, y - 26, W, 14);
    ctx.restore();
    return;
  }
  if (t < 25.75) return sceneRounds(ctx, t);
  if (t < 26.4) {
    sceneRounds(ctx, t);
    const p = E.inCubic(prog(t, 25.75, 26.4));
    const R = 20 + p * 2400;
    ctx.save();
    blobPath(ctx, RC_STAMP.x, RC_STAMP.y, R, 21, 0.12, 140, t * 3);
    ctx.clip();
    sceneBots(ctx, t);
    ctx.restore();
    // droplets
    const r = rng(41);
    ctx.fillStyle = C.night;
    for (let i = 0; i < 26; i++) {
      const a = r() * TAU, dd = R * (1.02 + r() * 0.12);
      ctx.beginPath(); ctx.arc(RC_STAMP.x + Math.cos(a) * dd, RC_STAMP.y + Math.sin(a) * dd, 3 + r() * 10 * (0.4 + p), 0, TAU); ctx.fill();
    }
    return;
  }
  if (t < 30.5) return sceneBots(ctx, t);
  if (t < 31.25) return pageTurn(ctx, t, 30.5, 31.25, () => sceneBots(ctx, t), () => scenePass(ctx, t));
  if (t < 36.85) return scenePass(ctx, t);
  if (t < 37.35) {
    // whip pan from the Pass desk to the season desk
    const p = E.inOutExpo(prog(t, 36.85, 37.35));
    ctx.save(); ctx.translate(-W * p, 0); scenePass(ctx, t); ctx.restore();
    ctx.save(); ctx.translate(W * (1 - p), 0); sceneSeason(ctx, t); ctx.restore();
    return;
  }
  if (t < 41.35) return sceneSeason(ctx, t);
  if (t < 42.0) {
    // the fee bar starts filling inside the morphing pool ticket, so the frame is never empty
    sceneSeason(ctx, t);
    if (t >= 41.75) sceneSplit(ctx, t, false);
    return;
  }
  if (t < 45.9) return sceneSplit(ctx, t);
  if (t < 46.8) {
    sceneSplit(ctx, t);
    const p = E.inCubic(prog(t, 45.9, 46.8));
    const bx = BAR.x + BAR.w * 0.9, by = BAR.y + BAR.h / 2;
    const R = 160 + p * 2300;
    // charred rim then the end card inside the hole
    ctx.save();
    burnFront(ctx, bx, by, R + 34, 5, t); ctx.fillStyle = 'rgba(30,27,46,0.9)'; ctx.fill();
    burnFront(ctx, bx, by, R + 16, 5, t); ctx.fillStyle = C.orange; ctx.fill();
    burnFront(ctx, bx, by, R + 6, 5, t); ctx.fillStyle = C.mustard; ctx.fill();
    burnFront(ctx, bx, by, R, 5, t); ctx.clip();
    sceneEnd(ctx, t);
    ctx.restore();
    return;
  }
  return sceneEnd(ctx, t);
};

window.SCENE_DARK = (t) => (t >= 26.1 && t < 30.9) || t >= 46.5;

window.SCENE_BLUR = (t) => {
  // subframe motion blur on the fast moves only
  const win = [
    [2.1, 2.5, 5, 0.012], // lunge + gulp
    [3.72, 4.62, 5, 0.012], // coin flies to the mark
    [7.75, 8.7, 8, 0.009], // pull back
    [12.6, 13.6, 6, 0.014], // dive
    [14.4, 14.75, 4, 0.01], // frame slam
    [20.1, 20.5, 5, 0.012], // paper feed wipe
    [30.95, 31.45, 4, 0.01], // envelope in
    [32.95, 33.45, 5, 0.012],
    [36.85, 37.35, 14, 0.014], // whip pan
    [41.35, 42.0, 4, 0.01],
  ];
  for (const [a, b, k, s] of win) if (t >= a && t <= b) return { k, shutter: s };
  return { k: 1, shutter: 0 };
};

window.SCENE_ASSETS = (t) => {
  const urls = [];
  if (t >= 11.4 && t < 13.55) urls.push(footUrl('A', t - 11.4));
  if (t >= 13.55 && t < 20.5) { const sh = shotAt(t); urls.push(footUrl(sh.id, t - sh.t0)); }
  return urls;
};

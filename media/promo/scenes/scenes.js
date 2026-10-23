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
  const fps = sh.fps || 30;
  const n = clamp(Math.floor(Math.max(0, lt) * fps + 1e-6), 0, Math.round(sh.dur * fps) - 1) + 1;
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
  ctx.fillText('SLANA  /  ON-CHAIN COIN ARENAS', 64, H - 46);
  ctx.textAlign = 'right';
  ctx.fillText(String(idx).padStart(2, '0') + ' / 07', W - 64 - 96, H - 46);
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
  ctx.strokeStyle = 'rgba(27,23,50,0.45)'; ctx.lineWidth = Math.max(1, r * 0.1);
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
  LOOK.bot = { body: '#9A95AE', overprint: '#3055FC', offset: { dx: 3, dy: 3 }, symbol: 'bolt', eyes: 'sleepy', mouth: 'flat', accessory: 'none', special: null };
  S.shots = {};
  (TL.footage || []).forEach((s) => (S.shots[s.id] = s));
  // the cold open's coin track (output px per footage frame), written by render/footage-from-takes.mjs
  S.track = {};
  for (const s of TL.footage || []) {
    try { const r = await fetch(`/cache/footage/${s.id}/track.json`); if (r.ok) S.track[s.id] = await r.json(); } catch {}
  }
};
/** Where the hero coin is in footage shot `id` at local time lt: {x, y, r} (output px). */
function trackAt(id, lt) {
  const tr = S.track[id];
  if (!tr || !tr.length) return { x: W / 2, y: H / 2, r: 80 };
  const fps = S.shots[id].fps || 30;
  const f = clamp(lt * fps, 0, tr.length - 1);
  const i = Math.floor(f), k = f - i;
  const a = tr[i], b = tr[Math.min(tr.length - 1, i + 1)];
  return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), r: lerp(a[2], b[2], k) };
}

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
    const pv = TL.hook2?.purse || [1200, 2950];
    const v = lerp(pv[0], pv[1], E.outCubic(prog(t, T_GULP + 0.08, T_GULP + 0.9)));
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
  kicker(ctx, 'ON-CHAIN COIN ARENAS  /  SOLANA', 150, 300, t, 0.2, { out: 3.55 });
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
  ctx.fillText('5-MIN ROUND', x0 + 170, y0 + 520);
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
    ctx.strokeStyle = 'rgba(27,23,50,0.55)'; ctx.lineWidth = 3; ctx.stroke();
    const g = ctx.createRadialGradient(TK_HOLE.x, TK_HOLE.y - 6, TK_HOLE.r * 0.6, TK_HOLE.x, TK_HOLE.y, TK_HOLE.r);
    g.addColorStop(0, 'rgba(27,23,50,0)'); g.addColorStop(1, 'rgba(27,23,50,0.35)');
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
  dashed(ctx, x0 + CLK.w - 150, y0 + 30, x0 + CLK.w - 150, y0 + CLK.h - 30, 'rgba(27,23,50,0.45)', 2.5, [7, 7]);
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
  ctx.strokeStyle = 'rgba(27,23,50,0.35)'; ctx.lineWidth = 2;
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
    const rule = (y) => dashed(ctx, L, ly(y), R, ly(y), 'rgba(27,23,50,0.5)', 2, [5, 6]);
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
      ctx.strokeStyle = 'rgba(251,47,133,0.55)'; ctx.lineWidth = 20; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(L - 6, ly(420)); ctx.lineTo(L - 6 + (R - L + 12) * mk, ly(420) + Math.sin(mk * 3) * 2); ctx.stroke();
      ctx.restore();
    }
    // print head darkening line at the slot
    const g = ctx.createLinearGradient(0, RC.slot - 60, 0, RC.slot);
    g.addColorStop(0, 'rgba(27,23,50,0)'); g.addColorStop(1, 'rgba(27,23,50,0.22)');
    ctx.fillStyle = g; ctx.fillRect(x0, RC.slot - 60, RC.w, 60);
    ctx.restore();
    RC_STAMP.y = ly(770);
    // PAID stamp (on the receipt)
    stamp(ctx, 'PAID', RC_STAMP.x, RC_STAMP.y, -0.2, t - 24.0, C.tealInk, { size: 54, round: true, mono: true, scale: 1.25 });
    // "flat 5%" sticker
    const st = prog(t, 24.6, 24.85);
    if (st > 0) {
      ctx.save();
      const ss = lerp(1.3, 1, E.outBack(st));
      ctx.translate(x0 - 40, ly(486)); ctx.rotate(-0.07); ctx.scale(ss, ss);
      ctx.globalAlpha = clamp(st * 3);
      paperShadow(ctx, () => ticketPath(ctx, -200, -36, 250, 72, 10, 190, 9), 0.6, 0.25);
      ticketPath(ctx, -200, -36, 250, 72, 10, 190, 9); ctx.fillStyle = C.teal; ctx.fill();
      dashed(ctx, -10, -26, -10, 26, 'rgba(255,253,246,0.6)', 2, [4, 4]);
      font(ctx, 30, 800, 'display'); ctx.fillStyle = C.card; ctx.textBaseline = 'middle';
      ctx.fillText('5%', -184, 2);
      font(ctx, 15, 500, 'mono'); ctx.letterSpacing = '2px';
      ctx.fillText('FLAT FEE', -120, 2);
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
  ctx.fillText('A flat 5% fee, on profit only.', 154, 794);
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
  ctx.strokeStyle = 'rgba(252,244,223,0.06)'; ctx.lineWidth = 1.5;
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
    chip(ctx, 'DAPHNE  1,750 $SLANA', ppx, ppy - 150, { align: 'center', size: 16, color: C.nightInk, fill: 'rgba(37,31,61,0.9)' });
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
  chip(ctx, 'BOT  0 $SLANA', bx, by + br + 44, { align: 'center', size: 16, color: C.nightInk2, dash: [5, 4], fill: 'rgba(25,20,46,0.9)' });
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

/* ───────────── 7. ARENAS (30.55 – 37.2) ───────────── */
// Four arena tickets are dealt onto the desk, one per beat, each in its own riso ink with its
// entry fee; an OPEN stamp lands on each. Every arena is open to everyone; only the fee differs.
const ARENAS = [
  { name: 'Penny Pond', fee: '1,000', ink: () => C.red, at: 31.45, stampAt: 34.2 },
  { name: 'Silver Creek', fee: '10,000', ink: () => C.teal, at: 32.05, stampAt: 34.8 },
  { name: 'Gold Lake', fee: '50,000', ink: () => C.mustard, at: 32.65, stampAt: 35.4 },
  { name: 'Whale Bay', fee: '250,000', ink: () => C.blue, at: 33.25, stampAt: 36.0 },
];
const AT = { x: 1010, y: 170, w: 760, h: 158, gap: 30 };
function drawArenaTicket(ctx, a, i, t) {
  const x = AT.x, y = AT.y + i * (AT.h + AT.gap), w = AT.w, h = AT.h;
  const stubX = w - 250;
  paperShadow(ctx, () => ticketPath(ctx, x, y, w, h, 14, stubX, 14), 1.0, 0.28);
  ticketPath(ctx, x, y, w, h, 14, stubX, 14); ctx.fillStyle = C.card; ctx.fill();
  ctx.save(); ticketPath(ctx, x, y, w, h, 14, stubX, 14); ctx.clip();
  // the arena's ink stripe, with a misregistered second pass
  ctx.fillStyle = a.ink(); ctx.fillRect(x, y, 30, h);
  ctx.restore();
  ticketPath(ctx, x, y, w, h, 14, stubX, 14); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
  dashed(ctx, x + stubX, y + 22, x + stubX, y + h - 22, 'rgba(27,23,50,0.45)', 2.5, [7, 7]);
  font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText(`ARENA ${i + 1}`, x + 64, y + 48);
  font(ctx, 62, 800, 'display'); ctx.letterSpacing = '-1.5px'; ctx.fillStyle = C.ink;
  ctx.fillText(a.name, x + 60, y + 122);
  ctx.textAlign = 'center';
  font(ctx, 16, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2;
  ctx.fillText('ENTRY', x + stubX + 125, y + 44);
  font(ctx, a.fee.length > 6 ? 54 : 60, 800, 'display'); ctx.letterSpacing = '-1.5px'; ctx.fillStyle = C.ink;
  ctx.fillText(a.fee, x + stubX + 125, y + 102);
  font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.pinkText;
  ctx.fillText('$SLANA', x + stubX + 125, y + 134);
  ctx.textAlign = 'left';
  stamp(ctx, 'OPEN', x + stubX - 82, y + 48, -0.1 + i * 0.04, t - a.stampAt, C.tealInk, { size: 30, mono: true });
}
function sceneArenas(ctx, t) {
  bg(ctx, t);
  const d = drift(t, 0.8);
  ctx.save();
  ctx.translate(d.x, d.y);
  ARENAS.forEach((a, i) => {
    const k = spring(t - a.at, 1.5, 6.2);
    if (t < a.at - 0.2) return;
    const fly = 1 - clamp(E.outCubic(prog(t, a.at - 0.2, a.at + 0.05)));
    const cx = AT.x + AT.w / 2, cy = AT.y + i * (AT.h + AT.gap) + AT.h / 2;
    ctx.save();
    // in the cut the tickets clear off for the arena posters (posterWall)
    const gone = TL.cut ? E.inCubic(prog(t, 34.45 + i * 0.05, 34.8 + i * 0.05)) : 0;
    ctx.translate(cx + fly * 1100 + gone * 1300, cy - fly * 160 - gone * 60);
    const rot = (i % 2 ? 1 : -1) * 0.012 + fly * 0.25 + (1 - clamp(k, 0, 1.2)) * 0.04 + gone * 0.2;
    ctx.rotate(rot);
    const s = lerp(1.06, 1, clamp(k, 0, 1));
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    drawArenaTicket(ctx, a, i, t);
    ctx.restore();
  });
  ctx.restore();
  kicker(ctx, 'ARENAS  /  OPEN TO EVERYONE', 150, 300, t, 31.1, { out: 36.7 });
  headline(ctx, [
    { text: 'Four arenas.', at: 31.4 },
    { text: 'Pick your stakes.', at: 32.5, color: C.pink },
  ], 150, 450, t, { size: 96, out: 36.7 });
  ctx.save(); ctx.globalAlpha = tw(t, 34.0, 34.4) * (1 - tw(t, 36.6, 36.85));
  font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Same game in every room.', 154, 640);
  ctx.fillText('Only the entry fee differs.', 154, 674);
  ctx.restore();
  hud(ctx, t, 5, false, 1);
}

/* ───────────── 8. JOIN (36.85 – 41.6) ───────────── */
// A lobby row with a running round: JOIN. Then the death sheet: "Buy back in", same fee.
const JR = { x: 1010, y: 190, w: 760, h: 230 };
const JD = { x: 1050, y: 500, w: 680, h: 330 };
function sceneJoin(ctx, t) {
  bg(ctx, t);
  const d = drift(t, 0.8);
  ctx.save();
  ctx.translate(d.x, d.y);
  // lobby row: a round already running
  const k1 = E.outBack(prog(t, 37.35, 37.75), 1.2);
  if (k1 > 0) {
    ctx.save();
    ctx.translate(JR.x + JR.w / 2, JR.y + JR.h / 2); ctx.scale(k1, k1); ctx.rotate(-0.015); ctx.translate(-JR.x - JR.w / 2, -JR.y - JR.h / 2);
    paperShadow(ctx, () => rrect(ctx, JR.x, JR.y, JR.w, JR.h, 16), 1.0, 0.28);
    rrect(ctx, JR.x, JR.y, JR.w, JR.h, 16); ctx.fillStyle = C.card; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.fillStyle = C.red; ctx.fillRect(JR.x + 2, JR.y + 16, 24, JR.h - 32);
    font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
    ctx.fillText('PENNY POND  /  23 PLAYERS', JR.x + 60, JR.y + 50);
    font(ctx, 26, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink;
    ctx.fillText('ROUND ENDS IN', JR.x + 60, JR.y + 104);
    const left = 192 - Math.floor(Math.max(0, t - 37.35));
    font(ctx, 96, 800, 'display'); ctx.letterSpacing = '-3px'; ctx.fillStyle = C.ink;
    ctx.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, JR.x + 56, JR.y + 196);
    stamp(ctx, 'JOIN', JR.x + JR.w - 170, JR.y + JR.h / 2 + 6, -0.14, t - 38.15, C.pinkInk, { size: 58, mono: true });
    ctx.restore();
  }
  // death sheet: buy back in
  const k2 = E.outBack(prog(t, 38.95, 39.35), 1.2);
  if (k2 > 0) {
    ctx.save();
    ctx.translate(JD.x + JD.w / 2, JD.y + JD.h / 2); ctx.scale(k2, k2); ctx.rotate(0.02); ctx.translate(-JD.x - JD.w / 2, -JD.y - JD.h / 2);
    paperShadow(ctx, () => rrect(ctx, JD.x, JD.y, JD.w, JD.h, 18), 1.2, 0.3);
    rrect(ctx, JD.x, JD.y, JD.w, JD.h, 18); ctx.fillStyle = C.card; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
    font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.pinkText; ctx.textBaseline = 'alphabetic';
    ctx.fillText('EATEN BY MOCHI_MOON', JD.x + 44, JD.y + 56);
    font(ctx, 60, 800, 'display'); ctx.letterSpacing = '-1.5px'; ctx.fillStyle = C.ink;
    ctx.fillText('Same round.', JD.x + 40, JD.y + 130);
    ctx.fillText('Same fee.', JD.x + 40, JD.y + 192);
    coin(ctx, JD.x + JD.w - 110, JD.y + 120, { look: LOOK.player, r: 62, expr: t > 40.2 ? 'proud' : 'scared', time: t, seed: 3 });
    // the ink button, pressed on the beat
    const press = t > 39.95 && t < 40.15 ? 4 : 0;
    const bx = JD.x + 40, by = JD.y + 226 + press, bw = JD.w - 80, bh = 74;
    rrect(ctx, bx + 6 - press, by + 6 - press, bw, bh, 14); ctx.fillStyle = C.ink; ctx.fill();
    rrect(ctx, bx, by, bw, bh, 14); ctx.fillStyle = C.pink; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
    font(ctx, 34, 800, 'display'); ctx.letterSpacing = '0px'; ctx.fillStyle = C.ink; ctx.textBaseline = 'middle';
    ctx.fillText('Buy back in', bx + 30, by + bh / 2 + 2);
    font(ctx, 20, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.textAlign = 'right';
    ctx.fillText('1,000 $SLANA', bx + bw - 30, by + bh / 2 + 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    stamp(ctx, 'BACK IN', JD.x + JD.w - 180, JD.y + 170, 0.12, t - 40.2, C.tealInk, { size: 50, mono: true });
    ctx.restore();
  }
  ctx.restore();
  kicker(ctx, 'LATE JOIN  /  BUY BACK IN', 150, 300, t, 37.4, { out: 41.1 });
  headline(ctx, [
    { text: 'Join mid-round.', at: 37.55 },
    { text: 'Eaten? Buy back in.', at: 38.95, color: C.pink },
  ], 150, 450, t, { size: 92, out: 41.1 });
  ctx.save(); ctx.globalAlpha = tw(t, 39.4, 39.8) * (1 - tw(t, 41.1, 41.35));
  font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Joins close in the final minute;', 154, 640);
  ctx.fillText('a ticket bought then joins the next round.', 154, 674);
  ctx.restore();
  hud(ctx, t, 7, false, 1);
}

/* ───────────── 9. FEE (41.35 – 46.8) ───────────── */
// One flat fee: 5% of profit, paid to the operator. Then the floor-loot stub catches fire:
// loot left on the floor at the bell is burned. The fire burns through to the end card.
const BAR = { x: 150, y: 470, w: 1620, h: 150 };
const SEG = [
  { p: 0.95, col: C.teal, txt: C.ink, label: 'YOU KEEP', sub: '95% of your profit', at: 42.0 },
  { p: 0.05, col: C.pink, txt: C.ink, label: 'FEE  5%', sub: 'paid to the operator', at: 42.6 },
];
const LS = { x: 1170, y: 750, w: 600, h: 170 };
const BURN_AT = 44.4;
const BURN_C = { x: LS.x + LS.w * 0.42, y: LS.y + LS.h / 2 };
function burnFront(ctx, cx, cy, R, seed, t) {
  blobPath(ctx, cx, cy, R, seed, 0.22, 160, t * 2);
}
function sceneFee(ctx, t, own = true) {
  if (own) bg(ctx, t);
  const d = drift(t, 0.8);
  ctx.save();
  ctx.translate(d.x, d.y);
  const segX = [];
  let acc = BAR.x;
  SEG.forEach((s) => { segX.push(acc); acc += BAR.w * s.p; });
  const shellA = tw(t, 41.4, 41.6);
  ctx.save();
  ctx.globalAlpha = shellA;
  paperShadow(ctx, () => rrect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 18), 1.1, 0.3);
  rrect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 18); ctx.fillStyle = C.card; ctx.fill();
  font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink2; ctx.textBaseline = 'alphabetic';
  ctx.fillText('YOUR PROFIT AT THE BELL', BAR.x + 4, BAR.y - 22);
  ctx.restore();
  SEG.forEach((s, i) => {
    const x = segX[i], w = BAR.w * s.p;
    if (t < s.at) return;
    const k = spring(t - s.at, 1.3, 6.5);
    ctx.save();
    rrect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 18); ctx.clip();
    ctx.beginPath(); ctx.rect(x, BAR.y, w * clamp(k, 0, 1.03), BAR.h); ctx.clip();
    ctx.fillStyle = s.col; ctx.fillRect(x, BAR.y, w, BAR.h);
    ctx.globalAlpha = 0.14; ctx.fillStyle = C.ink;
    for (let xx = x + 6; xx < x + w; xx += 10) for (let yy = BAR.y + 6; yy < BAR.y + BAR.h; yy += 10) { ctx.beginPath(); ctx.arc(xx + ((yy / 10) % 2) * 5, yy, 1.4, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (i === 0) {
      const pv = Math.round(95 * E.outCubic(prog(t, s.at, s.at + 0.5)));
      font(ctx, 104, 800, 'display'); ctx.letterSpacing = '-3px'; ctx.fillStyle = s.txt; ctx.textBaseline = 'alphabetic';
      ctx.fillText(pv + '%', x + 30, BAR.y + BAR.h - 34);
    }
    ctx.restore();
    if (i > 0) dashed(ctx, x, BAR.y + 18, x, BAR.y + BAR.h - 18, 'rgba(27,23,50,0.6)', 3, [8, 8]);
    const la = tw(t, s.at + 0.1, s.at + 0.4);
    ctx.save(); ctx.globalAlpha = la; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    const lx = i === 0 ? x + 4 : BAR.x + BAR.w;
    font(ctx, 22, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = i === 0 ? C.ink : C.pinkText;
    ctx.fillText(s.label, lx, BAR.y + BAR.h + 50);
    font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.ink2;
    ctx.fillText(s.sub, lx, BAR.y + BAR.h + 82);
    ctx.restore();
  });
  // the fee callout: a pink tag pinned on the thin slice
  const ck = E.outBack(prog(t, 42.75, 43.05), 1.6);
  if (ck > 0) {
    const fx = segX[1] + BAR.w * 0.025;
    ctx.save();
    ctx.translate(fx, BAR.y - 70); ctx.rotate(0.05); ctx.scale(ck, ck);
    paperShadow(ctx, () => ticketPath(ctx, -95, -40, 190, 80, 10, 95, 9), 0.6, 0.25);
    ticketPath(ctx, -95, -40, 190, 80, 10, 95, 9); ctx.fillStyle = C.pink; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = C.ink; ctx.stroke();
    font(ctx, 44, 800, 'display'); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('5%', 0, 3);
    ctx.restore();
    ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.globalAlpha = clamp(ck);
    ctx.beginPath(); ctx.moveTo(fx, BAR.y - 30); ctx.lineTo(fx, BAR.y + 6); ctx.stroke(); ctx.restore();
  }
  // the floor-loot stub: loot left on the floor at the bell
  const lk = E.outBack(prog(t, 43.55, 43.95), 1.3);
  if (lk > 0) {
    ctx.save();
    ctx.translate(LS.x + LS.w / 2, LS.y + LS.h / 2); ctx.rotate(-0.025); ctx.scale(lk, lk); ctx.translate(-LS.x - LS.w / 2, -LS.y - LS.h / 2);
    paperShadow(ctx, () => ticketPath(ctx, LS.x, LS.y, LS.w, LS.h, 14, LS.w - 170, 14), 1.0, 0.28);
    ticketPath(ctx, LS.x, LS.y, LS.w, LS.h, 14, LS.w - 170, 14); ctx.fillStyle = C.mustard; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
    dashed(ctx, LS.x + LS.w - 170, LS.y + 20, LS.x + LS.w - 170, LS.y + LS.h - 20, 'rgba(27,23,50,0.5)', 2.5, [7, 7]);
    font(ctx, 18, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    ctx.fillText('FLOOR LOOT AT THE BELL', LS.x + 36, LS.y + 50);
    for (let i = 0; i < 6; i++) lootCoin(ctx, LS.x + 70 + i * 62, LS.y + 108 + (i % 2) * 10, 22, 1, t * 2 + i);
    ctx.save(); ctx.translate(LS.x + LS.w - 85, LS.y + LS.h / 2); ctx.rotate(-Math.PI / 2);
    font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '4px'; ctx.textAlign = 'center'; ctx.fillStyle = C.ink;
    ctx.fillText('UNCLAIMED', 0, 6);
    ctx.restore();
    ctx.restore();
  }
  // the burn
  const bt = t - BURN_AT;
  if (bt > 0) {
    const R = 10 + E.outCubic(clamp(bt / 1.3)) * 140;
    ctx.save();
    rrect(ctx, LS.x - 20, LS.y - 30, LS.w + 40, LS.h + 60, 18); ctx.clip();
    burnFront(ctx, BURN_C.x, BURN_C.y, R + 14, 5, t);
    ctx.fillStyle = 'rgba(27,23,50,0.85)'; ctx.fill();
    burnFront(ctx, BURN_C.x, BURN_C.y, R + 6, 5, t);
    ctx.fillStyle = C.orange; ctx.fill();
    burnFront(ctx, BURN_C.x, BURN_C.y, R + 2, 5, t);
    ctx.fillStyle = C.mustard; ctx.fill();
    burnFront(ctx, BURN_C.x, BURN_C.y, R, 5, t);
    ctx.fillStyle = C.paper; ctx.fill();
    ctx.restore();
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const life = 0.9 + r() * 0.8, start = r() * 2.2;
      const lt = bt - start;
      if (lt < 0 || lt > life) continue;
      const a = r() * TAU;
      const x = BURN_C.x + Math.cos(a) * (R * 0.9) + Math.sin(lt * 5 + i) * 10;
      const y = BURN_C.y + Math.sin(a) * (R * 0.6) - lt * (120 + r() * 140);
      ctx.fillStyle = i % 3 ? C.orange : C.mustard;
      ctx.globalAlpha = 1 - lt / life;
      ctx.beginPath(); ctx.arc(x, y, 2 + r() * 3.5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    stamp(ctx, 'BURNED', LS.x + 120, LS.y - 30, -0.12, t - 44.7, C.red, { size: 48, mono: true });
  }
  const fa = tw(t, 43.3, 43.6);
  if (fa > 0) {
    ctx.save(); ctx.globalAlpha = fa;
    kicker(ctx, 'NO PROFIT, NO FEE', 150, 800, t, 43.3, { size: 22, ls: 4, dotColor: C.teal });
    kicker(ctx, 'LOOT LEFT AT THE BELL IS BURNED', 150, 850, t, 44.5, { size: 22, ls: 4, dotColor: C.red });
    ctx.restore();
  }
  ctx.restore();
  kicker(ctx, 'THE FEE', 150, 180, t, 41.4);
  headline(ctx, [
    { text: 'One flat fee.', at: 41.45 },
    { text: '5% of profit.', at: 42.6, color: C.pink },
  ], 150, 300, t, { size: 92, lh: 0.98 });
  if (own) hud(ctx, t, 6, false, 1);
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
    ctx.fillText('slana.io', tx + 44, ty + th / 2 + 2);
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
  font(ctx, 24, 500, 'mono'); ctx.letterSpacing = '5px'; ctx.fillStyle = C.nightInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('X  @SLANAIO  /  FREE PRACTICE ON SOLANA', W / 2, 920);
  ctx.restore();
  hud(ctx, t, 7, true, tw(t, 50.6, 51.0));
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
  sg.addColorStop(0, 'rgba(27,23,50,0.32)'); sg.addColorStop(1, 'rgba(27,23,50,0)');
  ctx.fillStyle = sg; ctx.fillRect(fx, -600, 160, H + 1200);
  // crease highlight
  ctx.fillStyle = 'rgba(255,253,246,0.55)'; ctx.fillRect(fx - 3, -600, 3, H + 1200);
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

function drawOld(ctx, t) {
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
    ctx.fillStyle = 'rgba(27,23,50,0.18)'; ctx.fillRect(0, y - 26, W, 14);
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
  if (t < 31.25) return pageTurn(ctx, t, 30.5, 31.25, () => sceneBots(ctx, t), () => sceneArenas(ctx, t));
  if (t < 36.85) return sceneArenas(ctx, t);
  if (t < 37.35) {
    // whip pan from the arena desk to the join desk
    const p = E.inOutExpo(prog(t, 36.85, 37.35));
    ctx.save(); ctx.translate(-W * p, 0); sceneArenas(ctx, t); ctx.restore();
    ctx.save(); ctx.translate(W * (1 - p), 0); sceneJoin(ctx, t); ctx.restore();
    return;
  }
  if (t < 41.35) return sceneJoin(ctx, t);
  if (t < 42.0) {
    // paper feeds up from the join desk to the fee desk
    const p = E.inOutCubic(prog(t, 41.35, 41.9));
    ctx.save(); ctx.translate(0, -H * p); sceneJoin(ctx, t); ctx.restore();
    ctx.save(); ctx.translate(0, H * (1 - p)); sceneFee(ctx, t); ctx.restore();
    return;
  }
  if (t < 45.9) return sceneFee(ctx, t);
  if (t < 46.8) return burnThrough(ctx, t, () => sceneEnd(ctx, t));
  return sceneEnd(ctx, t);
};

/** The floor-loot stub burns through the fee desk (45.9 - 46.8); `inside` draws what the hole shows. */
function burnThrough(ctx, t, inside) {
  sceneFee(ctx, t);
  const p = E.inCubic(prog(t, 45.9, 46.8));
  const bx = BURN_C.x, by = BURN_C.y;
  const R = 160 + p * 2300;
  // charred rim then the next scene inside the hole
  ctx.save();
  burnFront(ctx, bx, by, R + 34, 5, t); ctx.fillStyle = 'rgba(27,23,50,0.9)'; ctx.fill();
  burnFront(ctx, bx, by, R + 16, 5, t); ctx.fillStyle = C.orange; ctx.fill();
  burnFront(ctx, bx, by, R + 6, 5, t); ctx.fillStyle = C.mustard; ctx.fill();
  burnFront(ctx, bx, by, R, 5, t); ctx.clip();
  inside();
  ctx.restore();
}

/* ───────────── 11. NFT (cut only: film time, 3.0 s, t = 0 on the drop) ─────────────
 * The plain NFT mention of the NFT kit (media/free-mint/scenes/nft.js, drawBeat `plain`): on the
 * paper stock the three cards are dealt face up, a small "COMING SOON" kicker and "Slana NFTs.".
 * It leaves on an ink flood that becomes the end card's night stock, so the wordmark slams onto
 * the same ink. */
const NFT_OUT = 2.3, NFT_FLOOD = [2.4, 3.0];
function sceneNft(ctx, t) {
  NFT.drawBeat(ctx, t, { out: NFT_OUT, plain: { head: 'Slana NFTs.', layout: { ky: 400, hy1: 600 } }, kicker: 'COMING SOON' });
  const p = E.inCubic(prog(t, NFT_FLOOD[0], NFT_FLOOD[1]));
  if (p <= 0) return;
  const cx = 1470, cy = 540;
  const R = 30 + p * 2300;
  ctx.save();
  blobPath(ctx, cx, cy, R, 33, 0.12, 140, t * 3);
  ctx.fillStyle = C.night; ctx.fill();
  const r = rng(77);
  for (let i = 0; i < 30; i++) {
    const a = r() * TAU, dd = R * (1.03 + r() * 0.14);
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, 3 + r() * 11 * (0.4 + p), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

const darkOld = (t) => (t >= 26.1 && t < 30.9) || t >= 46.5;

function blurOld(t) {
  // subframe motion blur on the fast moves only
  const win = [
    [2.1, 2.5, 5, 0.012], // lunge + gulp
    [3.72, 4.62, 5, 0.012], // coin flies to the mark
    [7.75, 8.7, 8, 0.009], // pull back
    [12.6, 13.6, 6, 0.014], // dive
    [14.4, 14.75, 4, 0.01], // frame slam
    [20.1, 20.5, 5, 0.012], // paper feed wipe
    [31.25, 33.3, 4, 0.01], // tickets dealt
    [36.85, 37.35, 14, 0.014], // whip pan
  ];
  for (const [a, b, k, s] of win) if (t >= a && t <= b) return { k, shutter: s };
  return { k: 1, shutter: 0 };
};

function assetsOld(t) {
  const urls = [];
  if (t >= 11.4 && t < 13.55) urls.push(footUrl('A', t - 11.4));
  if (t >= 13.55 && t < 20.5) { const sh = shotAt(t); urls.push(footUrl(sh.id, t - sh.t0)); }
  return urls;
};

/* ───────────── the cut ─────────────
 * timeline.json "cut" lays the film out: pieces of the scene timeline above (old seconds), the
 * cold open on real footage, and the transitions that join the pieces. Everything below maps the
 * film's time to the scenes. */

/** The purse under the hero coin (ink chip with the $SLANA odometer). */
function purse(ctx, x, y, v, pop = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y); ctx.scale(pop, pop);
  rrect(ctx, -150, -34, 300, 68, 10);
  ctx.fillStyle = C.ink; ctx.fill();
  font(ctx, 40, 800, 'display'); ctx.letterSpacing = '-1px'; ctx.fillStyle = C.card; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(fmt(Math.round(v / 10) * 10), 40, 16); ctx.textAlign = 'left';
  font(ctx, 17, 500, 'mono'); ctx.letterSpacing = '2px'; ctx.fillStyle = C.pink;
  ctx.fillText('$SLANA', 52, 12);
  ctx.restore();
}

/** Cold open (0 - 2.4): real footage. A chase, the gulp on the low F (1.2), the purse jumps, the
 * camera pushes into the coin, which lands where the printed coin of the old hook sits (match cut). */
function sceneHook2(ctx, t) {
  const H2 = TL.hook2;
  const G = H2.gulp;
  const END = H2.end; // the cut into the printed coin
  const me = trackAt(H2.shot, t);
  // push: the footage scales about the coin until it lands on the printed coin's spot and size
  const push = E.inOutCubic(prog(t, END - 0.5, END));
  const tx = lerp(me.x, 1400, push), ty = lerp(me.y, 604, push);
  const sc = lerp(1, 205 / Math.max(20, me.r), push);
  const sh = shake(t, [G], 16, 0.4);
  ctx.save();
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.translate(tx + sh.x, ty + sh.y); ctx.scale(sc, sc); ctx.rotate(sh.r); ctx.translate(-me.x, -me.y);
  drawFoot(ctx, H2.shot, t, 0, 0, W, H, 1);
  ctx.restore();
  // the paper takes over toward the cut (the printed page of the next shot)
  const pa = E.inCubic(prog(t, END - 0.22, END));
  if (pa > 0) {
    ctx.save(); ctx.globalAlpha = pa;
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(1400, 604, 205 * (1 + 0.2 * (1 - pa)), 0, TAU, true); ctx.clip('evenodd');
    bg(ctx, t + 1.2);
    ctx.restore();
  }
  // a paper wash on the left keeps the type readable over the game
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 980, 0);
  g.addColorStop(0, 'rgba(241,234,219,0.92)'); g.addColorStop(0.55, 'rgba(241,234,219,0.7)'); g.addColorStop(1, 'rgba(241,234,219,0)');
  ctx.fillStyle = g; ctx.globalAlpha = 1 - pa; ctx.fillRect(0, 0, 980, H);
  ctx.restore();
  // gulp flash and ink burst
  if (t >= G && t < G + 0.14) { ctx.save(); ctx.globalAlpha = 0.55 * (1 - (t - G) / 0.14); ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  const gp = trackAt(H2.shot, G);
  const gx = (gp.x - me.x) * sc + tx, gy = (gp.y - me.y) * sc + ty;
  burst(ctx, gx, gy, t - G, { seed: 4, n: 34, speed: 900, size: 11 });
  shockDots(ctx, gx, gy, t - G, C.ink, 700, 0.16);
  // the value float: +X rises off the gulp and drops into the purse
  const vf = t - G;
  const gain = H2.purse[1] - H2.purse[0];
  if (vf > 0 && vf < 1.0) {
    const k = E.outCubic(clamp(vf / 0.35));
    const fall = E.inCubic(prog(vf, 0.55, 0.95));
    const fx = lerp(gx + 30, me.x * 0 + tx, fall), fy = lerp(gy - me.r * sc - 40 - 90 * k, ty + me.r * sc + 60, fall);
    const s1 = (0.4 + 0.75 * E.outBack(clamp(vf / 0.3))) * (1 - 0.6 * fall);
    ctx.save();
    ctx.translate(fx, fy); ctx.scale(s1, s1); ctx.rotate(-0.06);
    font(ctx, 128, 800, 'display'); ctx.letterSpacing = '-3px'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const txt = '+' + fmt(gain);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = C.pink; ctx.fillText(txt, 7, 6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 12; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = C.mustard; ctx.fillText(txt, 0, 0);
    font(ctx, 26, 500, 'mono'); ctx.letterSpacing = '3px'; ctx.fillStyle = C.ink;
    ctx.fillText('$SLANA', 0, 84);
    ctx.restore();
  }
  // purse under the coin
  const ca = tw(t, 0.25, 0.5);
  if (ca > 0.01) {
    const v = lerp(H2.purse[0], H2.purse[1], E.outCubic(prog(t, G + 0.55, G + 1.05)));
    const pop = 1 + 0.14 * Math.exp(-(t - G - 0.95) * 6) * (t > G + 0.95 ? 1 : 0);
    purse(ctx, tx, ty + me.r * sc + 60, v, pop, ca);
  }
  // type: the same kicker and headline as the printed hook, so they carry across the cut
  kicker(ctx, 'ON-CHAIN COIN ARENAS  /  SOLANA', 150, 300, t, 0.0, { out: END - 0.05 });
  headline(ctx, [
    { text: 'Eat a player.', at: 0.04 },
    { text: 'Keep their tokens.', at: G + 0.08, color: C.pink },
  ], 150, 470, t, { size: 118, out: END - 0.05, stagger: 0.06 });
  // print marks in the corners from the first frame
  hud(ctx, t, 1, false, 0.9 * (1 - tw(t, END - 0.6, END - 0.3)));
}

/* The four arena posters (brand/posters) dealt onto the board on the beat, in the cut. */
const POSTERS = ['poster-1-penny-pond', 'poster-2-silver-creek', 'poster-3-gold-lake', 'poster-4-whale-bay'];
const POSTER_AT = [34.8, 35.1, 35.4, 35.7];
function posterWall(ctx, t) {
  if (t < POSTER_AT[0] - 0.25) return;
  const w = 286, h = 400;
  POSTERS.forEach((name, i) => {
    const at = POSTER_AT[i];
    if (t < at - 0.25) return;
    const im = getImg(`/brand/posters/${name}.png`);
    const fall = 1 - E.outCubic(clamp(prog(t, at - 0.25, at)));
    const k = spring(t - at, 1.7, 6.5);
    const x = 770 + i * 272 + w / 2, y = 330 + h / 2 + (i % 2) * 26;
    ctx.save();
    ctx.translate(x, y - fall * 900);
    ctx.rotate((i % 2 ? 1 : -1) * 0.035 + fall * 0.3 + (1 - clamp(k, 0, 1.2)) * 0.05);
    const sc = lerp(1.08, 1, clamp(k, 0, 1));
    ctx.scale(sc, sc);
    paperShadow(ctx, () => { ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); }, 1.1, 0.3);
    if (im) ctx.drawImage(im, -w / 2, -h / 2, w, h);
    else { ctx.fillStyle = C.card; ctx.fillRect(-w / 2, -h / 2, w, h); }
    ctx.restore();
    tape(ctx, x - 20, y - h / 2 - 14 - fall * 900, 120, 34, -0.2 + i * 0.12, prog(t, at + 0.05, at + 0.2));
  });
}
const SCENE_FN = {
  rounds: (ctx, t) => sceneRounds(ctx, t),
  arenas: (ctx, t) => { sceneArenas(ctx, t); posterWall(ctx, t); },
  fee: (ctx, t) => sceneFee(ctx, t),
};
const drawScene = (name, ctx, t) => (name ? SCENE_FN[name](ctx, t) : drawOld(ctx, t));

function cutAt(t) {
  const cs = TL.cut;
  for (let i = cs.length - 1; i >= 0; i--) if (t >= cs[i].at - 1e-9) return cs[i];
  return cs[0];
}
window.SCENE_DRAW = (ctx, t) => {
  const c = cutAt(t), lt = t - c.at;
  if (c.kind === 'hook') return sceneHook2(ctx, lt);
  if (c.kind === 'turn') return pageTurn(ctx, lt, 0, c.dur, () => drawScene(c.sa, ctx, c.a + lt), () => drawScene(c.sb, ctx, c.b + lt));
  if (c.kind === 'burn') return burnThrough(ctx, c.a + lt, () => sceneNft(ctx, c.b + lt));
  if (c.kind === 'nft') return sceneNft(ctx, lt);
  if (c.kind === 'whip') {
    const p = E.inOutExpo(prog(lt, 0, c.dur));
    ctx.save(); ctx.translate(-W * p, 0); drawScene(c.sa, ctx, c.a + lt); ctx.restore();
    ctx.save(); ctx.translate(W * (1 - p), 0); drawScene(c.sb, ctx, c.b + lt); ctx.restore();
    return;
  }
  return drawScene(c.scene, ctx, c.old + lt);
};
window.SCENE_DARK = (t) => {
  const c = cutAt(t), lt = t - c.at;
  if (c.kind === 'hook') return false;
  if (c.kind === 'burn') return false;
  if (c.kind === 'nft') return lt > NFT_FLOOD[1] - 0.15;
  if (c.kind) return darkOld(c.b + lt);
  return darkOld(c.old + lt);
};
window.SCENE_BLUR = (t) => {
  const c = cutAt(t), lt = t - c.at;
  if (c.kind === 'hook') {
    const G = TL.hook2.gulp, END = TL.hook2.end;
    if (lt >= G - 0.06 && lt < G + 0.16) return { k: 5, shutter: 0.012 };
    if (lt >= END - 0.45) return { k: 8, shutter: 0.012 };
    return { k: 1, shutter: 0 };
  }
  if (c.kind === 'whip') return { k: 14, shutter: 0.014 };
  if (c.kind === 'turn') return { k: 4, shutter: 0.01 };
  if (c.kind === 'burn') return { k: 1, shutter: 0 };
  if (c.kind === 'nft') {
    // the deal and the way out
    if (lt < 0.5 || lt >= NFT_OUT) return { k: 4, shutter: 0.01 };
    return { k: 1, shutter: 0 };
  }
  return blurOld(c.old + lt);
};
window.SCENE_ASSETS = (t) => {
  const c = cutAt(t), lt = t - c.at;
  if (c.kind === 'hook') return [footUrl(TL.hook2.shot, lt)];
  if (c.kind === 'burn' || c.kind === 'nft') return [];
  const posters = POSTERS.map((n) => `/brand/posters/${n}.png`);
  if (c.kind) return [...assetsOld(c.a + lt), ...assetsOld(c.b + lt), ...(c.sa === 'arenas' || c.sb === 'arenas' ? posters : [])];
  return [...assetsOld(c.old + lt), ...(c.scene === 'arenas' ? posters : [])];
};

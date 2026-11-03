#!/usr/bin/env node
// Renders the graphics layer of the Elymum SOON promo as transparent PNG frames (Ring Storybook style):
// corner bug, kinetic captions, the sun coin creature hopping in and chomping the frame, the jaw wipe,
// and the yellow SOON card (coins and confetti burst, bounce-in title, wordmark, handle).
//
//   node media/promo-soon/overlay.mjs <layout 16x9|9x16> <workdir> [--from s] [--to s] [--every n]
//
// Reads <workdir>/face.json (from beauty.py) so the creature looks at her face; for 9x16 it also writes
// <workdir>/crop916.json (the smoothed horizontal crop the compositor uses). Frames go to <workdir>/ov-<layout>/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFrom, resolveChromium } from '../../scripts/lib/common.mjs';
import { C, baseCss, coin, coinMark, wordmark, star } from '../../brand/lib/art.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cues = JSON.parse(readFileSync(process.env.PROMO_CUES || join(HERE, 'cues.json'), 'utf8'));
const [layoutName = '16x9', work = 'out/promo/work', ...rest] = process.argv.slice(2);
const arg = (k, d) => (rest.includes(k) ? Number(rest[rest.indexOf(k) + 1]) : d);
const FPS = cues.fps;
const T0 = arg('--from', 0);
const T1 = arg('--to', cues.duration);
const EVERY = arg('--every', 1);
const ONLY = rest.includes('--times') ? rest[rest.indexOf('--times') + 1].split(',').map(Number) : null;

/* ------------------------------------------------------------------ layout */
const V = layoutName === '9x16';
const L = V
  ? { w: 1080, h: 1920, ground: 1690, mScale: 1.12, capY: 330, capFont: 50, capMax: 940, bug: [40, 150], bugW: 132, soon: 300, soonY: 860 }
  : { w: 1920, h: 1080, ground: 1052, mScale: 1, capY: 962, capFont: 54, capMax: 1400, bug: [44, 38], bugW: 150, soon: 340, soonY: 470 };

/* face track -> layout coordinates (and the vertical crop) */
const face = JSON.parse(readFileSync(join(work, 'face.json'), 'utf8')).frames;
const SRC_W = 1920, SRC_H = 1080;
const cropW = (SRC_H * 9) / 16; // 607.5
let crop = null;
if (V) {
  // heavy centred smoothing of the face x so the crop glides, never jitters
  const xs = face.map((f) => f.cx);
  const sm = xs.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -30; k <= 30; k++) {
      const j = Math.min(xs.length - 1, Math.max(0, i + k));
      const w = Math.exp(-0.5 * (k / 12) ** 2);
      s += xs[j] * w; n += w;
    }
    return s / n;
  });
  crop = sm.map((cx) => Math.round(Math.min(SRC_W - cropW, Math.max(0, cx - cropW / 2)) * 10) / 10);
  writeFileSync(join(work, 'crop916.json'), JSON.stringify({ cropW, x: crop }));
}
/* her pointing fingertip (hands.py), smoothed; clamped to the tracked window */
let fingerFrames = [];
try {
  const fj = JSON.parse(readFileSync(join(work, 'finger.json'), 'utf8')).frames;
  const P = cues.monster.perch;
  fingerFrames = Object.entries(fj).map(([k, v]) => [Number(k), v.tip])
    .filter(([k]) => k / FPS >= P.land - 0.35 && k / FPS <= P.leave + 0.001).sort((a, b) => a[0] - b[0]);
} catch { /* no track: the creature stays on the floor */ }
function tipAt(t) {
  if (!fingerFrames.length) return [cues.monster.hops.at(-1).x * L.w, L.ground - 300];
  const i = t * FPS;
  let sx = 0, sy = 0, n = 0;
  for (const [k, [x, y]] of fingerFrames) {
    const w = Math.exp(-0.5 * ((k - i) / 2.2) ** 2);
    sx += x * w; sy += y * w; n += w;
  }
  if (n < 1e-6) {
    const near = fingerFrames.reduce((a, b) => (Math.abs(b[0] - i) < Math.abs(a[0] - i) ? b : a));
    return near[1];
  }
  return [sx / n, sy / n];
}
function faceAt(t) {
  const i = Math.min(face.length - 1, Math.max(0, Math.round(t * FPS)));
  const f = face[i];
  if (!V) return [f.cx, f.cy];
  const s = L.h / SRC_H;
  return [(f.cx - crop[i]) * s, f.cy * s];
}

/* ------------------------------------------------------------------ helpers */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u * u;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const backOut = (u, s = 2.2) => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;
const elastic = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 2 ** (-9 * u) * Math.sin(((u * 10 - 0.75) * 2 * Math.PI) / 3.2) + 1);
function rng(seed) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}
const px = (n) => `${n.toFixed(1)}px`;

/* ------------------------------------------------------------------ corner bug */
function bug(t) {
  if (cues.bug === false) return '';
  const end = cues.monster.lunge;
  if (t < 0.4 || t > end + 0.2) return '';
  const u = prog(t, 0.4, 0.85);
  const out = prog(t, end - 0.05, end + 0.2);
  const s = backOut(u) * (1 - easeIn(out));
  const [x, y] = L.bug;
  return `<div class="abs" style="left:${x}px;top:${y}px;transform-origin:0 0;transform:scale(${s.toFixed(3)}) rotate(-2deg)">
    <div class="sticker" style="display:flex;align-items:center;gap:10px;padding:8px 16px 8px 10px;border-radius:999px;border-width:3px;box-shadow:4px 4px 0 var(--ink)">
      ${coinMark(V ? 46 : 50, { shadow: false })}${wordmark({ width: L.bugW })}
    </div></div>`;
}

/* ------------------------------------------------------------------ captions */
function captions(t) {
  if (t > cues.monster.lunge) return '';
  const c = cues.captions.find((p) => t >= p.t0 - 0.02 && t < p.t1 + 0.12);
  if (!c) return '';
  const uIn = prog(t, c.t0 - 0.02, c.t0 + 0.16);
  const uOut = prog(t, c.t1, c.t1 + 0.12);
  const s = (0.82 + 0.18 * backOut(uIn)) * (1 - 0.1 * uOut);
  const op = clamp(uIn * 3) * (1 - uOut);
  const words = c.words
    .map(([w, wt, kind], i) => {
      const next = c.words[i + 1]?.[1] ?? c.t1;
      const said = t >= wt - 0.03;
      const cur = said && t < next;
      const pu = prog(t, wt - 0.03, wt + 0.18);
      if (kind === 'pop') {
        const ps = said ? 0.6 + 0.4 * elastic(pu) : 0.92;
        const rot = said ? -3 + 2 * Math.sin(t * 7) : 0;
        return `<span class="w pop" style="opacity:${said ? 1 : 0.32};transform:translateY(${said ? -2 : 0}px) scale(${ps.toFixed(3)}) rotate(${rot.toFixed(2)}deg)">${w}</span>`;
      }
      return `<span class="w${cur ? ' cur' : ''}" style="opacity:${said ? 1 : 0.32}">${w}</span>`;
    })
    .join(' ');
  const shift = !V && c.t0 >= M.enter ? (M.capShift ?? 260) : 0; // make room for the creature
  return `<div class="abs cap" style="left:${shift}px;width:${L.w}px;top:${L.capY}px;opacity:${op.toFixed(3)}">
    <div class="capbox" style="transform:translate(-50%,-50%) scale(${s.toFixed(3)}) rotate(${(-1 + 0.6 * Math.sin(c.t0 * 3)).toFixed(2)}deg)">${words}</div></div>`;
}

/* ------------------------------------------------------------------ the creature */
const M = cues.monster;
const FROM = M.from ?? -0.14; // where it comes from (fraction of the width; >1 = off the right edge)

/*
 * The creature's path: floor hops (M.hops), an optional jump onto her fingertip that follows the tracked
 * tip (M.perch: jump, land, leave), a cartoon hang when the finger drops, then optional floor hops again
 * (M.postHops). Each segment is a jump from one anchor to the next; an anchor is a floor spot or the tip.
 */
const anchors = [];
{
  let prev = { at: -99, pos: () => [FROM * L.w, L.ground], size: M.hops[0].size };
  anchors.push(prev);
  const add = (t0, t1, pos, size, kind) => anchors.push({ t0, t1, pos, size, kind });
  for (const h of M.hops) add(h.t, h.land, () => [h.x * L.w, L.ground], h.size, 'floor');
  if (M.perch) {
    const P = M.perch;
    add(P.jump, P.land, (t) => { const tp = tipAt(Math.min(t, P.leave)); return [tp[0] + P.dx + (P.hangDx ?? 0) * easeOut(prog(t, P.leave, P.leave + 0.3)), tp[1] + 6 - (P.hangDy ?? 0) * easeOut(prog(t, P.leave, P.leave + 0.3))]; }, P.size, 'tip');
  }
  for (const h of M.postHops ?? []) add(h.t, h.land, () => [h.x * L.w, L.ground], h.size, 'floor');
}
function pathAt(t) {
  // index of the last anchor whose jump has started
  let k = 0;
  for (let i = 1; i < anchors.length; i++) if (t >= anchors[i].t0) k = i;
  const a = anchors[k];
  if (k === 0) return { cx: a.pos(t)[0], base: a.pos(t)[1], size: a.size, air: false, u: 0, kind: 'floor', land: -9, dir: 1 };
  const b = anchors[k - 1];
  const bEnd = b.t1 ?? -99;
  if (t < a.t1) {
    const u = prog(t, a.t0, a.t1);
    const e = easeInOut(u);
    const [x0, y0] = b.pos(Math.max(bEnd, a.t0));
    const [x1, y1] = a.pos(t);
    const size = lerp(b.size, a.size, u);
    const hh = 0.42 * Math.max(b.size, a.size) + 50 + Math.max(0, (y0 - y1) * 0.25);
    return { cx: lerp(x0, x1, e), base: lerp(y0, y1, e) - Math.sin(Math.PI * u) * hh, size, air: true, u, kind: a.kind, land: a.t1, dir: Math.sign(x1 - x0) || 1 };
  }
  const [x, y] = a.pos(t);
  const prevX = b.pos(bEnd)[0];
  return { cx: x, base: y, size: a.size, air: false, u: 1, kind: a.kind, land: a.t1, dir: Math.sign(x - prevX) || 1 };
}
function moodAt(t) {
  let m = ['smug', null, false];
  for (const e of M.moods ?? []) if (t >= e[0]) m = [e[1], e[2] ?? null, !!e[3]];
  return m; // [mood, look override, sweat]
}

function monster(t) {
  if (t < M.enter || t >= M.jaws) return { html: '', fx: '' }; // smash cut: the jaws take over
  const st = pathAt(t);
  let { cx, base, size } = st;
  let sx = 1, sy = 1, rot = 0;
  const air = st.air;
  if (air) {
    const u = st.u;
    sy = 1 + 0.14 * Math.sin(Math.PI * u);
    sx = 1 - 0.08 * Math.sin(Math.PI * u);
    rot = -8 * st.dir * Math.cos(Math.PI * u);
  } else {
    // anticipation squash before the next jump
    const nxt = anchors.find((a) => a.t0 > t);
    if (nxt && nxt.t0 - t < 0.12) {
      const a = 1 - (nxt.t0 - t) / 0.12;
      sx = 1 + 0.14 * a; sy = 1 - 0.16 * a;
    }
    const dl = t - st.land;
    if (dl >= 0 && dl < 0.5) {
      const k = 0.26 * Math.exp(-dl / 0.09) * Math.cos(dl * 34);
      sx *= 1 + k; sy *= 1 - k;
    }
    if (st.kind === 'tip') {
      const d = t - st.land;
      rot = 7 * Math.sin(d * 2 * Math.PI * 1.7) * Math.exp(-d / 0.9);
      if (M.perch && t >= M.perch.leave) {
        const h = t - M.perch.leave; // finger gone: cartoon hang-time, legs kicking
        sy *= 1 + 0.035 * Math.sin(h * 46);
        rot = 4 * Math.sin(h * 30);
      }
    } else if (dl > 0.45) {
      sy *= 1 + 0.025 * Math.sin(dl * 2 * Math.PI * 1.6); // idle breathing
    }
  }
  let [mood, lookOverride, sweat] = moodAt(t);
  let wiggle = 0, scaleBoost = 1, excl = 0;
  if (t >= M.open) {
    mood = 'open';
    sweat = false;
    const u = prog(t, M.open, M.lunge);
    scaleBoost = 1 + (M.openGrow ?? 0.18) * easeOut(u);
    wiggle = Math.sin((t - M.open) * 38) * 5 * u;
    excl = prog(t, M.open, M.open + 0.18);
    if (!air) { sy *= 1 - 0.06 * u; sx *= 1 + 0.05 * u; } // crouch before the leap
  }
  size *= L.mScale * scaleBoost;
  let cy = base - (52 / 112) * size * sy;
  if (t >= M.lunge) {
    mood = 'chomp';
    const u = easeIn(prog(t, M.lunge, M.jaws));
    size = lerp(size, 1500, u);
    const v = easeOut(prog(t, M.lunge, M.jaws));
    cx = lerp(cx, L.w / 2, v);
    cy = lerp(cy, L.h * 0.5, v) - Math.sin(Math.PI * prog(t, M.lunge, M.jaws)) * 120;
    sx = 1 + 0.08 * Math.sin(Math.PI * u); sy = 1 - 0.05 * Math.sin(Math.PI * u);
    rot = -6 * (1 - u);
    excl = 0;
    lookOverride = [0, 0.5];
  }
  // eyes on her face
  const [fx0, fy0] = faceAt(t);
  const lx = fx0 - cx, ly = fy0 - (cy - size * 0.05);
  const n = Math.hypot(lx, ly) || 1;
  let look = [(lx / n) * 3.6, (ly / n) * 3.6];
  if (mood === 'happy') look = [0, 0.5];
  if (lookOverride) look = lookOverride;
  const svg = coin('sun', { mood, look, size, feet: true, sweat });
  const onFloor = st.kind === 'floor' && t < M.lunge;
  const lift = Math.max(0, L.ground - base);
  const shOp = onFloor ? 0.28 * clamp(1 - lift / 300) : 0;
  const shW = size * 0.62 * clamp(1 - (lift / 400) * 0.5);
  let html = shOp > 0 ? `<div class="abs" style="left:${px(cx - shW / 2)};top:${px(L.ground - 4 - size * 0.035)};width:${px(shW)};height:${px(size * 0.07)};border-radius:50%;background:rgba(4,24,28,${shOp.toFixed(3)})"></div>` : '';
  html += `<div class="abs mon" style="left:${px(cx - size / 2)};top:${px(cy - size / 2)};width:${px(size)};height:${px(size)};transform-origin:50% 96%;transform:translateX(${wiggle.toFixed(1)}px) rotate(${(rot + wiggle * 0.3).toFixed(2)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})">${svg}</div>`;
  if (excl > 0) {
    const es = backOut(excl, 3);
    const side = cx > L.w * 0.6 ? -1 : 1; // keep the "!" on screen and toward her
    const ex = side > 0 ? cx + size * 0.28 : cx - size * 0.28 - size * 0.3;
    html += `<div class="abs" style="left:${px(ex)};top:${px(cy - size * 0.95)};transform:scale(${es.toFixed(3)}) rotate(${12 * side}deg);transform-origin:50% 100%">
      <div class="sticker" style="padding:2px 22px 10px;border-radius:22px;font-family:var(--display);font-weight:900;font-size:${Math.round(size * 0.3)}px;line-height:1;background:var(--cream)">!</div></div>`;
  }
  // dust puffs at each floor landing + speed lines while airborne
  let fx = '';
  for (const a of anchors.slice(1)) {
    if (a.kind !== 'floor') continue;
    const d = t - a.t1;
    if (d < 0 || d > 0.55) continue;
    const s = a.size * L.mScale;
    const u = d / 0.55;
    const ax = a.pos(t)[0];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const r = (8 + 20 * easeOut(u)) * (1 - k * 0.22) * (s / 260);
        const dx = side * (s * 0.3 + (s * 0.35 + k * 26) * easeOut(u));
        const dy = -k * 14 * (s / 260) - 18 * easeOut(u);
        fx += `<div class="abs puff" style="left:${px(ax + dx - r)};top:${px(L.ground + dy - r)};width:${px(2 * r)};height:${px(2 * r)};opacity:${(1 - u).toFixed(3)}"></div>`;
      }
    }
  }
  if (air && t < M.lunge) {
    for (let k = 0; k < 3; k++) {
      const len = size * (0.32 - k * 0.06);
      const lx2 = st.dir > 0 ? cx - size * 0.55 - len - k * 10 : cx + size * 0.55 + k * 10;
      const ly2 = cy - size * 0.2 + k * size * 0.2;
      fx += `<div class="abs" style="left:${px(lx2)};top:${px(ly2)};width:${px(len)};height:7px;border-radius:4px;background:var(--ink);opacity:.85"></div>`;
    }
  }
  if (t >= M.lunge && t < M.jaws) {
    const u = prog(t, M.lunge, M.jaws);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + 0.2;
      const r0 = size * 0.62 + 40, r1 = r0 + 90 + 60 * u;
      fx += `<div class="abs" style="left:${px(cx + Math.cos(a) * r0)};top:${px(cy + Math.sin(a) * r0)};width:${px(r1 - r0)};height:8px;border-radius:4px;background:var(--ink);opacity:${(0.8 * (1 - u * 0.5)).toFixed(2)};transform-origin:0 50%;transform:rotate(${(a * 180) / Math.PI}deg)"></div>`;
    }
  }
  return { html, fx };
}

/* ------------------------------------------------------------------ the jaw wipe */
function jaws(t) {
  if (t < M.jaws || t > cues.card.flash + 0.1) return '';
  const u = prog(t, M.jaws, M.impact) ** 2;
  const { w, h } = L;
  const tw = V ? 135 : 160; // tooth width
  const th = tw * 0.62;
  const sag = V ? 30 : 46;
  const n = Math.ceil(w / tw) + 2;
  const jaw = (top) => {
    // edge position: off-screen -> slightly past centre so the jaws overlap at the bite
    const edge = top ? lerp(h * 0.14, h / 2 + 8, u) : lerp(h * 0.86, h / 2 - 8, u);
    const dir = top ? 1 : -1;
    const off = top ? 0 : tw / 2;
    const lip = (x) => edge + dir * sag * Math.sin((Math.PI * x) / w);
    let d = `M -40 ${top ? -60 : h + 60} L -40 ${lip(-40)}`;
    for (let x = -40; x <= w + 40; x += 40) d += ` L ${x} ${lip(x)}`;
    d += ` L ${w + 40} ${top ? -60 : h + 60} Z`;
    let teeth = '';
    for (let i = -1; i < n; i++) {
      const x = i * tw + off;
      const y = lip(x + tw / 2);
      teeth += `<path d="M ${x + 8} ${y - dir * 6} Q ${x + tw / 2} ${y + dir * th * 1.15} ${x + tw - 8} ${y - dir * 6} Z" fill="#fff" stroke="${C.ink}" stroke-width="7" stroke-linejoin="round"/>`;
    }
    let band = '';
    // shade band along the lip, then the ink edge
    let d2 = '';
    for (let x = -40; x <= w + 40; x += 40) d2 += `${x === -40 ? 'M' : 'L'} ${x} ${lip(x) - dir * 26} `;
    band = `<path d="${d2}" stroke="${C.sunS}" stroke-width="26" fill="none"/>`;
    let d3 = '';
    for (let x = -40; x <= w + 40; x += 40) d3 += `${x === -40 ? 'M' : 'L'} ${x} ${lip(x)} `;
    // hard ink shadow under the top jaw
    const shadow = top ? `<path d="${d}" fill="${C.ink}" transform="translate(0 14)"/>` : '';
    // the creature's eyes ride on the top jaw, glaring down at her
    let eyes = '';
    if (top) {
      const ey = lip(w / 2) - (V ? 300 : 165);
      const ex = V ? 190 : 230;
      const rx = V ? 105 : 90, ry = V ? 130 : 105;
      for (const sx of [-1, 1]) {
        const x = w / 2 + sx * ex;
        eyes += `<ellipse cx="${x}" cy="${ey}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${C.ink}" stroke-width="12"/>
          <circle cx="${x - sx * 18}" cy="${ey + ry * 0.38}" r="${rx * 0.52}" fill="${C.ink}"/>
          <circle cx="${x - sx * 18 - rx * 0.2}" cy="${ey + ry * 0.38 - rx * 0.22}" r="${rx * 0.17}" fill="#fff"/>
          <path d="M${x - sx * rx * 0.95} ${ey - ry * 0.98} L${x + sx * rx * 1.0} ${ey - ry * 1.32}" stroke="${C.ink}" stroke-width="22" stroke-linecap="round"/>
          <ellipse cx="${x + sx * rx * 1.35}" cy="${ey + ry * 1.0}" rx="${rx * 0.55}" ry="${rx * 0.28}" fill="${C.blush}" opacity=".8"/>`;
      }
    }
    return `${shadow}${teeth}<path d="${d}" fill="${C.sun}"/>${band}<path d="${d3}" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linejoin="round"/>${eyes}`;
  };
  // speed streaks on the jaws
  return `<svg class="abs" style="left:0;top:0" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${jaw(false)}${jaw(true)}</svg>`;
}

/* ------------------------------------------------------------------ the SOON card */
const CARD = cues.card;
// `brand: false` -> SOON alone on the card (no wordmark, no handle), centred vertically
if (CARD.brand === false) L.soonY = L.h / 2;
const burst = (() => {
  const r = rng(4242);
  const paints = ['cyan', 'teal', 'foam', 'cream', 'up', 'cyan', 'teal'];
  const moods = ['happy', 'smile', 'scared', 'smug', 'happy', 'open'];
  const coins = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 + r() * 0.4;
    const sp = 900 + r() * 900;
    return { paint: paints[i % paints.length], mood: moods[i % moods.length], a, sp, vy: -500 - r() * 700, size: 70 + r() * 60, spin: (r() - 0.5) * 900 };
  });
  const conf = Array.from({ length: 70 }, (_, i) => {
    const a = r() * Math.PI * 2;
    const sp = 500 + r() * 1400;
    return { a, sp, vy: -600 - r() * 600, col: [C.cyan, C.teal, C.cream, C.ink, C.foam, C.blush, C.cream][i % 7], w: 14 + r() * 16, h: 8 + r() * 10, spin: (r() - 0.5) * 1400, wob: r() * 6 };
  });
  return { coins, conf };
})();

function card(t) {
  if (t < CARD.flash) return '';
  const { w, h } = L;
  const d = t - CARD.flash;
  let s = `<div class="abs" style="left:0;top:0;width:${w}px;height:${h}px;background:${C.sun}"></div>`;
  // slow sunburst
  const rays = 22;
  let rr = '';
  const R = Math.hypot(w, h);
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * 360, a1 = ((i + 1) / rays) * 360;
    const p = (a) => `${(Math.cos((a * Math.PI) / 180) * R).toFixed(0)} ${(Math.sin((a * Math.PI) / 180) * R).toFixed(0)}`;
    rr += `<path d="M0 0 L ${p(a0)} L ${p(a1)} Z"/>`;
  }
  const cyR = L.soonY;
  s += `<svg class="abs" style="left:0;top:0" width="${w}" height="${h}"><g transform="translate(${w / 2} ${cyR}) rotate(${(d * 9).toFixed(2)})" fill="#F5CD66" opacity="${clamp(d / 0.3).toFixed(2)}">${rr}</g>
    <circle cx="${w / 2}" cy="${cyR}" r="${V ? 470 : 520}" fill="${C.sun}" opacity=".55"/></svg>`;
  // halftone dots in the corners
  let dots = '';
  const dotStep = 34;
  for (let y = 0; y < h; y += dotStep) {
    for (let x = 0; x < w; x += dotStep) {
      const e = Math.min(x, w - x, y, h - y) / (V ? 260 : 220);
      const r = 7 * (1 - e);
      if (r > 0.6) dots += `<circle cx="${x + ((y / dotStep) % 2) * 17}" cy="${y}" r="${r.toFixed(1)}"/>`;
    }
  }
  s += `<svg class="abs" style="left:0;top:0" width="${w}" height="${h}"><g fill="${C.sunS}" opacity=".45">${dots}</g></svg>`;

  // coins + confetti flying out of the bite
  let bits = '';
  const g = 2600;
  const oy = h / 2;
  const dCard = d;
  {
  const d = dCard * (CARD.burstSpeed ?? 1); // faster physics for a short card
  for (const c of burst.conf) {
    const x = w / 2 + Math.cos(c.a) * c.sp * d * (V ? 0.75 : 1);
    const y = oy + Math.sin(c.a) * c.sp * d * 0.6 + c.vy * d + 0.5 * g * d * d;
    if (y > h + 60 || d > 2.6) continue;
    bits += `<div class="abs" style="left:${px(x)};top:${px(y)};width:${px(c.w)};height:${px(c.h)};background:${c.col};border:2.5px solid ${C.ink};border-radius:3px;transform:rotate(${(c.spin * d).toFixed(0)}deg) scaleX(${Math.cos(d * c.wob * 3).toFixed(2)})"></div>`;
  }
  for (const c of burst.coins) {
    const x = w / 2 + Math.cos(c.a) * c.sp * d * (V ? 0.7 : 1);
    const y = oy + Math.sin(c.a) * c.sp * 0.55 * d + c.vy * d + 0.5 * g * d * d;
    if (y > h + 200 || d > 2.6) continue;
    const sz = c.size * (V ? 1.1 : 1) * Math.min(1, d * 8);
    bits += `<div class="abs" style="left:${px(x - sz / 2)};top:${px(y - sz / 2)};transform:rotate(${(c.spin * d).toFixed(0)}deg)">${coin(c.paint, { mood: c.mood, size: sz, feet: false })}</div>`;
  }
  }

  // SOON, letter by letter
  let soon = '';
  const letters = ['S', 'O', 'O', 'N'];
  const fs = L.soon;
  const adv = fs * 0.74;
  const totalW = adv * 4;
  const rots = [-5, 3, -2, 5];
  const dys = [0, -10, 6, -4];
  letters.forEach((ch, i) => {
    const t0 = CARD.soon + i * 0.06;
    const u = prog(t, t0, t0 + 0.55);
    if (u <= 0) return;
    const sc = elastic(u);
    const settle = t > t0 + 0.55 ? Math.sin((t - t0) * 2 * Math.PI * 0.8 + i) : 0;
    const x = w / 2 - totalW / 2 + i * adv + adv / 2;
    const y = L.soonY + dys[i] - (1 - easeOut(u)) * 160 + settle * 4;
    const r = rots[i] * sc + settle * 1.6;
    const txt = (fill, stroke, sw, dx = 0, dy = 0) =>
      `<text x="${dx}" y="${dy}" text-anchor="middle" dominant-baseline="central" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke">${ch}</text>`;
    soon += `<svg class="abs" style="left:${px(x - fs)};top:${px(y - fs)};overflow:visible" width="${fs * 2}" height="${fs * 2}" viewBox="${-fs} ${-fs} ${fs * 2} ${fs * 2}">
      <g transform="rotate(${r.toFixed(2)}) scale(${sc.toFixed(3)})" font-family="Fraunces" font-weight="900" font-size="${fs}" style="font-variation-settings:'SOFT' 100,'WONK' 1,'opsz' 144">
        ${txt(C.ink, C.ink, fs * 0.075, fs * 0.05, fs * 0.05)}${txt(C.cream, C.ink, fs * 0.055)}
        <path d="M${-fs * 0.2} ${-fs * 0.25} q${fs * 0.05} ${-fs * 0.08} ${fs * 0.14} ${-fs * 0.09}" stroke="#fff" stroke-width="${fs * 0.035}" fill="none" stroke-linecap="round" opacity=".9"/>
      </g></svg>`;
  });

  // the creature, now full and smug, popping up behind the last O
  let mon = '';
  const mu = prog(t, CARD.soon + 0.35, CARD.soon + 0.8);
  if (mu > 0) {
    const sz = (V ? 270 : 280) * backOut(mu, 2.6);
    const mood = t < CARD.soon + 1.6 ? 'happy' : t < CARD.soon + 2.4 ? 'smug' : 'happy';
    const mx = w / 2 + totalW / 2 - adv * 0.5;
    const my = L.soonY - fs * 0.36 - sz * 0.47 + Math.sin(t * 5) * 3;
    const tilt = 6 + 3 * Math.sin(t * 4);
    mon = `<div class="abs" style="left:${px(mx - sz / 2)};top:${px(my - sz / 2)};transform:rotate(${tilt.toFixed(2)}deg);filter:drop-shadow(6px 6px 0 ${C.ink})">${coin('sun', { mood, look: [-2, 2], size: sz, diecut: 6 })}</div>`;
    // a little burp puff after the meal
    const bu = prog(t, CARD.soon + 1.0, CARD.soon + 1.7);
    if (CARD.burp !== false && bu > 0 && bu < 1) {
      for (let k = 0; k < 3; k++) {
        const r = (10 + k * 7) * easeOut(bu);
        mon += `<div class="abs puff" style="left:${px(mx - sz * 0.55 - k * 26 - r)};top:${px(my - sz * 0.05 - k * 22 - r)};width:${px(2 * r)};height:${px(2 * r)};opacity:${(1 - bu).toFixed(2)}"></div>`;
      }
    }
  }
  // sparkles
  let spark = '';
  const sr = rng(77);
  for (let i = 0; i < 9; i++) {
    const x = sr() * w, y = sr() * h * 0.9 + h * 0.05;
    const ph = sr() * 6;
    const k = clamp((d - 0.4 - i * 0.08) * 3) * (0.6 + 0.4 * Math.sin(t * 6 + ph));
    if (k <= 0) continue;
    if (Math.abs(x - w / 2) < totalW * 0.55 && Math.abs(y - L.soonY) < fs * 0.8) continue;
    spark += star(x, y, 3.2 * k, i % 2 ? C.cream : '#fff');
  }
  spark = `<svg class="abs" style="left:0;top:0" width="${w}" height="${h}">${spark}</svg>`;

  // wordmark + handle
  let foot = '';
  const brand = CARD.brand !== false;
  const wu = brand ? prog(t, CARD.wordmark, CARD.wordmark + 0.45) : 0;
  if (wu > 0) {
    const ww = V ? 560 : 520;
    const y = L.soonY + fs * 0.72 + (V ? 30 : 10);
    foot += `<div class="abs" style="left:${px(w / 2 - ww / 2)};top:${px(y)};transform:translateY(${((1 - easeOut(wu)) * 80).toFixed(1)}px) scale(${backOut(wu).toFixed(3)}) rotate(${(-2 + Math.sin(t * 2.3)).toFixed(2)}deg);opacity:${clamp(wu * 4).toFixed(2)}">${wordmark({ width: ww, diecut: true })}</div>`;
  }
  const hu = brand ? prog(t, CARD.handle, CARD.handle + 0.4) : 0;
  if (hu > 0) {
    const y = L.soonY + fs * 0.72 + (V ? 230 : 180);
    foot += `<div class="abs" style="left:0;width:${w}px;top:${px(y)};display:flex;justify-content:center;opacity:${clamp(hu * 4).toFixed(2)}">
      <div class="tag" style="font-size:${V ? 32 : 30}px;padding:12px 26px;border-width:3.5px;box-shadow:5px 5px 0 var(--ink);gap:16px;transform:scale(${backOut(hu).toFixed(3)}) rotate(1.5deg)">
        <span>elymum.io</span><span style="opacity:.5">&middot;</span><span>@elymumio</span></div></div>`;
  }
  // white flash on the bite
  const fl = 1 - prog(t, CARD.flash + 0.06, CARD.flash + 0.2);
  const flash = fl > 0 ? `<div class="abs" style="left:0;top:0;width:${w}px;height:${h}px;background:#fff;opacity:${fl.toFixed(3)}"></div>` : '';
  return s + spark + soon + mon + foot + bits + flash;
}

/* ------------------------------------------------------------------ page */
const css = `
.cap .capbox{position:absolute;left:50%;top:0;max-width:${L.capMax}px;width:max-content;text-align:center;background:var(--cream);border:4px solid var(--ink);border-radius:20px;box-shadow:6px 6px 0 var(--ink);
  padding:${V ? '12px 26px 14px' : '10px 26px 12px'};font-family:var(--body);font-weight:700;font-size:${L.capFont}px;line-height:1.15;color:var(--ink);letter-spacing:-.01em}
.w{display:inline-block;transition:none;border-radius:10px;padding:0 4px;margin:0 -2px}
.w.cur{background:${C.sun};box-shadow:inset 0 -4px 0 ${C.sunS}}
.w.pop{font-family:var(--display);font-style:italic;font-weight:900;font-variation-settings:"SOFT" 100,"WONK" 1,"opsz" 144;color:${C.sun};
  -webkit-text-stroke:3px var(--ink);paint-order:stroke fill;text-shadow:4px 4px 0 var(--ink);font-size:1.22em;padding:0 8px 0 4px;line-height:1}
.mon svg{width:100%;height:100%;filter:drop-shadow(${V ? 7 : 6}px ${V ? 7 : 6}px 0 ${C.ink})}
.puff{border-radius:50%;background:var(--cream);border:3.5px solid var(--ink)}
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss()}
html,body{width:${L.w}px;height:${L.h}px;overflow:hidden;background:transparent}
#root{position:relative;width:${L.w}px;height:${L.h}px;overflow:hidden}
${css}</style></head><body><div id="root"></div>
<div style="position:absolute;left:-9999px;font-family:Fraunces;font-weight:900">SOON<span style="font-family:'DM Sans';font-weight:700">a</span><span style="font-family:'Geist Mono'">a</span></div></body></html>`;

function frameHtml(t) {
  const m = monster(t);
  return bug(t) + captions(t) + m.fx + m.html + jaws(t) + card(t);
}

const outDir = join(work, `ov-${layoutName}`);
mkdirSync(outDir, { recursive: true });
const { chromium } = requireFrom('apps/web')('playwright');
const browser = await chromium.launch({ executablePath: resolveChromium(chromium).executablePath });
const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(async () => {
  for (const f of ['900 40px Fraunces', 'italic 900 40px Fraunces', '700 16px "DM Sans"', '600 16px "Geist Mono"']) await document.fonts.load(f).catch(() => {});
  await document.fonts.ready;
});
const N = Math.round(cues.duration * FPS);
const list = ONLY ? ONLY.map((s) => Math.round(s * FPS)) : [];
if (!ONLY) for (let i = Math.round(T0 * FPS); i < Math.min(N, Math.round(T1 * FPS)); i += EVERY) list.push(i);
let k = 0;
for (const i of list) {
  const t = i / FPS;
  await page.evaluate((h) => { document.getElementById('root').innerHTML = h; }, frameHtml(t));
  await page.screenshot({ path: join(outDir, `${String(i).padStart(5, '0')}.png`), omitBackground: true, clip: { x: 0, y: 0, width: L.w, height: L.h } });
  if (++k % 60 === 0) console.log(`${layoutName} ${k}/${list.length}`);
}
await browser.close();
console.log(`wrote ${list.length} frames to ${outDir}`);

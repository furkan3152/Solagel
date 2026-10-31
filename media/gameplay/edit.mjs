#!/usr/bin/env node
// Video A: "Elymum / Gameplay" (about 55 s, 60 fps). The edit decision list: which pieces of which
// takes, how they are timed, reframed and ramped, the graphics on top and the sound cues.
// One paid round in Asphodel Meadow, told in order: a mid-round join, she eats players (slow-motion
// punch-ins with the value floating off the gulp), a bot eats her and she buys back in, the final
// minute, the last ten seconds, the bell and the "Round over" receipt with the PAID stamp.
// Every take is a journal replayed frame by frame (capture/replay.mjs), so the picture is a true
// 60 fps. Cuts sit on the bar lines of the game's own score (82 BPM, 4/4): bar = 2.927 s.
// Writes cache/edit/gameplay.json (+ gameplay-music.json).
//   node media/gameplay/edit.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edit, events, mark, take } from './render/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// the site's host on the end card (no domain is hard-coded: set SITE_HOST to the PUBLIC_URL host)
const SITE = (process.env.SITE_HOST || 'elymum.io').toUpperCase();
const OUT = resolve(HERE, 'cache/edit');
mkdirSync(OUT, { recursive: true });
const BPM = 82, BEAT = 60 / BPM, BAR = BEAT * 4;
const bars = (n) => n * BAR;
const has = (t) => { try { take(t); return true; } catch { return false; } };

const e = new Edit({ name: 'gameplay', fps: 60 });
// arena: a round she survives to the bell (eats a player, the final minute, the bell, the receipt);
// arena2: the same with other beats (more eats, loot); spill: a bot eats her and she buys back in.
const A = 'arena', A2 = has('arena2') ? 'arena2' : 'arena', S = 'spill';

/** A kicker label in the top-left corner for a beat. */
const kicker = (t, text, dur = 2.6) => { e.add('tag', t, dur, { text, x: 72, y: 72, size: 27, kick: true, dot: true, scramble: true }, 20); e.cue('tick', t + 0.05, 0.3); e.cue('tick', t + 0.2, 0.2); };
/** A ticket lower-third with a counting value. */
const lower = (t, dur, kickerText, from, to, o = {}) => {
  e.add('lower', t, dur, { kicker: kickerText, count: [from, to], sign: o.sign || '', unit: o.unit ?? '$ELYMUM', accent: o.accent || 'pink', stub: o.stub || 'PENNY POND', countAt: o.countAt ?? 0.3, countDur: o.countDur || 0.9, w: o.w || 660, dec: o.dec }, 30);
  e.cue('whoosh', t - 0.05, 0.28, { dur: 0.4, bright: 1.3 });
  e.cue('pop', t + 0.3, 0.35);
};
const stamp = (t, text, x, y, color = 'pink', o = {}) => {
  e.add('stamp', t, o.dur || 1.5, { text, x, y, color, rot: o.rot ?? -8, size: o.size || 130 }, 40);
  e.cue('stamp', t, 0.9);
  e.cue('impact', t, o.hit ?? 0.55);
};
const wipe = (t, colors = ['pink', 'paper'], dur = 0.8) => { e.add('wipe', t - dur / 2, dur, { colors }, 90); e.cue('paper', t - dur / 2, 0.55); };
/** A hand-drawn box around a source-pixel rectangle of a shot. */
const boxSrc = (s, t, dur, x0, y0, x1, y1, label, o = {}) => {
  const [a, b] = e.project(s, t + 0.1, x0, y0), [c, d] = e.project(s, t + 0.1, x1, y1);
  e.add('box', t, dur, { x: a, y: b, w: c - a, h: d - b, label, labelBelow: o.below, seed: o.seed || 3, color: o.color }, 40);
};
/** The value float off the gulp: follows Daphne's coin. */
const float = (s, t, text, o = {}) => {
  const dur = o.dur ?? 1.5;
  e.add('float', t, dur, { text, sub: o.sub ?? '$ELYMUM', track: e.trackMe(s, t, dur, 1 / 30), size: o.size ?? 120, color: o.color || 'mustard' }, 35);
  e.cue('coin', t, 0.5).cue('pop', t + 0.05, 0.4);
};
const CHIP = [884, 12, 1036, 66]; // the round chip on the HUD (source px)
const val = (v) => Math.round(v / 1e6);

/** An eat beat: slow motion through the gulp, a punch-in, GULP!, the value floats off. */
function eatShot(take, tEat, delta, o = {}) {
  const pre = o.pre ?? 2.0, dur = o.dur ?? bars(2);
  // output time of the gulp: pre seconds at 1x minus what the ramp eats
  const s = e.shot({ take, from: tEat - pre, dur, zoom: o.zoom ?? 1.45, lag: 0.45,
    speed: [[0, 1], [pre - 0.55, 1], [pre - 0.35, 0.3], [pre + 0.9, 0.3], [pre + 1.2, 1], [dur, 1]],
    punch: [[pre - 0.25, 1.28, 0.3, 1.1, 0.6]], shake: [[pre + 0.35, 10]] });
  const tE = e.timeOf(s, tEat);
  e.cue('gulp', tE, 0.8).cue('sub', tE, 0.4);
  e.add('flash', tE, 0.18, { color: 'card', peak: 0.4 }, 60);
  stamp(tE + 0.12, o.stamp || 'GULP!', 1450, 300, 'pink', { rot: -9, size: 110, dur: 1.3 });
  float(s, tE + 0.08, `+${val(delta).toLocaleString('en-US')}`, { dur: 1.7 });
  return { s, tE };
}

// ── 0 · intro card (1 bar) ──
const tIntro = bars(1);
e.add('card', 0, tIntro + 0.4, { variant: 'intro', kicker: 'GAMEPLAY / PENNY POND / LIVE ROUND', live: true, tagline: 'Five minutes. Stay alive. Get paid.', tagAccent: 5, tagAt: 0.95, tagGap: 0.12 }, 50);
e.cue('riser', 0.0, 0.35, { dur: 0.9 });
for (let i = 0; i < 5; i++) e.cue('pop', 0.42 + i * 0.06, 0.25, { pitch: 0.8 + i * 0.08 });
e.cue('stamp', 0.7, 0.8).cue('sub', 0.7, 0.6);
for (let i = 0; i < 6; i++) e.cue('stamp', 0.95 + i * 0.12 + 0.1, 0.3);
wipe(tIntro, ['pink', 'card']);

// ── 1 · join mid-round (1.5 bars) ── the lobby row counts the round down; the ticket; sign
e.at(tIntro);
const tEnter = mark(A, 'enter'), tBuy = mark(A, 'buy');
// the lobby row, then the ticket sheet fast-forwarded; the shot ends as she drops in
const jramp = (v) => [[0, 1], [1.6, 1], [2.1, v], [4.39, v]];
let jv = 4;
for (let lo = 1, hi = 12, i = 0; i < 30; i++) {
  jv = (lo + hi) / 2;
  const pr = new Edit({ name: 'probe', fps: 60 }).shot({ take: A, from: mark(A, 'lobby') + 0.6, dur: bars(1.5), speed: jramp(jv), cam: 'center' });
  if (pr.srcEnd > tEnter + 0.35) hi = jv; else lo = jv;
}
const s1 = e.shot({ take: A, from: mark(A, 'lobby') + 0.6, dur: bars(1.5),
  speed: jramp(jv),
  cam: [[0, 960, 540, 1.0], [0.7, 520, 480, 1.7], [1.8, 520, 480, 1.75], [2.3, 960, 540, 1.15], [4.39, 960, 540, 1.2]] });
kicker(s1.start + 0.2, 'JOIN A ROUND MID-WAY', 2.6);
boxSrc(s1, s1.start + 0.75, 1.3, 280, 418, 700, 538, 'ROUND ALREADY RUNNING', { seed: 6 });
e.cue('whoosh', s1.start + 2.0, 0.4, { dur: 0.6 });

// (no drop-in shot: this round dropped her in a corner of the map, the world edge in frame;
// the round chip shows in the lobby row above and in the final minute)
wipe(s1.end, ['mustard', 'card'], 0.6);

// ── 3 · eat a player (2 bars) ──
const eats = [...events(A, 'value', (v) => v.reason === 'eat').map((x) => ({ take: A, ...x })), ...(A2 !== A ? events(A2, 'value', (v) => v.reason === 'eat').map((x) => ({ take: A2, ...x })) : [])];
const eat1 = eats[0];
const b3 = e.t;
const { s: s3, tE: tE3 } = eatShot(eat1.take, eat1.t, eat1.v.delta);
kicker(b3 + 0.2, 'EAT A PLAYER', 2.4);
lower(tE3 + 0.9, s3.end - tE3 - 0.8, 'YOUR TILL / THEIR TOKENS', val(eat1.v.value - eat1.v.delta), val(eat1.v.value), { countAt: 0.2, countDur: 0.9 });

// ── 3b · a second eat or the loot, from the other round take (1.5 bars) ──
const eat2 = eats.find((x) => x !== eat1 && x.take !== eat1.take) || eats[1];
const loots = A2 !== A ? events(A2, 'value', (v) => v.reason === 'loot') : [];
let sB = s3;
if (loots.length >= 2) {
  // loot swept up: the floats rise off the pickups
  let lootAt = loots[0].t;
  { let best = 0; for (const x of loots) { const n = loots.filter((y) => y.t >= x.t && y.t < x.t + 4).length; if (n > best) { best = n; lootAt = x.t; } } }
  sB = e.shot({ take: A2, from: lootAt - 0.7, dur: bars(1.5), zoom: 1.5, lag: 0.55 });
  kicker(sB.start + 0.15, 'LOOT ON THE FLOOR', 2.4);
  const inShot = loots.filter((x) => x.t >= sB.from && x.t <= sB.srcEnd);
  for (const ev of inShot.slice(0, 5)) { const t = e.timeOf(sB, ev.t); e.cue('coin', t, 0.35, { pitch: 1 + Math.random() * 0.3 }); }
  const sum = inShot.reduce((a, x) => a + x.v.delta, 0);
  if (inShot.length) float(sB, e.timeOf(sB, inShot[0].t) + 0.05, `+${val(sum).toLocaleString('en-US')}`, { dur: 2.2, size: 104 });
} else if (eat2) {
  wipe(e.t, ['teal', 'card'], 0.6);
  const r = eatShot(eat2.take, eat2.t, eat2.v.delta, { dur: bars(1.5), pre: 1.6, stamp: 'TAKEN!' });
  sB = r.s;
  kicker(sB.start + 0.15, 'TAKE WHAT THEY CARRY', 2.4);
}

// ── 4 · eaten by a bot, buy back in (2.5 bars) ── same round, same fee
wipe(sB.end, ['teal', 'card'], 0.7);
const tDie = events(S, 'death')[0].t;
const s5a = e.shot({ take: S, from: tDie - 1.5, dur: bars(1), zoom: 2.1, lag: 0.4,
  speed: [[0, 1], [1.2, 1], [1.35, 0.45], [2.2, 0.45], [2.5, 1]], punch: [[1.3, 1.18, 0.15, 1.0, 0.4]], shake: [[1.55, 16]] });
kicker(s5a.start + 0.15, 'A BOT ATE HER: TOKENS SPILL', 2.6);
e.cue('gulp', e.timeOf(s5a, tDie), 0.7);
const tSB = mark(S, 'buyback'), tRe = mark(S, 'reenter');
const s5b = e.shot({ take: S, from: tSB - 1.4, dur: bars(1.5), speed: [[0, 1.1], [1.9, 1.1], [2.4, (tRe - tSB - 0.8) / 1.6], [4.39, (tRe - tSB - 0.8) / 1.6]],
  cam: [[0, 960, 560, 1.35], [1.8, 1150, 820, 1.95], [2.4, 960, 540, 1.2], [4.39, 960, 540, 1.25]] });
kicker(s5b.start + 0.1, 'EATEN? BUY BACK IN', 2.8);
stamp(s5b.start + 1.5, 'SAME ROUND', 1300, 300, 'teal', { rot: 6, size: 96 });

// ── 5 · the final minute (1 bar) ── joins close; the chip turns mustard
// (the end of the round comes from arena2: she eats pixel_penny four seconds before the bell)
const F = A2;
const tFinal = mark(F, 'final');
const s6 = e.shot({ take: F, from: tFinal - 0.6, dur: bars(1),
  cam: [[0, 960, 540, 1.15], [0.8, 960, 260, 1.6], [2.92, 960, 250, 1.65]] });
kicker(s6.start + 0.1, 'FINAL MINUTE / JOINS CLOSED', 2.8);
boxSrc(s6, s6.start + 0.75, 2.1, ...CHIP, 'NO NEW TICKETS', { seed: 4, below: true, color: 'mustard' });
e.cue('swell', s6.start + 0.4, 0.4, { dur: 0.6 });

// ── 6 · the last ten seconds (4 bars) ── a last gulp in slow motion, then the bell
wipe(s6.end, ['ink', 'card'], 0.6);
const tBell = events(F, 'roundResult')[0].t;
const rr = events(F, 'roundResult')[0].v;
const lastEat = events(F, 'value', (v) => v.reason === 'eat').filter((x) => x.t > tBell - 9)[0];
const dur7 = bars(4);
let speed7 = 1, pre7 = 0;
if (lastEat) {
  // slow motion through the gulp; the shot still ends on the bell
  // place the slow window so the gulp lands 0.2 s into it (searched: the ramp moves the gulp)
  const ramp = (uE) => [[0, 1], [uE - 0.5, 1], [uE - 0.3, 0.3], [uE + 0.9, 0.3], [uE + 1.2, 1], [dur7, 1]];
  let best = null;
  for (let uE = dur7 - 7; uE < dur7 - 2; uE += 0.02) {
    const pr = new Edit({ name: 'probe', fps: 60 }).shot({ take: F, from: 0, dur: dur7, speed: ramp(uE), cam: 'center' });
    const off = lastEat.t - (tBell - pr.srcEnd - 0.03);
    const k = pr.frames.findIndex((f) => f[0] >= off);
    const err = Math.abs(k / 60 - uE - 0.2);
    if (k >= 0 && (!best || err < best.err)) best = { uE, err, srcEnd: pr.srcEnd };
  }
  speed7 = ramp(best.uE);
  pre7 = best.srcEnd;
} else pre7 = dur7;
// a fixed frame that keeps the big 10..1 countdown (top centre) and her coin (the game camera centres it)
const s7 = e.shot({ take: F, from: tBell - pre7 - 0.03, dur: dur7, speed: speed7, cam: [[0, 940, 365, 1.6], [dur7, 940, 360, 1.66]],
  punch: lastEat ? [[speed7[2][0], 1.22, 0.3, 1.1, 0.6]] : [] });
kicker(s7.start + 0.2, 'THE LAST TEN SECONDS', 3.0);
e.add('ring', s7.start + 2.6, 2.6, { track: e.trackMe(s7, s7.start + 2.6, 2.6), label: 'STAY ALIVE', pad: 1.4 }, 25);
if (lastEat) {
  const tE = e.timeOf(s7, lastEat.t);
  e.cue('gulp', tE, 0.8).cue('sub', tE, 0.4);
  e.add('flash', tE, 0.18, { color: 'card', peak: 0.4 }, 60);
  stamp(tE + 0.12, 'GULP!', 1450, 300, 'pink', { rot: -9, size: 110, dur: 1.3 });
  float(s7, tE + 0.08, `+${val(lastEat.v.delta).toLocaleString('en-US')}`, { dur: 1.6 });
}
lower(s7.end - 2.3, 2.35, 'YOUR TILL AT THE BELL', 1000, val(rr.payout), { countAt: 0.2, countDur: 1.0, w: 640 });

// ── 7 · the bell (3 bars) ── the frozen world, the receipt, PAID
const tPaid = mark(F, 'paid');
const s8a = e.shot({ take: F, from: tBell - 0.05, dur: 2.3, zoom: 1.4, lag: 0.6 });
// the receipt: a modal over the dimmed world, framed on its own (the world edge may sit behind it)
const s8 = e.shot({ take: F, from: tBell + 2.25, dur: bars(3) - 2.3, edge: false,
  cam: [[0, 960, 545, 1.25], [0.9, 960, 545, 1.45], [3.0, 960, 545, 1.48], [3.8, 780, 560, 1.85], [6.48, 775, 560, 1.92]] });
s8.start0 = s8a.start;
e.add('flash', s8a.start, 0.35, { color: 'card', peak: 0.55 }, 60);
stamp(s8a.start + 0.08, 'BELL!', 1320, 330, 'mustard', { rot: -10, size: 120, dur: 1.4 });
const tStamp = e.timeOf(s8, tPaid) + 0.35;
kicker(s8a.start + 2.6, 'ALIVE AT THE BELL: PAID', 3.2);
e.cue('printer', s8a.start + 2.7, 0.4, { dur: 1.2 });
e.cue('kaching', tStamp, 0.6).cue('impact', tStamp, 0.4);
{
  // the receipt's own sum: the till at the bell minus 5% of the profit over the 1,000 entry
  const till = rr.payout / 1e6;
  lower(tStamp + 0.4, s8.end - tStamp - 0.3, 'ROUND OVER / FEE ON PROFIT ONLY', 0, Math.round((till - Math.max(0, till - 1000) * 0.05) * 100) / 100, { stub: 'PAID', countDur: 1.2, accent: 'teal', w: 720, dec: 2 });
}

// ── 8 · outro card ──
wipe(s8.end, ['pink', 'card']);
const tOut = s8.end;
e.add('card', tOut - 0.05, bars(2) + 0.05, {
  variant: 'outro', kicker: 'ELYMUM / ON ELYSIUM', tagline: 'Eat. Grow. Last the round.', tagAccent: 4, tagAt: 0.7, tagGap: 0.26,
  foot: `WL → MINT → PLAY  /  ${SITE}  /  @ELYMUMIO`, footAt: 1.6, footY: 812,
}, 50);
for (let i = 0; i < 3; i++) e.cue('stamp', tOut + 0.7 + i * 0.26 + 0.1, 0.6);
e.cue('sub', tOut + 0.4, 0.5);
e.at(tOut + bars(2));

const data = e.build(resolve(OUT, 'gameplay.json'));
// the score: the game's lobby music (melody and full kit), plus swung drums from the first cut;
// they drop out for the last ten seconds (the game's own ticks and bell carry it) and the receipt
const music = {
  parts: [{ file: resolve(HERE, 'cache/takes/music-lobby/audio.wav'), at: 0, from: 0.22 + 4 * BAR - tIntro, dur: data.duration + 0.2, gain: 0, fadeIn: 0.4, fadeOut: 2.0 }],
  drums: { bpm: BPM, phase: tIntro - BAR, start: tIntro, end: tOut + bars(1.5), gain: -5, drop: [[s7.start + bars(2), tOut - 0.05]], fills: [s6.end - BEAT] },
  gain: [[0, -4], [tIntro, 0], [s7.start + bars(2), 0], [s7.start + bars(2) + 1, -7], [s8a.start + 3.5, -7], [tOut, 0], [tOut + bars(1.5), 0], [data.duration, -10]],
};
writeFileSync(resolve(OUT, 'gameplay-music.json'), JSON.stringify(music, null, 1));
console.log('gameplay edit:', data.duration.toFixed(2), 's,', data.frames, 'frames,', data.items.length, 'graphics,', data.sfx.length, 'cues');
for (const s of e.shots) console.log(`  ${s.start.toFixed(2)}-${s.end.toFixed(2)}  ${s.take} ${s.from.toFixed(2)}-${s.srcEnd.toFixed(2)}${s.edgeZoom > 1.01 ? `  edge zoom x${s.edgeZoom.toFixed(2)}` : ''}`);

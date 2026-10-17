#!/usr/bin/env node
// Video A: "Slana / Gameplay" (about 66 s). The edit decision list: which pieces of which takes,
// how they are timed, reframed and ramped, the graphics on top and the sound cues.
// One paid round in Penny Pond, told in order: a mid-round join, loot, she eats a player, a bot
// eats Daphne and she buys back in, the final minute, the last ten seconds, the bell, the
// "Round over" receipt with the PAID stamp.
// Writes cache/edit/gameplay.json (+ music.json). Cuts sit on the bar lines of the game's own
// score (82 BPM, 4/4): bar = 2.927 s.
//   node media/gameplay/edit.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edit, events, mark } from './render/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'cache/edit');
mkdirSync(OUT, { recursive: true });
const BPM = 82, BEAT = 60 / BPM, BAR = BEAT * 4;
const bars = (n) => n * BAR;

const e = new Edit({ name: 'gameplay' });
// arena2: a whole round from a mid-round join to the bell (a player eaten, loot swept up, the
// final minute, the last ten seconds, the receipt); arena: a bot eats Daphne and she buys back in.
const A = 'arena', A2 = 'arena2', SP = A2;

/** A kicker label in the top-left corner for a beat. */
const kicker = (t, text, dur = 2.6) => { e.add('tag', t, dur, { text, x: 72, y: 72, size: 27, kick: true, dot: true, scramble: true }, 20); e.cue('tick', t + 0.05, 0.3); e.cue('tick', t + 0.2, 0.2); };
/** A ticket lower-third with a counting value. */
const lower = (t, dur, kickerText, from, to, o = {}) => {
  e.add('lower', t, dur, { kicker: kickerText, count: [from, to], sign: o.sign || '', unit: o.unit ?? '$SLANA', accent: o.accent || 'pink', stub: o.stub || 'PENNY POND', countAt: o.countAt ?? 0.3, countDur: o.countDur || 0.9, w: o.w || 660, dec: o.dec }, 30);
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
const CHIP = [884, 12, 1036, 66]; // the round chip on the HUD (source px)

// ── 0 · intro card (1.5 bars) ──
const tIntro = bars(1.5);
e.add('card', 0, tIntro + 0.4, { variant: 'intro', kicker: 'GAMEPLAY / PENNY POND / LIVE ROUND', live: true, tagline: 'Five minutes. Stay alive. Get paid.', tagAccent: 5, tagAt: 1.45, tagGap: 0.16 }, 50);
e.cue('riser', 0.0, 0.35, { dur: 1.3 });
for (let i = 0; i < 5; i++) e.cue('pop', 0.62 + i * 0.07, 0.25, { pitch: 0.8 + i * 0.08 });
e.cue('stamp', 1.02, 0.8).cue('sub', 1.02, 0.6);
for (let i = 0; i < 6; i++) e.cue('stamp', 1.45 + i * 0.16 + 0.1, 0.32);
wipe(tIntro, ['pink', 'card']);

// ── 1 · join mid-round (2 bars) ── the lobby row counts the round down; the ticket; sign
e.at(tIntro);
const s1 = e.shot({ take: A2, from: 0.9, dur: bars(2), speed: [[0, 1.1], [2.5, 1.1], [3.0, 4.6], [5.0, 4.6], [5.6, 3]],
  cam: [[0, 960, 540, 1.0], [0.9, 520, 480, 1.75], [2.5, 520, 480, 1.8], [3.3, 960, 540, 1.2], [5.85, 960, 540, 1.25]] });
kicker(s1.start + 0.25, 'JOIN A ROUND MID-WAY', 2.8);
boxSrc(s1, s1.start + 0.95, 1.6, 280, 418, 700, 538, 'ROUND ALREADY RUNNING', { seed: 6 });
e.cue('whoosh', s1.start + 2.8, 0.4, { dur: 0.6 });

// ── 2 · drop in (1 bar) ── the round chip
const s2 = e.shot({ take: A2, from: mark(A2, 'enter') + 0.25, dur: bars(1),
  cam: [[0, 960, 540, 1.0], [0.6, 960, 300, 1.45], [2.92, 960, 300, 1.5]] });
boxSrc(s2, s2.start + 0.55, 2.3, ...CHIP, 'ROUND CLOCK', { seed: 9, below: true, color: 'mustard' });
e.add('ring', s2.start + 0.4, 2.4, { track: e.trackMe(s2, s2.start + 0.4, 2.4), label: 'YOU', pad: 1.4 }, 25);
e.cue('stamp', s2.start + 0.1, 0.5);

// ── 3 · loot (2 bars) ── value floats as Daphne sweeps up spilled loot
const loots = events(SP, 'value', (v) => v.reason === 'loot').map((x) => x.t);
let lootAt = loots[0];
{ let best = 0; for (const t0 of loots) { const n = loots.filter((x) => x >= t0 && x < t0 + 5).length; if (n > best) { best = n; lootAt = t0; } } }
const s4 = e.shot({ take: SP, from: lootAt - 0.6, dur: bars(2), zoom: 1.6, lag: 0.6 });
kicker(s4.start + 0.2, 'LOOT ON THE FLOOR');
{
  const inShot = events(SP, 'value', (v) => v.reason === 'loot').filter((x) => x.t >= s4.from && x.t <= s4.srcEnd);
  const v0 = (inShot[0].v.value - inShot[0].v.delta) / 1e6;
  const v1 = inShot[inShot.length - 1].v.value / 1e6;
  lower(s4.start + 1.6, 4.0, 'YOUR TILL / LOOT PICKED UP', Math.round(v0), Math.round(v1), { countAt: 0.3, countDur: 3.2 });
  for (const ev of inShot) e.cue('coin', e.timeOf(s4, ev.t), 0.35, { pitch: 1 + Math.random() * 0.3 });
}

// ── 4 · eat a player (2 bars) ── Daphne eats a rival's coin; its tokens move into her till
const eatsA2 = events(A2, 'value', (v) => v.reason === 'eat');
const tEatP = eatsA2[0].t;
const s3 = e.shot({ take: A2, from: tEatP - 2.6, dur: bars(2), zoom: 1.35, lag: 0.6, blend: true,
  speed: [[0, 1], [2.2, 1], [2.4, 0.5], [3.4, 0.5], [3.8, 1], [5.85, 1]] });
kicker(s3.start + 0.2, 'EAT A PLAYER', 2.4);
{
  const v = eatsA2[0].v;
  const tE = e.timeOf(s3, tEatP);
  e.cue('gulp', tE, 0.7);
  stamp(tE + 0.1, 'GULP!', 1420, 640, 'pink', { rot: -9, size: 110 });
  lower(tE + 0.5, s3.end - tE - 0.4, 'YOUR TILL / THEIR TOKENS', Math.round((v.value - v.delta) / 1e6), Math.round(v.value / 1e6), { countAt: 0.2, countDur: 0.9 });
}

// ── 5 · eaten by a bot, buy back in (2.5 bars) ── same round, same fee
wipe(s3.end, ['teal', 'card'], 0.7);
const tDie = events(A, 'death')[0].t;
const s5a = e.shot({ take: A, from: tDie - 1.3, dur: bars(1.25), zoom: 1.5, lag: 0.5, punch: [[1.2, 1.15, 0.15, 1.0, 0.4]], shake: [[1.3, 16]] });
kicker(s5a.start + 0.15, 'A BOT ATE HER: TOKENS SPILL', 2.6);
e.cue('gulp', e.timeOf(s5a, tDie), 0.7);
const tBuy = mark(A, 'buyback');
const s5b = e.shot({ take: A, from: tBuy - 0.4, dur: bars(1.25), speed: [[0, 1.2], [1.5, 1.2], [2.0, 3.0], [3.66, 3.0]],
  cam: [[0, 960, 600, 1.55], [1.4, 1150, 820, 2.0], [2.0, 960, 540, 1.25], [3.66, 960, 540, 1.25]] });
kicker(s5b.start + 0.1, 'EATEN? BUY BACK IN', 2.8);
stamp(s5b.start + 0.95, 'SAME ROUND', 1300, 300, 'teal', { rot: 6, size: 96 });

// ── 6 · the final minute (1 bar) ── joins close; the chip turns mustard
const tFinal = mark(A2, 'final');
const s6 = e.shot({ take: A2, from: tFinal - 0.6, dur: bars(1),
  cam: [[0, 960, 540, 1.15], [0.8, 960, 260, 1.6], [2.92, 960, 250, 1.65]] });
kicker(s6.start + 0.1, 'FINAL MINUTE / JOINS CLOSED', 2.8);
boxSrc(s6, s6.start + 0.75, 2.1, ...CHIP, 'NO NEW TICKETS', { seed: 4, below: true, color: 'mustard' });
e.cue('swell', s6.start + 0.4, 0.4, { dur: 0.6 });

// ── 7 · the last ten seconds (4 bars) ── she eats mochi_moon piece by piece, takes #1
wipe(s6.end, ['ink', 'card'], 0.6);
const tCount = mark(A2, 'count');
const tBell = events(A2, 'roundResult')[0].t;
const rr = events(A2, 'roundResult')[0].v;
const s7 = e.shot({ take: A2, from: tBell - bars(4) - 0.1, dur: bars(4),
  cam: [[0, 960, 470, 1.25], [3.0, 950, 470, 1.35], [8.0, 950, 470, 1.4], [11.7, 960, 470, 1.3]] });
kicker(s7.start + 0.2, 'THE LAST TEN SECONDS', 3.0);
e.add('ring', s7.start + 3.4, 3.2, { track: e.trackMe(s7, s7.start + 3.4, 3.2), label: 'STAY ALIVE', pad: 1.4 }, 25);
lower(s7.start + 6.8, s7.end - s7.start - 6.7, `YOUR TILL / ${rr.stats?.playersEaten ?? 2} PLAYERS EATEN`, 1000, Math.round(rr.payout / 1e6), { countAt: 0.25, countDur: 1.6, w: 700 });
const ranks = events(A2, 'rank', (v) => v.rank > 0).filter((x) => x.t > tCount - 15 && x.t < tBell);
if (ranks.length > 1) {
  const rseq = ranks.map((x) => x.v.rank);
  const r0 = s7.start + 0.5;
  e.add('rank', r0, s7.end - r0 - 0.2, { label: 'YOUR RANK', seq: rseq, at: ranks.slice(1).map((x) => e.timeOf(s7, x.t) - r0), x: 140, y: 380, w: 230 }, 30);
  for (const x of ranks.slice(1)) e.cue('tick', e.timeOf(s7, x.t), 0.5).cue('pop', e.timeOf(s7, x.t), 0.4);
}

// ── 8 · the bell (3 bars) ── the frozen world, the receipt, PAID
const tPaid = mark(A2, 'paid');
const s8 = e.shot({ take: A2, from: tBell - 0.05, dur: bars(3),
  cam: [[0, 960, 500, 1.3], [1.6, 960, 520, 1.15], [2.9, 960, 540, 1.0], [3.6, 800, 520, 1.45], [8.78, 790, 520, 1.55]] });
e.add('flash', s8.start, 0.35, { color: 'card', peak: 0.55 }, 60);
stamp(s8.start + 0.08, 'BELL!', 1320, 330, 'mustard', { rot: -10, size: 120, dur: 1.4 });
const tStamp = e.timeOf(s8, tPaid) + 0.35;
kicker(s8.start + 2.6, 'ALIVE AT THE BELL: PAID', 3.2);
e.cue('printer', s8.start + 2.7, 0.4, { dur: 1.2 });
e.cue('kaching', tStamp, 0.6).cue('impact', tStamp, 0.4);
{
  // the receipt's own sum: the till at the bell minus 5% of the profit over the 1,000 entry
  const till = rr.payout / 1e6;
  lower(tStamp + 0.4, s8.end - tStamp - 0.3, 'ROUND OVER / FEE ON PROFIT ONLY', 0, Math.round((till - (till - 1000) * 0.05) * 100) / 100, { stub: 'PAID', countDur: 1.2, accent: 'teal', w: 720, dec: 2 });
}

// ── 9 · outro card ──
wipe(s8.end, ['pink', 'card']);
const tOut = s8.end;
e.add('card', tOut - 0.05, bars(3) + 0.05, {
  variant: 'outro', kicker: 'SLANA / ON SOLANA', tagline: 'Eat. Grow. Last the round.', tagAccent: 4, tagAt: 0.9, tagGap: 0.3,
  foot: 'PRACTICE IS FREE  /  SLANA.IO  /  @SLANAIO', footAt: 2.0, footY: 812,
}, 50);
for (let i = 0; i < 3; i++) e.cue('stamp', tOut + 0.9 + i * 0.3 + 0.1, 0.6);
e.cue('sub', tOut + 0.4, 0.5);
e.at(tOut + bars(3));

const data = e.build(resolve(OUT, 'gameplay.json'));
// the score: the game's lobby music (melody and full kit), plus swung drums from the first cut;
// they drop out for the last ten seconds (the game's own ticks and bell carry it) and the receipt
const music = {
  parts: [{ file: resolve(HERE, 'cache/takes/music-lobby/audio.wav'), at: 0, from: 0.22 + 4 * BAR - tIntro, dur: data.duration + 0.2, gain: 0, fadeIn: 0.6, fadeOut: 2.5 }],
  drums: { bpm: BPM, phase: tIntro - BAR, start: tIntro, end: tOut + bars(2), gain: -5, drop: [[s7.start + bars(2), tOut - 0.05]], fills: [s6.end - BEAT] },
  gain: [[0, -4], [tIntro, 0], [s7.start + bars(2), 0], [s7.start + bars(2) + 1, -7], [s8.start + 3.5, -7], [tOut, 0], [tOut + bars(2), 0], [data.duration, -10]],
};
writeFileSync(resolve(OUT, 'gameplay-music.json'), JSON.stringify(music, null, 1));
console.log('gameplay edit:', data.duration.toFixed(2), 's,', data.frames, 'frames,', data.items.length, 'graphics,', data.sfx.length, 'cues');
for (const s of e.shots) console.log(`  ${s.start.toFixed(2)}-${s.end.toFixed(2)}  ${s.take} ${s.from.toFixed(2)}-${s.srcEnd.toFixed(2)}`);

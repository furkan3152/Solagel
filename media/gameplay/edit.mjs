#!/usr/bin/env node
// Video A: "Slana / Gameplay" (about 72 s). The edit decision list: which pieces of which takes,
// how they are timed, reframed and ramped, the graphics on top and the sound cues.
// Writes cache/edit/gameplay.json (+ music.json). Cuts sit on the bar lines of the game's own
// score (82 BPM, 4/4): bar = 2.927 s.
//   node media/gameplay/edit.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edit, events, mark, take } from './render/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'cache/edit');
mkdirSync(OUT, { recursive: true });
const BPM = 82, BEAT = 60 / BPM, BAR = BEAT * 4;
const bars = (n) => n * BAR;

const e = new Edit({ name: 'gameplay' });
const A = 'arena', T4 = 'arena-t4', T7 = 'arena-t7', SP = 'split';
const has = (t) => { try { take(t); return true; } catch { return false; } };

/** A kicker label in the top-left corner for a beat. */
const kicker = (t, text, dur = 2.6) => { e.add('tag', t, dur, { text, x: 72, y: 72, size: 27, kick: true, dot: true, scramble: true }, 20); e.cue('tick', t + 0.05, 0.3); e.cue('tick', t + 0.2, 0.2); };
/** A ticket lower-third with a counting value. */
const lower = (t, dur, kickerText, from, to, o = {}) => {
  e.add('lower', t, dur, { kicker: kickerText, count: [from, to], sign: o.sign || '', unit: o.unit ?? '$SLANA', accent: o.accent || 'pink', stub: o.stub || 'PENNY POND', countAt: 0.3, countDur: o.countDur || 0.9, w: o.w || 660 }, 30);
  e.cue('whoosh', t - 0.05, 0.28, { dur: 0.4, bright: 1.3 });
  e.cue('pop', t + 0.3, 0.35);
};
const stamp = (t, text, x, y, color = 'pink', o = {}) => {
  e.add('stamp', t, o.dur || 1.5, { text, x, y, color, rot: o.rot ?? -8, size: o.size || 130 }, 40);
  e.cue('stamp', t, 0.9);
  e.cue('impact', t, o.hit ?? 0.55);
};
const wipe = (t, colors = ['pink', 'paper'], dur = 0.8) => { e.add('wipe', t - dur / 2, dur, { colors }, 90); e.cue('paper', t - dur / 2, 0.55); };

// ── 0 · intro card (1.5 bars) ──
const tIntro = bars(1.5);
e.add('card', 0, tIntro + 0.4, { variant: 'intro', kicker: 'GAMEPLAY / PENNY POND / LIVE', live: true, tagline: 'Eat a player. Keep their tokens.', tagAccent: 4, tagAt: 1.55, tagGap: 0.16 }, 50);
e.cue('riser', 0.0, 0.35, { dur: 1.3 });
for (let i = 0; i < 5; i++) e.cue('pop', 0.62 + i * 0.07, 0.25, { pitch: 0.8 + i * 0.08 });
e.cue('stamp', 1.02, 0.8).cue('sub', 1.02, 0.6);
for (let i = 0; i < 6; i++) e.cue('stamp', 1.55 + i * 0.16 + 0.1, 0.32);
wipe(tIntro, ['pink', 'card']);

// ── 1 · buy a ticket (2 bars) ── lobby: the ticket sheet, sign, VALID stamp
e.at(tIntro);
const tStampSrc = 19.1;
const s1 = e.shot({ take: A, from: 6.0, dur: bars(2), speed: [[0, 3.4], [3.0, 3.4], [3.6, 1], [5.9, 1]],
  cam: [[0, 960, 540, 1.0], [2.6, 960, 520, 1.12], [3.9, 1010, 370, 1.85], [5.9, 1010, 370, 1.95]], shake: [] });
const st1 = e.timeOf(s1, tStampSrc);
s1.shake = [[st1 - s1.start, 18]];
e.resolveShot(s1);
kicker(s1.start + 0.3, 'BUY A TICKET');
lower(st1 + 0.15, 2.4, 'TICKET / PENNY POND', 0, 1000, { stub: 'ENTRY' });
e.cue('stamp', st1, 1.0).cue('impact', st1, 0.5);
e.cue('whoosh', s1.start + 3.0, 0.4, { dur: 0.6 });

// ── 2 · drop in (2 bars) ── lands next to a whale; two loot pickups; whip to the standings
const s2 = e.shot({ take: A, from: 20.95, dur: bars(2), zoom: 1.0,
  cam: [[0, 960, 540, 1.0], [0.9, 960, 540, 1.25], [3.1, 960, 540, 1.3], [3.55, 1700, 230, 2.15], [5.9, 1700, 230, 2.2]] });
kicker(s2.start + 0.9, 'DROP IN / LIVE ROOM', 2.3);
e.add('ring', s2.start + 1.0, 1.9, { track: e.trackMe(s2, s2.start + 1.0, 1.9), label: 'YOU', pad: 1.35 }, 25);
e.cue('whoosh', s2.start + 3.05, 0.6, { dur: 0.5 });
{
  // the standings panel (source px), boxed once the camera is on it
  const [x0, y0] = e.project(s2, s2.start + 3.8, 1662, 22), [x1, y1] = e.project(s2, s2.start + 3.8, 1902, 300);
  e.add('box', s2.start + 3.75, 2.0, { x: x0, y: y0, w: x1 - x0, h: y1 - y0, label: 'LIVE STANDINGS', labelBelow: true, seed: 5 }, 25);
}

// ── 3 · loot on the floor (2 bars) ──
const s3 = e.shot({ take: A, from: 85.2, dur: bars(2), zoom: 1.75, lag: 0.6 });
kicker(s3.start + 0.2, 'LOOT ON THE FLOOR');
lower(s3.start + 2.0, 3.3, 'YOUR TILL / LOOT PICKED UP', 1498, 2391, { countAt: 0.3, countDur: 3.0 });
for (const ev of events(A, 'value', (v) => v.reason === 'loot')) { const t = e.timeOf(s3, ev.t); if (t > s3.start && t < s3.end) e.cue('coin', t, 0.35, { pitch: 1 + Math.random() * 0.3 }); }

// ── 4 · the standings move (1 bar) ──
const s4 = e.shot({ take: A, from: 80.9, dur: bars(1), cam: { x: 1700, y: 210 }, zoom: 2.3, speed: 1.1 });
kicker(s4.start + 0.1, 'CLIMB THE STANDINGS', 2.6);
const tRank = e.timeOf(s4, 82.3) - s4.start - 0.25;
e.add('rank', s4.start + 0.25, 2.5, { label: 'YOUR RANK', seq: [3, 2], at: [tRank], x: 140, y: 640, w: 230 }, 30);
e.cue('tick', s4.start + 0.25 + tRank, 0.5).cue('pop', s4.start + 0.25 + tRank, 0.4);

// ── 5 · loot rain (2 bars) ── four pickups in a breath, slowed down; +stamp
const s5 = e.shot({ take: A, from: 97.55, dur: bars(2), zoom: 1.7, lag: 0.55, blend: true,
  speed: [[0, 1], [0.55, 1], [0.75, 0.55], [2.0, 0.55], [2.4, 1.7], [5.9, 1.7]], punch: [[0.6, 1.25, 0.25, 1.6, 0.5]] });
kicker(s5.start + 0.2, 'COIN RAIN');
const tRain = e.timeOf(s5, 98.9);
stamp(tRain + 0.05, 'LOOT!', 1330, 330, 'mustard', { rot: -10 });
lower(s5.start + 2.6, 3.0, 'YOUR TILL', 2391, 3552, { countAt: 0.2, countDur: 1.6 });
for (const ev of events(A, 'value', (v) => v.reason === 'loot')) { const t = e.timeOf(s5, ev.t); if (t > s5.start && t < s5.end - 0.05) e.cue('coin', t, 0.45, { pitch: 1.1 }); }
e.cue('swell', s5.start - 0.2, 0.4, { dur: 0.6 });

// ── 6 · eat a player (2 bars) ── Daphne swallows mochi_moon: +1,000 (a freeze on the bite)
wipe(s5.end, ['teal', 'card'], 0.7);
const s6 = e.shot({ take: T7, from: 66.7, dur: bars(2), zoom: 1.6, lead: [170, 40], lag: 0.6, blend: true,
  speed: [[0, 1], [2.55, 1], [2.75, 0.45], [3.05, 0.0], [3.6, 0.0], [3.8, 1], [5.9, 1]] });
const tBite = e.timeOf(s6, 69.8);
s6.punch = [[tBite - s6.start - 0.25, 1.35, 0.2, 1.2, 0.5]];
s6.shake = [[tBite - s6.start, 20]];
e.resolveShot(s6);
kicker(s6.start + 0.2, 'EAT A PLAYER, TAKE THEIR TOKENS', 2.8);
e.add('flash', tBite, 0.25, { color: 'card', peak: 0.45 }, 60);
stamp(tBite + 0.05, 'GULP!', 1380, 360, 'pink', { rot: -9 });
lower(tBite + 0.35, 2.4, 'ATE MOCHI_MOON / A PLAYER', 0, 1000, { sign: '+' });
e.cue('gulp', tBite, 0.8);

// ── 7 · split to catch (2 bars) ──
let s7;
if (has(SP) && events(SP, 'kill', (v) => v.killer === 'Daphne').length && take(SP).marks.some((m) => m.label === 'split')) {
  // the first split that caught something within 1.5 s
  const kills = events(SP, 'kill', (v) => v.killer === 'Daphne').map((k) => k.t);
  const sp = take(SP).marks.filter((m) => m.label === 'split').find((m) => kills.some((k) => k > m.t && k < m.t + 1.6)) || take(SP).marks.find((m) => m.label === 'split');
  const kt = kills.find((k) => k > sp.t) ?? sp.t + 0.8;
  s7 = e.shot({ take: SP, from: sp.t - 2.4, dur: bars(2), zoom: 1.45, lag: 0.5, blend: true,
    speed: [[0, 1], [2.2, 1], [2.45, 0.5], [3.5, 0.5], [3.9, 1], [5.9, 1]] });
  const tSp = e.timeOf(s7, sp.t), tK = e.timeOf(s7, kt);
  e.add('key', tSp - 0.7, 2.2, { keys: ['SPACE'], label: 'SPLIT', x: 1180, y: 900, presses: [0.7] }, 35);
  stamp(tK + 0.05, 'CAUGHT!', 1360, 340, 'teal', { rot: 7 });
  e.cue('whoosh', tSp, 0.5, { dur: 0.35, bright: 1.6 });
  e.cue('gulp', tK, 0.6);
} else {
  s7 = e.shot({ take: A, from: 118.9, dur: bars(2), zoom: 1.35, lag: 0.6, blend: true,
    speed: [[0, 1], [3.4, 1], [3.7, 0.5], [5.9, 0.5]] });
  const tSp = e.timeOf(s7, 122.78);
  e.add('key', tSp - 0.7, 2.0, { keys: ['SPACE'], label: 'SPLIT', x: 1180, y: 900, presses: [0.7] }, 35);
  e.cue('whoosh', tSp, 0.5, { dur: 0.35, bright: 1.6 });
}
kicker(s7.start + 0.2, 'SPLIT TO CATCH PREY');

// ── 8 · rug cactus (1 bar) ──
const s8 = e.shot({ take: T4, from: 153.7, dur: bars(1), zoom: 1.6, lead: [0, 170], lag: 0.5, punch: [[1.4, 1.2, 0.15, 0.8, 0.4]], shake: [[1.5, 16]] });
kicker(s8.start + 0.1, 'RUG CACTI POP BIG COINS', 2.6);
e.cue('impact', s8.start + 1.5, 0.45);

// ── 9 · run from bigger coins (2 bars) ──
wipe(s8.end, ['ink', 'card'], 0.6);
const s9 = e.shot({ take: A, from: 171.2, dur: bars(2), zoom: 1.15, lag: 0.8, blend: true, speed: [[0, 1.5], [3.0, 1.5], [3.4, 0.6], [5.9, 0.6]] });
kicker(s9.start + 0.2, 'BIGGER EATS SMALLER. RUN.', 2.8);
e.cue('riser', s9.start + 1.0, 0.3, { dur: 2.0 });

// ── 10 · cash out (4 bars) ── WAGMI, C, the channel ring, the receipt prints, PAID
const s10 = e.shot({ take: A, from: 180.6, dur: bars(4), lag: 0.7,
  speed: [[0, 1.2], [1.5, 1.2], [1.8, 1], [11.8, 1]],
  cam: [[0, 960, 540, 1.3], [3.6, 960, 540, 1.45], [4.4, 960, 500, 1.2], [5.3, 955, 470, 1.65], [11.8, 955, 470, 1.75]] });
const tC = e.timeOf(s10, mark(A, 'cashout'));
const tPaid = e.timeOf(s10, 188.0);
const tRcpt = e.timeOf(s10, 185.25);
s10.punch = [[tPaid - s10.start - 0.1, 1.12, 0.12, 0.7, 0.6]];
s10.shake = [[tPaid - s10.start, 14]];
e.resolveShot(s10);
kicker(s10.start + 0.2, 'CASH OUT ANY TIME', 3.0);
e.add('key', tC - 0.6, 2.4, { keys: ['C'], label: 'CASH OUT', x: 1240, y: 900, presses: [0.6] }, 35);
e.cue('tick', tC, 0.5);
e.cue('printer', tRcpt + 0.25, 0.45, { dur: 1.3 });
e.cue('stamp', tPaid, 1.0).cue('kaching', tPaid + 0.02, 0.7).cue('impact', tPaid, 0.45);
lower(tPaid + 0.5, s10.end - tPaid - 0.4, 'CASHED OUT / FEE ON PROFIT ONLY', 0, 2025.91, { stub: 'NET', countDur: 1.2, accent: 'teal', w: 720 });

// ── 11 · outro card ──
wipe(s10.end, ['pink', 'card']);
const tOut = s10.end;
e.add('card', tOut - 0.05, bars(3) + 0.05, {
  variant: 'outro', kicker: 'SLANA / ON SOLANA', tagline: 'Eat. Grow. Cash out.', tagAccent: 2, tagAt: 0.9, tagGap: 0.32,
  foot: 'PRACTICE IS FREE  /  TICKETS FROM 1,000 $SLANA  /  SLANA.XYZ', footAt: 2.0, footY: 812,
}, 50);
for (let i = 0; i < 3; i++) e.cue('stamp', tOut + 0.9 + i * 0.32 + 0.1, 0.6);
e.cue('sub', tOut + 0.4, 0.5);
e.at(tOut + bars(3));

const data = e.build(resolve(OUT, 'gameplay.json'));
// the score: the game's lobby music (melody and full kit), a downbeat on the first cut,
// plus swung drums from the first cut to the cash-out; they drop out for the channel and come back
const music = {
  parts: [{ file: resolve(HERE, 'cache/takes/music-lobby/audio.wav'), at: 0, from: 0.22 + 4 * BAR - tIntro, dur: data.duration + 0.2, gain: 0, fadeIn: 0.6, fadeOut: 2.5 }],
  drums: { bpm: BPM, phase: tIntro - BAR, start: tIntro, end: tOut + bars(2), gain: -5, drop: [[tC - 0.2, tPaid - 0.05]], fills: [s9.end - BEAT] },
  gain: [[0, -4], [tIntro, 0], [tOut + bars(2), 0], [data.duration, -10]],
};
writeFileSync(resolve(OUT, 'gameplay-music.json'), JSON.stringify(music, null, 1));
console.log('gameplay edit:', data.duration.toFixed(2), 's,', data.frames, 'frames,', data.items.length, 'graphics,', data.sfx.length, 'cues');
for (const s of e.shots) console.log(`  ${s.start.toFixed(2)}-${s.end.toFixed(2)}  ${s.take} ${s.from.toFixed(2)}-${s.srcEnd.toFixed(2)}`);

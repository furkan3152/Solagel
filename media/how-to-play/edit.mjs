#!/usr/bin/env node
// Video B: "How to play Slana" (about 2:25). Narrated, in eight chapters. The layout follows the
// voiceover: each line gets its stretch of picture, and the chapter cards sit between them.
// Footage and the render kit are shared with the gameplay video (media/gameplay).
// Writes cache/edit/howto.json and howto-music.json.
//   node media/how-to-play/edit.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edit, events, mark, take } from '../gameplay/render/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'cache/edit');
mkdirSync(OUT, { recursive: true });
const DUR = JSON.parse(readFileSync(resolve(HERE, 'cache/vo-raw/durations.json'), 'utf8'));
const e = new Edit({ name: 'howto' });
const A = 'arena', T7 = 'arena-t7', L = 'lobby', P = 'practice', C = 'controls', S = 'spill';
const has = (t) => { try { take(t); return true; } catch { return false; } };

// ── helpers ──
const GAP = 0.25; // breath between lines
let chapterN = 0;
const ACCENT = ['pink', 'teal', 'mustard', 'blue', 'pink', 'teal', 'mustard', 'blue'];
/** A chapter card (1.5 s); its line starts while the card lifts away. Returns the line's start. */
function chapter(n, title, sub, opts = {}) {
  chapterN = n;
  const t0 = e.t;
  const d = opts.dur ?? 1.4;
  e.add('card', t0, d + 0.3, { variant: 'chapter', num: String(n).padStart(2, '0'), kicker: `CHAPTER ${String(n).padStart(2, '0')} / 08`, title, sub, accent: ACCENT[n - 1], titleSize: opts.titleSize || 116, stamp: opts.stamp, stub: 'HOW TO PLAY' }, 50);
  e.add('wipe', t0 + d - 0.05, 0.7, { colors: [ACCENT[n - 1], 'card'], skew: -6 }, 90);
  e.cue('whoosh', t0, 0.35, { dur: 0.5 }).cue('stamp', t0 + 0.18, 0.5).cue('paper', t0 + d - 0.05, 0.4);
  if (opts.stamp) e.cue('stamp', t0 + 1.0, 0.45);
  e.at(t0 + d + 0.3);
  // the chapter chip stays up while the chapter runs (added when the chapter ends)
  return t0 + d - 0.35;
}
const chips = [];
/** Places VO line `id` at t and returns its end. */
const say = (id, t) => { e.voice(id, t); return t + DUR[id]; };
const caption = (t, dur, text, o = {}) => { e.add('caption', t, dur, { text, y: o.y ?? 896, size: o.size ?? 48, ...o }, 45); e.cue('pop', t + 0.05, 0.22); };
const kick = (t, text, dur = 2.4) => { e.add('tag', t, dur, { text, x: 72, y: 72, size: 26, kick: true, dot: true, scramble: true }, 20); e.cue('tick', t + 0.05, 0.25); };
const key = (t, dur, keys, label, presses, o = {}) => { e.add('key', t, dur, { keys, label, x: o.x ?? 1250, y: o.y ?? 640, presses, plus: o.plus, anchor: o.anchor }, 46); for (const p of presses) e.cue('tick', t + (Array.isArray(p) ? p[0] : p), 0.45); };
const boxSrc = (s, t, dur, x0, y0, x1, y1, label, o = {}) => {
  const [a, b] = e.project(s, t + 0.1, x0, y0), [c, d] = e.project(s, t + 0.1, x1, y1);
  e.add('box', t, dur, { x: a, y: b, w: c - a, h: d - b, label, labelBelow: o.below, seed: o.seed || 3, color: o.color }, 40);
};
/** Shots that fill [t, t + dur) in turn: specs [{take, from, d (share), ...shot}] */
function fill(t, dur, specs) {
  const tot = specs.reduce((a, s) => a + (s.d || 1), 0);
  let c = t;
  const out = [];
  for (const sp of specs) {
    const d = (dur * (sp.d || 1)) / tot;
    const { d: _, ...rest } = sp;
    out.push(e.shot({ start: c, dur: d, ...rest }));
    c += d;
  }
  e.at(t + dur);
  return out;
}

// ── intro card ──
e.add('card', 0, 3.15, { variant: 'intro', kicker: 'HOW TO PLAY / 8 CHAPTERS', tagline: 'The two-minute guide.', tagAccent: 1, tagAt: 1.3, tagGap: 0.14 }, 50);
e.add('wipe', 2.8, 0.7, { colors: ['pink', 'card'] }, 90);
e.cue('riser', 0, 0.25, { dur: 1.1 }).cue('stamp', 1.02, 0.6).cue('paper', 2.8, 0.45);
for (let i = 0; i < 4; i++) e.cue('stamp', 1.3 + i * 0.14 + 0.1, 0.25);
say('intro', 0.75);
e.at(3.15);

// ── 01 · what Slana is ──
let t = chapter(1, 'What Slana is', 'agar.io, on-chain, on Solana.');
let end = say('c1', t);
{
  const [a, b, c] = fill(e.t, end + 0.42 - e.t, [
    { take: A, from: 21.3, d: 3.2, zoom: 1.2 },
    { take: T7, from: 68.0, d: 3.0, zoom: 1.6, lead: [170, 30], lag: 0.6 },
    { take: A, from: 185.4, d: 3.3, cam: { x: 955, y: 470 }, zoom: 1.55 },
  ]);
  caption(a.start + 0.4, a.dur - 0.5, 'You are a coin in a *live* arena.');
  caption(b.start + 0.2, b.dur - 0.3, 'Eat players. *Take their tokens.*');
  caption(c.start + 0.2, c.dur - 0.2, 'Cash out *whenever you like.*');
  e.cue('gulp', e.timeOf(b, 69.8), 0.4);
  e.cue('stamp', e.timeOf(c, 188.0), 0.6).cue('kaching', e.timeOf(c, 188.0), 0.4);
}
chips.push([1, 'WHAT SLANA IS', t, e.t]);

// ── 02 · start free in Practice ──
t = chapter(2, 'Start free', 'No wallet. No tokens. Just bots.', { stamp: 'FREE' });
end = say('c2', t);
{
  const src = has(C) ? C : P;
  const enter = mark(src, 'enter');
  const [a, b] = fill(e.t, end + 0.42 - e.t, [
    { take: src, from: 0.6, d: 5.4, speed: (enter - 0.6) / 5.4 > 1 ? [[0, 1], [3.6, 1], [4.2, Math.min(3, (enter - 0.6 - 3.6) / 1.6)], [5.4, Math.min(3, (enter - 0.6 - 3.6) / 1.6)]] : 1, cam: [[0, 960, 540, 1.0], [1.2, 520, 560, 1.75], [5.4, 520, 560, 1.8]] },
    { take: src, from: enter + 0.2, d: 4.6, zoom: 1.25 },
  ]);
  boxSrc(a, a.start + 1.4, 2.6, 270, 330, 712, 420, 'PRACTICE / FREE', { seed: 4 });
  caption(a.start + 1.6, 3.0, 'Pick *Practice*, press Quick Play.');
  caption(b.start + 0.4, 2.0, 'No wallet. No tokens.');
  caption(b.start + 2.5, b.dur - 2.6, 'Two leagues: *Rookie* and *Pro*.');
}
chips.push([2, 'START FREE', t, e.t]);

// ── 03 · controls ──
t = chapter(3, 'Controls', 'Steer, split, tip mass, stickers, chat.', { titleSize: 120 });
{
  const src = has(C) ? C : P;
  const m = (l) => mark(src, l);
  // steer
  let tt = t + 0.15;
  end = say('c3a', tt);
  const s1 = e.shot({ start: e.t, take: src, from: m('steer') + 0.4, dur: end + 1.6 - e.t, zoom: 1.2, lag: 1.2 });
  e.add('mouse', s1.start + 0.3, s1.dur - 0.3, { x: 1260, y: 830, label: 'MOVE THE MOUSE' }, 46);
  e.at(s1.end);
  // split
  tt = e.t + 0.1;
  end = say('c3b', tt);
  const sp = take(src).keys.find((k) => k.code === 'Space' && k.t > m('split')) || { t: m('split') + 1 };
  const s2 = e.shot({ start: e.t, take: src, from: sp.t - 1.5, dur: Math.max(3.6, end + 0.42 - e.t), zoom: 1.3, lag: 0.8, blend: true, speed: [[0, 1], [1.3, 1], [1.5, 0.6], [2.6, 0.6], [2.9, 1]] });
  key(s2.start + 0.3, s2.dur - 0.4, ['SPACE'], 'SPLIT', [e.timeOf(s2, sp.t) - s2.start - 0.3], { x: 1180, y: 860 });
  e.at(s2.end);
  // eject
  tt = e.t + 0.1;
  end = say('c3c', tt);
  const w = take(src).keys.find((k) => k.code === 'KeyW' && k.t > m('eject')) || { t: m('eject') + 0.5 };
  const s3 = e.shot({ start: e.t, take: src, from: w.t - 0.8, dur: Math.max(3.0, end + 0.5 - e.t), zoom: 1.45, lag: 0.8 });
  key(s3.start + 0.2, s3.dur - 0.3, ['W'], 'HOLD TO TIP MASS', [[e.timeOf(s3, w.t) - s3.start - 0.2, 1.3]], { x: 1250, y: 860 });
  e.at(s3.end);
  // stickers and chat
  tt = e.t + 0.1;
  end = say('c3d', tt);
  const s4 = e.shot({ start: e.t, take: src, from: m('emotes') - 0.3, dur: Math.max(4.2, end + 0.5 - e.t), zoom: 1.35, lag: 0.8, speed: 1.15 });
  const emoteKeys = take(src).keys.filter((k) => /^Digit/.test(k.code) && k.t > m('emotes') && k.t < m('emotes') + 8);
  key(s4.start + 0.2, 2.3, ['1', '-', '8'], 'STICKERS', emoteKeys.slice(0, 3).map((k) => [e.timeOf(s4, k.t) - s4.start - 0.2, 0.12, 0]), { x: 1160, y: 860 });
  e.at(s4.end);
  const s5 = e.shot({ take: src, from: m('chat') - 0.2, dur: 2.6, zoom: 1.2, lag: 0.8, speed: 1.3 });
  key(s5.start + 0.1, s5.dur - 0.1, ['ENTER'], 'CHAT', [0.25, 2.0], { x: 1180, y: 860 });
}
chips.push([3, 'CONTROLS', t, e.t]);

// ── 04 · eat and avoid ──
t = chapter(4, 'Eat and avoid', 'Bigger eats smaller. Mind the cacti.', { titleSize: 112 });
end = say('c4a', t);
e.add('board', e.t, end + 0.5 - e.t, { kicker: 'THE RULE', title: 'Bigger eats *smaller*.', titleSize: 80 }, 48);
e.add('eatrule', e.t + 0.3, end + 0.3 - e.t, { rule: 'At least *1.25x* the mass, and mostly cover it.', moveAt: 2.2, ruleAt: 3.4, cy: 520 }, 49);
e.cue('whoosh', e.t + 2.2, 0.35, { dur: 0.8 }).cue('gulp', e.t + 3.4, 0.6).cue('pop', e.t + 3.4, 0.3);
e.at(end + 0.6);
let tt = e.t + 0.1;
end = say('c4b', tt);
{
  const s = e.shot({ take: A, from: 171.6, dur: end + 0.42 - e.t, zoom: 1.15, lag: 0.8, speed: 1.2 });
  e.add('ring', s.start + 0.4, s.dur - 0.5, { track: e.trackMe(s, s.start + 0.4, s.dur - 0.5), label: 'YOU', pad: 1.4 }, 40);
  caption(s.start + 0.5, s.dur - 0.6, 'Bigger coins hunt you. *Run.*');
}
tt = e.t + 0.1;
end = say('c4c', tt);
{
  const pops = events(P, 'cells', (v) => v >= 9).map((x) => x.t);
  const pop = pops[0] ?? mark(P, 'popped');
  const s = e.shot({ take: P, from: pop - 2.2, dur: end + 0.42 - e.t, zoom: 1.35, lag: 0.6, punch: [[2.1, 1.15, 0.15, 0.8, 0.4]], shake: [[2.2, 14]] });
  caption(s.start + 0.3, s.dur - 0.4, 'Rug cacti pop *big* coins.');
  e.cue('impact', s.start + 2.2, 0.4);
}
tt = e.t + 0.1;
end = say('c4d', tt);
{
  let s;
  if (has(S) && take(S).marks.some((m) => m.label === 'eaten')) {
    const dth = events(S, 'death')[0]?.t ?? mark(S, 'eaten');
    s = e.shot({ take: S, from: dth - 2.6, dur: end + 0.5 - e.t, zoom: 1.3, lag: 0.6, punch: [[2.5, 1.2, 0.2, 1.0, 0.5]] });
    caption(s.start + 0.3, 2.6, 'Bots carry *no value*.');
    caption(s.start + 3.1, s.dur - 3.2, 'Eaten by a bot? Your tokens spill as *loot*.');
  } else {
    s = e.shot({ take: 'arena-t4', from: 178.6, dur: end + 0.5 - e.t, zoom: 1.4, lag: 0.6, lead: [0, 120] });
    caption(s.start + 0.3, 2.6, 'Bots carry *no value*.');
    caption(s.start + 3.1, s.dur - 3.2, 'Eaten by a bot? Your tokens spill as *loot*.');
  }
}
chips.push([4, 'EAT AND AVOID', t, e.t]);

// ── 05 · arenas and tickets ──
t = chapter(5, 'Arenas and tickets', 'A fixed entry fee per room.', { titleSize: 96 });
end = say('c5a', t);
{
  const [w, l, s] = fill(e.t, end + 0.42 - e.t, [
    { take: L, from: 19.4, d: 3.0, cam: [[0, 960, 540, 1.0], [1.2, 1180, 400, 1.6], [3, 1180, 400, 1.6]] },
    { take: L, from: 3.0, d: 5.4, cam: [[0, 520, 600, 1.75], [5.4, 520, 610, 1.8]], speed: 0.9 },
    { take: L, from: 44.5, d: 4.4, cam: [[0, 960, 520, 1.45], [4.4, 960, 540, 1.6]] },
  ]);
  caption(w.start + 0.3, w.dur - 0.4, 'Connect a wallet.');
  // the four arenas in the list (source px rows)
  const rows = [[430, 'PENNY POND / 1,000'], [530, 'SILVER CREEK / 10,000'], [630, 'GOLD LAKE / PASS'], [740, 'WHALE BAY / PASS']];
  rows.forEach(([y, lab], i) => boxSrc(l, l.start + 0.6 + i * 1.1, l.end - (l.start + 0.6 + i * 1.1) - 0.05, 272, y - 44, 712, y + 44, lab, { seed: 7 + i, color: i > 1 ? 'mustard' : 'pink' }));
  caption(s.start + 0.3, s.dur - 0.4, 'Buy a ticket: the fee is fixed and shown up front.');
}
tt = e.t + 0.1;
end = say('c5b', tt);
{
  const [a, b] = fill(e.t, end + 0.5 - e.t, [
    { take: A, from: 24.0, d: 2.6, cam: { x: 150, y: 70 }, zoom: 3.2 },
    { take: T7, from: 68.6, d: 3.6, zoom: 1.5, lead: [170, 30], lag: 0.6 },
  ]);
  e.add('arrow', a.start + 0.3, a.dur - 0.35, { from: [900, 760], to: [700, 470], label: 'YOUR TILL', bend: -0.2 }, 40);
  caption(b.start + 0.3, b.dur - 0.4, 'Eat a player: their tokens move into your till.');
  e.cue('gulp', e.timeOf(b, 69.8), 0.4);
}
chips.push([5, 'ARENAS AND TICKETS', t, e.t]);

// ── 06 · cash out ──
t = chapter(6, 'Cash out', 'The fee only touches profit.', { stamp: 'PAID' });
end = say('c6a', t);
{
  const tc = mark(A, 'cashout');
  const s = e.shot({ take: A, from: tc - 1.0, dur: end + 0.5 - e.t, lag: 0.7,
    cam: [[0, 960, 540, 1.35], [3.6, 960, 540, 1.5], [4.3, 955, 470, 1.6], [9, 955, 470, 1.7]] });
  key(s.start + 0.3, 2.8, ['C'], 'CASH OUT', [e.timeOf(s, tc) - s.start - 0.3], { x: 1240, y: 860 });
  e.add('ring', e.timeOf(s, tc) + 0.2, 2.6, { track: e.trackMe(s, e.timeOf(s, tc) + 0.2, 2.6), label: '3 SECONDS', pad: 1.55, color: 'teal', color2: 'pink' }, 40);
  e.cue('printer', e.timeOf(s, 185.5), 0.4, { dur: 1.2 }).cue('stamp', e.timeOf(s, 188.0), 0.7).cue('kaching', e.timeOf(s, 188.0), 0.4);
}
tt = e.t + 0.1;
end = say('c6b', tt);
let end2 = say('c6c', end + GAP);
{
  const b0 = e.t, bd = end2 + 0.7 - e.t;
  e.add('board', b0, bd, { kicker: 'EXAMPLE / DEFAULT SETTINGS', title: 'Fee on *profit* only.', titleSize: 78 }, 48);
  e.add('receipt', b0 + 0.4, bd - 0.4, { x: 300, y: 300, w: 560, title: 'SLANA CASH-OUT', sub: 'NO PASS / FEE 5%', rows: [['ENTRY FEE', '1,000'], ['CASH-OUT VALUE', '2,000'], ['PROFIT', '1,000'], ['FEE 5% OF PROFIT', '-50', 'pink']], net: '1,950', netLabel: 'TO YOUR WALLET', stamp: 'PAID', printDur: 3.2, stampAt: 6.6, rot: -1.5 }, 49);
  const pt = end + GAP - b0;
  e.add('receipt', b0 + pt - 0.3, bd - pt + 0.3, { x: 1080, y: 300, w: 560, title: 'SLANA CASH-OUT', sub: 'WITH A PASS / FEE 2%', rows: [['ENTRY FEE', '1,000'], ['CASH-OUT VALUE', '2,000'], ['PROFIT', '1,000'], ['FEE 2% OF PROFIT', '-20', 'teal']], net: '1,980', netLabel: 'TO YOUR WALLET', stamp: 'PASS', stampColor: 'pink', printDur: 1.6, stampAt: 2.6, rot: 1.5 }, 49);
  e.cue('printer', b0 + 0.65, 0.35, { dur: 3.1 }).cue('stamp', b0 + 0.4 + 6.6, 0.6).cue('printer', b0 + pt, 0.35, { dur: 1.5 }).cue('stamp', b0 + pt - 0.3 + 2.6, 0.6);
  e.at(b0 + bd);
}
tt = e.t + 0.1;
end = say('c6d', tt);
{
  const b0 = e.t, bd = end + 0.5 - e.t;
  e.add('board', b0, bd, { kicker: 'WHERE THE FEE GOES', title: 'Split three ways.', titleSize: 78 }, 48);
  e.add('splitbar', b0 + 0.3, bd - 0.3, { x: 160, y: 520, w: 1600, parts: [{ label: 'TREASURY', pct: 50, color: 'blue' }, { label: 'SEASON POOL', pct: 30, color: 'mustard' }, { label: 'BURNED', pct: 20, color: 'red' }] }, 49);
  [0.6, 1.0, 1.4].forEach((d, i) => e.cue('pop', b0 + 0.3 + d, 0.35, { pitch: 0.9 + i * 0.15 }));
  e.at(b0 + bd);
}
chips.push([6, 'CASH OUT', t, e.t]);

// ── 07 · the Slana Pass and seasons ──
t = chapter(7, 'The Slana Pass', 'Free mint. Pass rooms. Seasons.', { titleSize: 104 });
end = say('c7a', t);
{
  const [a, b, c] = fill(e.t, end + 0.42 - e.t, [
    { take: L, from: 69.8, d: 3.2, cam: [[0, 960, 540, 1.0], [1.0, 770, 520, 1.45], [3.2, 770, 520, 1.5]] },
    { take: L, from: 77.0, d: 3.6, cam: [[0, 940, 540, 1.45], [3.6, 940, 520, 1.6]] },
    { take: L, from: 89.5, d: 3.4, cam: [[0, 960, 540, 1.0], [3.4, 960, 500, 1.15]] },
  ]);
  const perks = ['PASS ROOMS', '2% FEE', '+15% HEAD START', '2 S CASH-OUT'];
  const p0 = a.start + 2.2;
  perks.forEach((p, i) => { e.add('tag', p0 + i * 1.25, end - (p0 + i * 1.25) + 0.3, { text: p, x: 1840, y: 250 + i * 92, size: 30, ink: i % 2 === 1, anchor: 'tr', rot: i % 2 ? 2 : -2 }, 46); e.cue('stamp', p0 + i * 1.25, 0.35); });
  caption(a.start + 0.3, 2.2, 'A *free-mint* NFT.');
}
tt = e.t + 0.1;
end = say('c7b', tt);
{
  const s = e.shot({ take: L, from: 102.5, dur: end + 0.5 - e.t, cam: [[0, 960, 560, 1.15], [5.5, 960, 600, 1.35]] });
  caption(s.start + 0.3, s.dur - 0.4, 'Pass tickets score points. The *top 10* win prizes.');
}
chips.push([7, 'PASS AND SEASONS', t, e.t]);

// ── 08 · tips ──
t = chapter(8, 'Quick tips', 'Play smart. Cash out ahead.', { titleSize: 116 });
end = say('c8', t);
{
  const src = has(C) ? C : P;
  const [a, b, c] = fill(e.t, end + 0.42 - e.t, [
    { take: src, from: mark(src, 'enter') + 2.5, d: 2.2, zoom: 1.2 },
    { take: A, from: 121.3, d: 2.6, zoom: 1.3, lag: 0.6 },
    { take: A, from: 182.6, d: 3.2, zoom: 1.4 },
  ]);
  kick(a.start + 0.1, 'WARM UP IN PRACTICE', a.dur);
  kick(b.start + 0.1, 'SPLIT ONLY WHEN SURE', b.dur);
  kick(c.start + 0.1, 'CASH OUT WHILE AHEAD', c.dur);
}
chips.push([8, 'TIPS', t, e.t]);

// ── outro ──
const tOut = e.t;
e.add('wipe', tOut - 0.35, 0.7, { colors: ['pink', 'card'] }, 90);
e.cue('paper', tOut - 0.35, 0.45);
e.add('card', tOut, 4.3, { variant: 'outro', kicker: 'SLANA / ON SOLANA', tagline: 'Eat. Grow. Cash out.', tagAccent: 2, tagAt: 0.75, tagGap: 0.42, foot: 'START FREE IN PRACTICE  /  SLANA.XYZ', footAt: 2.0, footY: 812 }, 50);
for (let i = 0; i < 3; i++) e.cue('stamp', tOut + 0.75 + i * 0.42 + 0.1, 0.55);
say('outro', tOut + 0.55);
e.at(tOut + 4.3);

for (const [n, label, a, b] of chips) e.add('chip', a + 0.6, b - a - 0.9, { n: String(n).padStart(2, '0'), total: '08', label }, 44);

const data = e.build(resolve(OUT, 'howto.json'));
// the bed: the game's in-room score (calm), under everything, ducked by the voice in the mixer
const music = {
  parts: [{ file: resolve(HERE, '../gameplay/cache/takes/music-game/audio.wav'), at: 0, from: 6.0, dur: data.duration + 0.5, gain: 0, fadeIn: 1.0, fadeOut: 3.0 }],
  gain: [[0, -2], [3.15, -4], [data.duration - 4.3, -4], [data.duration - 3.8, -1], [data.duration, -8]],
};
writeFileSync(resolve(OUT, 'howto-music.json'), JSON.stringify(music, null, 1));
console.log('howto edit:', data.duration.toFixed(2), 's,', data.frames, 'frames,', data.items.length, 'graphics,', data.vo.length, 'lines');
for (const [n, label, a, b] of chips) console.log(`  ${String(n).padStart(2, '0')} ${label.padEnd(20)} ${a.toFixed(1)} - ${b.toFixed(1)}`);

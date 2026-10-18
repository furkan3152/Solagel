#!/usr/bin/env node
// Video B: "How to play Slana" (about 2:25). Narrated, in seven chapters. The layout follows the
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
// arena2: a round Daphne survives to the bell; arena: a round where a bot eats her and she buys back in
const A = 'arena2', A2 = 'arena2', D = 'arena', H = 'held', L = 'lobby', P = 'practice', C = 'controls', S = 'spill';
const has = (t) => { try { take(t); return true; } catch { return false; } };

// ── helpers ──
const GAP = 0.25; // breath between lines
let chapterN = 0;
const ACCENT = ['pink', 'teal', 'mustard', 'blue', 'pink', 'teal', 'mustard'];
const NCH = String(ACCENT.length).padStart(2, '0');
/** A chapter card (1.5 s); its line starts while the card lifts away. Returns the line's start. */
function chapter(n, title, sub, opts = {}) {
  chapterN = n;
  const t0 = e.t;
  const d = opts.dur ?? 1.4;
  e.add('card', t0, d + 0.3, { variant: 'chapter', num: String(n).padStart(2, '0'), kicker: `CHAPTER ${String(n).padStart(2, '0')} / ${NCH}`, title, sub, accent: ACCENT[n - 1], titleSize: opts.titleSize || 116, stamp: opts.stamp, stub: 'HOW TO PLAY' }, 50);
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
e.add('card', 0, 3.15, { variant: 'intro', kicker: 'HOW TO PLAY / 7 CHAPTERS', tagline: 'The two-minute guide.', tagAccent: 1, tagAt: 1.3, tagGap: 0.14 }, 50);
e.add('wipe', 2.8, 0.7, { colors: ['pink', 'card'] }, 90);
e.cue('riser', 0, 0.25, { dur: 1.1 }).cue('stamp', 1.02, 0.6).cue('paper', 2.8, 0.45);
for (let i = 0; i < 4; i++) e.cue('stamp', 1.3 + i * 0.14 + 0.1, 0.25);
say('intro', 0.75);
e.at(3.15);

// ── 01 · what Slana is ──
let t = chapter(1, 'What Slana is', 'On-chain coin arenas on Solana.');
let end = say('c1', t);
const eats = events(A, 'value', (v) => v.reason === 'eat');
const tBell = events(A, 'roundResult')[0].t, tPaid = mark(A, 'paid');
{
  const [a, b, c] = fill(e.t, end + 0.42 - e.t, [
    { take: A, from: 139.0, d: 3.2, zoom: 1.1, lag: 0.8 },
    { take: A, from: eats[0].t - 0.8, d: 3.0, cam: [[0, 950, 480, 1.4], [3, 950, 480, 1.45]] },
    { take: A, from: tPaid - 1.2, d: 3.3, cam: [[0, 800, 520, 1.45], [3.3, 790, 520, 1.55]] },
  ]);
  caption(a.start + 0.4, a.dur - 0.5, 'You are a coin in a *live* arena.');
  caption(b.start + 0.2, b.dur - 0.3, 'Eat players. *Take their tokens.*');
  caption(c.start + 0.2, c.dur - 0.2, 'Alive at the bell? *You get paid.*', { y: 930 });
  e.cue('gulp', b.start + 0.8, 0.4);
  e.cue('stamp', e.timeOf(c, tPaid) + 0.3, 0.6).cue('kaching', e.timeOf(c, tPaid) + 0.3, 0.4);
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
    { take: P, from: 29.5, d: 4.6, zoom: 1.25 },
  ]);
  boxSrc(a, a.start + 1.4, 2.6, 272, 320, 702, 406, 'PRACTICE / FREE', { seed: 4 });
  caption(a.start + 1.6, 3.0, 'Pick *Practice*, press Quick Play.');
  caption(b.start + 0.4, b.dur - 0.5, 'No wallet. No tokens. *Just bots.*');
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
  const s = e.shot({ take: D, from: events(D, 'death')[0].t - 5.4, dur: end + 0.42 - e.t, zoom: 1.15, lag: 0.8, speed: 1.2 });
  caption(s.start + 0.5, s.dur - 0.6, 'Bigger coins hunt you. *Run.*');
}
tt = e.t + 0.1;
end = say('c4c', tt);
{
  // Daphne runs into a rug cactus in arena2 and pops into pieces ("RUGGED!")
  const pop = events(A2, 'cells', (v) => v >= 9)[0].t;
  const s = e.shot({ take: A2, from: pop - 2.2, dur: end + 0.42 - e.t, zoom: 1.35, lag: 0.6, punch: [[2.1, 1.15, 0.15, 0.8, 0.4]], shake: [[2.2, 14]] });
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
    const dth = events(A, 'death')[0].t;
    s = e.shot({ take: A, from: dth - 2.6, dur: end + 0.5 - e.t, zoom: 1.3, lag: 0.6, punch: [[2.5, 1.2, 0.2, 1.0, 0.5]] });
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
    { take: L, from: mark(L, 'wallet') + 1.1, d: 3.0, cam: [[0, 960, 540, 1.0], [1.2, 1180, 400, 1.6], [3, 1180, 400, 1.6]] },
    { take: L, from: mark(L, 'tickets') + 1.8, d: 6.4, cam: [[0, 620, 650, 1.5], [6.4, 620, 660, 1.55]], speed: 0.9 },
    { take: L, from: mark(L, 'ticket-scroll') + 0.8, d: 4.4, cam: [[0, 960, 520, 1.45], [4.4, 960, 540, 1.6]] },
  ]);
  caption(w.start + 0.3, w.dur - 0.4, 'Connect a wallet.');
  // the four arenas in the list (source px rows)
  const rows = [[479, 'PENNY POND / 1,000'], [616, 'SILVER CREEK / 10,000'], [753, 'GOLD LAKE / 50,000'], [890, 'WHALE BAY / 250,000']];
  rows.forEach(([y, lab], i) => boxSrc(l, l.start + 0.6 + i * 1.2, l.end - (l.start + 0.6 + i * 1.2) - 0.05, 272, y - 64, 702, y + 64, lab, { seed: 7 + i, color: ['pink', 'teal', 'mustard', 'blue'][i] }));
  caption(s.start + 0.3, s.dur - 0.4, 'Buy a ticket: the fee is fixed and shown up front.');
}
tt = e.t + 0.1;
end = say('c5b', tt);
{
  const [a, b] = fill(e.t, end + 0.5 - e.t, [
    { take: A2, from: mark(A2, 'enter') + 4.0, d: 2.6, cam: { x: 150, y: 70 }, zoom: 3.2 },
    { take: A, from: eats[0].t - 0.6, d: 3.6, cam: [[0, 950, 480, 1.3], [3.6, 950, 480, 1.4]] },
  ]);
  e.add('arrow', a.start + 0.3, a.dur - 0.35, { from: [900, 760], to: [700, 470], label: 'YOUR TILL', bend: -0.2 }, 40);
  caption(b.start + 0.3, b.dur - 0.4, 'Eat a player: their tokens move into your till.');
  e.cue('gulp', b.start + 0.6, 0.4);
}
chips.push([5, 'ARENAS AND TICKETS', t, e.t]);

// ── 06 · rounds and payouts ──
t = chapter(6, 'Rounds and payouts', 'Five minutes. Alive at the bell? Paid.', { titleSize: 92, stamp: 'PAID' });
// rounds on the clock; join one that is already running
end = say('c6a', t);
{
  const [a, b] = fill(e.t, end + 0.42 - e.t, [
    { take: A2, from: 0.9, d: 3.4, cam: [[0, 960, 540, 1.0], [1.0, 520, 480, 1.8], [3.4, 520, 480, 1.85]] },
    { take: A2, from: mark(A2, 'enter') + 0.3, d: 3.2, cam: [[0, 960, 540, 1.0], [0.8, 960, 300, 1.45], [3.2, 960, 300, 1.5]] },
  ]);
  boxSrc(a, a.start + 1.2, a.dur - 1.3, 280, 418, 700, 538, 'EVERY ARENA, SAME CLOCK', { seed: 6 });
  boxSrc(b, b.start + 0.8, b.dur - 0.9, 884, 12, 1036, 66, 'ROUND CLOCK', { seed: 9, below: true, color: 'mustard' });
  caption(b.start + 0.9, b.dur - 1.0, 'Join a round that is *already running*.');
}
// joins close in the final minute; a ticket bought then is held
tt = e.t + 0.1;
end = say('c6b', tt);
{
  const [a, b] = fill(e.t, end + 0.45 - e.t, [
    { take: H, from: mark(H, 'closed') - 0.8, d: 3.0, cam: [[0, 520, 480, 1.8], [3.0, 520, 480, 1.85]] },
    { take: H, from: mark(H, 'held') + 2.0, d: 3.4, cam: [[0, 960, 540, 1.0], [0.8, 520, 470, 1.7], [3.4, 520, 470, 1.75]] },
  ]);
  boxSrc(b, b.start + 0.9, b.dur - 1.0, 274, 256, 710, 402, 'TICKET HELD', { seed: 8, below: true });
  boxSrc(a, a.start + 0.9, a.dur - 1.0, 280, 418, 700, 538, 'JOINS CLOSED', { seed: 4, color: 'mustard' });
  caption(b.start + 0.3, b.dur - 0.4, 'Bought in the final minute? Your ticket is *held*.', { y: 930 });
}
// eaten: buy back in
tt = e.t + 0.1;
end = say('c6c', tt);
{
  const tBuy = mark(D, 'buyback');
  const s = e.shot({ take: D, from: tBuy - 1.6, dur: Math.max(4.4, end + 0.42 - e.t), speed: [[0, 1], [2.2, 1], [2.6, 2.6], [9, 2.6]],
    cam: [[0, 960, 600, 1.5], [1.2, 1150, 820, 1.95], [2.4, 1150, 820, 1.95], [2.8, 960, 540, 1.2], [9, 960, 540, 1.25]] });
  caption(s.start + 0.3, s.dur - 0.4, 'Eaten? *Buy back in*, same round, same fee.');
}
// the bell: everyone alive is paid their till
tt = e.t + 0.1;
end = say('c6d', tt);
{
  const s = e.shot({ take: A, from: tBell - 2.4, dur: Math.max(5.6, end + 0.5 - e.t),
    cam: [[0, 960, 420, 1.3], [2.4, 960, 500, 1.2], [3.2, 960, 540, 1.0], [4.0, 800, 520, 1.45], [9, 790, 520, 1.55]] });
  e.cue('printer', e.timeOf(s, tBell) + 2.7, 0.35, { dur: 1.0 }).cue('kaching', e.timeOf(s, tPaid) + 0.35, 0.4);
  caption(s.start + 2.6, s.dur - 2.7, 'Alive at the bell: you are *paid your till*.', { y: 930 });
}
// the worked fee example of the guide: a flat 5% of profit, paid to the operator
tt = e.t + 0.1;
end = say('c6e', tt);
let end2 = say('c6f', end + GAP);
{
  const b0 = e.t, bd = end2 + 0.7 - e.t;
  e.add('board', b0, bd, { kicker: 'EXAMPLE / FLAT FEE', title: 'Fee on *profit* only.', titleSize: 78 }, 48);
  e.add('receipt', b0 + 0.4, bd - 0.4, { x: 240, y: 300, w: 580, title: 'ROUND OVER', sub: 'PENNY POND / FEE 5% OF PROFIT', rows: [['ENTRY FEE', '1,000'], ['TILL AT THE BELL', '2,000'], ['PROFIT', '1,000'], ['FEE 5% OF PROFIT', '-50', 'pink']], net: '1,950', netLabel: 'TO YOUR WALLET', stamp: 'PAID', printDur: 3.2, stampAt: 11.6, rot: -1.5 }, 49);
  e.add('splitbar', b0 + 3.6, bd - 3.6, { x: 960, y: 440, w: 720, title: 'THE PROFIT AT THE BELL', parts: [{ pct: 95, label: 'YOURS', color: 'teal' }, { pct: 5, label: 'FEE / OPERATOR', color: 'pink' }] }, 49);
  const pt = end + GAP - b0;
  e.add('tag', b0 + pt + 0.2, bd - pt - 0.4, { text: 'NO PROFIT = NO FEE', x: 1320, y: 780, size: 40, ink: true, rot: -2 }, 50);
  e.cue('printer', b0 + 0.65, 0.35, { dur: 3.1 }).cue('pop', b0 + 3.9, 0.3).cue('pop', b0 + 4.3, 0.3).cue('stamp', b0 + 0.4 + 11.6, 0.6).cue('stamp', b0 + pt + 0.2, 0.5);
  e.at(b0 + bd);
}
// floor loot at the bell is burned
tt = e.t + 0.1;
end = say('c6g', tt);
{
  // overlaps the fee board's fade-out, so no bare paper shows between the two boards
  const b0 = e.t - 0.35, bd = end + 1.0 - b0;
  e.add('board', b0, bd, { kicker: 'AT THE BELL', title: 'Floor loot is *burned*.', titleSize: 78 }, 48);
  for (let i = 0; i < 7; i++) e.add('loot', b0 + 0.3 + i * 0.11, bd - 0.4 - i * 0.11, { r: 34, x: 260 + i * 120, y: 560 + (i % 2) * 30 }, 49);
  e.add('stamp', b0 + 1.3, bd - 1.4, { text: 'BURNED', x: 1300, y: 560, size: 96, color: 'red', rot: -6 }, 50);
  [0.3, 0.5, 0.7, 0.9].forEach((d, i) => e.cue('coin', b0 + d, 0.3, { pitch: 1 + i * 0.1 }));
  e.cue('stamp', b0 + 1.3, 0.6);
  e.at(b0 + bd);
}
chips.push([6, 'ROUNDS AND PAYOUTS', t, e.t]);

// ── 07 · tips ──
t = chapter(7, 'Quick tips', 'Play smart. Last the round.', { titleSize: 116 });
end = say('c7', t);
{
  const src = has(C) ? C : P;
  const [a, b, c] = fill(e.t, end + 0.42 - e.t, [
    { take: P, from: 31.0, d: 2.2, zoom: 1.2 },
    { take: src, from: mark(src, 'split') + 1.0, d: 2.6, zoom: 1.3, lag: 0.6 },
    { take: A, from: mark(A, 'final') - 0.3, d: 3.2, cam: [[0, 960, 380, 1.3], [3.2, 960, 360, 1.35]] },
  ]);
  kick(a.start + 0.1, 'WARM UP IN PRACTICE', a.dur);
  kick(b.start + 0.1, 'SPLIT ONLY WHEN SURE', b.dur);
  kick(c.start + 0.1, 'FINAL MINUTE: PLAY SAFE', c.dur);
}
chips.push([7, 'TIPS', t, e.t]);

// ── outro ──
const tOut = e.t;
e.add('wipe', tOut - 0.35, 0.7, { colors: ['pink', 'card'] }, 90);
e.cue('paper', tOut - 0.35, 0.45);
e.add('card', tOut, 4.3, { variant: 'outro', kicker: 'SLANA / ON SOLANA', tagline: 'Eat. Grow. Last the round.', tagAccent: 4, tagAt: 0.75, tagGap: 0.42, foot: 'START FREE IN PRACTICE  /  SLANA.IO  /  @SLANAIO', footAt: 2.0, footY: 812 }, 50);
for (let i = 0; i < 3; i++) e.cue('stamp', tOut + 0.75 + i * 0.42 + 0.1, 0.55);
say('outro', tOut + 0.55);
e.at(tOut + 4.3);

for (const [n, label, a, b] of chips) e.add('chip', a + 0.6, b - a - 0.9, { n: String(n).padStart(2, '0'), total: NCH, label }, 44);

const data = e.build(resolve(OUT, 'howto.json'));
// the bed: the game's in-room score (calm), under everything, ducked by the voice in the mixer
const music = {
  parts: [{ file: resolve(HERE, '../gameplay/cache/takes/music-game/audio.wav'), at: 0, from: 6.0, dur: data.duration + 0.5, gain: 0, fadeIn: 1.0, fadeOut: 3.0 }],
  gain: [[0, -2], [3.15, -4], [data.duration - 4.3, -4], [data.duration - 3.8, -1], [data.duration, -8]],
};
writeFileSync(resolve(OUT, 'howto-music.json'), JSON.stringify(music, null, 1));
console.log('howto edit:', data.duration.toFixed(2), 's,', data.frames, 'frames,', data.items.length, 'graphics,', data.vo.length, 'lines');
for (const [n, label, a, b] of chips) console.log(`  ${String(n).padStart(2, '0')} ${label.padEnd(20)} ${a.toFixed(1)} - ${b.toFixed(1)}`);

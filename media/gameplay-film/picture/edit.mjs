#!/usr/bin/env node
// The film's edit decision list: every output frame (30 fps, 120 s) is a take and an exact take
// time, cut to media/gameplay-film/cues.json. The beats are found from the takes' own marks and
// events (the eats, the split, the round clock), so a new take re-cuts itself.
//   node edit.mjs   -> out/work/film/edit/plan.json and edit/times-<take>.json
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { HERE, TAKES, WORK } from './lib.mjs';

const FPS = 30;
const cues = JSON.parse(readFileSync(resolve(HERE, '../cues.json'), 'utf8'));
const DUR = cues.duration;
const beat = Object.fromEntries(cues.beats.map((b) => [b.id, b.at]));
const OUT = resolve(WORK, 'edit');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const load = (n) => JSON.parse(readFileSync(resolve(TAKES, n, 'events.json'), 'utf8'));
// which arena take carries which beat (one take can carry all)
const MAIN = opt('--main', 'arena'), LOBBY = opt('--lobby', MAIN), EAT = opt('--eat', MAIN), THREAT = opt('--threat', MAIN), SPLIT = opt('--split', MAIN);
const site = load('site');
const takes = Object.fromEntries([...new Set([MAIN, LOBBY, EAT, THREAT, SPLIT])].map((n) => [n, load(n)]));
const mark = (take, label, nth = 0) => {
  const m = take.marks.filter((x) => x.label === label)[nth];
  if (!m) throw new Error(`${take.name}: no mark ${label}`);
  return m;
};
const S = (l) => mark(site, l).t;
const T = (n, l) => mark(takes[n], l).t;

/** Journal input events of a take, in take seconds. */
async function inputs(take) {
  const out = [];
  let E = null;
  for await (const line of createInterface({ input: createReadStream(resolve(TAKES, take.name, take.journal)) })) {
    if (!line) continue;
    const e = JSON.parse(line);
    if (e.k === 'clock' && E === null) E = e.date - e.perf;
    if (e.k === 'in') out.push({ ...e, t: (e.t + E) / 1000 - take.t0 });
  }
  return out;
}

// ── arena landmarks ──
const gain = (e) => e.k === 'value' && (e.v?.delta ?? 0) > 0;
const after = (n, t0, pred) => takes[n].events.find((e) => e.t >= t0 && pred(e));
const playing = after(LOBBY, T(LOBBY, 'pay'), (e) => e.k === 'screen' && e.v === 'playing').t;
const eat1 = (opt('--eat-at') ? Number(opt('--eat-at')) : after(EAT, T(EAT, 'hunt1'), gain).t);
const split = opt('--split-at') ? Number(opt('--split-at')) : T(SPLIT, 'split');
const eat3 = after(SPLIT, split, (e) => gain(e) || (e.k === 'kill' && e.v?.killer === 'Daphne')).t;
const chase = opt('--chase-at') ? Number(opt('--chase-at')) : T(THREAT, 'chase');
const fin = mark(takes[MAIN], 'final');
const bell = fin.t + fin.left;
const pay = (await inputs(takes[LOBBY])).find((e) => e.type === 'mousedown' && e.t > T(LOBBY, 'pay') - 0.05).t;
console.log({ playing, eat1, chase, split, eat3, bell, pay, splitToEat: +(eat3 - split).toFixed(2) });

// ── segments: [filmStart, filmEnd, take, keyframes [[film, src], ...]] (linear between keys) ──
const seg = [];
const lin = (f0, f1, take, s0, rate = 1) => seg.push([f0, f1, take, [[f0, s0], [f1, s0 + (f1 - f0) * rate]]]);
const keys = (f0, f1, take, k) => seg.push([f0, f1, take, k]);

// site: the hero, the feast, the round plate, the WL chores, the mint
lin(0, 9.5, 'site', S('hero'));
lin(9.5, beat.round_plate - 0.5, 'site', S('toFeast'));
lin(beat.round_plate - 0.5, beat.wl_page, 'site', S('toRound'));
{ // the second chore's stamp on the thump at 30.4
  const c2 = S('chore2');
  lin(beat.wl_page, beat.mint_page, 'site', c2 - (30.4 - beat.wl_page));
}
{ // the minted cards land on the stamp at 34.9 (they land 0.65 s after the receipt)
  const m0 = S('mint') + 0.05, land = S('minted') + 0.65;
  keys(beat.mint_page, beat.enter_lobby, 'site', [[beat.mint_page, m0], [34.9, land], [beat.enter_lobby, land + (beat.enter_lobby - 34.9)]]);
}
// arena: the lobby, the ticket, the drop
{ // the board, a look along the arenas, Asphodel Meadow; cut to the open ticket sheet
  const sheet = T(LOBBY, 'sheet');
  const lob = T(LOBBY, 'lobby');
  const cut = beat.ticket - 0.5;
  // end on the Board click (the row picked just before), so the cut lands on the sheet
  lin(beat.enter_lobby, cut, LOBBY, Math.max(lob + 0.1, T(LOBBY, 'board') + 0.6 - (cut - beat.enter_lobby)));
  // the Pay click at 41.15 (the punch on 41.4); then the boarding hatch, cut into the drop at 45
  lin(cut, 41.15, LOBBY, pay - (41.15 - cut));
  const hatch = playing - pay;
  if (hatch <= beat.drop_in - 41.15) lin(41.15, beat.drop_in, LOBBY, pay);
  else { lin(41.15, 43.2, LOBBY, pay); lin(43.2, beat.drop_in, LOBBY, playing + 1.05 - (beat.drop_in - 43.2)); }
}
// the hatch has opened by the drop; the round's title card follows at +0.75 s
lin(beat.drop_in, 50.0, LOBBY, playing + 1.05);
// the first eat on 50.5, slowed through the gulp so the gain is still flying on "Dinner." (52.9)
keys(50.0, beat.threat - 0.2, EAT, [[50.0, eat1 - 0.5], [50.5, eat1], [53.0, eat1 + 0.85], [54.0, eat1 + 1.75], [beat.threat - 0.2, eat1 + 1.75 + (beat.threat - 0.2 - 54.0)]]);
// the threat: the big coin turns on her; she runs (and the phew)
lin(beat.threat - 0.2, 64.85, THREAT, chase - 1.6);
// the split on the whoosh (64.85 -> Space at 65.0), the eat on 70.3
{
  // Space on "split" (~66.5): the lunge and the catch are 0.4 s of play, so the lunge runs in slow
  // motion until the catch lands on the chomp at 70.3
  const SPACE_AT = 66.5;
  keys(64.85, beat.final_minute, SPLIT, [[64.85, split - (SPACE_AT - 64.85)], [SPACE_AT, split], [beat.split_pays, eat3], [beat.final_minute, eat3 + (beat.final_minute - beat.split_pays)]]);
}
// the final minute: the chip flips (joins close 60 s before the bell)
lin(beat.final_minute, 84.6, MAIN, bell - 60 - 0.3);
lin(84.6, beat.ten_seconds, MAIN, bell - 35);
// the last ten seconds, the bell on 100 (it swings in 0.55 s after the server's round end), the landing report
const BELL_LAG = 0.55;
lin(beat.ten_seconds, beat.end_card, MAIN, bell + BELL_LAG - (beat.bell - beat.ten_seconds));
// the end card
lin(beat.end_card, DUR, 'card', 0);

// ── frames ──
const frames = [];
for (let i = 0; i < Math.round(DUR * FPS); i++) {
  const f = i / FPS;
  const s = seg.find((x) => f >= x[0] - 1e-9 && f < x[1] - 1e-9) ?? seg[seg.length - 1];
  const k = s[3];
  let j = 0;
  while (j + 2 < k.length && f > k[j + 1][0]) j++;
  const [fa, sa] = k[j], [fb, sb] = k[j + 1];
  const t = sa + ((f - fa) / (fb - fa)) * (sb - sa);
  frames.push({ take: s[2], t: +t.toFixed(4) });
}
const per = {};
for (const fr of frames) (per[fr.take] ||= new Set()).add(fr.t);
for (const [take, set] of Object.entries(per)) {
  const list = [...set].sort((a, b) => a - b);
  writeFileSync(resolve(OUT, `times-${take}.json`), JSON.stringify(list));
  const index = new Map(list.map((t, i) => [t, i]));
  for (const fr of frames) if (fr.take === take) fr.i = index.get(fr.t);
}
// monotonic within each take? (the replay runs forward only)
writeFileSync(resolve(OUT, 'plan.json'), JSON.stringify({ fps: FPS, duration: DUR, segments: seg, landmarks: { playing, eat1, chase, split, eat3, bell, pay }, frames }));
console.log('segments', seg.map((s) => `${s[0].toFixed(2)}-${s[1].toFixed(2)} ${s[2]} @${s[3][0][1].toFixed(2)}`).join('\n'));

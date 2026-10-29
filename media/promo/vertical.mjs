#!/usr/bin/env node
// The promo's vertical cut for X and Reels: 1080x1920, 60 fps, about 32 s (eleven bars of the game's
// 82 BPM score). Real gameplay, full bleed, reframed around Daphne's coin from the replayed takes
// (media/gameplay/capture/replay.mjs), with the promo's riso headline, its voice lines (Kokoro
// af_heart, cache/vo-raw), a plain NFT mention ("Elymum NFTs.", $1 in HYPE) and the SITE_HOST / @elymum
// end card.
//   node media/promo/vertical.mjs
//   MASTER_AUDIO=192k media/gameplay/render/render.sh media/promo/cache/vertical/vertical.json \
//     media/promo/cache/vertical/vertical-music.json elymum-promo-vertical media/promo/cache/vo-raw
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edit, events, mark } from '../gameplay/render/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// the site's host on the end card (no domain is hard-coded: set SITE_HOST to the PUBLIC_URL host)
const SITE = (process.env.SITE_HOST || 'elymum.io').toUpperCase();
const OUT = resolve(HERE, 'cache/vertical');
mkdirSync(OUT, { recursive: true });
const BPM = 82, BEAT = 60 / BPM, BAR = BEAT * 4;
const bars = (n) => n * BAR;
const A = 'arena';
const e = new Edit({ name: 'vertical', fps: 60, w: 1080, h: 1920 });

const head = (t, dur, lines, o = {}) => e.add('headline', t, dur, { lines, x: o.x ?? 70, y: o.y ?? 210, size: o.size ?? 104, align: o.align, out: o.out ?? dur - 0.4 }, 45);
const kick = (t, text, dur) => { e.add('tag', t, dur, { text, x: 70, y: 120, size: 26, kick: true, dot: true, scramble: true }, 46); e.cue('tick', t + 0.05, 0.3); };
const wipe = (t, colors, dur = 0.7) => { e.add('wipe', t - dur / 2, dur, { colors }, 90); e.cue('paper', t - dur / 2, 0.5); };
const float = (s, t, text) => { e.add('float', t, 1.6, { text, sub: '$ELYMUM', track: e.trackMe(s, t, 1.6, 1 / 30), size: 124 }, 35); e.cue('coin', t, 0.5).cue('pop', t + 0.05, 0.4); };

// ── 0 · the gulp (1.5 bars) ── slow motion through it, the value floats off
const eat = events(A, 'value', (v) => v.reason === 'eat')[0];
const pre = 1.25;
const s0 = e.shot({ take: A, from: eat.t - pre, dur: bars(1.5), zoom: 2.3, lag: 0.4, lead: [0, -60],
  speed: [[0, 1], [pre - 0.45, 1], [pre - 0.25, 0.3], [pre + 0.95, 0.3], [pre + 1.25, 1], [5, 1]],
  punch: [[pre - 0.2, 1.22, 0.3, 1.2, 0.6]], shake: [[pre + 0.3, 12]] });
const tG = e.timeOf(s0, eat.t);
e.cue('impact', 0, 0.7);
kick(0.0, 'ON-CHAIN COIN ARENAS / ELYSIUM', bars(1.5) - 0.2);
head(0.0, bars(1.5), [{ text: 'Eat a player.', at: 0.04 }, { text: 'Keep their', at: tG + 0.1, color: 'pink' }, { text: 'tokens.', at: tG + 0.24, color: 'pink' }]);
e.voice('hook_a', 0.1).voice('hook_b', tG + 0.15);
e.cue('gulp', tG, 0.8).cue('sub', tG, 0.5);
e.add('flash', tG, 0.18, { color: 'card', peak: 0.45 }, 60);
float(s0, tG + 0.08, `+${Math.round(eat.v.delta / 1e6).toLocaleString('en-US')}`);

// ── 1 · five-minute rounds (1.5 bars) ── she drops into a round already running; the round chip
wipe(s0.end, ['pink', 'card']);
// the round clock over a live stretch of the round (top centre) with her coin below it
const s1 = e.shot({ take: A, from: 179.6, dur: bars(1.5), cam: [[0, 960, 345, 1.82], [4.39, 960, 340, 1.86]] });
kick(s1.start + 0.15, 'LIVE ROUND / PENNY POND', 4.0);
head(s1.start, bars(1.5), [{ text: 'Five-minute', at: 0.25 }, { text: 'rounds.', at: 0.4, color: 'pink' }], { y: 1500 });
e.voice('rounds_a', s1.start + 0.3);
const CHIP = [884, 12, 1036, 66];
{ const [a, b] = e.project(s1, s1.start + 0.8, CHIP[0], CHIP[1]), [c, d] = e.project(s1, s1.start + 0.8, CHIP[2], CHIP[3]); e.add('box', s1.start + 0.7, 3.2, { x: a, y: b, w: c - a, h: d - b, label: 'ROUND CLOCK', labelBelow: true, seed: 9, color: 'mustard' }, 40); }

// ── 2 · the last ten seconds (2.5 bars) ── arena2: she eats pixel_penny four seconds before the bell
wipe(s1.end, ['ink', 'card'], 0.6);
const F = 'arena2';
const tBell = events(F, 'roundResult')[0].t;
const rr = events(F, 'roundResult')[0].v;
const s2 = e.shot({ take: F, from: tBell - bars(2.5) - 0.05, dur: bars(2.5), zoom: 1.9, lag: 0.6 });
{
  const last = events(F, 'value', (v) => v.reason === 'eat').filter((x) => x.t > tBell - 8)[0];
  if (last) { const tE = e.timeOf(s2, last.t); e.cue('gulp', tE, 0.8); e.add('flash', tE, 0.16, { color: 'card', peak: 0.4 }, 60); float(s2, tE + 0.08, `+${Math.round(last.v.delta / 1e6).toLocaleString('en-US')}`); }
}
kick(s2.start + 0.15, 'THE LAST TEN SECONDS', 3.0);
head(s2.start, bars(2.5), [{ text: 'Alive at', at: 0.3 }, { text: 'the bell?', at: 0.45, color: 'pink' }], { y: 1500 });
e.voice('rounds_b', s2.start + 3.1);
e.add('ring', s2.start + 0.6, 2.2, { track: e.trackMe(s2, s2.start + 0.6, 2.2), label: 'STAY ALIVE', pad: 1.35 }, 25);

// ── 3 · the bell, the receipt, PAID (2 bars) ──
const tPaid = mark(F, 'paid');
// the bell on the frozen world (kept inside the map), then the receipt modal framed on its own
const s3a = e.shot({ take: F, from: tBell - 0.05, dur: 2.3, zoom: 1.85, lag: 0.6 });
const s3 = e.shot({ take: F, from: tBell + 2.25, dur: bars(2) - 2.3, edge: false, cam: [[0, 800, 540, 1.85], [0.6, 768, 540, 1.95], [3.55, 765, 540, 2.0]] });
e.add('flash', s3a.start, 0.35, { color: 'card', peak: 0.55 }, 60);
e.add('stamp', s3a.start + 0.08, 1.4, { text: 'BELL!', x: 760, y: 360, color: 'mustard', rot: -10, size: 120 }, 40);
e.cue('stamp', s3a.start + 0.08, 0.9).cue('impact', s3a.start + 0.08, 0.6);
const tStamp = e.timeOf(s3, tPaid) + 0.35;
e.cue('printer', s3a.start + 2.6, 0.4, { dur: 1.2 }).cue('kaching', tStamp, 0.6).cue('impact', tStamp, 0.4);
head(s3a.start, bars(2), [{ text: 'Get paid.', at: tStamp - s3a.start - 0.1, color: 'pink' }], { y: 1560, size: 128 });
{
  const till = rr.payout / 1e6;
  const net = Math.round((till - Math.max(0, till - 1000) * 0.05) * 100) / 100;
  e.add('lower', tStamp + 0.2, s3.end - tStamp - 0.2, { kicker: 'ROUND OVER / FEE 5% OF PROFIT', count: [0, net], unit: '$ELYMUM', accent: 'teal', stub: 'PAID', countAt: 0.2, countDur: 1.0, w: 700, dec: 2, x: 190, y: 1300 }, 30);
}

// ── 4 · the NFT (1 bar) ── a plain mention: the cards dealt face up, "$1 IN HYPE", "Elymum NFTs."
// (the NFT kit's plain beat, media/mint-film/scenes/nft.js, on the paper stock)
wipe(s3.end, ['pink', 'card']);
const tN = s3.end;
const ND = bars(1);
e.add('nft', tN - 0.05, ND + 0.05, { lead: 0.05, kicker: '$1 IN HYPE', plain: { head: 'Elymum NFTs.', layout: { ky: 630, hy1: 830, cards: [[240, 1210, -0.13, 28], [540, 1165, 0, 0], [840, 1210, 0.13, 28]] } }, times: { deal: [0, 0.12, 0.24], l1: 0.08 } }, 50);
e.voice('nft', tN + 0.12);
e.cue('impact', tN, 0.55).cue('sub', tN, 0.4);
[0, 0.12, 0.24].forEach((d, i) => e.cue('paper', tN + d, 0.35 + i * 0.05));

// ── 5 · end card (2.5 bars) ──
wipe(tN + ND, ['ink', 'card']);
const tOut = tN + ND;
e.add('card', tOut - 0.05, bars(2.5) + 0.05, {
  variant: 'outro', kicker: 'ELYMUM / ON ELYSIUM', tagline: 'Eat. Grow. Last the round.', tagAccent: 4, tagAt: 0.7, tagGap: 0.26,
  foot: `${SITE}  /  @ELYMUM`, footAt: 1.5, footY: 860, footSize: 46, oy: 420,
  coins: [
    { skin: 4, r: 110, x: 120, y: -150, expression: 'happy' },
    { skin: 7, r: 130, x: 760, y: -230, expression: 'proud' },
    { skin: 2, r: 70, x: 150, y: 1020, expression: 'hungry' },
    { skin: 9, r: 64, x: 820, y: 1060, expression: 'love' },
    { skin: 1, r: 44, x: 900, y: 120, expression: 'happy' },
    { skin: 6, r: 48, x: 60, y: 610, expression: 'scared' },
  ],
}, 50);
for (let i = 0; i < 3; i++) e.cue('stamp', tOut + 0.7 + i * 0.26 + 0.1, 0.6);
e.cue('sub', tOut + 0.4, 0.5);
e.voice('end', tOut + 0.55);
e.at(tOut + bars(2.5));

const data = e.build(resolve(OUT, 'vertical.json'));
const music = {
  parts: [{ file: resolve(HERE, '../gameplay/cache/takes/music-lobby/audio.wav'), at: 0, from: 0.22 + 4 * BAR, dur: data.duration + 0.2, gain: 0, fadeIn: 0.05, fadeOut: 1.6 }],
  drums: { bpm: BPM, phase: 0, start: 0, end: tOut + bars(1.5), gain: -5, drop: [[s2.start + bars(1.5), tN - 0.05]], fills: [s1.end - BEAT, tOut - BEAT] },
  gain: [[0, 0], [s2.start + bars(1.5), 0], [s2.start + bars(1.5) + 1, -7], [s3a.start + 3, -7], [tN, 0], [data.duration, -10]],
};
writeFileSync(resolve(OUT, 'vertical-music.json'), JSON.stringify(music, null, 1));
console.log('vertical edit:', data.duration.toFixed(2), 's,', data.frames, 'frames');
for (const s of e.shots) console.log(`  ${s.start.toFixed(2)}-${s.end.toFixed(2)}  ${s.take} ${s.from.toFixed(2)}-${s.srcEnd.toFixed(2)}${s.edgeZoom > 1.01 ? `  edge zoom x${s.edgeZoom.toFixed(2)}` : ''}`);

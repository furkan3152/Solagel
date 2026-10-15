#!/usr/bin/env node
// Take "music": the game's own procedural lo-fi score (music bus only, no effects), recorded from
// the dev audio tap with no video. Two moods: the lobby (melody, full kit) and in game (sparser).
//   node media/gameplay/capture/take-music.mjs [--lobby 240] [--game 180]
import { Player, Recorder, launch, log } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const browser = await launch();
try {
  const p = new Player(browser, { name: 'listener', skin: 1, w: 640, h: 360, audio: 'music', quality: 'low' });
  await p.open();
  const lobby = new Recorder(p, 'music-lobby', { video: false });
  await lobby.start();
  await p.page.mouse.click(5, 5); // a gesture, in case the context waits for one
  await p.wait(Number(opt('--lobby', '240')) * 1000);
  await lobby.stop();
  log('lobby music done');
  const p2 = new Player(browser, { name: 'listener', skin: 1, w: 640, h: 360, audio: 'music', quality: 'low' });
  await p2.open();
  await p2.page.setViewportSize({ width: 1280, height: 720 });
  await p2.practice();
  await p2.page.setViewportSize({ width: 320, height: 180 });
  p2.o.w = 320; p2.o.h = 180;
  const game = new Recorder(p2, 'music-game', { video: false });
  await game.start();
  const t0 = Date.now();
  while (Date.now() - t0 < Number(opt('--game', '180')) * 1000) await p2.drive(3000, { mode: 'free', humans: 0, reach: 60 });
  await game.stop();
  log('game music done');
} finally {
  await browser.close();
}

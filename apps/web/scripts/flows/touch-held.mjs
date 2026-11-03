// Regression (phone, touch emulation, landscape): a thumb held on the joystick and on Tip when the
// coin is eaten must not keep steering / tipping into the next life.
//   node apps/web/scripts/flows/touch-held.mjs   (stack: node apps/web/scripts/ui-audit.mjs --serve)
import { launch, newContext, watchPage, BASE, check, done } from './lib.mjs';

const b = await launch();
const errors = [];
const ctx = await newContext(b, { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem('elymum.brief', '1'));
const p = await ctx.newPage();
watchPage(p, errors);
await p.goto(`${BASE}/play`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__elymum?.useUi.getState().connected, null, { timeout: 180000 });
await p.waitForTimeout(1500);
await p.evaluate(() => window.__elymum.engine.play('practice'));
await p.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 30000 });
await p.waitForSelector('.g-stick', { timeout: 15000 });
await p.waitForTimeout(1200);
// thumb down on the stick (pushed right) and on Tip, never lifted
const stick = await p.locator('.g-stick').boundingBox();
const tip = await p.locator('.g-touch__btn.is-eject').boundingBox();
const cdp = await ctx.newCDPSession(p);
const points = [
  { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 1 },
  { x: tip.x + tip.width / 2, y: tip.y + tip.height / 2, id: 2 },
];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
points[0].x += stick.width * 0.45;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points });
await p.waitForTimeout(300);
check(await p.evaluate(() => window.__elymum.engine.input.stick.active), 'the stick steers while held');
// eaten (as the server says it): the HUD and its controls go away under the thumb
await p.evaluate(() =>
  window.__elymum.engine['onMessage']({
    t: 'death',
    stats: { aliveMs: 9000, finalMass: 0, maxMass: 40, foodEaten: 2, cellsEaten: 0, playersEaten: 0, bestRank: 3 },
    killer: 'bot',
    killerSkin: 1,
  }),
);
await p.waitForTimeout(800);
const after = await p.evaluate(() => ({ stick: window.__elymum.engine.input.stick.active, eject: window.__elymum.engine.input.ejectTimer !== null }));
console.log(after);
check(!after.stick, 'the stick lets go when the controls leave');
check(!after.eject, 'Tip stops when the controls leave');
console.log(errors.join('\n'));
check(errors.length === 0, 'no console errors');
await b.close();
done();

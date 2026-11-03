// Arena flow: connect the wallet and sign in through the UI, buy a ticket (dev fake chain), drop the
// socket (the coin is reclaimed), open the game again in a new tab (signed in; the paid coin resumes).
//   node apps/web/scripts/flows/arena-reconnect.mjs   (stack: node apps/web/scripts/ui-audit.mjs --serve)
import { installEvmWallet, newDevKey } from '../evm-wallet.mjs';
import { launch, newContext, watchPage, BASE, check, done } from './lib.mjs';

const b = await launch();
const errors = [];
const ctx = await newContext(b);
await installEvmWallet(ctx, { privateKey: newDevKey(), autoConnect: false, allowTransactions: false });
await ctx.addInitScript(() => localStorage.setItem('elymum.brief', '1'));
let p = await ctx.newPage();
watchPage(p, errors);
p.on('console', (m) => m.type() === 'warning' && console.log('warn:', m.text().slice(0, 200)));
const S = () =>
  p.evaluate(() => {
    const s = window.__elymum.useUi.getState();
    return { screen: s.screen, connected: s.connected, room: s.room?.id, modal: s.modal, auth: !!s.auth, toasts: s.toasts.map((t) => t.text), ticket: s.ticket, cta: document.querySelector('.kl-cta')?.textContent };
  });
await p.goto(`${BASE}/play`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__elymum?.useUi.getState().connected, null, { timeout: 180000 });
await p.waitForTimeout(1500);
console.log('start', JSON.stringify(await S()));
// connect through the header button
await p.getByRole('button', { name: /connect wallet/i }).first().click();
await p.waitForTimeout(800);
await p.getByText('Dev Wallet').first().click();
await p.waitForTimeout(3000);
console.log('connected', JSON.stringify(await S()));
await p.waitForFunction(() => !!window.__elymum.useUi.getState().auth, null, { timeout: 15000 }).catch(() => console.log('no auth yet'));
console.log('signed', JSON.stringify(await S()));
check((await S()).auth, 'sign-in after a user connect');
await p.waitForFunction(() => !!window.__elymumChain?.fakeWallet, null, { timeout: 15000 });
await p.locator('[role="radio"][data-kb-value="arena:1"]').click();
await p.waitForTimeout(400);
console.log('picked', JSON.stringify(await S()));
await p.locator('.kl-cta').click();
await p.waitForSelector('.tf-sheet', { timeout: 8000 });
await p.locator('.tf-sheet .tf-pay').click();
await p.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(1500);
const s1 = await S();
console.log('in arena', JSON.stringify(s1));
check(s1.screen === 'playing' && s1.room?.startsWith('arena'), 'bought ticket and joined the arena');
// socket drop: reclaim
await p.evaluate(() => window.__elymum.engine.net.ws.close());
await p.waitForTimeout(500);
await p.waitForFunction(() => window.__elymum.useUi.getState().connected, null, { timeout: 20000 });
await p.waitForTimeout(2500);
const s2 = await S();
console.log('after drop', JSON.stringify(s2));
check(s2.screen === 'playing' && s2.room === s1.room, 'reclaimed the arena coin after a socket drop');
// reload mid-game
// (a fresh tab of the same browser profile: a same-page reload of the dev build trips Chrome's request limits here)
await p.close();
p = await ctx.newPage();
watchPage(p, errors);
await p.goto(`${BASE}/play`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__elymum?.useUi.getState().connected, null, { timeout: 180000 });
await p.waitForTimeout(5000);
const s3 = await S();
console.log('after reload', JSON.stringify(s3));
check(s3.auth, 'still signed in after a reload');
if (s3.screen !== 'playing') {
  await p.locator('.kl-cta').click();
  await p.waitForTimeout(1500);
  if (await p.locator('.tf-sheet').count()) await p.locator('.tf-sheet .kb-btn--primary, .tf-sheet .tf-pay').first().click();
  await p.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 20000 }).catch(() => {});
}
const s4 = await S();
console.log('resumed', JSON.stringify(s4));
check(s4.screen === 'playing' && s4.room === s1.room, 'resumed the paid coin after a reload');
console.log(errors.join('\n'));
check(errors.length === 0, 'no console errors');
await b.close();
done();

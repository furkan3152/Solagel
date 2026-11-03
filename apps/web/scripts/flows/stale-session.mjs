// Regression: a stored sign-in token the server no longer accepts (expired, or AUTH_SECRET rotated)
// must not leave /play looking signed in. Expected: the server's `auth_failed` drops the client's
// session (UI auth + stored token), so the lobby offers "Sign in" again.
//   node apps/web/scripts/flows/stale-session.mjs   (stack: node apps/web/scripts/ui-audit.mjs --serve)
import { installEvmWallet, newDevKey } from '../evm-wallet.mjs';
import { launch, newContext, watchPage, BASE, check, done } from './lib.mjs';

const b = await launch();
const errors = [];
const ctx = await newContext(b);
const { address } = await installEvmWallet(ctx, { privateKey: newDevKey(), autoConnect: true, allowTransactions: false });
// a well-formed but stale token (its MAC does not check out on this server)
await ctx.addInitScript((addr) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('elymum.brief', '1');
  localStorage.setItem('elymum.auth.v1', JSON.stringify({ address: addr, token: `${addr}.${Date.now() + 3600_000}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, exp: Date.now() + 20 * 3600_000 }));
}, address);
const p = await ctx.newPage();
watchPage(p, errors);
await p.goto(`${BASE}/play`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__elymum?.useUi.getState().connected, null, { timeout: 90000 });
await p.waitForTimeout(4000);
const st = await p.evaluate(() => ({ auth: window.__elymum.useUi.getState().auth, stored: localStorage.getItem('elymum.auth.v1'), cta: document.querySelector('.kl-cta')?.textContent }));
console.log(st);
check(st.auth === null, 'the rejected token leaves the UI signed out');
check(st.stored === null, 'the rejected token is forgotten');
await b.close();
done();

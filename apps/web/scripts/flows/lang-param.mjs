// Regression: `?lang=` is remembered like a pick, English included. A visitor whose stored language
// is Russian opens `/?lang=en`; the next visit without the parameter stays English.
//   node apps/web/scripts/flows/lang-param.mjs   (stack: node apps/web/scripts/ui-audit.mjs --serve)
import { launch, newContext, watchPage, BASE, check, done } from './lib.mjs';

const b = await launch();
const errors = [];
const ctx = await newContext(b, { locale: 'ru-RU' });
const visit = async (path) => {
  const p = await ctx.newPage();
  watchPage(p, errors);
  await p.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await p.waitForFunction(() => document.title.length > 0 && !!document.querySelector('main, #root > *'), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  const lang = await p.evaluate(() => document.documentElement.lang);
  await p.close();
  return lang;
};
check((await visit('/?lang=ru')) === 'ru', 'Russian by ?lang=ru');
check((await visit('/')) === 'ru', 'Russian remembered');
check((await visit('/?lang=en')) === 'en', 'English by ?lang=en');
check((await visit('/')) === 'en', 'English remembered on the next visit');
console.log(errors.join('\n'));
check(errors.length === 0, 'no console errors');
await b.close();
done();

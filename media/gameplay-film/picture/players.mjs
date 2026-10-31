// The film's arena players: the gameplay kit's Player with today's lobby (the wallet reconnects by
// itself, the game signs in over the socket, the ticket sheet's Pay button).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TAKES as FILM_TAKES, WEB } from './lib.mjs';
process.env.ELYMUM_URL ||= `${WEB}/play`;
const { Player, log } = await import('../../gameplay/capture/lib.mjs');
const { viem } = await import('../../../scripts/lib/common.mjs');

export /** Player with today's lobby: the wallet reconnects by itself, the game signs in over the socket. */
class FilmPlayer extends Player {
  async open() {
    mkdirSync(resolve(FILM_TAKES, 'keys'), { recursive: true });
    this.o.keyPath ||= resolve(FILM_TAKES, 'keys', `${this.o.name}.key`);
    if (!existsSync(this.o.keyPath)) writeFileSync(this.o.keyPath, viem('/accounts').generatePrivateKey() + '\n');
    this.pkey = readFileSync(this.o.keyPath, 'utf8').trim();
    this.account = viem('/accounts').privateKeyToAccount(this.pkey);
    const browser = this.browser;
    const origNew = browser.newContext.bind(browser);
    browser.newContext = async (...a) => { const c = await origNew(...a); await c.addInitScript(() => localStorage.setItem('elymum.wallet.v1', 'dev.elymum.wallet')); browser.newContext = origNew; return c; };
    return super.open();
  }
  async login() {
    const res = await fetch(`${WEB}/api/auth/nonce?address=${this.account.address}`);
    const { message } = await res.json();
    const signature = await this.account.signMessage({ message });
    await this.page.evaluate(([a, m, s]) => window.__elymum.engine.authSignature(a, m, s), [this.account.address, message, signature]);
    await this.page.waitForFunction(() => !!window.__elymum.useUi.getState().auth, null, { timeout: 15000 });
    await this.page.waitForFunction(() => window.__elymumChain?.useChainData.getState().tokenBalance != null, null, { timeout: 20000 });
    await this.wait(600);
  }
  async buyTicket(arena = 1, { slow = false, signDelay = 900, onSheet = null } = {}) {
    const open = await this.page.locator('.tf-sheet').isVisible().catch(() => false);
    if (!open) {
      await this.click(`[role="radio"][data-kb-value="arena:${arena}"]`, { fx: 0.45, after: slow ? 500 : 300 });
      for (let i = 0; i < 4; i++) {
        await this.click('.kl-cta', { after: 200 });
        if (await this.page.waitForSelector('.tf-sheet .tf-pay', { timeout: 5000 }).then(() => true, () => false)) break;
        log(`${this.o.name}: no ticket sheet yet, again`);
        await this.click(`[role="radio"][data-kb-value="arena:${arena}"]`, { fx: 0.45, after: 600 });
      }
    }
    await this.page.waitForSelector('.tf-sheet .tf-pay', { timeout: 10000 });
    await this.wait(slow ? 900 : 400);
    if (onSheet) await onSheet();
    await this.ui((ms) => { if (window.__elymumChain?.fakeWallet) window.__elymumChain.fakeWallet.delayMs = ms; }, signDelay);
    await this.click('.tf-sheet .tf-pay', { before: slow ? 350 : 150 });
    const ok = await this.page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 20000 }).then(() => true, () => false);
    if (!ok) {
      log(`${this.o.name}: resume`);
      await this.click('.kl-cta');
      await this.page.waitForFunction(() => window.__elymum.useUi.getState().screen === 'playing', null, { timeout: 20000 });
    }
  }
}


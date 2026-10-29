import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPACITY, RULES } from '@elymum/shared';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chainStatus } from './evm-helpers';
import { Kb } from '../src/design';
import { pageFromUrl, urlForPage, useUi } from '../src/store';
import { DocsPage } from '../src/ui/docs/DocsPage';
import { docsEn } from '../src/ui/docs/content.en';
import { FACTS, SERVER, feeExample } from '../src/ui/docs/facts';

const initial = useUi.getState();
const en0 = docsEn();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

/** The section order the guide promises. */
const SECTION_IDS = ['play', 'rooms', 'value', 'payout', 'fair', 'wallet', 'faq'];

describe('player guide facts', () => {
  it('works the fee example through splitPayout: entry 1,000, till 2,000 at the bell → fee 50, player 1,950', () => {
    expect(FACTS.example).toEqual({ entry: 1000, cashout: 2000 });
    expect(feeExample(500)).toEqual({ fee: 50n, player: 1950n });
    // the server's own rate when it differs
    expect(feeExample(450)).toEqual({ fee: 45n, player: 1955n });
  });

  it('quotes the contract defaults', () => {
    expect(FACTS.fee).toEqual({ bps: 500, maxBps: 1000 });
    expect(FACTS.refundHours).toBe(24);
    expect(FACTS.rules).toMatchObject({ roundMin: 5, joinCloseS: 60, afkS: 45, lootMin: 3, lootMax: 24, lootEntryDiv: 4 });
    expect(FACTS.rules.roundMin).toBe(RULES.roundMs / 60_000);
    expect(FACTS.capacity).toEqual({ practice: CAPACITY.practice, private: CAPACITY.private, arena: 50 });
    // every default arena is open to everyone; they differ only by entry fee
    expect(FACTS.arenas.map((a) => [a.id, a.entry])).toEqual([
      [1, 1000],
      [2, 10000],
      [3, 50000],
      [4, 250000],
    ]);
  });

  it('mirrors the server-only timings from the server source', () => {
    // vitest runs in apps/web (pnpm -r / -F run each package in its own directory)
    const src = (rel: string) => readFileSync(resolve(process.cwd(), '../server/src', rel), 'utf8');
    const manager = src('rooms/manager.ts');
    const room = src('rooms/room.ts');
    // the chain gateway: chain/evm.ts on Elysium (chain/solana.ts until the server port lands)
    const gateway = existsSync(resolve(process.cwd(), '../server/src/chain/evm.ts')) ? src('chain/evm.ts') : src('chain/solana.ts');
    expect(manager).toMatch(new RegExp(`export const PRO_LEVEL = ${SERVER.proLevel};`));
    expect(manager).toMatch(new RegExp(`export const PROMOTE_MAX_MASS = ${SERVER.promoteMaxMass};`));
    expect(manager).toMatch(new RegExp(`export const PROMOTE_KILLS = ${SERVER.promoteKills};`));
    expect(manager).toMatch(new RegExp(`export const PROMOTION_MS = ${SERVER.promotionHours} \\* 3600_000;`));
    expect(manager).toMatch(new RegExp(`length: ${SERVER.privateCodeLength} }`));
    expect(room).toMatch(new RegExp(`export const MAX_STAKE_SESSION_AGE_S = ${SERVER.maxTicketHours} \\* 3600;`));
    expect(gateway).toMatch(new RegExp(`export const STALE_SESSION_AFTER_S = ${SERVER.staleTicketMinutes} \\* 60;`));
  });
});

describe('player guide content', () => {
  const en = docsEn('$ELYMUM');

  it("quotes the server's fee rate and uses it in the worked example", () => {
    const text = (c: typeof en) => JSON.stringify([c.dateline, c.sections]);
    expect(text(en)).toContain('fee 50, you get 1,950');
    expect(text(en)).toContain('Fee 5% of profit');
    const live = docsEn('$ELYMUM', 300);
    expect(live.feeBps).toBe(300);
    expect(text(live)).toContain('fee 30, you get 1,970');
    expect(text(live)).toContain('Fee 3% of profit');
  });

  it("says the fee goes to the operator's wallet, floor loot is burned, and arenas open soon until the token is set", () => {
    const t = JSON.stringify([en.receipt, en.sections]);
    expect(t).toContain("The whole fee goes to the operator's wallet");
    expect(en.receipt.footer).toBe("The fee goes to the operator's wallet");
    expect(t).toMatch(/Loot still on the floor at the bell is burned/);
    expect(t).toContain('Opening soon');
  });

  it('has no Pass, mint, season, treasury or prize-pool chapter or wording', () => {
    const t = JSON.stringify(en);
    expect(t).not.toMatch(/Slana Pass|\bPass\b|NFT mint/);
    expect(t).not.toMatch(/season|treasury|prize pool|reveal/i);
  });

  it('describes timed rounds and promises no cash-out in arenas', () => {
    const all = JSON.stringify([en.dateline, en.sections]);
    expect(all).toContain('5-minute rounds');
    expect(all).toContain('There is no cash-out in an arena');
    expect(all).not.toMatch(/cash out in|Press C|cash-out button|cashes out in|anytime/i);
    expect(JSON.stringify(en.sections)).not.toContain('"key":"C"');
  });

  it('R24: describes collecting a settled payout, not a 24 h refund of the entry fee only', () => {
    const t = JSON.stringify(en.sections);
    expect(t).not.toMatch(/never includes winnings|create the token account rather|returns your entry fee only/);
    expect(t).toContain('Collect payout');
  });

  it('has every section in the promised order, each with a title and content', () => {
    expect(en.sections.map((s) => s.id)).toEqual(SECTION_IDS);
    for (const s of en.sections) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it('uses no emoji, nothing from Solana and no Turkish', () => {
    const text = JSON.stringify(en);
    expect(text).not.toMatch(/Solana|Slana|lamport|\bSOL\b|◎|\brent\b|token account/);
    expect(text).toContain('HYPE');
    expect(text).toContain('Elysium');
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/SOL arena/i);
    expect(text).not.toMatch(/record_game/);
    // the CI guard's Turkish letters, written as escapes so this file passes the guard itself
    expect(text).not.toMatch(/[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/);
  });

  it('formats numbers in en-US', () => {
    expect(en.pct(500)).toBe('5%');
    expect(en.pct(450)).toBe('4.5%');
    expect(en.num(1950)).toBe('1,950');
    expect(en.num(250000)).toBe('250,000');
  });
});

describe('player guide page', () => {
  it('renders the seven sections and the worked fee example', () => {
    render(
      <Kb theme="paper">
        <DocsPage />
      </Kb>,
    );
    const toc = screen.getByRole('navigation', { name: en0.tocLabel });
    expect(within(toc).getAllByRole('button')).toHaveLength(7);
    for (const s of en0.sections) expect(screen.getByRole('heading', { level: 3, name: s.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Rounds, payout and fees' })).toBeTruthy();
    // the receipt: fee 50, 1,950 to the player
    expect(screen.getByText('1,950')).toBeTruthy();
    expect(screen.getByText('−50')).toBeTruthy();
    expect(screen.getByText("The fee goes to the operator's wallet")).toBeTruthy();
  });

  it("follows the server's fee rate (ChainStatus.feeBps)", () => {
    act(() =>
      useUi.setState({
        chain: chainStatus({ token: null, feeBps: 400 }),
      }),
    );
    render(
      <Kb theme="paper">
        <DocsPage />
      </Kb>,
    );
    expect(screen.getByText('1,960')).toBeTruthy();
    expect(screen.getByText('−40')).toBeTruthy();
  });
});

describe('docs routes', () => {
  it('opens the guide at /docs and #docs', () => {
    expect(pageFromUrl('/docs', '')).toBe('docs');
    expect(pageFromUrl('/docs/', '')).toBe('docs');
    expect(pageFromUrl('/', '#docs')).toBe('docs');
    // the retired Pass page falls back to the front page
    expect(pageFromUrl('/', '#pass')).toBe('play');
    expect(pageFromUrl('/docs', '#ranks')).toBe('ranks');
    expect(pageFromUrl('/', '')).toBe('play');
    expect(pageFromUrl('/elsewhere', '')).toBe('play');
  });

  it('keeps /docs while on the guide and leaves it for the other pages', () => {
    expect(urlForPage('docs', '/', '')).toBe('/#docs');
    expect(urlForPage('docs', '/docs', '')).toBe('/docs');
    expect(urlForPage('profile', '/docs', '')).toBe('/#profile');
    expect(urlForPage('play', '/docs', '?x=1')).toBe('/?x=1');
    expect(urlForPage('ranks', '/', '')).toBe('/#ranks');
  });
});

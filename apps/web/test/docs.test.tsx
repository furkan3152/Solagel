import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPACITY, RULES } from '@slana/shared';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import { pageFromUrl, urlForPage, useUi } from '../src/store';
import { DocsPage } from '../src/ui/docs/DocsPage';
import { docsEn } from '../src/ui/docs/content.en';
import { FACTS, SERVER } from '../src/ui/docs/facts';

const initial = useUi.getState();
const en0 = docsEn();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

/** The section order the guide promises (Task 16 brief). */
const SECTION_IDS = ['play', 'rooms', 'value', 'payout', 'pass', 'mint', 'seasons', 'fair', 'wallet', 'faq'];

describe('player guide facts', () => {
  it('works the fee example through splitPayout: 1,000 in, 2,000 out → fee 50 (Pass 20), net 1,950 (Pass 1,980)', () => {
    const { normal, pass } = FACTS.example;
    expect(FACTS.example).toMatchObject({ entry: 1000, cashout: 2000 });
    expect(normal).toEqual({ fee: 50n, treasury: 25n, season: 15n, burn: 10n, player: 1950n });
    expect(pass).toEqual({ fee: 20n, treasury: 10n, season: 6n, burn: 4n, player: 1980n });
  });

  it('quotes the program and admin defaults', () => {
    expect(FACTS.fee).toEqual({ bps: 500, passBps: 200, maxBps: 1000, split: [5000, 3000, 2000] });
    expect(FACTS.settleFeeLamports).toBe(20_000);
    expect(FACTS.season).toMatchObject({ boardSize: 20, prizeRanks: 10, claimDays: 30, shares: [3000, 2000, 1400, 1000, 800, 600, 450, 300, 250, 200] });
    expect(FACTS.pass).toEqual({ supply: 3333, perWallet: 1 });
    expect(FACTS.refundHours).toBe(24);
    expect(FACTS.rules).toMatchObject({ roundMin: 5, joinCloseS: 60, passStartPct: 15, afkS: 45, lootMin: 3, lootMax: 24, lootEntryDiv: 4 });
    expect(FACTS.capacity).toEqual({ practice: CAPACITY.practice, private: CAPACITY.private, arena: 50 });
    expect(FACTS.arenas.map((a) => [a.id, a.entry, a.pass])).toEqual([
      [1, 1000, false],
      [2, 10000, false],
      [3, 50000, true],
      [4, 250000, true],
    ]);
    expect(RULES.passStartMassMul).toBe(1.15);
  });

  it('mirrors the server-only timings from the server source', () => {
    // vitest runs in apps/web (pnpm -r / -F run each package in its own directory)
    const src = (rel: string) => readFileSync(resolve(process.cwd(), '../server/src', rel), 'utf8');
    const manager = src('rooms/manager.ts');
    const room = src('rooms/room.ts');
    const solana = src('chain/solana.ts');
    expect(manager).toMatch(new RegExp(`export const PRO_LEVEL = ${SERVER.proLevel};`));
    expect(manager).toMatch(new RegExp(`export const PROMOTE_MAX_MASS = ${SERVER.promoteMaxMass};`));
    expect(manager).toMatch(new RegExp(`export const PROMOTE_KILLS = ${SERVER.promoteKills};`));
    expect(manager).toMatch(new RegExp(`export const PROMOTION_MS = ${SERVER.promotionHours} \\* 3600_000;`));
    expect(manager).toMatch(new RegExp(`length: ${SERVER.privateCodeLength} }`));
    expect(room).toMatch(new RegExp(`export const MAX_STAKE_SESSION_AGE_S = ${SERVER.maxTicketHours} \\* 3600;`));
    expect(solana).toMatch(new RegExp(`export const STALE_SESSION_AFTER_S = ${SERVER.staleTicketMinutes} \\* 60;`));
  });
});

describe('player guide content', () => {
  const en = docsEn('$SLANA');

  it('I3: quotes the Pass power the server applies when it publishes one', () => {
    const text = (c: typeof en) => JSON.stringify(c.sections);
    const power = { startMassMul: 1.3, cashoutMs: 1_000 };
    expect(text(docsEn('$SLANA', power))).toContain('start with +30% mass');
    expect(text(en)).toContain('start with +15% mass');
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

  it('uses no emoji, no SOL arenas and no Turkish', () => {
    const text = JSON.stringify(en);
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
  it('renders the ten sections and the worked fee example', () => {
    render(
      <Kb theme="paper">
        <DocsPage />
      </Kb>,
    );
    const toc = screen.getByRole('navigation', { name: en0.tocLabel });
    expect(within(toc).getAllByRole('button')).toHaveLength(10);
    for (const s of en0.sections) expect(screen.getByRole('heading', { level: 3, name: s.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Rounds, payout and fees' })).toBeTruthy();
    // Receipts: net 1,950 without a Pass, 1,980 with one; fee 50 / 20
    expect(screen.getByText('1,950')).toBeTruthy();
    expect(screen.getByText('1,980')).toBeTruthy();
    expect(screen.getByText('−50')).toBeTruthy();
    expect(screen.getByText('−20')).toBeTruthy();
  });
});

describe('docs routes', () => {
  it('opens the guide at /docs and #docs', () => {
    expect(pageFromUrl('/docs', '')).toBe('docs');
    expect(pageFromUrl('/docs/', '')).toBe('docs');
    expect(pageFromUrl('/', '#docs')).toBe('docs');
    expect(pageFromUrl('/', '#pass')).toBe('pass');
    expect(pageFromUrl('/docs', '#ranks')).toBe('ranks');
    expect(pageFromUrl('/', '')).toBe('play');
    expect(pageFromUrl('/elsewhere', '')).toBe('play');
  });

  it('keeps /docs while on the guide and leaves it for the other pages', () => {
    expect(urlForPage('docs', '/', '')).toBe('/#docs');
    expect(urlForPage('docs', '/docs', '')).toBe('/docs');
    expect(urlForPage('pass', '/docs', '')).toBe('/#pass');
    expect(urlForPage('play', '/docs', '?x=1')).toBe('/?x=1');
    expect(urlForPage('ranks', '/', '')).toBe('/#ranks');
  });
});

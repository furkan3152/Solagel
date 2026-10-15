import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPACITY, RULES } from '@slana/shared';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import { pageFromUrl, urlForPage, useUi } from '../src/store';
import { DocsPage } from '../src/ui/docs/DocsPage';
import { docsEn } from '../src/ui/docs/content.en';
import { docsTr } from '../src/ui/docs/content.tr';
import { FACTS, SERVER } from '../src/ui/docs/facts';

const initial = useUi.getState();
afterEach(() => {
  act(() => useUi.setState(initial, true));
});

/** The section order the guide promises. */
const SECTION_IDS = ['play', 'rooms', 'value', 'cashout', 'pass', 'mint', 'seasons', 'fair', 'wallet', 'faq'];

describe('player guide facts', () => {
  it('works the fee example through splitPayout: 1.000 in, 2.000 out → fee 50 (Pass 20), net 1.950 (Pass 1.980)', () => {
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
    expect(FACTS.rules).toMatchObject({ cashoutS: 3, passCashoutS: 2, passStartPct: 15, afkS: 45, lootMin: 3, lootMax: 24, lootEntryDiv: 4 });
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
    expect(solana).toMatch(new RegExp(`export const NO_ATA_RETRY_MS = ${SERVER.noAtaRetryMinutes} \\* 60_000;`));
  });
});

describe('player guide content', () => {
  const tr = docsTr('$SLANA');
  const en = docsEn('$SLANA');

  it('has the same sections and blocks in TR and EN, in the promised order', () => {
    expect(tr.sections.map((s) => s.id)).toEqual(SECTION_IDS);
    expect(en.sections.map((s) => s.id)).toEqual(SECTION_IDS);
    const shape = (c: typeof tr) => c.sections.map((s) => s.blocks.map((b) => b.kind + ('items' in b && Array.isArray(b.items) ? b.items.length : '')));
    expect(shape(tr)).toEqual(shape(en));
  });

  it('uses no emoji and no SOL arenas', () => {
    for (const c of [tr, en]) {
      const text = JSON.stringify(c);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text).not.toMatch(/SOL arena|SOL arenası/i);
      expect(text).not.toMatch(/record_game/);
    }
  });

  it('formats numbers per language', () => {
    expect(tr.pct(500)).toBe('%5');
    expect(tr.pct(450)).toBe('%4,5');
    expect(en.pct(450)).toBe('4.5%');
    expect(tr.num(1950)).toBe('1.950');
    expect(en.num(1950)).toBe('1,950');
  });
});

describe('player guide page', () => {
  it('renders the ten sections and the worked fee example in Turkish', () => {
    act(() => useUi.setState({ settings: { ...initial.settings, lang: 'tr' } }));
    render(
      <Kb theme="paper">
        <DocsPage />
      </Kb>,
    );
    const toc = screen.getByRole('navigation', { name: 'İçindekiler' });
    expect(within(toc).getAllByRole('button')).toHaveLength(10);
    for (const s of docsTr().sections) expect(screen.getByRole('heading', { level: 3, name: s.title })).toBeTruthy();
    // Receipts: net 1.950 without a Pass, 1.980 with one; fee 50 / 20
    expect(screen.getByText('1.950')).toBeTruthy();
    expect(screen.getByText('1.980')).toBeTruthy();
    expect(screen.getByText('−50')).toBeTruthy();
    expect(screen.getByText('−20')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Pass oyun içinde güç verir' })).toBeTruthy();
  });

  it('renders in English', () => {
    act(() => useUi.setState({ settings: { ...initial.settings, lang: 'en' } }));
    render(
      <Kb theme="paper">
        <DocsPage />
      </Kb>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Cash-out and fees' })).toBeTruthy();
    expect(screen.getByText('1,950')).toBeTruthy();
    expect(screen.getByText('1,980')).toBeTruthy();
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

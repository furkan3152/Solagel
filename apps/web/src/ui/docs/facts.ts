import { CAPACITY, DEFAULT_ARENAS, RULES, arenaMeta } from '@elymum/shared';
import { DEFAULT_FEE_BPS, DEFAULT_SETTLE_FEE_LAMPORTS, MAX_FEE_BPS, SESSION_REFUND_TIMEOUT_SECS, splitPayout, type PayoutSplit } from '@elymum/sdk';

/**
 * Every number the player guide quotes, taken from the code that enforces it, so the
 * page cannot drift from the game. Program and admin defaults come from `@elymum/sdk`
 * (mirrors of `programs/slana-ref/src/constants.rs` and `pnpm admin init`), gameplay from
 * `@elymum/shared` `RULES` / `CAPACITY` (server defaults; operators may change them with
 * env vars). The few server-only timings are mirrored in `SERVER` below and checked
 * against the server source by `test/docs.test.ts`.
 */

/** Server timings that live only in apps/server (checked by test/docs.test.ts). */
export const SERVER = {
  /** `PRO_LEVEL` (rooms/manager.ts): practice players at this level or more play in the pro league. */
  proLevel: 5,
  /** `PROMOTE_MAX_MASS` / `PROMOTE_KILLS` (rooms/manager.ts): a rookie game above either promotes to pro… */
  promoteMaxMass: 3000,
  promoteKills: 8,
  /** …for `PROMOTION_MS` (24 h). */
  promotionHours: 24,
  /** `MAX_STAKE_SESSION_AGE_S` (rooms/room.ts): a safety cap; rounds end every 5 minutes, so tickets close far sooner. */
  maxTicketHours: 6,
  /** `STALE_SESSION_AFTER_S` (chain/solana.ts): a ticket nobody plays is settled at its entry fee after 15 min. */
  staleTicketMinutes: 15,
  /** `PRIVATE_ROOM_CAPACITY` default (shared CAPACITY.private) and the 5-character room code (rooms/manager.ts). */
  privateCodeLength: 5,
} as const;

/** The worked fee example of the guide: a 1,000-token ticket with 2,000 tokens in the till at the bell. */
export const EXAMPLE = { entry: 1000, cashout: 2000 } as const;

/** The worked example at `bps` (the server's `feeBps`; 5 % → fee 50, player 1,950), exactly as `settle_session` splits it. */
export function feeExample(bps: number): PayoutSplit {
  return splitPayout(EXAMPLE.cashout, EXAMPLE.entry, bps);
}

export interface DocsFacts {
  fee: { bps: number; maxBps: number };
  settleFeeLamports: number;
  example: { entry: number; cashout: number };
  arenas: { id: number; name: string; entry: number; maxSessions: number }[];
  capacity: { practice: number; private: number; arena: number };
  rules: {
    roundMin: number;
    joinCloseS: number;
    afkS: number;
    spawnShieldS: number;
    eatRatio: number;
    lootMin: number;
    lootMax: number;
    lootEntryDiv: number;
  };
  refundHours: number;
  server: typeof SERVER;
}

export const FACTS: DocsFacts = {
  fee: { bps: DEFAULT_FEE_BPS, maxBps: MAX_FEE_BPS },
  settleFeeLamports: DEFAULT_SETTLE_FEE_LAMPORTS,
  example: EXAMPLE,
  arenas: DEFAULT_ARENAS.map((a) => ({ id: a.id, name: arenaMeta(a.id).name, entry: a.entryTokens, maxSessions: a.maxSessions })),
  capacity: { practice: CAPACITY.practice, private: CAPACITY.private, arena: CAPACITY.arena },
  rules: {
    roundMin: RULES.roundMs / 60_000,
    joinCloseS: RULES.roundJoinCloseMs / 1000,
    afkS: RULES.afkGraceMs / 1000,
    spawnShieldS: RULES.spawnShieldMs / 1000,
    eatRatio: RULES.eatRatio,
    lootMin: RULES.lootPiecesMin,
    lootMax: RULES.lootPiecesMax,
    lootEntryDiv: Math.round(1 / RULES.lootPieceEntryFraction),
  },
  refundHours: SESSION_REFUND_TIMEOUT_SECS / 3600,
  server: SERVER,
};

/* ------------------------------------------------------------------ */
/* Content model                                                       */
/* ------------------------------------------------------------------ */

export type DocBlock =
  | { kind: 'p'; text: string }
  /** Bulleted list; an item may lead with a bold term. */
  | { kind: 'list'; items: (string | { term: string; text: string })[] }
  /** Key → action rows (controls). */
  | { kind: 'keys'; rows: { key: string; action: string }[]; caption: string }
  /** Newspaper table. */
  | { kind: 'table'; caption: string; head: string[]; rows: string[][]; numeric?: number[] }
  /** Boxes joined by arrows: how value moves. */
  | { kind: 'flow'; label: string; steps: { title: string; text: string }[] }
  /** The worked fee example as a receipt (at the server's fee rate). */
  | { kind: 'fee-example' }
  /** Two columns compared side by side. */
  | { kind: 'compare'; left: { title: string; items: string[] }; right: { title: string; items: string[] } }
  /** A boxed notice; `stamp` is printed on it. */
  | { kind: 'note'; tone: 'warn' | 'info'; stamp: string; title: string; text: string }
  /** Questions and answers (disclosure widgets). */
  | { kind: 'faq'; items: { q: string; a: string }[] };

export interface DocSection {
  /** Anchor id (prefixed `docs-` on the page). */
  id: string;
  title: string;
  /** One-line summary under the title. */
  lede: string;
  blocks: DocBlock[];
}

export interface DocsContent {
  kicker: string;
  title: string;
  deck: string;
  /** Short facts for the dateline strip under the head. */
  dateline: string[];
  tocLabel: string;
  /** The worked fee example receipt (its numbers come from `feeExample(feeBps)`). */
  receipt: {
    title: string;
    meta: string;
    entry: string;
    cashout: string;
    profit: string;
    fee: (pct: string) => string;
    net: string;
    /** Where the fee goes (the receipt's footer). */
    footer: string;
    caption: string;
  };
  /** The fee rate the guide quotes (basis points): the server's `feeBps`, else the program default. */
  feeBps: number;
  colophon: string;
  backToTop: string;
  sections: DocSection[];
  /** Formats a percentage given in basis points (`500` → `%5` / `5%`). */
  pct: (bps: number) => string;
  /** Formats a whole number with the language's grouping (`1.000` / `1,000`). */
  num: (n: number) => string;
}

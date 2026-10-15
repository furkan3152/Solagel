import { CAPACITY, DEFAULT_ARENAS, LEADERBOARD_SIZE, PRIZE_SHARES_BPS, RULES, arenaMeta, type PassPower } from '@slana/shared';
import {
  CLAIM_WINDOW_SECS,
  DEFAULT_FEE_BPS,
  DEFAULT_FEE_SPLIT_BPS,
  DEFAULT_PASS_FEE_BPS,
  DEFAULT_PASS_PER_WALLET,
  DEFAULT_PASS_SUPPLY,
  DEFAULT_SETTLE_FEE_LAMPORTS,
  MAX_FEE_BPS,
  MAX_SCORE_PER_GAME,
  PRIZE_RANKS,
  SESSION_REFUND_TIMEOUT_SECS,
  splitPayout,
  type PayoutSplit,
} from '@slana/sdk';

/**
 * Every number the player guide quotes, taken from the code that enforces it, so the
 * page cannot drift from the game. Program and admin defaults come from `@slana/sdk`
 * (mirrors of `programs/slana-ref/src/constants.rs` and `pnpm admin init`), gameplay from
 * `@slana/shared` `RULES` / `CAPACITY` (server defaults; operators may change them with
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
  /** `MAX_STAKE_SESSION_AGE_S` (rooms/room.ts): arena players are cashed out automatically after 6 h. */
  maxTicketHours: 6,
  /** `STALE_SESSION_AFTER_S` (chain/solana.ts): a ticket nobody plays is settled at its entry fee after 15 min. */
  staleTicketMinutes: 15,
  /** `PRIVATE_ROOM_CAPACITY` default (shared CAPACITY.private) and the 5-character room code (rooms/manager.ts). */
  privateCodeLength: 5,
} as const;

/** The worked fee example of the guide: a 1,000-token ticket cashed out at 2,000 tokens. */
export const EXAMPLE = { entry: 1000, cashout: 2000 } as const;

export interface DocsFacts {
  fee: { bps: number; passBps: number; maxBps: number; split: readonly [number, number, number] };
  settleFeeLamports: number;
  example: { entry: number; cashout: number; normal: PayoutSplit; pass: PayoutSplit };
  arenas: { id: number; name: string; entry: number; pass: boolean; maxSessions: number }[];
  capacity: { practice: number; private: number; arena: number };
  rules: {
    cashoutS: number;
    passCashoutS: number;
    passStartPct: number;
    afkS: number;
    spawnShieldS: number;
    eatRatio: number;
    lootMin: number;
    lootMax: number;
    lootEntryDiv: number;
  };
  season: { boardSize: number; prizeRanks: number; shares: readonly number[]; claimDays: number; maxScore: number };
  pass: { supply: number; perWallet: number };
  refundHours: number;
  server: typeof SERVER;
}

const cfg = { feeBps: DEFAULT_FEE_BPS, passFeeBps: DEFAULT_PASS_FEE_BPS, treasuryBps: DEFAULT_FEE_SPLIT_BPS[0], burnBps: DEFAULT_FEE_SPLIT_BPS[2] };

export const FACTS: DocsFacts = {
  fee: { bps: DEFAULT_FEE_BPS, passBps: DEFAULT_PASS_FEE_BPS, maxBps: MAX_FEE_BPS, split: DEFAULT_FEE_SPLIT_BPS },
  settleFeeLamports: DEFAULT_SETTLE_FEE_LAMPORTS,
  example: {
    ...EXAMPLE,
    normal: splitPayout(EXAMPLE.cashout, EXAMPLE.entry, false, cfg),
    pass: splitPayout(EXAMPLE.cashout, EXAMPLE.entry, true, cfg),
  },
  arenas: DEFAULT_ARENAS.map((a) => ({ id: a.id, name: arenaMeta(a.id).name, entry: a.entryTokens, pass: a.requiresPass, maxSessions: a.maxSessions })),
  capacity: { practice: CAPACITY.practice, private: CAPACITY.private, arena: CAPACITY.arena },
  rules: {
    cashoutS: RULES.cashoutMs / 1000,
    passCashoutS: RULES.passCashoutMs / 1000,
    passStartPct: Math.round((RULES.passStartMassMul - 1) * 100),
    afkS: RULES.afkGraceMs / 1000,
    spawnShieldS: RULES.spawnShieldMs / 1000,
    eatRatio: RULES.eatRatio,
    lootMin: RULES.lootPiecesMin,
    lootMax: RULES.lootPiecesMax,
    lootEntryDiv: Math.round(1 / RULES.lootPieceEntryFraction),
  },
  season: { boardSize: LEADERBOARD_SIZE, prizeRanks: PRIZE_RANKS, shares: PRIZE_SHARES_BPS, claimDays: CLAIM_WINDOW_SECS / 86_400, maxScore: MAX_SCORE_PER_GAME },
  pass: { supply: DEFAULT_PASS_SUPPLY, perWallet: DEFAULT_PASS_PER_WALLET },
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
  /** Numbered steps. */
  | { kind: 'steps'; items: string[] }
  /** Key → action rows (controls). */
  | { kind: 'keys'; rows: { key: string; action: string }[]; caption: string }
  /** Newspaper table. */
  | { kind: 'table'; caption: string; head: string[]; rows: string[][]; numeric?: number[] }
  /** Boxes joined by arrows: how value moves. */
  | { kind: 'flow'; label: string; steps: { title: string; text: string }[] }
  /** The worked fee example as two receipts (without and with a Pass). */
  | { kind: 'fee-example' }
  /** Perks with where each one is enforced. */
  | { kind: 'perks'; items: { title: string; text: string; where: 'chain' | 'server' }[] }
  /** Two columns compared side by side. */
  | { kind: 'compare'; left: { title: string; items: string[] }; right: { title: string; items: string[] } }
  /** A boxed notice; `stamp` is printed on it. */
  | { kind: 'note'; tone: 'warn' | 'info'; stamp: string; title: string; text: string }
  /** Prize shares of the season ranks. */
  | { kind: 'prizes'; caption: string }
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
  /** Labels of the worked fee example receipts. */
  receipt: {
    title: string;
    titlePass: string;
    meta: string;
    entry: string;
    cashout: string;
    profit: string;
    fee: (pct: string) => string;
    net: string;
    split: string;
    treasury: string;
    season: string;
    burn: string;
    caption: string;
  };
  perkWhere: { chain: string; server: string };
  rank: (n: number) => string;
  /** Live config line (shown when the chain config differs from the defaults). */
  live: (fee: string, passFee: string) => string;
  colophon: string;
  backToTop: string;
  sections: DocSection[];
  /** Formats a percentage given in basis points (`500` → `%5` / `5%`). */
  pct: (bps: number) => string;
  /** Formats a whole number with the language's grouping (`1.000` / `1,000`). */
  num: (n: number) => string;
}

/**
 * I3: the guide's gameplay numbers with the Pass power this server applies (`ChainStatus.passPower`
 * from its env); `FACTS.rules` (the `RULES` defaults) when unknown.
 */
export function rulesWith(power: PassPower | null | undefined): DocsFacts['rules'] {
  if (!power) return FACTS.rules;
  return { ...FACTS.rules, passCashoutS: power.cashoutMs / 1000, passStartPct: Math.round((power.startMassMul - 1) * 100) };
}

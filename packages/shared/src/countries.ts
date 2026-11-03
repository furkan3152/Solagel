/* ------------------------------------------------------------------ */
/* Countries (the flag a player plays for)                             */
/* ------------------------------------------------------------------ */

/**
 * Every officially assigned ISO 3166-1 alpha-2 code (249). This is the strict allowlist: a join, a
 * profile or a snapshot carrying anything else is treated as "no country". Display names come from
 * the browser (`Intl.DisplayNames`), so no name table ships here.
 */
const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

/** The allowlist, sorted. */
export const COUNTRY_CODES: readonly string[] = CODES.split(' ');
const CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

/** Bytes of a country code on the wire (`PlayerFlag.Country`): two ASCII capitals. */
export const COUNTRY_BYTES = 2;

/** Whether `v` is an allowlisted ISO 3166-1 alpha-2 code (upper case only). */
export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && v.length === 2 && CODE_SET.has(v);
}

/** A loosely typed country (any case, surrounding spaces) as an allowlisted code, or null. */
export function normalizeCountry(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 8) return null;
  const c = v.trim().toUpperCase();
  return isCountryCode(c) ? c : null;
}

/** The code packed into 16 bits (first letter high), as it travels on the wire; 0 for none. */
export function packCountry(code: string | null | undefined): number {
  return isCountryCode(code) ? (code.charCodeAt(0) << 8) | code.charCodeAt(1) : 0;
}

const BY_PACKED = new Map<number, string>(COUNTRY_CODES.map((c) => [packCountry(c), c]));

/** The code of a packed value (`packCountry`), or null when it is not on the allowlist. No allocation. */
export function unpackCountry(packed: number): string | null {
  return BY_PACKED.get(packed) ?? null;
}

/**
 * Languages whose country is a fair first guess when the browser's language tags carry no region
 * (`de` → DE). Languages spoken in many countries (en, es, pt, ar, fr) are left out on purpose.
 */
const LANGUAGE_COUNTRY: Readonly<Record<string, string>> = {
  de: 'DE', it: 'IT', nl: 'NL', pl: 'PL', sv: 'SE', da: 'DK', nb: 'NO', nn: 'NO', no: 'NO', fi: 'FI', is: 'IS',
  cs: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO', bg: 'BG', el: 'GR', tr: 'TR', uk: 'UA', ru: 'RU', lt: 'LT', lv: 'LV',
  et: 'EE', hr: 'HR', sr: 'RS', sl: 'SI', ja: 'JP', ko: 'KR', zh: 'CN', hi: 'IN', id: 'ID', ms: 'MY', th: 'TH',
  vi: 'VN', fil: 'PH', tl: 'PH', he: 'IL', fa: 'IR', ka: 'GE', hy: 'AM', kk: 'KZ', uz: 'UZ', bn: 'BD', ur: 'PK',
};

/**
 * A first guess at the player's country from the browser's language tags (`navigator.languages`,
 * best first): the first tag with a region (`en-GB` → GB, `pt_BR` → BR), else a language that is
 * mostly spoken in one country (`de` → DE). Null when nothing fits: the player picks one, or none.
 */
export function suggestCountry(languages: readonly string[] | null | undefined): string | null {
  if (!languages) return null;
  for (const tag of languages) {
    if (typeof tag !== 'string') continue;
    const parts = tag.split(/[-_]/);
    // language[-script][-region]: the first 2-letter subtag after the language is the region
    for (let i = 1; i < parts.length && i < 3; i++) {
      const c = normalizeCountry(parts[i].length === 2 ? parts[i] : '');
      if (c) return c;
    }
  }
  for (const tag of languages) {
    if (typeof tag !== 'string') continue;
    const c = LANGUAGE_COUNTRY[tag.split(/[-_]/)[0].toLowerCase()];
    if (c) return c;
  }
  return null;
}

/**
 * Where server bots say they come from: the bot names are English-speaking handles, so mostly the
 * English-speaking countries, with a sprinkle of others. Weighted by repetition.
 */
const BOT_COUNTRY_POOL: readonly string[] = [
  ...Array<string>(10).fill('US'),
  ...Array<string>(5).fill('GB'),
  ...Array<string>(4).fill('CA'),
  ...Array<string>(3).fill('AU'),
  'IE', 'NZ', 'DE', 'FR', 'NL', 'SE', 'BR', 'PH', 'IN', 'MX', 'PL', 'ES', 'IT', 'ZA',
];

/** FNV-1a over the lower-cased name, from `seed`. */
function nameHash(name: string, seed: number): number {
  let h = seed >>> 0;
  const s = name.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A bot's country: always the same one for the same name (any case), so a regular keeps its flag. */
export function botCountry(name: string): string {
  return BOT_COUNTRY_POOL[nameHash(name, 0x811c9dc5) % BOT_COUNTRY_POOL.length];
}

/** Share of bots that paint their coin with their country's flag (the flag skin), in percent. */
export const BOT_FLAG_SKIN_PERCENT = 30;

/**
 * Whether a bot wears its country's flag as the coin skin (`PlayerFlag.FlagSkin`): about
 * `BOT_FLAG_SKIN_PERCENT` % of the names, always the same answer for the same name (any case).
 */
export function botWearsFlag(name: string): boolean {
  // a second hash (another seed), so the pick does not follow the country
  return nameHash(name, 0x2f6b9d13) % 100 < BOT_FLAG_SKIN_PERCENT;
}

/**
 * A row of the countries board (`GET /api/leaderboard` `countries`): what the human players of one
 * country did together (bots excluded).
 */
export interface CountryBoardRow {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Sum of the best mass of every game played. */
  mass: number;
  /** Games played. */
  games: number;
  /** Arena payouts (raw token units) of the games that ended alive. */
  paid: number;
}

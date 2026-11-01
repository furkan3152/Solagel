/**
 * Bot names: the kind of usernames real people pick (first names with digits, initials,
 * lowercase handles, a few dots and underscores; English-speaking names only, in plain ASCII).
 * Never crypto puns. Every bot also carries a visible BOT tag (`PlayerFlag.Bot`), so the names
 * only have to look natural, not fool anyone.
 */
export const BOT_NAMES: readonly string[] = [
  // English-speaking first names, handles, nicknames and plain gamer tags (ASCII only)
  'jake_r', 'emily22', 'mattplays', 'sarah.k', 'tommy7', 'jess_m', 'ryan_2004', 'katie.l', 'danny_b', 'chloe99',
  'liam_w', 'olivia.j', 'noah_t', 'ava_x', 'mason91', 'harper_l', 'ethan.c', 'grace_h', 'lucas_m', 'zoe.b',
  'nate_g', 'lily_p', 'samwise', 'mikey_d', 'alex_rivera', 'jordan23', 'taylor.s', 'casey_j', 'morgan_k', 'jamie_o',
  'chris_p', 'kevin1992', 'amanda_r', 'brian.t', 'megan_e', 'tyler_j', 'hannah.w', 'josh_n', 'ashley_c', 'andrew_p',
  'nicole.s', 'justin_m', 'rachel_h', 'brandon7', 'laura_g', 'kyle_b', 'amy.d', 'sean_f', 'emma_rose', 'owenplays',
  'maddie.k', 'luke_s', 'abby_t', 'dylan99', 'ellie_m', 'connor_w', 'mia.r', 'evan_h', 'ruby_j', 'charlie_b',
  'georgia.l', 'oliver_t', 'poppy_m', 'jack.h', 'daisy.w', 'molly_r', 'archie_s', 'evie.c', 'toby_m', 'amelia_f',
  'finn_o', 'leo.b', 'sophie_m', 'ella.v', 'lisa_b', 'nightowl_sam', 'pixelpete', 'jayplays', 'benji_gg', 'katgamer',
  'mrjohnson', 'realmike', 'justtom', 'notjake', 'itsmaria', 'heyitsjen', 'yoitsdan', 'simplydave', 'coolkev', 'lazysunday',
  'sleepyhead', 'quietfox', 'bluejay_22', 'redpanda7', 'greenapple', 'tacotuesday', 'pizzaguy', 'cookie_jar', 'sunnyday', 'rainyday_k',
  'stargazer', 'driftwood', 'paperplane', 'lemonade', 'bubbletea_g', 'noodlesoup', 'mangolassi', 'blueberry', 'snowball', 'frostbite',
  'Mike_T', 'JennyB', 'SamC', 'TomH', 'Katie_W', 'BenL', 'jk_23', 'mtb', 'jp_m', 'rb_88',
  'ckim', 'em_jay', 'kb_2', 'ns_77', 'jdawg', 'aj_lee', 'benny', 'tinylou', 'abbz', 'jojo',
  'bex', 'gabe', 'rory', 'kit', 'ollie', 'reggie', 'fitz', 'bea', 'vic', 'ada',
  'eli', 'juno', 'remy', 'wren', 'ezra', 'milo', 'otis', 'nova', 'arlo', 'cleo',
  'aaron_k', 'austin.m', 'bella_r', 'blake_t', 'bobby_j', 'brooke.s', 'caleb_w', 'cameron_d', 'carter.p', 'claire_b',
  'cody_m', 'colin.r', 'dakota_s', 'derek_h', 'drew.k', 'dustin_b', 'eric.l', 'faith_m', 'gavin_r', 'hailey.j',
  'hunter_s', 'ian.p', 'jason_t', 'jenna.w', 'jesse_l', 'jordyn.m', 'kayla_b', 'kelsey.r', 'lauren_h', 'logan.d',
  'marissa_t', 'max_cooper', 'nathan_k', 'paige.w', 'parker_j', 'peyton_s', 'quinn.a', 'reid_m', 'riley.b', 'sadie_c',
  'savannah.j', 'scott_w', 'seth.m', 'shane_r', 'spencer.k', 'summer_l', 'travis.b', 'trevor_h', 'vanessa.m', 'wesley_j',
  'whitney.k', 'zach_t', 'zack.r', 'adam_w', 'beth.c', 'carl_m', 'dana_r', 'frank.b', 'gary_l', 'holly.p',
  'jack_mills', 'joel.r', 'kate_wood', 'lindsay_m', 'mark.e', 'nora_b', 'pete_s', 'rose.h', 'ted_j', 'wendy_m',
  'will.f', 'becca_l', 'jules_k', 'sophia_r', 'maya.t', 'natalie_s', 'audrey_b', 'leah.k', 'violet_m', 'stella_r',
  'nina.j', 'lydia_h', 'piper.l', 'hazel_w', 'ivy.m', 'ruby_lee', 'rosie.t', 'fiona_g', 'heidi.k', 'josie_b',
  'kara.l', 'danp92', 'jen1987', 'mike2k', 'mattc07', 'kyle1999', 'sam_88', 'chris_04', 'tom_2010', 'joe_7',
  'nick21', 'zach11', 'benji05', 'alexk3', 'rob_77', 'drew09', 'amy2001', 'bigmike', 'jakeyboy', 'thebrandon',
  'sillygoose', 'happycamper', 'nightowl', 'earlybird', 'lonewolf', 'luckystrike', 'wildcard', 'slowpoke', 'latecomer', 'backseat',
  'cornerkid', 'busybee', 'honeybee', 'firefly', 'ladybug', 'tumbleweed', 'pebble', 'mapleleaf', 'pinecone', 'acorn',
  'wildberry', 'sugarcube', 'marshmallow', 'pancake', 'waffles', 'toast_m', 'biscuit_b', 'muffin_t', 'pretzel_k', 'noodle',
  'jellybean', 'gumdrop', 'sprinkles', 'peanut', 'buttons', 'pickles', 'tylerplays', 'meganplays', 'chrisgames', 'emmaplays',
  'benplays', 'lilyplays', 'tomgames', 'danplays', 'jason.b', 'kim.l', 'scott.t', 'rachel.m', 'paul.h', 'sue.k',
  'steve.r', 'anna.b', 'dave.m', 'lisa.k', 'ryan.c', 'joan.p', 'karen.w', 'gregg.l', 'Dan_W', 'EmmaK',
  'ChrisB',
];

/** Words a bot name must never contain (crypto puns from the old pool, and anything rude). */
export const BOT_NAME_BANNED_PARTS: readonly string[] = [
  'gm_', 'moon', 'hodl', 'wagmi', 'ngmi', 'degen', 'pump', 'lambo', 'satoshi', 'whale', 'gwei', 'token', 'coin', 'nft',
  'crypto', 'sats', 'rug', 'airdrop', 'mint', 'gas', 'chain', 'block', 'hash', 'nonce', 'mev', 'jeet', 'fomo', 'fren',
  'sex', 'fuck', 'shit', 'nazi', 'kill', 'dick', 'porn',
];

/** Style rules every bot name follows: 3–16 ASCII letters/digits with single `.`/`_` inside, no banned part. */
export function isNaturalBotName(name: string): boolean {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|[._](?=[A-Za-z0-9]))*$/.test(name)) return false;
  if (name.length < 3 || name.length > 16) return false;
  const low = name.toLowerCase();
  return !BOT_NAME_BANNED_PARTS.some((w) => low.includes(w));
}

/**
 * Picks a bot name not in `taken` (compared case-insensitively; pass every name in the room,
 * humans too). With `regulars` (names bots wore earlier in this room), sometimes a returning
 * regular comes back (`regularChance`, default 0.35), so a room has familiar faces across rounds.
 * When the pool runs dry the name gets two digits appended, still unique.
 */
export function pickBotName(
  rng: () => number,
  taken: Iterable<string>,
  regulars: readonly string[] = [],
  regularChance = 0.35,
): string {
  const used = new Set<string>();
  for (const n of taken) used.add(n.toLowerCase());
  const free = (n: string) => !used.has(n.toLowerCase());
  if (regulars.length > 0 && rng() < regularChance) {
    const back = regulars.filter(free);
    if (back.length > 0) return back[Math.floor(rng() * back.length)];
  }
  const pool = BOT_NAMES.filter(free);
  if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
  for (let i = 0; i < 1000; i++) {
    const base = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)].slice(0, 13);
    const n = `${base}${Math.floor(rng() * 90 + 10)}`;
    if (free(n)) return n;
  }
  let k = 100;
  while (!free(`player${k}`)) k++;
  return `player${k}`;
}

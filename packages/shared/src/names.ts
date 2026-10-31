/**
 * Bot names: the kind of usernames real people pick (first names with digits, initials,
 * lowercase handles, a few dots and underscores, names from many countries written in plain
 * ASCII). Never crypto puns. Every bot also carries a visible BOT tag (`PlayerFlag.Bot`),
 * so the names only have to look natural, not fool anyone.
 */
export const BOT_NAMES: readonly string[] = [
  // English-speaking first names, handles and gamer-ish (but normal) tags
  'jake_r', 'emily22', 'mattplays', 'sarah.k', 'tommy7', 'jess_m', 'ryan_2004', 'katie.l', 'danny_b', 'chloe99',
  'liam_w', 'olivia.j', 'noah_t', 'ava_x', 'mason91', 'harper_l', 'ethan.c', 'grace_h', 'lucas_m', 'zoe.b',
  'nate_g', 'lily_p', 'samwise', 'mikey_d', 'alex_rivera', 'jordan23', 'taylor.s', 'casey_j', 'morgan_k', 'jamie_o',
  'chris_p', 'kevin1992', 'amanda_r', 'brian.t', 'megan_e', 'tyler_j', 'hannah.w', 'josh_n', 'ashley_c', 'andrew_p',
  'nicole.s', 'justin_m', 'rachel_h', 'brandon7', 'laura_g', 'kyle_b', 'amy.d', 'sean_f', 'emma_rose', 'owenplays',
  'maddie.k', 'luke_s', 'abby_t', 'dylan99', 'ellie_m', 'connor_w', 'mia.r', 'evan_h', 'ruby_j', 'charlie_b',
  'georgia.l', 'oliver_t', 'poppy_m', 'jack.h', 'isla_k', 'freddie_g', 'daisy.w', 'alfie_j', 'molly_r', 'archie_s',
  'evie.c', 'toby_m', 'amelia_f', 'finn_o', 'sienna_l', 'leo.b', 'imogen_t', 'sophie_m', 'ella.v', 'lisa_b',
  'kenjiplays', 'marco88', 'marco_88', 'nightowl_sam', 'pixelpete', 'jayplays', 'benji_gg', 'katgamer', 'mrjohnson', 'realmike',
  'justtom', 'notjake', 'itsmaria', 'heyitsjen', 'yoitsdan', 'simplydave', 'coolkev', 'lazysunday', 'sleepyhead', 'quietfox',
  'bluejay_22', 'redpanda7', 'greenapple', 'tacotuesday', 'pizzaguy', 'cookie_jar', 'sunnyday', 'rainyday_k', 'stargazer', 'driftwood',
  'paperplane', 'lemonade', 'bubbletea_g', 'noodlesoup', 'mangolassi', 'blueberry', 'snowball', 'frostbite', 'Mike_T', 'JennyB',
  'SamC', 'TomH', 'Katie_W', 'BenL',
  // Turkish (plain ASCII, no Turkish letters)
  'deniz_k', 'emre.dmr', 'mert_y', 'burak34', 'elif.s', 'zeynep_a', 'can_ozt', 'ayse.k', 'mehmet_t', 'ahmet06',
  'selin.b', 'ece_y', 'kerem_s', 'baris_c', 'irem.k', 'onur35', 'cem_aydin', 'esra_g', 'ozan.t', 'tuba_m',
  'hakan_k', 'gizem.a', 'serkan16', 'pinar_d', 'yusuf_e', 'damla.c', 'kaan_b', 'ipek_s', 'umut.k', 'melis_t',
  'furkan61', 'sena.y', 'eren_g', 'busra_k', 'arda_y', 'nazli.e', 'sinan_o', 'derya_m', 'ozge.k', 'volkan07',
  'cansu_b', 'tolga.y', 'merve_d', 'berk_a', 'emrecan', 'denizplays',
  // Spanish and Latin American
  'pablo_g', 'lucia.m', 'javi_r', 'carmen22', 'diego_fdz', 'sofia.l', 'alejandro_m', 'marta_p', 'sergio.r', 'elena_v',
  'carlos10', 'paula.g', 'miguelito', 'ines_r', 'raul_88', 'nerea.s', 'alvaro_t', 'irene_m', 'jorge.l', 'andrea_c',
  'manu_g', 'valeria.r', 'mateo_s', 'camila_v', 'santi_99', 'ximena.r', 'joaquin_p', 'luna_m', 'nico_herrera', 'rocio.f',
  // Portuguese and Brazilian
  'joao_pedro', 'ana.clara', 'lucas_br', 'bruna_s', 'thiago.m', 'rafa_costa', 'gabi_l', 'felipe23', 'larissa.p', 'vini_r',
  // Italian
  'giulia_r', 'luca.b', 'francesca_m', 'matteo_c', 'chiara.v', 'davide_p', 'sara_r', 'alessio77', 'elisa.g', 'fede_m',
  'martina_l', 'simone.r', 'giorgia_t', 'andrea_b', 'lorenzo_f',
  // French
  'theo_l', 'camille.r', 'hugo_m', 'manon_b', 'louis.p', 'chloe_d', 'antoine_v', 'lea.m', 'julien_r', 'ines.b',
  'maxime_g', 'clara.f', 'nathan_p', 'oceane_l', 'baptiste.r', 'juliette_m',
  // German, Austrian, Swiss
  'jonas_k', 'lena.m', 'felix_w', 'anna_sch', 'tim_mueller', 'lea_s', 'niklas.b', 'sophie_h', 'lukas_92', 'marie.k',
  'jan_hoffmann', 'laura.w', 'paul_r', 'hannah_s', 'moritz.f', 'julia_b', 'finn_k', 'mia_schulz', 'tobias.m', 'katharina_l',
  'max_becker', 'emma.w', 'leon_k', 'johanna.f', 'basti_r', 'steffi_m', 'kai.weber', 'nina_k',
  // Dutch and Scandinavian
  'sven_l', 'ingrid.h', 'lars_n', 'freya_s', 'mikkel.j', 'astrid_b', 'erik_v', 'sanne.d', 'daan_m', 'fleur_v',
  'bram.j', 'noor_k', 'oskar_s', 'elin.a', 'henrik_l', 'maja_n',
  // Polish and Eastern European
  'kuba_w', 'ola.k', 'piotr_n', 'kasia_m', 'tomek.z', 'marta_w', 'pavel_s', 'olga.k', 'dmitri_v', 'nastya_l',
  'ivan_p', 'katya.s', 'andrei_m', 'irina_b', 'vlad_r', 'yulia.k', 'bogdan_t', 'ana_pop',
  // Japanese (romaji)
  'yuki_s', 'haruto.k', 'sakura_m', 'ren_t', 'aoi.n', 'sota_y', 'hina_k', 'takumi_99', 'mei.t', 'daiki_s',
  'yui_o', 'kaito.h', 'riko_m', 'shota_n', 'nanami.k', 'yuto_i', 'miyu_t', 'hiro_kun', 'akira.s', 'kenta_w',
  'mio_f', 'ryota.k', 'emi_n',
  // Korean
  'minjun_k', 'jiwoo.p', 'seoyeon_l', 'hyun_j', 'dongwoo.k', 'sujin_c', 'jaehyun_p', 'yuna.k', 'taeyang_s', 'haneul.l',
  // Chinese (pinyin)
  'wei_chen', 'xiaoli.w', 'junhao_l', 'meiling_z', 'haoran.y', 'yiting_c', 'zhang_lei', 'lin.xue', 'chen_yu', 'liu_yang',
  // Indian
  'arjun_s', 'priya.k', 'rohan_m', 'ananya_r', 'vikram.p', 'neha_s', 'aditya_k', 'kavya.n', 'rahul_93', 'isha.g',
  'siddharth_v', 'divya_m',
  // Arabic and Persian
  'omar_h', 'layla.a', 'youssef_k', 'amira_s', 'karim.b', 'noor_a', 'tariq_m', 'salma.r', 'ali_reza', 'sara_h',
  'darius_k', 'shirin.m',
  // Greek
  'nikos_p', 'eleni.k', 'giorgos_m', 'maria_t', 'kostas.d', 'sofia_p',
  // initials and short tags
  'jk_23', 'mtb', 'jp_m', 'rb_88', 'ckim', 'em_jay', 'kb_2', 'ns_77', 'jdawg', 'aj_lee',
  // plain lowercase first names and nicknames
  'marcuz', 'benny', 'tinylou', 'abbz', 'kezza', 'jojo', 'bex', 'dani', 'tash', 'gabe',
  'rory', 'kit', 'ollie', 'reggie', 'fitz', 'bea', 'vic', 'sami', 'luz', 'pia',
  'teo', 'ivo', 'ada', 'eli', 'nils', 'juno', 'remy', 'wren', 'ezra', 'milo',
  'otis', 'nova', 'arlo', 'cleo', 'hugo',
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

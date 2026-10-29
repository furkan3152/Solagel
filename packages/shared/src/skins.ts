
export type SkinTier = 'free' | 'level' | 'premium';

export type FaceStyle =
  | 'kawaii'
  | 'happy'
  | 'cat'
  | 'cool'
  | 'sleepy'
  | 'dog'
  | 'frog'
  | 'laser'
  | 'ghost'
  | 'ninja'
  | 'bull'
  | 'bear';

export type SymbolStyle =
  | 'solbars'
  | 'star'
  | 'cent'
  | 'dollar'
  | 'heart'
  | 'drop'
  | 'bolt'
  | 'gem'
  | 'btc'
  | 'eth'
  | 'paw'
  | 'lily'
  | 'bone'
  | 'moon'
  | 'rocket'
  | 'wave'
  | 'diamond'
  | 'crown'
  | 'shuriken'
  | 'chartUp'
  | 'chartDown'
  | 'none';

export type Accessory =
  | 'none'
  | 'bow'
  | 'sunglasses'
  | 'dogEars'
  | 'frogEyes'
  | 'beanie'
  | 'helmet'
  | 'spout'
  | 'sparkles'
  | 'crown'
  | 'headband'
  | 'horns'
  | 'bearEars';

export interface SkinColors {
  /** Highlight of the radial gradient. */
  light: string;
  /** Main body color. */
  base: string;
  /** Shadow side of the body. */
  dark: string;
  /** Thick coin edge + outlines. */
  rim: string;
  /** Embossed symbol color. */
  symbol: string;
  /** Cheek blush. */
  blush: string;
}

export interface SkinDef {
  id: number;
  key: string;
  name: string;
  desc: string;
  tier: SkinTier;
  /** Required level for 'level' tier skins. */
  level?: number;
  colors: SkinColors;
  symbol: SymbolStyle;
  face: FaceStyle;
  accessory: Accessory;
  /** Animated hue cycling. */
  rainbow?: boolean;
  /** Semi-transparent body. */
  translucent?: boolean;
  /** Faceted crystal shading. */
  faceted?: boolean;
}

const c = (light: string, base: string, dark: string, rim: string, symbol: string, blush = '#FF8FB8'): SkinColors => ({
  light,
  base,
  dark,
  rim,
  symbol,
  blush,
});

export const SKINS: readonly SkinDef[] = [
  // ───────────── free (0–7) ─────────────
  {
    id: 0,
    key: 'solly',
    name: 'Solly',
    desc: 'The OG jelly coin. Fast, cheap, adorable.',
    tier: 'free',
    colors: c('#43FCC4', '#A46BFF', '#8022FB', '#4E00B7', '#FFFFFF', '#FF8FCB'),
    symbol: 'solbars',
    face: 'kawaii',
    accessory: 'none',
  },
  {
    id: 1,
    key: 'goldie',
    name: 'Goldie',
    desc: 'Shiny, chunky and always smiling.',
    tier: 'free',
    colors: c('#FFF4B8', '#FFC93C', '#EFA200', '#B67600', '#FFF7D6', '#FF9F8A'),
    symbol: 'star',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 2,
    key: 'penny',
    name: 'Penny',
    desc: 'Every wei counts.',
    tier: 'free',
    colors: c('#FFD2B3', '#F47F46', '#D55B20', '#97360D', '#FFE6D6', '#FF8F8F'),
    symbol: 'cent',
    face: 'kawaii',
    accessory: 'none',
  },
  {
    id: 3,
    key: 'minty',
    name: 'Minty',
    desc: 'Fresh from the mint.',
    tier: 'free',
    colors: c('#D2FFEE', '#00E5A3', '#00B57D', '#008159', '#F0FFF8', '#FF9FB0'),
    symbol: 'dollar',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 4,
    key: 'bubbles',
    name: 'Bubbles',
    desc: 'Pink, bouncy and dangerously cute.',
    tier: 'free',
    colors: c('#FFE0EE', '#FF8FB8', '#F75395', '#C42869', '#FFF0F6', '#FF5C93'),
    symbol: 'heart',
    face: 'kawaii',
    accessory: 'bow',
  },
  {
    id: 5,
    key: 'skye',
    name: 'Skye',
    desc: 'Pure liquidity, chill vibes.',
    tier: 'free',
    colors: c('#DDF2FF', '#7CC8FF', '#32A1F5', '#0F71BD', '#F2FAFF', '#FF9FC2'),
    symbol: 'drop',
    face: 'sleepy',
    accessory: 'none',
  },
  {
    id: 6,
    key: 'zesty',
    name: 'Zesty',
    desc: 'Sub-second finality, sub-second snacking.',
    tier: 'free',
    colors: c('#FFFCD9', '#FFE873', '#F9C800', '#C59500', '#FFFBE6', '#FF9F8A'),
    symbol: 'bolt',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 7,
    key: 'grape',
    name: 'Grape',
    desc: 'A tiny gem with a big appetite.',
    tier: 'free',
    colors: c('#F1EAFF', '#C9B6FF', '#A185FF', '#704DD5', '#FBF8FF', '#FF9FD0'),
    symbol: 'gem',
    face: 'cat',
    accessory: 'none',
  },

  // ───────────── level-gated (8–15) ─────────────
  {
    id: 8,
    key: 'bitsy',
    name: 'Bitsy',
    desc: 'Grandpa of all coins, still cool.',
    tier: 'level',
    level: 2,
    colors: c('#FFDDB0', '#FF9F2E', '#E47D00', '#A95A00', '#FFF1DC', '#FF8F8F'),
    symbol: 'btc',
    face: 'cool',
    accessory: 'sunglasses',
  },
  {
    id: 9,
    key: 'ethy',
    name: 'Ethy',
    desc: 'Thinks in octahedrons.',
    tier: 'level',
    level: 3,
    colors: c('#F4F2FF', '#B9B2EE', '#8E85D3', '#5D5498', '#FFFFFF', '#FF9FC8'),
    symbol: 'eth',
    face: 'kawaii',
    accessory: 'none',
  },
  {
    id: 10,
    key: 'doggo',
    name: 'Doggo',
    desc: 'Much coin. Very jelly. Wow.',
    tier: 'level',
    level: 5,
    colors: c('#FFEACB', '#FBB253', '#E38D0F', '#A36100', '#FFF4E3', '#FF9F8A'),
    symbol: 'paw',
    face: 'dog',
    accessory: 'dogEars',
  },
  {
    id: 11,
    key: 'froggy',
    name: 'Froggy',
    desc: 'Feels good, man.',
    tier: 'level',
    level: 7,
    colors: c('#DAFAAF', '#7FD838', '#57B500', '#358000', '#F1FFE3', '#FF9FA8'),
    symbol: 'lily',
    face: 'frog',
    accessory: 'frogEyes',
  },
  {
    id: 12,
    key: 'hattie',
    name: 'Hattie',
    desc: 'Never takes the hat off. Ever.',
    tier: 'level',
    level: 10,
    colors: c('#FFF0DB', '#EEC590', '#D3A262', '#94682A', '#FFF8EE', '#FF9F9F'),
    symbol: 'bone',
    face: 'dog',
    accessory: 'beanie',
  },
  {
    id: 13,
    key: 'moonie',
    name: 'Moonie',
    desc: 'Already on the way to the moon.',
    tier: 'level',
    level: 13,
    colors: c('#FFFFFF', '#DCE1EE', '#ACB7D0', '#6D7A99', '#FFFFFF', '#FFB0C8'),
    symbol: 'moon',
    face: 'sleepy',
    accessory: 'helmet',
  },
  {
    id: 14,
    key: 'rocket',
    name: 'Rocket',
    desc: 'Only goes up. Mostly.',
    tier: 'level',
    level: 16,
    colors: c('#FFD9D9', '#FF6B6B', '#F02835', '#B20015', '#FFF0F0', '#FFB0B0'),
    symbol: 'rocket',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 15,
    key: 'whale',
    name: 'Whale',
    desc: 'Moves markets by blinking.',
    tier: 'level',
    level: 20,
    colors: c('#C7E6FF', '#3D8BFF', '#0063EA', '#013898', '#E9F4FF', '#FF9FC8'),
    symbol: 'wave',
    face: 'kawaii',
    accessory: 'spout',
  },

  // ───────────── premium (16–23) ─────────────
  {
    id: 16,
    key: 'diamond',
    name: 'Diamond Hands',
    desc: 'Never sells. Never melts.',
    tier: 'premium',
    colors: c('#EAFFFF', '#82F0FF', '#00C8E8', '#008BA9', '#FFFFFF', '#FF9FD8'),
    symbol: 'diamond',
    face: 'happy',
    accessory: 'sparkles',
    faceted: true,
  },
  {
    id: 17,
    key: 'laser',
    name: 'Laser Eyes',
    desc: 'Locked in. Target acquired.',
    tier: 'premium',
    colors: c('#FFEDB0', '#FFB627', '#E39200', '#9C5F00', '#FFF6D9', '#FF8F6F'),
    symbol: 'star',
    face: 'laser',
    accessory: 'none',
  },
  {
    id: 18,
    key: 'king',
    name: 'King Coin',
    desc: 'Heavy is the head that wears the bag.',
    tier: 'premium',
    colors: c('#FFF6C2', '#FFD54A', '#E6AD00', '#7F2FC8', '#FFFBE6', '#FF9F9F'),
    symbol: 'crown',
    face: 'happy',
    accessory: 'crown',
  },
  {
    id: 19,
    key: 'ninja',
    name: 'Ninja',
    desc: 'You never see the split coming.',
    tier: 'premium',
    colors: c('#898EAA', '#424660', '#2B2E41', '#16171F', '#E8E9F2', '#FF8FB8'),
    symbol: 'shuriken',
    face: 'ninja',
    accessory: 'headband',
  },
  {
    id: 20,
    key: 'rainbow',
    name: 'Rainbow',
    desc: 'Every color of the bull run.',
    tier: 'premium',
    colors: c('#FFFFFF', '#FF8FB8', '#C77DFF', '#5D35B8', '#FFFFFF', '#FF5C93'),
    symbol: 'heart',
    face: 'kawaii',
    accessory: 'sparkles',
    rainbow: true,
  },
  {
    id: 21,
    key: 'ghosty',
    name: 'Ghosty',
    desc: 'Rugged once, came back cuter.',
    tier: 'premium',
    colors: c('#FFFFFF', '#EEEBFF', '#CBC2FC', '#9C91E1', '#FFFFFF', '#FFB0D0'),
    symbol: 'none',
    face: 'ghost',
    accessory: 'none',
    translucent: true,
  },
  {
    id: 22,
    key: 'bull',
    name: 'Bull',
    desc: 'Green candles only.',
    tier: 'premium',
    colors: c('#D3FFE0', '#00DF7D', '#00B15F', '#007B3C', '#F0FFF5', '#FF9FA0'),
    symbol: 'chartUp',
    face: 'bull',
    accessory: 'horns',
  },
  {
    id: 23,
    key: 'bear',
    name: 'Bear',
    desc: 'Hibernates through dips, wakes up hungry.',
    tier: 'premium',
    colors: c('#FFD8CB', '#E46F4C', '#C34D2A', '#862B11', '#FFEDE6', '#FF9F9F'),
    symbol: 'chartDown',
    face: 'bear',
    accessory: 'bearEars',
  },
];

export const SKIN_COUNT = SKINS.length;

export const getSkin = (id: number): SkinDef => SKINS[id] ?? SKINS[0];

/**
 * The basic skins (ids 0..7): free for everyone and the only looks a player can pick.
 */
export const BASIC_SKINS: readonly SkinDef[] = SKINS.slice(0, 8);

export const isBasicSkin = (id: number): boolean => Number.isInteger(id) && id >= 0 && id < BASIC_SKINS.length;

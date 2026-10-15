import { english, type Localized } from './localized';

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
  name: Localized;
  desc: Localized;
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
    name: english('Solly'),
    desc: english('The OG jelly coin. Fast, cheap, adorable.'),
    tier: 'free',
    colors: c('#6FF7C8', '#A46BFF', '#7B3FE4', '#4B1FA8', '#FFFFFF', '#FF8FCB'),
    symbol: 'solbars',
    face: 'kawaii',
    accessory: 'none',
  },
  {
    id: 1,
    key: 'goldie',
    name: english('Goldie'),
    desc: english('Shiny, chunky and always smiling.'),
    tier: 'free',
    colors: c('#FFF4B8', '#FFC93C', '#EDA31A', '#B5760C', '#FFF7D6', '#FF9F8A'),
    symbol: 'star',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 2,
    key: 'penny',
    name: english('Penny'),
    desc: english('Every lamport counts.'),
    tier: 'free',
    colors: c('#FFD2B3', '#E8875A', '#C9653A', '#8E3F22', '#FFE6D6', '#FF8F8F'),
    symbol: 'cent',
    face: 'kawaii',
    accessory: 'none',
  },
  {
    id: 3,
    key: 'minty',
    name: english('Minty'),
    desc: english('Fresh from the mint.'),
    tier: 'free',
    colors: c('#D2FFEE', '#4FE0A8', '#25B47F', '#14805A', '#F0FFF8', '#FF9FB0'),
    symbol: 'dollar',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 4,
    key: 'bubbles',
    name: english('Bubbles'),
    desc: english('Pink, bouncy and dangerously cute.'),
    tier: 'free',
    colors: c('#FFE0EE', '#FF8FB8', '#EA6496', '#B83D6A', '#FFF0F6', '#FF5C93'),
    symbol: 'heart',
    face: 'kawaii',
    accessory: 'bow',
  },
  {
    id: 5,
    key: 'skye',
    name: english('Skye'),
    desc: english('Pure liquidity, chill vibes.'),
    tier: 'free',
    colors: c('#DDF2FF', '#7CC8FF', '#4DA1E6', '#2D72B0', '#F2FAFF', '#FF9FC2'),
    symbol: 'drop',
    face: 'sleepy',
    accessory: 'none',
  },
  {
    id: 6,
    key: 'zesty',
    name: english('Zesty'),
    desc: english('Sub-second finality, sub-second snacking.'),
    tier: 'free',
    colors: c('#FFFCD9', '#FFE873', '#F4C93F', '#C49516', '#FFFBE6', '#FF9F8A'),
    symbol: 'bolt',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 7,
    key: 'grape',
    name: english('Grape'),
    desc: english('A tiny gem with a big appetite.'),
    tier: 'free',
    colors: c('#F1EAFF', '#C9B6FF', '#A08AF0', '#6E56C4', '#FBF8FF', '#FF9FD0'),
    symbol: 'gem',
    face: 'cat',
    accessory: 'none',
  },

  // ───────────── level-gated (8–15) ─────────────
  {
    id: 8,
    key: 'bitsy',
    name: english('Bitsy'),
    desc: english('Grandpa of all coins, still cool.'),
    tier: 'level',
    level: 2,
    colors: c('#FFDDB0', '#FF9F2E', '#E37E10', '#A85A05', '#FFF1DC', '#FF8F8F'),
    symbol: 'btc',
    face: 'cool',
    accessory: 'sunglasses',
  },
  {
    id: 9,
    key: 'ethy',
    name: english('Ethy'),
    desc: english('Thinks in octahedrons.'),
    tier: 'level',
    level: 3,
    colors: c('#F4F2FF', '#B9B4E6', '#8E88C8', '#5D578F', '#FFFFFF', '#FF9FC8'),
    symbol: 'eth',
    face: 'kawaii',
    accessory: 'none',
  },
  {
    id: 10,
    key: 'doggo',
    name: english('Doggo'),
    desc: english('Much coin. Very jelly. Wow.'),
    tier: 'level',
    level: 5,
    colors: c('#FFEACB', '#F2B66B', '#D9923F', '#9E6420', '#FFF4E3', '#FF9F8A'),
    symbol: 'paw',
    face: 'dog',
    accessory: 'dogEars',
  },
  {
    id: 11,
    key: 'froggy',
    name: english('Froggy'),
    desc: english('Feels good, man.'),
    tier: 'level',
    level: 7,
    colors: c('#DDF8BA', '#8BD45A', '#64B236', '#3D7E1C', '#F1FFE3', '#FF9FA8'),
    symbol: 'lily',
    face: 'frog',
    accessory: 'frogEyes',
  },
  {
    id: 12,
    key: 'hattie',
    name: english('Hattie'),
    desc: english('Never takes the hat off. Ever.'),
    tier: 'level',
    level: 10,
    colors: c('#FFF0DB', '#E9C79B', '#CDA470', '#8F6A3A', '#FFF8EE', '#FF9F9F'),
    symbol: 'bone',
    face: 'dog',
    accessory: 'beanie',
  },
  {
    id: 13,
    key: 'moonie',
    name: english('Moonie'),
    desc: english('Already on the way to the moon.'),
    tier: 'level',
    level: 13,
    colors: c('#FFFFFF', '#DCE1EE', '#AEB7CC', '#6F7A94', '#FFFFFF', '#FFB0C8'),
    symbol: 'moon',
    face: 'sleepy',
    accessory: 'helmet',
  },
  {
    id: 14,
    key: 'rocket',
    name: english('Rocket'),
    desc: english('Only goes up. Mostly.'),
    tier: 'level',
    level: 16,
    colors: c('#FFD9D9', '#FF6B6B', '#E14646', '#A82525', '#FFF0F0', '#FFB0B0'),
    symbol: 'rocket',
    face: 'happy',
    accessory: 'none',
  },
  {
    id: 15,
    key: 'whale',
    name: english('Whale'),
    desc: english('Moves markets by blinking.'),
    tier: 'level',
    level: 20,
    colors: c('#C7E6FF', '#3D8BFF', '#2468D6', '#123C8A', '#E9F4FF', '#FF9FC8'),
    symbol: 'wave',
    face: 'kawaii',
    accessory: 'spout',
  },

  // ───────────── premium (16–23) ─────────────
  {
    id: 16,
    key: 'diamond',
    name: english('Diamond Hands'),
    desc: english('Never sells. Never melts.'),
    tier: 'premium',
    colors: c('#EAFFFF', '#82F0FF', '#3FC6E2', '#1E8AA6', '#FFFFFF', '#FF9FD8'),
    symbol: 'diamond',
    face: 'happy',
    accessory: 'sparkles',
    faceted: true,
  },
  {
    id: 17,
    key: 'laser',
    name: english('Laser Eyes'),
    desc: english('Locked in. Target acquired.'),
    tier: 'premium',
    colors: c('#FFEDB0', '#FFB627', '#E39200', '#9C5F00', '#FFF6D9', '#FF8F6F'),
    symbol: 'star',
    face: 'laser',
    accessory: 'none',
  },
  {
    id: 18,
    key: 'king',
    name: english('King Coin'),
    desc: english('Heavy is the head that wears the bag.'),
    tier: 'premium',
    colors: c('#FFF6C2', '#FFD54A', '#E6AD00', '#7A3FB8', '#FFFBE6', '#FF9F9F'),
    symbol: 'crown',
    face: 'happy',
    accessory: 'crown',
  },
  {
    id: 19,
    key: 'ninja',
    name: english('Ninja'),
    desc: english('You never see the split coming.'),
    tier: 'premium',
    colors: c('#8A8EA6', '#43465C', '#2C2E3E', '#16171F', '#E8E9F2', '#FF8FB8'),
    symbol: 'shuriken',
    face: 'ninja',
    accessory: 'headband',
  },
  {
    id: 20,
    key: 'rainbow',
    name: english('Rainbow'),
    desc: english('Every color of the bull run.'),
    tier: 'premium',
    colors: c('#FFFFFF', '#FF8FB8', '#C77DFF', '#5B3FA8', '#FFFFFF', '#FF5C93'),
    symbol: 'heart',
    face: 'kawaii',
    accessory: 'sparkles',
    rainbow: true,
  },
  {
    id: 21,
    key: 'ghosty',
    name: english('Ghosty'),
    desc: english('Rugged once, came back cuter.'),
    tier: 'premium',
    colors: c('#FFFFFF', '#EEEBFF', '#CBC4F4', '#9C94D6', '#FFFFFF', '#FFB0D0'),
    symbol: 'none',
    face: 'ghost',
    accessory: 'none',
    translucent: true,
  },
  {
    id: 22,
    key: 'bull',
    name: english('Bull'),
    desc: english('Green candles only.'),
    tier: 'premium',
    colors: c('#D3FFE0', '#3DDC84', '#1FB062', '#0E7A3E', '#F0FFF5', '#FF9FA0'),
    symbol: 'chartUp',
    face: 'bull',
    accessory: 'horns',
  },
  {
    id: 23,
    key: 'bear',
    name: english('Bear'),
    desc: english('Hibernates through dips, wakes up hungry.'),
    tier: 'premium',
    colors: c('#FFD8CB', '#D9785B', '#B8573B', '#7E3420', '#FFEDE6', '#FF9F9F'),
    symbol: 'chartDown',
    face: 'bear',
    accessory: 'bearEars',
  },
];

export const SKIN_COUNT = SKINS.length;
export const FREE_SKIN_IDS = SKINS.filter((s) => s.tier === 'free').map((s) => s.id);

export const getSkin = (id: number): SkinDef => SKINS[id] ?? SKINS[0];

/**
 * The basic skins (ids 0..7): free for everyone and the only looks a player
 * can pick without a Slana Pass, which brings its own NFT look.
 */
export const BASIC_SKINS: readonly SkinDef[] = SKINS.slice(0, 8);

export const isBasicSkin = (id: number): boolean => Number.isInteger(id) && id >= 0 && id < BASIC_SKINS.length;

/** Hue-shifted color for rainbow skins. */
export function rainbowColor(timeMs: number, offset = 0, lightness = 72): string {
  const hue = ((timeMs / 18 + offset) % 360 + 360) % 360;
  return `hsl(${hue.toFixed(0)} 95% ${lightness}%)`;
}

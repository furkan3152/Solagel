import type { Rng } from '../game/rng';

export type BotStyle = 'farmer' | 'hunter' | 'coward' | 'balanced';
export type BotSkill = 0 | 1 | 2;

export interface Personality {
  style: BotStyle;
  skill: BotSkill;
  /** Weight of prey interest. */
  aggression: number;
  /** Weight of food interest. */
  greed: number;
  /** Multiplier on danger (and safety margins). */
  caution: number;
  /** 0..1 willingness to split-attack. */
  splitBravery: number;
  /** Decision interval in ms. */
  thinkMs: number;
  /** Aim noise in radians. */
  aimNoise: number;
  /** Perception range multiplier. */
  perception: number;
  /** Chance per decision to "not notice" threats (easy bots only). */
  distraction: number;
  /** Uses viruses as shields / avoids popping. */
  virusAware: boolean;
  /** Predicts where prey will be. */
  leadsTargets: boolean;
  /** Can shoot viruses at threats by feeding them. */
  virusShooter: boolean;
  /** Reaction delay: a newly seen threat is only noticed after this many ms (people need time too). */
  reactionMs: number;
  /** Seconds of a threat's observed motion the bot extrapolates when judging how close it is. */
  predictS: number;
  /** Chance per decision of a small human mistake (misjudged split reach, a careless step). */
  mistakeRate: number;
  /** 0..1 how much the bot heads for dense coin fields seen at a distance (vs. only nearby coins). */
  foodRouting: number;
  /** Multiplier on wall / corner awareness while fleeing. */
  wallSense: number;
  /** Double-splits prey that one split cannot reach (hard bots). */
  doubleSplit: boolean;
  /** Gives up chasing one target after this many ms (and leaves it alone for a while). */
  chaseMs: number;
}

const STYLE_BASE: Record<BotStyle, Pick<Personality, 'aggression' | 'greed' | 'caution' | 'splitBravery'>> = {
  farmer: { aggression: 0.45, greed: 1.25, caution: 1.15, splitBravery: 0.25 },
  hunter: { aggression: 1.45, greed: 0.8, caution: 0.9, splitBravery: 0.85 },
  coward: { aggression: 0.35, greed: 1.0, caution: 1.6, splitBravery: 0.15 },
  balanced: { aggression: 0.95, greed: 1.0, caution: 1.05, splitBravery: 0.55 },
};

type SkillFields = Exclude<keyof Personality, 'style' | 'skill' | 'aggression' | 'greed' | 'caution' | 'splitBravery'>;

/**
 * Per difficulty. Easy bots stay beatable for newcomers: slow to react, short-sighted, often
 * distracted, sloppy aim, no virus tricks. Hard bots play like a decent human (they still react
 * with a delay and slip now and then).
 */
const SKILL_BASE: Record<BotSkill, Pick<Personality, SkillFields>> = {
  0: {
    thinkMs: 300,
    aimNoise: 0.32,
    perception: 0.75,
    distraction: 0.18,
    virusAware: false,
    leadsTargets: false,
    virusShooter: false,
    reactionMs: 450,
    predictS: 0.12,
    mistakeRate: 0.08,
    foodRouting: 0.35,
    wallSense: 0.6,
    doubleSplit: false,
    chaseMs: 3500,
  },
  1: {
    thinkMs: 190,
    aimNoise: 0.14,
    perception: 0.92,
    distraction: 0.04,
    virusAware: true,
    leadsTargets: true,
    virusShooter: false,
    reactionMs: 260,
    predictS: 0.3,
    mistakeRate: 0.03,
    foodRouting: 0.8,
    wallSense: 1,
    doubleSplit: false,
    chaseMs: 6000,
  },
  2: {
    thinkMs: 120,
    aimNoise: 0.05,
    perception: 1.05,
    distraction: 0,
    virusAware: true,
    leadsTargets: true,
    virusShooter: true,
    reactionMs: 150,
    predictS: 0.45,
    mistakeRate: 0.008,
    foodRouting: 1,
    wallSense: 1.25,
    doubleSplit: true,
    chaseMs: 9000,
  },
};

/** Difficulty weights (any non-negative numbers; they are used as proportions). */
export interface BotMixWeights {
  easy: number;
  medium: number;
  hard: number;
}

/**
 * Bot difficulty mix: a preset (`rookie` for the practice rookie league, `standard` everywhere
 * else) or admin-set weights (`/api/admin/bots`).
 */
export type BotMix = 'rookie' | 'standard' | BotMixWeights;

/** The presets as weights: `standard` 45 % easy, 40 % medium, 15 % hard; `rookie` 70 % easy, 30 % medium. */
export const BOT_MIX_PRESETS: Record<'rookie' | 'standard', BotMixWeights> = {
  rookie: { easy: 70, medium: 30, hard: 0 },
  standard: { easy: 45, medium: 40, hard: 15 },
};

export function mixWeights(mix: BotMix = 'standard'): BotMixWeights {
  return typeof mix === 'string' ? BOT_MIX_PRESETS[mix] : mix;
}

function rollSkill(r: number, mix: BotMix): BotSkill {
  const w = mixWeights(mix);
  const easy = Math.max(0, w.easy);
  const medium = Math.max(0, w.medium);
  const hard = Math.max(0, w.hard);
  const sum = easy + medium + hard;
  if (!(sum > 0)) return 1;
  const x = r * sum;
  return x < easy ? 0 : x < easy + medium ? 1 : 2;
}

/** Rolls a personality; the skill follows the difficulty mix (`BOT_MIX_PRESETS` or admin weights). */
export function rollPersonality(rng: Rng, mix: BotMix = 'standard'): Personality {
  const skill = rollSkill(rng(), mix);
  const styles: BotStyle[] = ['farmer', 'hunter', 'coward', 'balanced', 'balanced'];
  const style = styles[Math.floor(rng() * styles.length)];
  const jitter = () => 0.85 + rng() * 0.3;
  const base = STYLE_BASE[style];
  const sk = SKILL_BASE[skill];
  return {
    style,
    skill,
    aggression: base.aggression * jitter(),
    greed: base.greed * jitter(),
    caution: base.caution * jitter(),
    splitBravery: Math.min(1, base.splitBravery * jitter() * (skill === 0 ? 0.4 : 1)),
    ...sk,
    thinkMs: sk.thinkMs * jitter(),
    reactionMs: sk.reactionMs * jitter(),
  };
}

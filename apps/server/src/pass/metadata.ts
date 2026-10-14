import { passTraits, type PassTraits } from '@slana/art';
import type { PassStatus } from '@slana/shared';

/** On-chain symbol of the Pass (Metaplex JSON `symbol`). */
export const PASS_SYMBOL = 'SLANA';
export const PASS_COLLECTION_NAME = 'Slana Pass';

export interface PassAttribute {
  trait_type: string;
  value: string;
}

export interface PassMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  attributes: PassAttribute[];
  properties: { category: 'image'; files: { uri: string; type: 'image/png' }[] };
}

const SEALED_DESCRIPTION =
  'A sealed Slana Pass. Its risograph coin and traits are revealed on-chain once the mint ends ' +
  '(commit–reveal: nobody, the team included, knows which number is rare before then). ' +
  'In Slana the Pass opens the Pass rooms, lowers the arena fee and gives a head start.';

const REVEALED_DESCRIPTION =
  'A Slana Pass: a hand-printed risograph coin for Slana, the on-chain coin-eating arena on Solana. ' +
  'Holders play Pass rooms, pay a lower arena fee, start bigger and cash out faster.';

const title = (s: string): string => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1));

/** `oneOfOne:3` → `1/1 #3`, `gold` → `Gold`. */
function specialLabel(special: PassTraits['special']): string | null {
  if (!special) return null;
  if (special.startsWith('oneOfOne:')) return `1/1 #${special.slice('oneOfOne:'.length)}`;
  return title(special);
}

/** Pass number `n` is within `1..supply`. */
export const passInRange = (n: number, pass: PassStatus): boolean => Number.isInteger(n) && n >= 1 && n <= pass.supply;

/** The reveal seed when traits are public, else null (sealed). */
export const revealedSeed = (pass: PassStatus): string | null => (pass.revealed && pass.seed ? pass.seed : null);

/** Metaplex attributes of a revealed Pass (art traits plus `Rarity`). */
export function passAttributes(t: PassTraits): PassAttribute[] {
  const attrs: PassAttribute[] = [
    { trait_type: 'Ink', value: t.ink },
    { trait_type: 'Overprint', value: t.overprint },
    { trait_type: 'Symbol', value: t.symbol },
    { trait_type: 'Eyes', value: t.eyes },
    { trait_type: 'Mouth', value: t.mouth },
    { trait_type: 'Accessory', value: t.accessory },
    { trait_type: 'Paper', value: t.paper },
  ];
  const special = specialLabel(t.special);
  if (special) attrs.push({ trait_type: 'Special', value: special });
  attrs.push({ trait_type: 'Rarity', value: title(t.rarity) });
  return attrs;
}

/**
 * Metaplex JSON of Pass `n` (`<base>/pass/<n>.json`): sealed before the
 * on-chain reveal, with traits after. Null when `n` is outside `1..supply`.
 */
export function passMetadata(n: number, pass: PassStatus, baseUrl: string): PassMetadata | null {
  if (!passInRange(n, pass)) return null;
  const image = `${baseUrl}/pass/${n}.png`;
  const seed = revealedSeed(pass);
  return {
    name: `${PASS_COLLECTION_NAME} #${n}`,
    symbol: PASS_SYMBOL,
    description: seed ? REVEALED_DESCRIPTION : SEALED_DESCRIPTION,
    image,
    external_url: baseUrl,
    attributes: seed ? passAttributes(passTraits(seed, n, pass.supply)) : [{ trait_type: 'Status', value: 'Sealed' }],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

/** Metaplex JSON of the collection (`<base>/pass/collection.json`). */
export function collectionMetadata(pass: PassStatus, baseUrl: string): Omit<PassMetadata, 'attributes'> & { attributes: PassAttribute[] } {
  const image = `${baseUrl}/pass/collection.png`;
  return {
    name: PASS_COLLECTION_NAME,
    symbol: PASS_SYMBOL,
    description: `${pass.supply.toLocaleString('en-US')} risograph coin passes for Slana, minted free on Solana. ${REVEALED_DESCRIPTION.split('. ').slice(1).join('. ')}`,
    image,
    external_url: baseUrl,
    attributes: [],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

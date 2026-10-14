import { collectionJson, PASS_COLLECTION_NAME, PASS_SYMBOL, passJson, type PassMetadata } from '@slana/art';
import type { PassStatus } from '@slana/shared';

export { PASS_SYMBOL, PASS_COLLECTION_NAME, passAttributes } from '@slana/art';
export type { PassAttribute, PassMetadata } from '@slana/art';

const SEALED_DESCRIPTION =
  'A sealed Slana Pass. Its risograph coin and traits are revealed on-chain once the mint ends ' +
  '(commit–reveal: nobody, the team included, knows which number is rare before then). ' +
  'In Slana the Pass opens the Pass rooms, lowers the arena fee and gives a head start.';

/** Pass number `n` is within `1..supply`. */
export const passInRange = (n: number, pass: PassStatus): boolean => Number.isInteger(n) && n >= 1 && n <= pass.supply;

/** The reveal seed when traits are public, else null (sealed). */
export const revealedSeed = (pass: PassStatus): string | null => (pass.revealed && pass.seed ? pass.seed : null);

/**
 * Metaplex JSON of Pass `n` (`<base>/pass/<n>.json`): sealed before the
 * on-chain reveal, with traits after. Null when `n` is outside `1..supply`.
 */
export function passMetadata(n: number, pass: PassStatus, baseUrl: string): PassMetadata | null {
  if (!passInRange(n, pass)) return null;
  const image = `${baseUrl}/pass/${n}.png`;
  const seed = revealedSeed(pass);
  if (seed) return passJson(n, seed, pass.supply, { siteUrl: baseUrl });
  return {
    name: `${PASS_COLLECTION_NAME} #${n}`,
    symbol: PASS_SYMBOL,
    description: SEALED_DESCRIPTION,
    image,
    external_url: baseUrl,
    attributes: [{ trait_type: 'Status', value: 'Sealed' }],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

/** Metaplex JSON of the collection (`<base>/pass/collection.json`). */
export function collectionMetadata(pass: PassStatus, baseUrl: string): PassMetadata {
  return collectionJson(pass.supply, { siteUrl: baseUrl });
}

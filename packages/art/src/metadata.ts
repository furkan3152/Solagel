import { passTraits, type PassTraits } from './traits';

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
  external_url?: string;
  attributes: PassAttribute[];
  properties: { category: 'image'; files: { uri: string; type: 'image/png' }[] };
}

export const REVEALED_DESCRIPTION =
  'A Slana Pass: a hand-printed risograph coin for Slana, the on-chain coin-eating arena on Solana. ' +
  'Holders play Pass rooms, pay a lower arena fee, start bigger and cash out faster.';

const title = (s: string): string => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1));

/** `oneOfOne:3` -> `1/1 #3`, `gold` -> `Gold`. */
function specialLabel(special: PassTraits['special']): string | null {
  if (!special) return null;
  if (special.startsWith('oneOfOne:')) return `1/1 #${special.slice('oneOfOne:'.length)}`;
  return title(special);
}

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
 * Metaplex JSON of a revealed Pass. `external_url` is omitted when empty.
 * Lower-level builder; prefer `passJson`.
 */
export function revealedPassMetadata(traits: PassTraits, n: number, image: string, externalUrl?: string): PassMetadata {
  return {
    name: `${PASS_COLLECTION_NAME} #${n}`,
    symbol: PASS_SYMBOL,
    description: REVEALED_DESCRIPTION,
    image,
    ...(externalUrl ? { external_url: externalUrl } : {}),
    attributes: passAttributes(traits),
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

/** Metaplex JSON of the collection. `external_url` is omitted when empty. */
export function collectionMetadataJson(supply: number, image: string, externalUrl?: string): PassMetadata {
  return {
    name: PASS_COLLECTION_NAME,
    symbol: PASS_SYMBOL,
    description: `${supply.toLocaleString('en-US')} risograph coin passes for Slana, minted free on Solana. ${REVEALED_DESCRIPTION.split('. ').slice(1).join('. ')}`,
    image,
    ...(externalUrl ? { external_url: externalUrl } : {}),
    attributes: [],
    properties: { category: 'image', files: [{ uri: image, type: 'image/png' }] },
  };
}

export interface PassUrlOptions {
  /** Site root, e.g. `https://host` (a trailing slash is stripped). Server convention: image `<site>/pass/<file>`, external_url `<site>`. */
  siteUrl?: string;
  /** Third-party image folder ending in `/` (IPFS, Arweave...): image `<base><file>`. Wins over siteUrl for the image. */
  baseUrl?: string;
}

/** Image URL and external_url for a file (`<n>.png`, `collection.png`) under the three URL modes. */
export function passUrls(file: string, o: PassUrlOptions): { image: string; externalUrl: string | undefined } {
  const site = o.siteUrl ? o.siteUrl.replace(/\/+$/, '') : undefined;
  const image = o.baseUrl ? `${o.baseUrl}${file}` : site ? `${site}/pass/${file}` : file;
  return { image, externalUrl: site || undefined };
}

/** The `<n>.json` object of a revealed Pass for a seed; the single source for the server and the CLI. */
export function passJson(n: number, seedHex: string, supply: number, o: PassUrlOptions = {}): PassMetadata {
  const { image, externalUrl } = passUrls(`${n}.png`, o);
  return revealedPassMetadata(passTraits(seedHex, n, supply), n, image, externalUrl);
}

/** The `collection.json` object, same URL conventions as `passJson`. */
export function collectionJson(supply: number, o: PassUrlOptions = {}): PassMetadata {
  const { image, externalUrl } = passUrls('collection.png', o);
  return collectionMetadataJson(supply, image, externalUrl);
}

/** Exact bytes (compact JSON, no trailing newline) served by the server and written by the CLI. */
export const serializePassJson = (obj: unknown): string => JSON.stringify(obj);

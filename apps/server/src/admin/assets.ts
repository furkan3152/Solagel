import type { NftSettings, TokenMintInspection, TokenSettings } from '@solagel/shared';
import { PublicKey, type Connection } from '@solana/web3.js';

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINT_SIZE = 82;
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_MAPPINGS = 1000;

const EXTENSION_NAMES: Readonly<Record<number, string>> = {
  1: 'TransferFeeConfig', 2: 'TransferFeeAmount', 3: 'MintCloseAuthority',
  4: 'ConfidentialTransferMint', 5: 'ConfidentialTransferAccount', 6: 'DefaultAccountState',
  7: 'ImmutableOwner', 8: 'MemoTransfer', 9: 'NonTransferable', 10: 'InterestBearingConfig',
  11: 'CpiGuard', 12: 'PermanentDelegate', 13: 'NonTransferableAccount', 14: 'TransferHook',
  15: 'TransferHookAccount', 16: 'ConfidentialTransferFeeConfig', 17: 'ConfidentialTransferFeeAmount',
  18: 'MetadataPointer', 19: 'TokenMetadata', 20: 'GroupPointer', 21: 'TokenGroup',
  22: 'GroupMemberPointer', 23: 'TokenGroupMember', 24: 'ConfidentialMintBurn',
  25: 'ScaledUiAmount', 26: 'PausableConfig', 27: 'PausableAccount',
};
const ACCOUNT_ONLY_EXTENSIONS = new Set([2, 5, 7, 8, 11, 13, 15, 17, 27]);

/** Invalid asset input is safe to show to the authenticated administrator. */
export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetValidationError';
  }
}

function invalid(message: string): never { throw new AssetValidationError(message); }

function object(value: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key))) invalid(`${label} contains unsupported fields.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) invalid(`${label} must be a string of at most ${max} characters.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  return text(value, label, max) || null;
}

/** Public keys stay case-sensitive; no RPC or URL is accepted in their place. */
export function canonicalSolanaAddress(value: unknown, label = 'Mint address'): string {
  const address = text(value, label, 44);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) invalid(`${label} must be a Solana public key.`);
  try {
    const canonical = new PublicKey(address).toBase58();
    if (canonical !== address) invalid(`${label} must use canonical base58 encoding.`);
    return canonical;
  } catch {
    return invalid(`${label} must be a Solana public key.`);
  }
}

function optionalAuthority(data: Buffer, offset: number, label: string): string | null {
  const option = data.readUInt32LE(offset);
  if (option !== 0 && option !== 1) invalid(`The mint has an invalid ${label} field.`);
  return option === 0 ? null : new PublicKey(data.subarray(offset + 4, offset + 36)).toBase58();
}

function extensionTypes(data: Buffer): number[] {
  if (data.length === MINT_SIZE) return [];
  if (data.length < TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1 || data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] !== 1) {
    invalid('The Token-2022 account is not a valid extended mint.');
  }
  if (data.subarray(MINT_SIZE, TOKEN_2022_ACCOUNT_TYPE_OFFSET).some((byte) => byte !== 0)) {
    invalid('The Token-2022 mint has invalid account padding.');
  }
  const types: number[] = [];
  const seen = new Set<number>();
  let offset = TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1;
  while (offset < data.length) {
    // Unallocated extension space is zero-filled, not an active extension.
    if (data.subarray(offset).every((byte) => byte === 0)) break;
    if (data.length - offset < 4) invalid('The Token-2022 mint has a truncated extension header.');
    const type = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    if (type === 0 || seen.has(type) || ACCOUNT_ONLY_EXTENSIONS.has(type)) {
      invalid('The Token-2022 mint has an invalid or duplicate mint extension.');
    }
    offset += 4;
    if (length > data.length - offset) invalid('The Token-2022 mint has a truncated extension.');
    types.push(type);
    seen.add(type);
    offset += length;
  }
  return types;
}

/**
 * Read-only inspection against the server's configured Solana connection.
 * Parsing a real mint never implies pump.fun provenance or gameplay support.
 */
export async function inspectTokenMint(
  connection: Pick<Connection, 'getAccountInfo'>,
  mintAddress: unknown,
  cluster: string,
): Promise<TokenMintInspection> {
  const address = canonicalSolanaAddress(mintAddress);
  let account;
  try {
    account = await connection.getAccountInfo(new PublicKey(address), 'confirmed');
  } catch {
    // RPC errors can contain the private endpoint or API key. Keep them out of responses.
    return invalid('The mint could not be read from the configured Solana network.');
  }
  if (!account) invalid('No account exists for this mint on the configured Solana network.');
  const owner = account.owner.toBase58();
  const tokenProgram = owner === SPL_TOKEN_PROGRAM ? 'spl-token' : owner === TOKEN_2022_PROGRAM ? 'token-2022' : null;
  if (!tokenProgram || account.executable) invalid('This account is not owned by the SPL Token or Token-2022 program.');
  const data = account.data;
  if (data.length < MINT_SIZE || (tokenProgram === 'spl-token' && data.length !== MINT_SIZE)) {
    invalid('This token-program account is not a mint.');
  }
  if (data[45] !== 1) invalid('The token mint is not initialized.');
  const mintAuthority = optionalAuthority(data, 0, 'mint authority');
  const freezeAuthority = optionalAuthority(data, 46, 'freeze authority');
  const extensions = tokenProgram === 'token-2022' ? extensionTypes(data) : [];
  const warnings = [
    'Token gameplay is not enabled. The beta continues to use SOL.',
    'Mint inspection does not verify pump.fun provenance, liquidity, or project ownership.',
  ];
  if (mintAuthority) warnings.push('Mint authority is active and can increase supply.');
  if (freezeAuthority) warnings.push('Freeze authority is active and can freeze token accounts.');
  for (const type of extensions) warnings.push(`Unsupported Token-2022 extension: ${EXTENSION_NAMES[type] ?? `unknown type ${type}`}.`);
  return {
    mintAddress: address,
    cluster: ['mainnet-beta', 'devnet', 'testnet', 'localnet'].includes(cluster) ? cluster : 'custom',
    tokenProgram,
    decimals: data[44],
    supply: data.readBigUInt64LE(36).toString(),
    mintAuthority,
    freezeAuthority,
    extensions,
    warnings,
    gameplaySupported: false,
  };
}

function officialUrl(value: unknown, hostname: string, label: string): URL | null {
  const raw = optionalText(value, label, 300);
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return invalid(`${label} must be an HTTPS URL on ${hostname}.`); }
  if (url.protocol !== 'https:' || url.hostname !== hostname || url.port || url.username || url.password || url.search || url.hash) {
    invalid(`${label} must be an HTTPS URL on ${hostname}, without credentials, parameters, or fragments.`);
  }
  return url;
}

export function validatePumpFunUrl(value: unknown, mintAddress: string | null): string | null {
  const url = officialUrl(value, 'pump.fun', 'Token launch URL');
  if (!url) return null;
  const match = /^\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/.exec(url.pathname);
  if (!match || !mintAddress || match[1] !== mintAddress) {
    invalid('Token launch URL must be https://pump.fun/coin/ followed by the configured mint address.');
  }
  return `https://pump.fun/coin/${mintAddress}`;
}

export function validateOpenSeaUrl(value: unknown): string | null {
  const url = officialUrl(value, 'opensea.io', 'OpenSea collection URL');
  if (!url) return null;
  const match = /^\/collection\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/?$/.exec(url.pathname);
  if (!match) invalid('OpenSea URL must point to https://opensea.io/collection/ followed by a collection slug.');
  return `https://opensea.io/collection/${match[1]}`;
}

/** Canonical staging data only; the admin API must inspect any provided mint. */
export function validateTokenSettings(value: unknown): TokenSettings {
  const input = object(value, 'Token settings', ['status', 'mintAddress', 'symbol', 'decimals', 'launchUrl']);
  const status = input.status;
  if (status !== 'planned' && status !== 'configured' && status !== 'launched') invalid('Invalid token status.');
  const rawMint = optionalText(input.mintAddress, 'Mint address', 44);
  const mintAddress = rawMint ? canonicalSolanaAddress(rawMint) : null;
  const symbol = text(input.symbol, 'Token symbol', 16).toUpperCase();
  if (symbol && !/^[A-Z0-9]{1,16}$/.test(symbol)) invalid('Token symbol must contain only letters and digits.');
  const decimals = input.decimals;
  if (decimals !== null && (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255)) {
    invalid('Token decimals must be an integer from 0 to 255, or null.');
  }
  if (decimals !== null && !mintAddress) invalid('Token decimals require a mint address.');
  const launchUrl = validatePumpFunUrl(input.launchUrl, mintAddress);
  if (status !== 'planned' && (!mintAddress || decimals === null || !symbol)) {
    invalid('Configured tokens require a mint address, verified decimals, and a symbol.');
  }
  if (status === 'launched' && !launchUrl) invalid('A launched token requires its matching pump.fun URL.');
  return { status, mintAddress, symbol, decimals: decimals as number | null, launchUrl };
}

function collectionAddress(value: unknown, chain: NftSettings['chain']): string | null {
  const raw = optionalText(value, 'NFT collection address', 44);
  if (!raw) return null;
  if (chain === 'unconfigured') invalid('Choose the NFT chain before adding a collection address.');
  if (chain === 'solana') return canonicalSolanaAddress(raw, 'NFT collection address');
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw) || /^0x0{40}$/.test(raw)) invalid('NFT collection address must be a nonzero EVM contract address.');
  return raw.toLowerCase();
}

/**
 * Validates a cosmetic registry for a future ownership verifier. "configured"
 * is staged configuration; it grants no entitlement and verifies no contract.
 */
export function validateNftSettings(value: unknown): NftSettings {
  const input = object(value, 'NFT settings', ['status', 'chain', 'standard', 'collectionAddress', 'openSeaUrl', 'skinMappings']);
  const status = input.status;
  const chain = input.chain;
  const standard = input.standard;
  if (status !== 'planned' && status !== 'configured') invalid('Invalid NFT status.');
  if (chain !== 'unconfigured' && chain !== 'solana' && chain !== 'ethereum' && chain !== 'base' && chain !== 'polygon') invalid('Invalid NFT chain.');
  if (standard !== 'unconfigured' && standard !== 'metaplex' && standard !== 'erc721' && standard !== 'erc1155') invalid('Invalid NFT standard.');
  if (standard !== 'unconfigured' && (chain === 'unconfigured' || (chain === 'solana' ? standard !== 'metaplex' : standard === 'metaplex'))) {
    invalid('The NFT standard does not match the selected chain.');
  }
  const address = collectionAddress(input.collectionAddress, chain);
  const openSeaUrl = validateOpenSeaUrl(input.openSeaUrl);
  if (!Array.isArray(input.skinMappings) || input.skinMappings.length > MAX_MAPPINGS) invalid(`NFT skin mappings must be an array of at most ${MAX_MAPPINGS} items.`);
  if ((status === 'configured' || input.skinMappings.length > 0) && (!address || standard === 'unconfigured')) {
    invalid('NFT configuration and mappings require a collection address, chain, and matching standard.');
  }
  const assetIds = new Set<string>();
  const skinMappings = input.skinMappings.map((raw) => {
    const mapping = object(raw, 'NFT skin mapping', ['skinId', 'assetId']);
    if (typeof mapping.skinId !== 'number' || !Number.isInteger(mapping.skinId) || mapping.skinId < 16 || mapping.skinId > 23) {
      invalid('NFT mappings may use only premium cosmetic skin IDs 16 through 23.');
    }
    let assetId = text(mapping.assetId, 'NFT asset ID', 78);
    if (chain === 'solana') assetId = canonicalSolanaAddress(assetId, 'NFT asset ID');
    else if (!/^(0|[1-9][0-9]{0,77})$/.test(assetId) || BigInt(assetId) > MAX_UINT256) {
      invalid('EVM NFT asset IDs must be canonical decimal uint256 token IDs.');
    }
    if (assetIds.has(assetId)) invalid('Each NFT asset ID may appear only once in the skin mappings.');
    assetIds.add(assetId);
    return { skinId: mapping.skinId, assetId };
  });
  return { status, chain, standard, collectionAddress: address, openSeaUrl, skinMappings };
}

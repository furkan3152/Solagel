import { DEFAULT_ADMIN_SETTINGS } from '@solagel/shared';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import {
  inspectTokenMint, validateNftSettings, validateOpenSeaUrl, validatePumpFunUrl, validateTokenSettings,
} from '../src/admin/assets';

const MINT = 'So11111111111111111111111111111111111111112';
const OTHER_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AUTHORITY = new PublicKey('11111111111111111111111111111111');
const SPL = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const EVM_COLLECTION = `0x${'AbCdEf'.repeat(6)}ABcd`;

function mintData(): Buffer {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(18_446_744_073_709_551_615n, 36);
  data[44] = 9;
  data[45] = 1;
  return data;
}

function rpc(data = mintData(), owner = SPL) {
  const account: AccountInfo<Buffer> = { data, owner, executable: false, lamports: 1_000_000, rentEpoch: 0 };
  return { account, connection: { getAccountInfo: vi.fn(async () => account) } };
}

function extension(type: number, length = 8): Buffer {
  const data = Buffer.alloc(4 + length);
  data.writeUInt16LE(type, 0);
  data.writeUInt16LE(length, 2);
  return data;
}

function extendedMint(...entries: Buffer[]): Buffer {
  const base = Buffer.alloc(166);
  mintData().copy(base);
  base[165] = 1;
  return Buffer.concat([base, ...entries]);
}

describe('read-only Solana token inspection', () => {
  it('preserves the full u64 supply and exposes authorities without claiming gameplay support', async () => {
    const data = mintData();
    data.writeUInt32LE(1, 0);
    AUTHORITY.toBuffer().copy(data, 4);
    data.writeUInt32LE(1, 46);
    AUTHORITY.toBuffer().copy(data, 50);
    const { connection } = rpc(data);
    const result = await inspectTokenMint(connection, MINT, 'devnet');
    expect(result).toMatchObject({ mintAddress: MINT, tokenProgram: 'spl-token', cluster: 'devnet', decimals: 9,
      supply: '18446744073709551615', mintAuthority: AUTHORITY.toBase58(), freezeAuthority: AUTHORITY.toBase58(),
      extensions: [], gameplaySupported: false });
    expect(result.warnings.join(' ')).toMatch(/beta continues to use SOL/);
    expect(connection.getAccountInfo).toHaveBeenCalledWith(new PublicKey(MINT), 'confirmed');
  });

  it('accepts a zero-supply initialized mint with revoked authorities and zero decimals', async () => {
    const data = mintData();
    data.writeBigUInt64LE(0n, 36);
    data[44] = 0;
    const { connection } = rpc(data);
    expect(await inspectTokenMint(connection, MINT, 'localnet')).toMatchObject({ supply: '0', decimals: 0, mintAuthority: null, freezeAuthority: null });
  });

  it.each(['not-a-mint', 'https://example.com/rpc', '0'.repeat(44), '1'.repeat(33)])('rejects malformed mint %s before RPC access', async (mint) => {
    const { connection } = rpc();
    await expect(inspectTokenMint(connection, mint, 'devnet')).rejects.toThrow(/public key|encoding/);
    expect(connection.getAccountInfo).not.toHaveBeenCalled();
  });

  it('rejects a wallet/system account even if its data looks like a mint', async () => {
    const { connection } = rpc(mintData(), AUTHORITY);
    await expect(inspectTokenMint(connection, MINT, 'devnet')).rejects.toThrow(/not owned/);
  });

  it('rejects executable and missing accounts', async () => {
    const { account, connection } = rpc();
    account.executable = true;
    await expect(inspectTokenMint(connection, MINT, 'devnet')).rejects.toThrow(/not owned/);
    await expect(inspectTokenMint({ getAccountInfo: async () => null }, MINT, 'devnet')).rejects.toThrow(/No account exists/);
  });

  it.each([0, 2])('rejects initialized flag %s', async (flag) => {
    const data = mintData();
    data[45] = flag;
    await expect(inspectTokenMint(rpc(data).connection, MINT, 'devnet')).rejects.toThrow(/not initialized/);
  });

  it.each([81, 165])('rejects a classic token-program account with length %s', async (length) => {
    const data = Buffer.alloc(length);
    mintData().copy(data);
    await expect(inspectTokenMint(rpc(data).connection, MINT, 'devnet')).rejects.toThrow(/not a mint/);
  });

  it('rejects malformed authority options instead of treating them as revoked', async () => {
    const data = mintData();
    data.writeUInt32LE(2, 46);
    await expect(inspectTokenMint(rpc(data).connection, MINT, 'devnet')).rejects.toThrow(/invalid freeze authority/);
  });

  it('never returns a private RPC endpoint from an upstream error or cluster label', async () => {
    const privateEndpoint = 'https://private.example/rpc?api-key=secret-value';
    const connection = { getAccountInfo: vi.fn(async () => { throw new Error(privateEndpoint); }) };
    await expect(inspectTokenMint(connection, MINT, 'devnet')).rejects.toThrow('The mint could not be read from the configured Solana network.');
    const result = await inspectTokenMint(rpc().connection, MINT, privateEndpoint);
    expect(JSON.stringify(result)).not.toContain(privateEndpoint);
    expect(result.cluster).toBe('custom');
  });

  it('inspects an extension-free Token-2022 mint without declaring integration ready', async () => {
    const result = await inspectTokenMint(rpc(mintData(), TOKEN_2022).connection, MINT, 'devnet');
    expect(result).toMatchObject({ tokenProgram: 'token-2022', extensions: [], gameplaySupported: false });
  });

  it('identifies each Token-2022 extension including unknown types as unsupported', async () => {
    const data = extendedMint(extension(1, 108), extension(18, 64), extension(500));
    const result = await inspectTokenMint(rpc(data, TOKEN_2022).connection, MINT, 'devnet');
    expect(result.extensions).toEqual([1, 18, 500]);
    expect(result.warnings.join(' ')).toMatch(/Unsupported Token-2022 extension: TransferFeeConfig/);
    expect(result.warnings.join(' ')).toMatch(/MetadataPointer/);
    expect(result.warnings.join(' ')).toMatch(/unknown type 500/);
    expect(result.gameplaySupported).toBe(false);
  });

  it('rejects token-account extensions, duplicate TLVs and truncated payloads on a mint', async () => {
    for (const data of [extendedMint(extension(2)), extendedMint(extension(18), extension(18)), extendedMint(extension(18).subarray(0, 7))]) {
      await expect(inspectTokenMint(rpc(data, TOKEN_2022).connection, MINT, 'devnet')).rejects.toThrow(/extension/);
    }
  });

  it('rejects invalid Token-2022 account types and padding', async () => {
    const account = extendedMint();
    account[165] = 2;
    await expect(inspectTokenMint(rpc(account, TOKEN_2022).connection, MINT, 'devnet')).rejects.toThrow(/not a valid extended mint/);
    account[165] = 1;
    account[100] = 1;
    await expect(inspectTokenMint(rpc(account, TOKEN_2022).connection, MINT, 'devnet')).rejects.toThrow(/padding/);
  });
});

describe('official asset links', () => {
  it('accepts only the configured mint in a canonical pump.fun coin URL', () => {
    expect(validatePumpFunUrl(`https://pump.fun/coin/${MINT}/`, MINT)).toBe(`https://pump.fun/coin/${MINT}`);
    expect(() => validatePumpFunUrl(`https://pump.fun/coin/${OTHER_MINT}`, MINT)).toThrow(/configured mint/);
    expect(() => validatePumpFunUrl(`https://pump.fun/coin/${MINT}`, null)).toThrow(/configured mint/);
  });

  it.each([
    `http://pump.fun/coin/${MINT}`, `https://pump.fun.evil.test/coin/${MINT}`,
    `https://pump.fun@evil.test/coin/${MINT}`, `https://user@pump.fun/coin/${MINT}`,
    `https://pump.fun:8443/coin/${MINT}`, `https://pump.fun/coin/${MINT}?redirect=evil`,
    `https://pump.fun/coin/${MINT}#fragment`, `https://pump.fun/${MINT}`,
  ])('rejects unsafe or non-coin launch URL %s', (url) => {
    expect(() => validatePumpFunUrl(url, MINT)).toThrow();
  });

  it('normalizes an official OpenSea collection URL and accepts an omitted link', () => {
    expect(validateOpenSeaUrl('https://opensea.io/collection/solagel-skins/')).toBe('https://opensea.io/collection/solagel-skins');
    expect(validateOpenSeaUrl(null)).toBeNull();
  });

  it.each([
    'http://opensea.io/collection/skins', 'https://opensea.io.evil.test/collection/skins',
    'https://opensea.io@evil.test/collection/skins', 'https://admin@opensea.io/collection/skins',
    'https://opensea.io/assets/ethereum/0x123/1', 'https://opensea.io/collection/skins/extra',
    'https://opensea.io/collection/skins?redirect=evil', 'https://opensea.io/collection/skins#mint',
    'https://opensea.io/collection/%2F%2Fevil.test',
  ])('rejects unsafe or non-collection OpenSea URL %s', (url) => {
    expect(() => validateOpenSeaUrl(url)).toThrow();
  });
});

describe('staged asset settings', () => {
  const nft = () => ({ ...DEFAULT_ADMIN_SETTINGS.nft, status: 'configured', chain: 'ethereum', standard: 'erc721',
    collectionAddress: EVM_COLLECTION, skinMappings: [{ skinId: 16, assetId: '1' }] });
  const token = () => ({ ...DEFAULT_ADMIN_SETTINGS.token, status: 'configured', mintAddress: MINT, symbol: 'sgel', decimals: 6 });

  it('keeps unlaunched defaults unconfigured without inventing assets', () => {
    expect(validateTokenSettings(DEFAULT_ADMIN_SETTINGS.token)).toEqual(DEFAULT_ADMIN_SETTINGS.token);
    expect(validateNftSettings(DEFAULT_ADMIN_SETTINGS.nft)).toEqual(DEFAULT_ADMIN_SETTINGS.nft);
  });

  it('normalizes token symbols while keeping token launch and NFT availability independent', () => {
    const settings = validateTokenSettings({ ...token(), status: 'launched', symbol: '1inch', launchUrl: `https://pump.fun/coin/${MINT}` });
    expect(settings.symbol).toBe('1INCH');
    expect(settings.status).toBe('launched');
    expect(validateNftSettings(DEFAULT_ADMIN_SETTINGS.nft).status).toBe('planned');
  });

  it('requires a matching pump.fun URL for launched tokens and full fields for configured tokens', () => {
    expect(() => validateTokenSettings({ ...token(), status: 'launched' })).toThrow(/requires its matching/);
    expect(() => validateTokenSettings({ ...token(), mintAddress: null })).toThrow();
    expect(() => validateTokenSettings({ ...token(), decimals: null })).toThrow();
    expect(() => validateTokenSettings({ ...token(), symbol: '' })).toThrow();
    expect(() => validateTokenSettings({ ...token(), decimals: 1.2 })).toThrow(/decimals/);
    expect(() => validateTokenSettings({ ...token(), decimals: 256 })).toThrow(/decimals/);
  });

  it.each(['ethereum', 'base', 'polygon'])('stages %s collection addresses canonically without claiming ownership', (chain) => {
    const settings = validateNftSettings({ ...nft(), chain });
    expect(settings.collectionAddress).toBe(EVM_COLLECTION.toLowerCase());
    expect(settings.skinMappings).toEqual([{ skinId: 16, assetId: '1' }]);
  });

  it('supports Solana Metaplex mint mappings and multiple assets for the same cosmetic', () => {
    const settings = validateNftSettings({ ...nft(), chain: 'solana', standard: 'metaplex', collectionAddress: MINT,
      skinMappings: [{ skinId: 16, assetId: OTHER_MINT }, { skinId: 16, assetId: MINT }] });
    expect(settings.skinMappings).toHaveLength(2);
    expect(settings.collectionAddress).toBe(MINT);
  });

  it('rejects unsupported chain-standard combinations and custom RPC URLs', () => {
    expect(() => validateNftSettings({ ...nft(), chain: 'solana' })).toThrow(/standard does not match/);
    expect(() => validateNftSettings({ ...nft(), standard: 'metaplex' })).toThrow(/standard does not match/);
    expect(() => validateNftSettings({ ...nft(), chain: 'https://rpc.example' })).toThrow(/Invalid NFT chain/);
    expect(() => validateNftSettings({ ...nft(), collectionAddress: 'https://rpc.example' })).toThrow(/contract address/);
    expect(() => validateNftSettings({ ...nft(), collectionAddress: `0x${'0'.repeat(40)}` })).toThrow(/nonzero/);
    expect(() => validateNftSettings({ ...nft(), standard: 'unconfigured' })).toThrow(/matching standard/);
    expect(() => validateNftSettings({ ...nft(), rpcUrl: 'https://rpc.example' })).toThrow(/unsupported fields/);
    expect(() => validateTokenSettings({ ...token(), rpcUrl: 'https://rpc.example' })).toThrow(/unsupported fields/);
  });

  it.each([0, 7, 8, 15, 24, 16.1, '16'])('rejects skin %s to preserve existing free and progression skins', (skinId) => {
    expect(() => validateNftSettings({ ...nft(), skinMappings: [{ skinId, assetId: '1' }] })).toThrow(/premium cosmetic/);
  });

  it('rejects duplicate asset IDs regardless of target skin', () => {
    expect(() => validateNftSettings({ ...nft(), skinMappings: [{ skinId: 16, assetId: '1' }, { skinId: 17, assetId: '1' }] })).toThrow(/only once/);
  });

  it.each(['01', '+1', '-1', '1.0', '1e3', '0x1', ((1n << 256n)).toString()])('rejects noncanonical or out-of-range EVM token ID %s', (assetId) => {
    expect(() => validateNftSettings({ ...nft(), skinMappings: [{ skinId: 16, assetId }] })).toThrow(/canonical decimal uint256/);
  });

  it('supports uint256 boundaries without number precision loss', () => {
    const maxId = ((1n << 256n) - 1n).toString();
    const settings = validateNftSettings({ ...nft(), standard: 'erc1155', skinMappings: [{ skinId: 16, assetId: '0' }, { skinId: 23, assetId: maxId }] });
    expect(settings.skinMappings[1].assetId).toBe(maxId);
  });

  it('rejects EVM IDs in Solana mappings instead of treating them as ownership proof', () => {
    expect(() => validateNftSettings({ ...nft(), chain: 'solana', standard: 'metaplex', collectionAddress: MINT,
      skinMappings: [{ skinId: 16, assetId: '1' }] })).toThrow(/public key/);
  });
});

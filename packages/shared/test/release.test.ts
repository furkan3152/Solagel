import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_SETTINGS } from '../src/admin';
import { releaseForSettings } from '../src/release';

describe('public release announcements', () => {
  it('keeps draft asset identifiers private and leaves SOL economics unchanged', () => {
    const settings = structuredClone(DEFAULT_ADMIN_SETTINGS);
    settings.token = { status: 'configured', mintAddress: 'draft-mint', symbol: 'GEL', decimals: 6, launchUrl: 'https://pump.fun/coin/draft-mint' };
    settings.nft = { status: 'configured', chain: 'base', standard: 'erc721', collectionAddress: 'draft-contract', openSeaUrl: 'https://opensea.io/collection/draft', skinMappings: [{ skinId: 16, assetId: '1' }] };
    const release = releaseForSettings(settings);
    expect(release.rolloutOrder).toEqual(['sol-beta', 'token', 'nft']);
    expect(release.currency).toBe('SOL');
    expect(release.token.mintAddress).toBeNull();
    expect(release.token.launchUrl).toBeNull();
    expect(release.token.symbol).toBe('');
    expect(release.nft.collectionAddress).toBeNull();
    expect(release.nft.openSeaUrl).toBeNull();
    expect(release.nft.ownershipEnabled).toBe(false);
  });

  it('publishes an explicitly announced token without changing entry or payout units', () => {
    const settings = structuredClone(DEFAULT_ADMIN_SETTINGS);
    settings.token = { status: 'launched', mintAddress: 'verified-mint', symbol: 'GEL', decimals: 6, launchUrl: 'https://pump.fun/coin/verified-mint' };
    const release = releaseForSettings(settings);
    expect(release.token.mintAddress).toBe('verified-mint');
    expect(release.token.symbol).toBe('GEL');
    expect(release.token.gameplayEnabled).toBe(false);
    expect(release.currency).toBe('SOL');
    expect(release.premiumSalesEnabled).toBe(false);
    expect(release.nft.ownershipEnabled).toBe(false);
  });
});

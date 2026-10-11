import type { AdminSettings, NftChain, NftStandard } from './admin';

/** Product status is independent of the escrow denomination of existing tickets. */
export interface ReleaseStatus {
  phase: 'sol-beta';
  currency: 'SOL';
  rolloutOrder: readonly ['sol-beta', 'token', 'nft'];
  premiumSalesEnabled: false;
  token: {
    status: 'not-launched' | 'configured' | 'launched';
    platform: 'pump.fun';
    mintAddress: string | null;
    symbol: string;
    decimals: number | null;
    launchUrl: string | null;
    gameplayEnabled: false;
  };
  nft: {
    status: 'not-launched' | 'configured';
    platform: 'OpenSea';
    mintPrice: 0;
    collectionAddress: string | null;
    chain: NftChain;
    standard: NftStandard;
    openSeaUrl: string | null;
    cosmeticOnly: true;
    ownershipEnabled: false;
  };
}

export const RELEASE: ReleaseStatus = {
  phase: 'sol-beta', currency: 'SOL', rolloutOrder: ['sol-beta', 'token', 'nft'], premiumSalesEnabled: false,
  token: { status: 'not-launched', platform: 'pump.fun', mintAddress: null, symbol: '', decimals: null, launchUrl: null, gameplayEnabled: false },
  nft: { status: 'not-launched', platform: 'OpenSea', mintPrice: 0, collectionAddress: null, chain: 'unconfigured', standard: 'unconfigured', openSeaUrl: null, cosmeticOnly: true, ownershipEnabled: false },
};

/** Staged addresses stay private until the operator explicitly announces a verified token. */
export function releaseForSettings(settings: AdminSettings): ReleaseStatus {
  const announced = settings.token.status === 'launched';
  return {
    ...RELEASE,
    token: {
      ...RELEASE.token,
      status: settings.token.status === 'planned' ? 'not-launched' : settings.token.status,
      mintAddress: announced ? settings.token.mintAddress : null,
      symbol: announced ? settings.token.symbol : '',
      decimals: announced ? settings.token.decimals : null,
      launchUrl: announced ? settings.token.launchUrl : null,
    },
    nft: { ...RELEASE.nft, status: settings.nft.status === 'configured' ? 'configured' : 'not-launched' },
  };
}

/** Current product phase. Future assets are intentionally unconfigured until launch. */
export const RELEASE = {
  phase: 'sol-beta',
  currency: 'SOL',
  premiumSalesEnabled: false,
  token: { status: 'not-launched', platform: 'pump.fun', mintAddress: null },
  nft: {
    status: 'not-launched',
    platform: 'OpenSea',
    mintPrice: 0,
    collectionAddress: null,
    cosmeticOnly: true,
  },
} as const;

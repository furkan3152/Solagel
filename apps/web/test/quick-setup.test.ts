import { describe, expect, it } from 'vitest';
import { setupSteps } from '../src/admin/QuickSetup';

const ARENA = '0x9bdc7dcbb3ea173e3111093a64cbe547e2f82a68';
const NFT = '0xfd31b13e6684465a3b3161375e7f82f6a3deea11';
const TOKEN = '0xfeeb469fe3c892ebb82e44cef5f3bf1c74c11167';
const KEY = '0xabec7B8ed9b87989106f6d0510ec9Dd9DEE0a1FC';

function ctx(over: Record<string, unknown> = {}) {
  const status = {
    arena: { address: ARENA, config: { admin: '0x08b2b32E932D5f429073a441E6eFd8e3D42369b2', serverAuthority: KEY, token: null, feeBps: 500, holderNft: null }, token: null, arenas: [] },
    nft: { address: NFT, state: { phaseName: 'closed' } },
    testToken: { address: TOKEN, serverIsMinter: false, faucet: { holderNft: null } },
    ...over,
  };
  return { status, net: { serverKey: KEY, mainnet: false } } as never;
}

describe('finish setup', () => {
  it('lists every missing owner step in order on a fresh testnet deploy', () => {
    const ids = setupSteps(ctx(), { openMint: true }).map((s) => s.id);
    expect(ids).toEqual(['token', 'arena-1', 'arena-2', 'arena-3', 'arena-4', 'minter', 'faucet-nft', 'perks', 'holders-4', 'mint']);
  });

  it('leaves out what is already done on chain', () => {
    const arenas = [1, 2, 3, 4].map((id) => ({ id, exists: true, holdersOnly: id === 4 }));
    const c = ctx({
      arena: { address: ARENA, config: { admin: '0x08b2b32E932D5f429073a441E6eFd8e3D42369b2', serverAuthority: KEY, token: TOKEN, feeBps: 500, holderNft: NFT }, token: { decimals: 18 }, arenas },
      nft: { address: NFT, state: { phaseName: 'public' } },
      testToken: { address: TOKEN, serverIsMinter: true, faucet: { holderNft: NFT } },
    });
    expect(setupSteps(c, { openMint: true })).toEqual([]);
  });

  it('never opens the mint on mainnet', () => {
    expect(setupSteps(ctx(), { openMint: false }).map((s) => s.id)).not.toContain('mint');
  });
});

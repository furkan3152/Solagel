import { elymumNFTAbi } from '@elymum/sdk';
import type { MintContractState, MintState } from '@elymum/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeEventTopics, padHex, type Log } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSitePath } from '../src/site/router';
import { useSession } from '../src/site/session';
import { mintBlocker, mintView, mintedTokenIds, playOpenForHolders, remaining, usdText } from '../src/site/mint/logic';
import { resetWallets, useWallet } from '../src/wallet/store';
import { ALICE, BOB, chainStatus, detail, fakeProvider } from './evm-helpers';
import { installDomStubs, mockFetch } from './site-helpers';

const NFT = '0x0000000000000000000000000000000000000f7e';
const ROOT = `0x${'ab'.repeat(32)}`;

const spies = vi.hoisted(() => ({ getMintState: vi.fn(), getMintedBy: vi.fn(), sendWalletCall: vi.fn() }));
vi.mock('@elymum/sdk', async (orig) => ({ ...(await orig<typeof import('@elymum/sdk')>()), getMintState: spies.getMintState, getMintedBy: spies.getMintedBy }));
vi.mock('../src/wallet/tx', async (orig) => ({ ...(await orig<typeof import('../src/wallet/tx')>()), sendWalletCall: spies.sendWalletCall }));
vi.mock('../src/wallet/network', async (orig) => ({
  ...(await orig<typeof import('../src/wallet/network')>()),
  fetchServerChain: async () => chainStatus({ nftAddress: NFT }),
  publicClientFor: () => ({}),
}));
const { Mint } = await import('../src/site/mint/MintPage');

const contract = (o: Partial<MintContractState> = {}): MintContractState => ({
  phase: 'allowlist',
  priceWei: '30000000000000000',
  minPriceWei: '0',
  maxPriceWei: '0',
  keeper: '0x0000000000000000000000000000000000000000',
  merkleRoot: ROOT,
  maxSupply: 5000,
  totalSupply: 10,
  wlLimit: 1,
  publicLimit: 2,
  treasury: ALICE,
  frozen: false,
  ...o,
});
const mintState = (c: MintContractState | null, o: Partial<MintState> = {}): MintState => ({
  nftAddress: c ? NFT : null,
  chainId: 99801,
  contract: c,
  hypeUsd: 33.3,
  priceUsd: 0.999,
  targetUsdCents: 100,
  holders: 7,
  soldOut: false,
  gameAccess: 'holders',
  ...o,
});
const proof = (eligible: boolean, onchain = ROOT) => ({ eligible, proof: eligible ? [`0x${'11'.repeat(32)}`] : [], root: ROOT, onchainRoot: onchain });

/** A `Transfer(0x0 → to, id)` log of the NFT. */
const transferLog = (to: string, id: bigint, from = '0x0000000000000000000000000000000000000000', address = NFT): Log =>
  ({
    address,
    topics: encodeEventTopics({ abi: elymumNFTAbi, eventName: 'Transfer', args: { from: from as `0x${string}`, to: to as `0x${string}`, tokenId: id } }),
    data: '0x',
    blockHash: padHex('0x1'),
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: padHex('0x2'),
    transactionIndex: 0,
    removed: false,
  }) as unknown as Log;

describe('mint logic', () => {
  it('names the phase: unavailable, closed, allowlist, public, sold out', () => {
    expect(mintView(null)).toBe('unavailable');
    expect(mintView(mintState(null))).toBe('unavailable');
    expect(mintView(mintState(contract({ phase: 'closed' })))).toBe('closed');
    expect(mintView(mintState(contract()))).toBe('allowlist');
    expect(mintView(mintState(contract({ phase: 'public' })))).toBe('public');
    expect(mintView(mintState(contract({ totalSupply: 5000 })))).toBe('soldout');
  });

  it('pre-checks like the contract (mintRefusal) plus the proof and the published root', () => {
    const c = contract();
    expect(mintBlocker(c, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1, proof: proof(true) })).toBeNull();
    expect(mintBlocker(c, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1, proof: null })).toMatch(/checking/);
    expect(mintBlocker(c, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1, proof: proof(false) })).toMatch(/not on the allowlist/);
    expect(mintBlocker(c, { wl: 0, pub: 0 }, { kind: 'allowlist', qty: 1, proof: proof(true, `0x${'00'.repeat(32)}`) })).toMatch(/not published/);
    expect(mintBlocker(c, { wl: 1, pub: 0 }, { kind: 'allowlist', qty: 1, proof: proof(true) })).toMatch(/allowlist limit is 1/);
    expect(mintBlocker(c, { wl: 0, pub: 0 }, { kind: 'public', qty: 1, proof: null })).toMatch(/public mint is not open/);
    const pub = contract({ phase: 'public', totalSupply: 4999 });
    expect(mintBlocker(pub, { wl: 0, pub: 0 }, { kind: 'public', qty: 2, proof: null })).toMatch(/only 1 left/);
    expect(remaining(pub, { wl: 0, pub: 0 }, 'public')).toBe(1);
    expect(remaining(contract({ phase: 'public' }), { wl: 0, pub: 1 }, 'public')).toBe(1);
  });

  it('reads the minted token ids from the Transfer logs (mints to this wallet only)', () => {
    const logs = [transferLog(ALICE, 11n), transferLog(ALICE, 12n), transferLog(BOB, 13n), transferLog(ALICE, 14n, BOB), transferLog(ALICE, 15n, undefined, '0x0000000000000000000000000000000000000001')];
    expect(mintedTokenIds(logs, NFT, ALICE)).toEqual([11n, 12n]);
  });

  it('formats USD and knows when holders may play', () => {
    expect(usdText(0.999)).toBe('$1.00');
    expect(usdText(null)).toBeNull();
    expect(playOpenForHolders('holders')).toBe(true);
    expect(playOpenForHolders('public')).toBe(true);
    expect(playOpenForHolders('admins')).toBe(false);
  });

  it('/mint is a site page', () => {
    expect(isSitePath('/mint')).toBe(true);
  });
});

let restore = () => {};
beforeEach(() => {
  installDomStubs();
  localStorage.clear();
  resetWallets();
  useSession.setState({ session: null, signing: false, error: null });
  spies.getMintedBy.mockReset();
  spies.getMintedBy.mockResolvedValue({ wl: 0, pub: 0 });
  spies.getMintState.mockReset();
  spies.sendWalletCall.mockReset();
});
afterEach(() => {
  restore();
  act(() => resetWallets());
});
const connect = () => useWallet.setState({ status: 'connected', address: ALICE, chainId: 99801, current: detail(fakeProvider({ chainId: 99801, known: [99801] })) });

describe('/mint page', { timeout: 30_000 }, () => {
  it('Closed: the teaser and a way to the WL', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract({ phase: 'closed' })) }));
    render(<Mint pollMs={0} />);
    expect((await screen.findByTestId('mt-phase')).textContent).toBe('Closed');
    expect(screen.getByRole('heading', { name: 'Sealed. For now.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Join the WL' }).getAttribute('href')).toBe('/wl');
    expect(screen.getByTestId('mt-price').textContent).toMatch(/0\.0300\s*HYPE.*\$1\.00/);
  });

  it('Allowlist: eligibility, quantity bounded by the limit, and the mint call with the proof', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract({ wlLimit: 2 })), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(true) }));
    const fresh = { phase: 1, phaseName: 'allowlist', price: 31_000_000_000_000_000n, minPrice: 0n, maxPrice: 0n, keeper: null, root: ROOT, maxSupply: 5000, totalSupply: 10, wlLimit: 2, publicLimit: 2, treasury: ALICE, frozen: false, soldOut: false };
    spies.getMintState.mockResolvedValue(fresh);
    spies.sendWalletCall.mockImplementation(async (_call: unknown, opts: { onPhase?: (p: string) => void }) => {
      opts.onPhase?.('signing');
      return { ok: true, hash: `0x${'cd'.repeat(32)}`, receipt: { status: 'success', logs: [transferLog(ALICE, 11n), transferLog(ALICE, 12n)] } };
    });
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId('mt-eligibility').textContent).toMatch(/is on the allowlist\./));
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    expect(screen.getByRole('spinbutton', { name: 'How many emblems' }).textContent).toBe('2');
    expect((screen.getByRole('button', { name: 'One more' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mint 2 emblems' }));
    await screen.findByTestId('mt-done');
    const call = spies.sendWalletCall.mock.calls[0][0];
    expect(call).toMatchObject({ address: NFT, functionName: 'mintAllowlist', args: [2n, [`0x${'11'.repeat(32)}`]] });
    // the fresh price (re-read right before the wallet), times 2, plus the 1 % buffer the contract refunds
    expect(call.value).toBe(62_620_000_000_000_000n);
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual(['/api/nft/11.svg', '/api/nft/12.svg'].map((p) => `${location.protocol}//${location.host}${p}`));
    expect(screen.getByRole('link', { name: 'Play' }).getAttribute('href')).toBe('/play');
  });

  it('Allowlist: a wallet that is not on the list cannot mint', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract()), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId('mt-blocker').textContent).toMatch(/not on the allowlist/));
    expect((screen.getByRole('button', { name: /^Mint/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Allowlist: on the list, but the root is not on the contract yet', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract()), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(true, `0x${'00'.repeat(32)}`) }));
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId('mt-eligibility').textContent).toMatch(/not on the contract yet/));
    expect(screen.getByTestId('mt-blocker').textContent).toMatch(/not published/);
    expect((screen.getByRole('button', { name: /^Mint/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refusal at the fresh re-check stops before the wallet', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract({ phase: 'public' })), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.getMintState.mockResolvedValue({ phase: 2, phaseName: 'public', price: 1n, minPrice: 0n, maxPrice: 0n, keeper: null, root: ROOT, maxSupply: 10, totalSupply: 10, wlLimit: 1, publicLimit: 2, treasury: ALICE, frozen: false, soldOut: true });
    render(<Mint pollMs={0} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Mint 1 emblem' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Mint 1 emblem' }));
    expect((await screen.findByTestId('mt-error')).textContent).toMatch(/sold out/);
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
  });

  it('Sold out, with Play for holders', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract({ totalSupply: 5000 }), { soldOut: true }) }));
    render(<Mint pollMs={0} />);
    expect((await screen.findByTestId('mt-phase')).textContent).toBe('Sold out');
    expect(screen.getByRole('link', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Mint/ })).toBeNull();
  });

  it('no contract yet: the mint is not live', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(null) }));
    render(<Mint pollMs={0} />);
    expect(await screen.findByRole('heading', { name: 'The mint is not live yet.' })).toBeTruthy();
  });
});

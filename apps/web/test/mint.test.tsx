import { elymumNFTAbi } from '@elymum/sdk';
import type { ChainStatus } from '@elymum/shared';
import type { MintContractState, MintState } from '@elymum/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { encodeErrorResult, encodeEventTopics, padHex, type Log } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSitePath } from '../src/site/router';
import { useSession } from '../src/site/session';
import { fundsBlocker, hypeText, mintBlocker, mintErrorText, mintView, mintedTokenIds, playOpenForHolders, priceStory, remaining, usdText } from '../src/site/mint/logic';
import { announceProvider } from '../src/wallet/eip6963';
import { resetWallets, useWallet } from '../src/wallet/store';
import { ALICE, BOB, chainStatus, detail, fakeProvider } from './evm-helpers';
import { installDomStubs, mockFetch } from './site-helpers';
import { fetchMintState, prefetchMintState, readCachedMint, resetMintState, takeEarlyMint, writeCachedMint } from '../src/site/mint/mintState';

const NFT = '0x0000000000000000000000000000000000000f7e';
const ROOT = `0x${'ab'.repeat(32)}`;

const spies = vi.hoisted(() => ({
  getMintState: vi.fn(),
  getMintedBy: vi.fn(),
  sendWalletCall: vi.fn(),
  fetchServerChain: vi.fn(),
  client: { getBalance: vi.fn(), estimateGas: vi.fn() },
}));
vi.mock('@elymum/sdk', async (orig) => ({ ...(await orig<typeof import('@elymum/sdk')>()), getMintState: spies.getMintState, getMintedBy: spies.getMintedBy }));
vi.mock('../src/wallet/tx', async (orig) => ({ ...(await orig<typeof import('../src/wallet/tx')>()), sendWalletCall: spies.sendWalletCall }));
vi.mock('../src/wallet/network', async (orig) => ({
  ...(await orig<typeof import('../src/wallet/network')>()),
  fetchServerChain: spies.fetchServerChain,
  publicClientFor: () => spies.client,
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
  spies.fetchServerChain.mockReset();
  spies.fetchServerChain.mockResolvedValue(chainStatus({ nftAddress: NFT }));
  // unknown balance and a failing estimate by default: the wallet decides (nothing blocks)
  spies.client.getBalance.mockReset();
  spies.client.getBalance.mockRejectedValue(new Error('no rpc in tests'));
  spies.client.estimateGas.mockReset();
  spies.client.estimateGas.mockRejectedValue(new Error('no rpc in tests'));
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
    await waitFor(() => expect(screen.getByTestId('mt-phase').textContent).toBe('Closed'));
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
    await waitFor(() => expect(screen.getByTestId('mt-phase').textContent).toBe('Sold out'));
    expect(screen.getByRole('link', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Mint/ })).toBeNull();
  });

  it('no contract yet: the mint is not live', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(null) }));
    render(<Mint pollMs={0} />);
    expect(await screen.findByRole('heading', { name: 'The mint is not live yet.' })).toBeTruthy();
  });
});

/* ── the live testnet regression: 1 HYPE, public, limit 3 ─────────────── */

const HYPE = 10n ** 18n;
const pubContract = (o: Partial<MintContractState> = {}) => contract({ phase: 'public', priceWei: HYPE.toString(), merkleRoot: `0x${'00'.repeat(32)}`, maxSupply: 3333, totalSupply: 0, wlLimit: 3, publicLimit: 3, ...o });
const freshPub = (o: Record<string, unknown> = {}) => ({ phase: 2, phaseName: 'public', price: HYPE, minPrice: 0n, maxPrice: 0n, keeper: null, root: `0x${'00'.repeat(32)}`, maxSupply: 3333, totalSupply: 0, wlLimit: 3, publicLimit: 3, treasury: ALICE, frozen: false, soldOut: false, ...o });
const testnetState = (c = pubContract(), o: Partial<MintState> = {}) => mintState(c, { priceUsd: 87.52, hypeUsd: 87.52, gameAccess: 'public', ...o });
const minted = (ids: bigint[]) => async (_call: unknown, opts: { onPhase?: (p: string) => void }) => {
  opts.onPhase?.('switching');
  opts.onPhase?.('signing');
  return { ok: true, hash: `0x${'cd'.repeat(32)}`, receipt: { status: 'success', logs: ids.map((id) => transferLog(ALICE, id)) } };
};
const revert = (errorName: 'SoldOut' | 'PublicLimitExceeded') =>
  Object.assign(new Error('execution reverted'), { code: 3, data: encodeErrorResult({ abi: elymumNFTAbi, errorName }) });

describe('mint logic: price copy, funds, errors', () => {
  it('tells the testnet price plainly, keeps the dollar story only within ±10 % of the target', () => {
    const s = (priceUsd: number | null, chainId: number | null = 999) => ({ priceUsd, targetUsdCents: 100, chainId });
    expect(priceStory(s(87.52, 99801), true)).toBe('testnet');
    // the chain from the mint state when the server chain is not loaded yet
    expect(priceStory(s(87.52, 99801), null)).toBe('testnet');
    expect(priceStory(s(1.04), false)).toBe('dollar');
    expect(priceStory(s(0.91), false)).toBe('dollar');
    expect(priceStory(s(1.12), false)).toBe('plain');
    expect(priceStory(s(0.85), false)).toBe('plain');
    expect(priceStory(s(null), false)).toBe('plain');
  });

  it('formats HYPE for prose', () => {
    expect(hypeText(HYPE)).toBe('1');
    expect(hypeText(3_030_000_000_000_000_000n)).toBe('3.03');
    expect(hypeText(31_250_000_000_000_000n)).toBe('0.0313');
    expect(hypeText(0n)).toBe('0');
    expect(hypeText(1n)).toBe('<0.0001');
  });

  it('blocks only a balance that is known and too small', () => {
    expect(fundsBlocker(null, HYPE)).toBeNull();
    expect(fundsBlocker(2n * HYPE, HYPE)).toBeNull();
    expect(fundsBlocker(HYPE / 2n, 1_010_000_000_000_000_000n)).toMatch(/^this mint sends 1\.01 HYPE plus gas, and this wallet holds 0\.5 HYPE/);
  });

  it('words the mint failures that matter', () => {
    const fb = 'fallback';
    expect(mintErrorText({ kind: 'rejected', name: 'UserRejectedRequestError', message: '' }, fb)).toMatch(/cancelled in your wallet/);
    expect(mintErrorText({ kind: 'insufficient-funds', name: 'InsufficientFundsError', message: '' }, fb)).toMatch(/Not enough HYPE/);
    expect(mintErrorText({ kind: 'contract', name: 'SoldOut', message: '' }, fb)).toMatch(/Sold out/);
    expect(mintErrorText({ kind: 'contract', name: 'PublicLimitExceeded', message: '' }, fb)).toMatch(/public mint limit/);
    expect(mintErrorText({ kind: 'network', name: 'NetworkError', message: '' }, fb)).toBe(fb);
  });
});

describe('/mint on the testnet (1 HYPE, public, 3 per wallet)', { timeout: 30_000 }, () => {
  it('says the testnet price, not "one dollar"', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState() }));
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/1 HYPE on testnet/));
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/dollar/i);
    expect(document.querySelector('.mt-lede')!.textContent).toMatch(/Testnet mint: 1 HYPE/);
    expect(document.querySelector('.mt-lede')!.textContent).not.toMatch(/pinned to a dollar/);
    expect(screen.getByTestId('mt-mainnet-note').textContent).toMatch(/mainnet mint will be much cheaper/);
  });

  it('mainnet: the dollar story only while the price tracks a dollar', async () => {
    spies.fetchServerChain.mockResolvedValue(chainStatus({ chainId: 999, nftAddress: NFT }));
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(pubContract(), { chainId: 999, priceUsd: 1.02 }) }));
    const { unmount } = render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/One dollar/));
    unmount();
    restore();
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(pubContract(), { chainId: 999, priceUsd: 87.5 }) }));
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/1 HYPE\./));
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/dollar/i);
  });

  it('a session from another page without a connected wallet still offers Connect, then mints (no new signature)', async () => {
    // the owner's case: signed in by the arena flow, the wallet not reconnected on /mint
    useSession.setState({ session: { address: ALICE, token: 't', admin: true }, signing: false, error: null });
    const wallet = fakeProvider({ chainId: 99801, known: [99801] });
    const stopAnnounce = announceProvider(detail(wallet, 'MetaMask', 'io.metamask'));
    const prev = restore;
    restore = () => {
      stopAnnounce();
      prev();
    };
    const fetched = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) });
    const announced = restore;
    restore = () => {
      announced();
      fetched.restore();
    };
    spies.getMintState.mockResolvedValue(freshPub());
    spies.sendWalletCall.mockImplementation(minted([1n]));
    render(<Mint pollMs={0} />);
    const connectBtn = await screen.findByRole('button', { name: /Connect MetaMask/ });
    expect(screen.getByTestId('mt-connect').textContent).toMatch(/Signed in as/);
    fireEvent.click(connectBtn);
    const mintBtn = await screen.findByRole('button', { name: 'Mint 1 emblem' });
    await waitFor(() => expect((mintBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(mintBtn);
    await screen.findByTestId('mt-done');
    expect(wallet.calls.map((c) => c.method)).not.toContain('personal_sign');
    expect(spies.sendWalletCall.mock.calls[0][0]).toMatchObject({ functionName: 'mintPublic', args: [1n], value: 1_010_000_000_000_000_000n });
  });

  it('connected, not signed in: mints 3 with the 1 % buffer, and the emblems and Play show', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.getMintState.mockResolvedValue(freshPub());
    spies.client.getBalance.mockResolvedValue(4n * HYPE);
    spies.client.estimateGas.mockResolvedValue(120_000n);
    spies.sendWalletCall.mockImplementation(minted([1n, 2n, 3n]));
    render(<Mint pollMs={0} />);
    const more = await screen.findByRole('button', { name: 'One more' });
    fireEvent.click(more);
    fireEvent.click(more);
    const btn = screen.getByRole('button', { name: 'Mint 3 emblems' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByTestId('mt-done');
    expect(spies.sendWalletCall.mock.calls[0][0]).toMatchObject({ functionName: 'mintPublic', args: [3n], value: 3_030_000_000_000_000_000n });
    expect(spies.client.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ account: ALICE, to: NFT, value: 3_030_000_000_000_000_000n }));
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('src')?.replace(/^.*\/api/, '/api'))).toEqual(['/api/nft/1.svg', '/api/nft/2.svg', '/api/nft/3.svg']);
    expect(screen.getByRole('link', { name: 'Play' }).getAttribute('href')).toBe('/play');
  });

  it('a signed-in, connected wallet mints too', async () => {
    connect();
    useSession.setState({ session: { address: ALICE, token: 't', admin: false }, signing: false, error: null });
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false), 'GET /api/site/wl/me': null }));
    spies.getMintState.mockResolvedValue(freshPub());
    spies.sendWalletCall.mockImplementation(minted([7n]));
    render(<Mint pollMs={0} />);
    const btn = await screen.findByRole('button', { name: 'Mint 1 emblem' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByTestId('mt-done');
  });

  it('too little HYPE: says so and never opens the wallet', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.client.getBalance.mockResolvedValue(HYPE / 2n);
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId('mt-blocker').textContent).toMatch(/Not enough HYPE.*1\.01 HYPE.*0\.5 HYPE/));
    expect(screen.getByRole('link', { name: 'Get test HYPE' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Mint 1 emblem' }) as HTMLButtonElement).disabled).toBe(true);
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
  });

  it('limit reached: says so, the button stays off', async () => {
    connect();
    spies.getMintedBy.mockResolvedValue({ wl: 0, pub: 3 });
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId('mt-blocker').textContent).toMatch(/Limit reached.*Public limit is 3 per wallet \(minted 3\)/));
    expect((screen.getByRole('button', { name: 'Mint 1 emblem' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the dry run catches a contract refusal (sold out a moment ago) before the wallet', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.getMintState.mockResolvedValue(freshPub());
    spies.client.estimateGas.mockRejectedValue(revert('SoldOut'));
    render(<Mint pollMs={0} />);
    const btn = await screen.findByRole('button', { name: 'Mint 1 emblem' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect((await screen.findByTestId('mt-error')).textContent).toMatch(/Sold out: the last emblems went/);
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
  });

  it('a dry run that fails for another reason (RPC hiccup) does not block: the wallet decides', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.getMintState.mockResolvedValue(freshPub());
    spies.client.estimateGas.mockRejectedValue(new Error('fetch failed'));
    spies.sendWalletCall.mockImplementation(minted([1n]));
    render(<Mint pollMs={0} />);
    const btn = await screen.findByRole('button', { name: 'Mint 1 emblem' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByTestId('mt-done');
  });

  it('user rejected in the wallet: a clear message, and the button works again', async () => {
    connect();
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.getMintState.mockResolvedValue(freshPub());
    spies.sendWalletCall.mockResolvedValue({ ok: false, hash: null, error: { kind: 'rejected', name: 'UserRejectedRequestError', args: [], code: 4001, message: 'declined' } });
    render(<Mint pollMs={0} />);
    const btn = await screen.findByRole('button', { name: 'Mint 1 emblem' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect((await screen.findByTestId('mt-error')).textContent).toMatch(/cancelled in your wallet\. Nothing was minted/);
    expect((screen.getByRole('button', { name: 'Mint 1 emblem' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('the server chain did not answer at first: the button still works and asks again', async () => {
    connect();
    let n = 0;
    spies.fetchServerChain.mockImplementation(async (): Promise<ChainStatus | null> => (n++ === 0 ? null : chainStatus({ nftAddress: NFT })));
    ({ restore } = mockFetch({ 'GET /api/site/mint': testnetState(), [`GET /api/site/mint/proof?wallet=${ALICE}`]: proof(false) }));
    spies.getMintState.mockResolvedValue(freshPub());
    spies.sendWalletCall.mockImplementation(minted([1n]));
    render(<Mint pollMs={0} />);
    const btn = await screen.findByRole('button', { name: 'Mint 1 emblem' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    await screen.findByTestId('mt-done');
    expect(spies.sendWalletCall.mock.calls[0][1].chain).toMatchObject({ chainId: 99801 });
  });
});

describe('WalletSignIn with a session but no connected wallet (header, WL)', () => {
  it('offers to reconnect the wallet instead of only "Switch wallet", and needs no new signature', async () => {
    const { WalletSignIn } = await import('../src/site/wallet/SiteWallet');
    useSession.setState({ session: { address: ALICE, token: 't', admin: false }, signing: false, error: null });
    const wallet = fakeProvider({ chainId: 99801, known: [99801] });
    const stop = announceProvider(detail(wallet, 'Rabby', 'io.rabby'));
    try {
      render(<WalletSignIn label="Sign in" />);
      expect(screen.getByText('Signed in')).toBeTruthy();
      fireEvent.click(await screen.findByRole('button', { name: /Connect Rabby/ }));
      await waitFor(() => expect(useWallet.getState().address).toBe(ALICE));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Connect Rabby/ })).toBeNull());
      expect(screen.getByText('Signed in')).toBeTruthy();
      expect(wallet.calls.map((c) => c.method)).not.toContain('personal_sign');
      expect(useSession.getState().session?.address).toBe(ALICE);
    } finally {
      stop();
    }
  });
});

describe('/mint loads fast: skeleton, kept state, early start, timeouts', { timeout: 30_000 }, () => {
  afterEach(() => resetMintState());

  it('shows the skeleton card at once while nothing is known', () => {
    let release: (v: unknown) => void = () => {};
    ({ restore } = mockFetch({ 'GET /api/site/mint': () => new Promise((r) => (release = r)) }));
    render(<Mint pollMs={0} />);
    expect(screen.getByTestId('mt-phase').textContent).toBe('Loading');
    expect(document.querySelector('.mt-page[data-loading]')).toBeTruthy();
    expect(document.querySelector('.mt-page[data-view]')).toBeNull();
    release(mintState(contract({ phase: 'closed' })));
  });

  it('paints the kept state at once (marked stale), then the fresh answer replaces and is kept', async () => {
    writeCachedMint(mintState(contract({ phase: 'closed' })), Date.now() - 60_000);
    ({ restore } = mockFetch({ 'GET /api/site/mint': mintState(contract({ phase: 'public' })) }));
    render(<Mint pollMs={0} />);
    // first render, before any answer: the real card from the kept state
    expect(screen.getByTestId('mt-phase').textContent).toBe('Closed');
    expect(document.querySelector('.mt-page[data-stale]')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('mt-phase').textContent).toBe('Public'));
    expect(document.querySelector('.mt-page[data-stale]')).toBeNull();
    expect(readCachedMint()?.state.contract?.phase).toBe('public');
  });

  it('ignores a kept state that is unreadable or too old', () => {
    localStorage.setItem('elymum.mint-state.v1', '{not json');
    expect(readCachedMint()).toBeNull();
    writeCachedMint(mintState(contract()), Date.now() - 10 * 24 * 3600_000);
    expect(readCachedMint()).toBeNull();
  });

  it('a kept state survives a server that does not answer (no error screen)', async () => {
    writeCachedMint(mintState(contract({ phase: 'closed' })));
    ({ restore } = mockFetch({ 'GET /api/site/mint': () => new Response('{}', { status: 503 }) }));
    render(<Mint pollMs={0} />);
    expect(screen.getByTestId('mt-phase').textContent).toBe('Closed');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('The mint is not answering.')).toBeNull();
  });

  it('times out a hung request and retries', async () => {
    let n = 0;
    ({ restore } = mockFetch({
      'GET /api/site/mint': () => {
        n++;
        // the first try hangs (the server waiting on a slow RPC); the second answers
        return n === 1 ? new Promise(() => {}) : mintState(contract({ phase: 'public' }));
      },
    }));
    const s = await fetchMintState({ timeoutMs: 30, backoff: () => 0 });
    expect(s.contract?.phase).toBe('public');
    expect(n).toBe(2);
  });

  it('gives up after the retries with a plain message', async () => {
    ({ restore } = mockFetch({ 'GET /api/site/mint': () => new Promise(() => {}) }));
    await expect(fetchMintState({ timeoutMs: 20, retries: 1, backoff: () => 0 })).rejects.toThrow(/taking too long/);
  });

  it('the page takes the request the site entry started early', async () => {
    const fetched = mockFetch({ 'GET /api/site/mint': mintState(contract({ phase: 'closed' })) });
    restore = fetched.restore;
    prefetchMintState();
    render(<Mint pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId('mt-phase').textContent).toBe('Closed'));
    expect(fetched.calls.filter((c) => c.path === '/api/site/mint')).toHaveLength(1);
    expect(takeEarlyMint()).toBeNull();
  });
});

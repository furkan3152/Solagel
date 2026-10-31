import { addEthereumChainParams, chainInfo } from '@elymum/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { announceProvider, discoverProviders, mergeProviders, type ProviderDetail } from '../src/wallet/eip6963';
import { ensureChain, publicClientFor, serverChainInfo, WrongChainError } from '../src/wallet/network';
import { LAST_WALLET_KEY, connectWallet, disconnectWallet, firstAccount, initWallets, parseChainId, resetWallets, takeUserConnect, useWallet } from '../src/wallet/store';
import { ALICE, BOB, chainStatus, detail, fakeProvider } from './evm-helpers';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetWallets();
  localStorage.clear();
  delete (window as { ethereum?: unknown }).ethereum;
});
afterEach(() => {
  resetWallets();
  delete (window as { ethereum?: unknown }).ethereum;
});

describe('EIP-6963 discovery', () => {
  it('lists announced wallets once each and asks them to announce', () => {
    const a = detail(fakeProvider(), 'Rabby', 'io.rabby');
    const stopA = announceProvider(a);
    let list: ProviderDetail[] = [];
    const stop = discoverProviders((l) => (list = l));
    // announced before discovery started: the request event makes it announce again
    expect(list.map((d) => d.info.name)).toEqual(['Rabby']);
    // a re-announcement (same uuid) does not duplicate it
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    expect(list).toHaveLength(1);
    const b = detail(fakeProvider(), 'MetaMask', 'io.metamask');
    const stopB = announceProvider(b);
    expect(list.map((d) => d.info.rdns)).toEqual(['io.rabby', 'io.metamask']);
    stop();
    stopA();
    stopB();
  });

  it('ignores malformed announcements', () => {
    let list: ProviderDetail[] = [];
    const stop = discoverProviders((l) => (list = l));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'x' }, provider: {} } }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: null }));
    expect(list).toEqual([]);
    stop();
  });

  it('falls back to window.ethereum unless an announced wallet is that same provider', () => {
    const eth = Object.assign(fakeProvider(), { isMetaMask: true });
    (window as { ethereum?: unknown }).ethereum = eth;
    let list: ProviderDetail[] = [];
    const stop = discoverProviders((l) => (list = l));
    expect(list.map((d) => [d.info.name, d.info.rdns])).toEqual([['MetaMask', 'injected']]);
    // MetaMask announces itself: the fallback entry goes away
    const stopA = announceProvider(detail(eth, 'MetaMask', 'io.metamask'));
    expect(list.map((d) => d.info.rdns)).toEqual(['io.metamask']);
    stop();
    stopA();
    expect(mergeProviders([], null)).toEqual([]);
  });
});

describe('the wallet store', () => {
  it('connects (eth_requestAccounts), checksums the account and reads the chain', async () => {
    const p = fakeProvider({ accounts: [ALICE.toLowerCase() as `0x${string}`], chainId: 99801, known: [99801] });
    const d = detail(p);
    expect(await connectWallet(d)).toBe(ALICE);
    const s = useWallet.getState();
    expect(s).toMatchObject({ status: 'connected', address: ALICE, chainId: 99801 });
    expect(p.calls[0].method).toBe('eth_requestAccounts');
    expect(localStorage.getItem(LAST_WALLET_KEY)).toBe('test.wallet');
    // a user-initiated connect may ask for the game sign-in once
    expect(takeUserConnect()).toBe(true);
    expect(takeUserConnect()).toBe(false);
  });

  it('follows accountsChanged and chainChanged, and disconnects on an empty account list', async () => {
    const p = fakeProvider({ chainId: 1 });
    await connectWallet(detail(p));
    p.emit('accountsChanged', [BOB.toLowerCase()]);
    expect(useWallet.getState().address).toBe(BOB);
    p.emit('chainChanged', '0x185d9');
    expect(useWallet.getState().chainId).toBe(99801);
    p.emit('accountsChanged', []);
    expect(useWallet.getState()).toMatchObject({ status: 'disconnected', address: null });
    expect(localStorage.getItem(LAST_WALLET_KEY)).toBeNull();
  });

  it('treats a declined prompt as no connection, without an error banner', async () => {
    const p = fakeProvider();
    p.handlers.eth_requestAccounts = () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    };
    expect(await connectWallet(detail(p))).toBeNull();
    expect(useWallet.getState()).toMatchObject({ status: 'disconnected', error: null });
  });

  it('reconnects silently (eth_accounts) to the wallet used last time', async () => {
    localStorage.setItem(LAST_WALLET_KEY, 'io.rabby');
    const p = fakeProvider({ chainId: 99801 });
    const stop = announceProvider(detail(p, 'Rabby', 'io.rabby'));
    initWallets();
    await flush();
    await flush();
    expect(p.calls.map((c) => c.method)).toContain('eth_accounts');
    expect(p.calls.map((c) => c.method)).not.toContain('eth_requestAccounts');
    expect(useWallet.getState().address).toBe(ALICE);
    expect(takeUserConnect()).toBe(false);
    stop();
  });

  it('disconnect forgets the wallet and asks it to revoke the permission', async () => {
    const p = fakeProvider();
    await connectWallet(detail(p));
    disconnectWallet();
    expect(useWallet.getState().status).toBe('disconnected');
    expect(p.calls.at(-1)?.method).toBe('wallet_revokePermissions');
  });

  it('parses chain ids and accounts defensively', () => {
    expect(parseChainId('0x7a69')).toBe(31337);
    expect(parseChainId('99801')).toBe(99801);
    expect(parseChainId(5)).toBe(5);
    expect(parseChainId('0x')).toBeNull();
    expect(parseChainId(-1)).toBeNull();
    expect(firstAccount(['nope'])).toBeNull();
    expect(firstAccount([])).toBeNull();
  });
});

describe('ensureChain: exactly the chain the server says', () => {
  const chain = chainStatus();

  it('does nothing when the wallet is already there', async () => {
    const p = fakeProvider({ chainId: 99801, known: [99801] });
    await ensureChain(p, chain);
    expect(p.calls.map((c) => c.method)).toEqual(['eth_chainId']);
  });

  it('switches with wallet_switchEthereumChain', async () => {
    const p = fakeProvider({ chainId: 1, known: [1, 99801] });
    await ensureChain(p, chain);
    expect(p.chainId).toBe(99801);
    expect(p.calls.find((c) => c.method === 'wallet_switchEthereumChain')?.params).toEqual([{ chainId: '0x185d9' }]);
  });

  it('adds the chain on 4902 with the server RPC and explorer, then switches', async () => {
    const p = fakeProvider({ chainId: 1, known: [1] });
    await ensureChain(p, chain);
    const add = p.calls.find((c) => c.method === 'wallet_addEthereumChain');
    expect(add?.params).toEqual([addEthereumChainParams(chainInfo(99801, { name: 'Elysium Testnet', rpcUrl: chain.rpcUrl, explorerUrl: chain.explorerUrl }))]);
    expect((add?.params as { nativeCurrency: { symbol: string } }[])[0].nativeCurrency.symbol).toBe('HYPE');
    expect(p.calls.filter((c) => c.method === 'wallet_switchEthereumChain')).toHaveLength(2);
    expect(p.chainId).toBe(99801);
  });

  it('cannot add a chain without a public RPC, and passes a decline through', async () => {
    const p = fakeProvider({ chainId: 1, known: [1] });
    await expect(ensureChain(p, chainStatus({ chainId: 777, rpcUrl: null, chainName: 'Elysium' }))).rejects.toBeInstanceOf(WrongChainError);
    const q = fakeProvider({ chainId: 1, known: [1, 99801] });
    q.handlers.wallet_switchEthereumChain = () => {
      throw Object.assign(new Error('User rejected'), { code: 4001 });
    };
    await expect(ensureChain(q, chain)).rejects.toMatchObject({ code: 4001 });
    expect(q.calls.some((c) => c.method === 'wallet_addEthereumChain')).toBe(false);
  });

  it('refuses when the wallet still ends on another chain, or the server has none', async () => {
    const p = fakeProvider({ chainId: 1, known: [1, 99801] });
    p.handlers.wallet_switchEthereumChain = () => null;
    await expect(ensureChain(p, chain)).rejects.toBeInstanceOf(WrongChainError);
    await expect(ensureChain(p, chainStatus({ chainId: null }))).rejects.toBeInstanceOf(WrongChainError);
  });

  it('reads through the server public RPC, else the wallet provider', () => {
    expect(serverChainInfo(chain)?.name).toBe('Elysium Testnet');
    expect(publicClientFor(chain)?.chain?.id).toBe(99801);
    expect(publicClientFor(chainStatus({ rpcUrl: null }))).toBeNull();
    expect(publicClientFor(chainStatus({ rpcUrl: null }), fakeProvider())?.chain?.id).toBe(99801);
  });
});

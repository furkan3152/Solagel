import { setFeeBpsCall } from '@elymum/sdk';
import type { StatusSnapshot } from '@elymum/sdk/ops';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPanel } from '../src/admin/AdminPanel';
import { DeployTab } from '../src/admin/DeployTab';
import { MintTab } from '../src/admin/MintTab';
import { resolveNetwork } from '../src/admin/net';
import type { Plan } from '../src/admin/plan';
import { TxPreview } from '../src/admin/TxPreview';
import type { ChainCtx } from '../src/admin/ui';
import { Kb } from '../src/design';
import type { AdminApi } from '../src/site/api';
import { resetWallets, useWallet } from '../src/wallet/store';
import { ALICE, BOB, chainStatus, detail, fakeProvider, type FakeProvider } from './evm-helpers';

const ARENA = '0x00000000000000000000000000000000000a4e4a';
const NFT = '0x0000000000000000000000000000000000000f7e';
const NEW = '0x00000000000000000000000000000000000ae1e0';
const HASH = `0x${'cd'.repeat(32)}`;

let provider: FakeProvider;
beforeEach(() => {
  resetWallets();
  localStorage.clear();
  provider = fakeProvider({ chainId: 99801, known: [99801] });
  provider.handlers.eth_sendTransaction = () => HASH;
  useWallet.setState({ status: 'connected', address: ALICE, chainId: 99801, current: detail(provider) });
});
afterEach(() => act(() => resetWallets()));

const ui = (node: ReactElement) => render(<Kb>{node}</Kb>);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
/** A read client: the receipt and `owner()`. */
const client = (owner = ALICE) =>
  ({
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', contractAddress: NEW, logs: [] })),
    readContract: vi.fn(async () => owner),
  }) as never;

describe('TxPreview: every write is previewed, checked and sent once', () => {
  const plan = (extra: Partial<Plan> = {}): Plan => ({ title: 'Set the fee', contract: 'ElymumArena', call: setFeeBpsCall(ARENA, 300), ownerOf: ARENA, owner: ALICE, ...extra });

  it('shows the function, the named arguments, the network and the signer before the wallet opens', () => {
    ui(<TxPreview plan={plan()} net={resolveNetwork(chainStatus())} me={ALICE} client={client()} blockers={[]} onClose={() => {}} />);
    const box = screen.getByTestId('tx-preview');
    expect(box.textContent).toContain('setFeeBps(uint16)');
    expect(within(box).getByText('bps')).toBeTruthy();
    expect(within(box).getByText('uint16')).toBeTruthy();
    expect(within(box).getByText('300')).toBeTruthy();
    expect(box.textContent).toContain('Elysium Testnet (99801)');
    expect(box.textContent).toContain(ALICE);
    expect(provider.calls.some((c) => c.method === 'eth_sendTransaction')).toBe(false);
    expect(screen.queryByText(/MAINNET/)).toBeNull();
  });

  it('refuses before the wallet: chain blockers and a signer that is not the owner', () => {
    const view = ui(<TxPreview plan={plan()} net={resolveNetwork(chainStatus())} me={ALICE} client={client()} blockers={['The RPC is on another chain.']} onClose={() => {}} />);
    expect((screen.getByTestId('tx-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('tx-refusals').textContent).toContain('another chain');
    view.unmount();
    ui(<TxPreview plan={plan({ owner: BOB })} net={resolveNetwork(chainStatus())} me={ALICE} client={client()} blockers={[]} onClose={() => {}} />);
    expect((screen.getByTestId('tx-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('tx-refusals').textContent).toMatch(/Owner check/);
  });

  it('re-reads the owner right before signing and refuses a changed owner', async () => {
    ui(<TxPreview plan={plan()} net={resolveNetwork(chainStatus())} me={ALICE} client={client(BOB)} blockers={[]} onClose={() => {}} />);
    act(() => screen.getByTestId('tx-confirm').click());
    await settle();
    expect(screen.getByTestId('tx-error').textContent).toMatch(/Owner check/);
    expect(provider.calls.some((c) => c.method === 'eth_sendTransaction')).toBe(false);
  });

  it('a double click sends once; the receipt runs onDone and shows the result', async () => {
    const onDone = vi.fn();
    const onSigned = vi.fn();
    ui(<TxPreview plan={plan({ onDone })} net={resolveNetwork(chainStatus())} me={ALICE} client={client()} blockers={[]} onClose={() => {}} onSigned={onSigned} />);
    const btn = screen.getByTestId('tx-confirm');
    act(() => {
      btn.click();
      btn.click();
      btn.click();
    });
    await settle();
    expect(provider.calls.filter((c) => c.method === 'eth_sendTransaction')).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('tx-done')).toBeTruthy());
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH }));
    expect(onSigned).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH, url: `https://explorer-elysium-testnet.t.conduit.xyz/tx/${HASH}` }));
  });

  it('a receipt timeout after the broadcast offers "Check status" on that hash, never a resend', async () => {
    const onDone = vi.fn();
    let receiptCalls = 0;
    const read = {
      waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => {
        receiptCalls++;
        expect(hash).toBe(HASH);
        if (receiptCalls <= 2) throw new Error('Timed out while waiting for transaction with hash');
        return { status: 'success', contractAddress: NEW, logs: [] };
      }),
      readContract: vi.fn(async () => ALICE),
    } as never;
    ui(<TxPreview plan={plan({ onDone })} net={resolveNetwork(chainStatus())} me={ALICE} client={read} blockers={[]} onClose={() => {}} />);
    act(() => screen.getByTestId('tx-confirm').click());
    await settle();
    await waitFor(() => expect(screen.getByTestId('tx-error')).toBeTruthy());
    // broadcast: no "Try again" (it would send a second transaction), only the status check
    expect(screen.queryByTestId('tx-confirm')).toBeNull();
    expect(screen.getByTestId('tx-check').textContent).toContain('Check status');
    expect(screen.getByTestId('tx-error').textContent).toMatch(/It was sent/);
    // still nothing: the check can be repeated
    act(() => screen.getByTestId('tx-check').click());
    await settle();
    await waitFor(() => expect(screen.getByTestId('tx-error').textContent).toMatch(/Still no receipt/));
    expect(screen.queryByTestId('tx-confirm')).toBeNull();
    act(() => screen.getByTestId('tx-check').click());
    await waitFor(() => expect(screen.getByTestId('tx-done')).toBeTruthy());
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH }));
    expect(provider.calls.filter((c) => c.method === 'eth_sendTransaction')).toHaveLength(1);
  });

  it('"Try again" (a new send) only when nothing was broadcast', async () => {
    provider.handlers.eth_sendTransaction = () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    };
    ui(<TxPreview plan={plan()} net={resolveNetwork(chainStatus())} me={ALICE} client={client()} blockers={[]} onClose={() => {}} />);
    act(() => screen.getByTestId('tx-confirm').click());
    await settle();
    await waitFor(() => expect(screen.getByTestId('tx-error')).toBeTruthy());
    expect(screen.getByTestId('tx-confirm').textContent).toContain('Try again');
    expect(screen.queryByTestId('tx-check')).toBeNull();
  });

  it('switches (or adds) the server chain before the prompt', async () => {
    provider.chainId = 1;
    provider.known = new Set([1]);
    ui(<TxPreview plan={plan()} net={resolveNetwork(chainStatus())} me={ALICE} client={client()} blockers={[]} onClose={() => {}} />);
    act(() => screen.getByTestId('tx-confirm').click());
    await settle();
    const methods = provider.calls.map((c) => c.method);
    expect(methods.indexOf('wallet_addEthereumChain')).toBeGreaterThan(-1);
    expect(methods.indexOf('wallet_addEthereumChain')).toBeLessThan(methods.indexOf('eth_sendTransaction'));
  });

  it('irreversible actions need the typed confirmation; mainnet shows the red banner', () => {
    ui(<TxPreview plan={plan({ confirmText: 'FREEZE' })} net={resolveNetwork(chainStatus({ chainId: 4242, chainName: 'Elysium', rpcUrl: null }))} me={ALICE} client={client()} blockers={[]} onClose={() => {}} />);
    expect(screen.getByText('MAINNET.')).toBeTruthy();
    expect((screen.getByTestId('tx-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type FREEZE to confirm/), { target: { value: 'FREEZE' } });
    expect((screen.getByTestId('tx-confirm') as HTMLButtonElement).disabled).toBe(false);
  });
});

/** A chain tab context with a plan recorder. */
function ctxOf(over: Partial<ChainCtx> = {}): ChainCtx & { plans: Plan[] } {
  const plans: Plan[] = [];
  return {
    net: resolveNetwork(chainStatus({ arenaAddress: null })),
    status: null,
    refresh: vi.fn(async () => {}),
    reloadNet: vi.fn(async () => {}),
    me: ALICE,
    walletChainId: 99801,
    client: null,
    api: null,
    open: (p: Plan) => plans.push(p),
    plans,
    ...over,
  };
}

describe('Deploy wizard', () => {
  it('connect → chain: offers the switch while the wallet is elsewhere', () => {
    const view = ui(<DeployTab ctx={ctxOf({ me: null })} />);
    expect(screen.getByTestId('deploy-steps').querySelector('[data-step="connect"]')?.getAttribute('data-state')).toBe('active');
    view.unmount();
    ui(<DeployTab ctx={ctxOf({ walletChainId: 1 })} />);
    expect(screen.getByTestId('deploy-switch').textContent).toBe('Switch to Elysium Testnet');
  });

  it('deploys the arena with admin = you, server authority = the server key, fee wallet = you, then registers it', async () => {
    const registerContract = vi.fn(async () => ({ arena: null, nft: null, token: null }));
    const ctx = ctxOf({ api: { registerContract, mintPrice: vi.fn(async () => ({ priceWei: null })) } as unknown as AdminApi });
    ui(<DeployTab ctx={ctx} />);
    act(() => screen.getByTestId('deploy-arena').click());
    expect(ctx.plans).toHaveLength(1);
    const p = ctx.plans[0];
    expect(p.deploy?.name).toBe('ElymumArena');
    expect(p.deploy?.params.args).toEqual([ALICE, '0x000000000000000000000000000000000000bEEF', ALICE]);
    await p.onDone!({ hash: HASH as `0x${string}`, receipt: {} as never, address: NEW as `0x${string}` });
    expect(registerContract).toHaveBeenCalledWith({ kind: 'arena', address: NEW, txHash: HASH });
    expect(ctx.reloadNet).toHaveBeenCalled();
  });

  it('then the NFT with the spec defaults and the $1 price from the server', async () => {
    const registerContract = vi.fn(async () => ({ arena: null, nft: null, token: null }));
    const api = { registerContract, mintPrice: vi.fn(async () => ({ hypeUsd: 33.3, targetUsdCents: 100, priceWei: '30000000000000000', fetchedAt: 1 })) } as unknown as AdminApi;
    const ctx = ctxOf({ api, net: resolveNetwork(chainStatus({ arenaAddress: ARENA })), status: { arena: { code: 'ok', config: { token: null }, arenas: [] }, nft: null } as unknown as StatusSnapshot });
    ui(<DeployTab ctx={ctx} />);
    await waitFor(() => expect((screen.getByLabelText(/Mint price/) as HTMLInputElement).value).toBe('0.03'));
    expect((screen.getByLabelText('Max supply') as HTMLInputElement).value).toBe('5000');
    expect((screen.getByLabelText(/Base URI/) as HTMLInputElement).value).toBe(`${location.origin}/api/nft/`);
    act(() => screen.getByTestId('deploy-nft').click());
    const p = ctx.plans[0];
    expect(p.deploy?.name).toBe('ElymumNFT');
    expect(p.deploy?.params.args).toEqual([ALICE, 5000, 30_000_000_000_000_000n, 1, 2, `${location.origin}/api/nft/`, ALICE]);
    await p.onDone!({ hash: HASH as `0x${string}`, receipt: {} as never, address: NFT as `0x${string}` });
    expect(registerContract).toHaveBeenCalledWith({ kind: 'nft', address: NFT, txHash: HASH });
  });

  it('sets the token only when typed twice the same, then creates the default arenas one by one', async () => {
    const net = resolveNetwork(chainStatus({ arenaAddress: ARENA, nftAddress: NFT }));
    const cfg = { admin: ALICE, token: null, decimals: 18 };
    const getCode = vi.fn(async () => '0x6080');
    const ctx = ctxOf({ net, client: { getCode } as never, status: { arena: { code: 'ok', config: cfg, arenas: [] }, nft: { code: 'ok' } } as unknown as StatusSnapshot });
    const view = ui(<DeployTab ctx={ctx} />);
    fireEvent.change(screen.getByLabelText('Token address'), { target: { value: BOB } });
    fireEvent.change(screen.getByLabelText('Token address (again)'), { target: { value: ALICE } });
    act(() => screen.getByTestId('set-token').click());
    await settle();
    expect(ctx.plans).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toMatch(/the two addresses differ/);
    fireEvent.change(screen.getByLabelText('Token address (again)'), { target: { value: BOB.toLowerCase() } });
    act(() => screen.getByTestId('set-token').click());
    await settle();
    expect(ctx.plans[0].call).toMatchObject({ functionName: 'setToken', args: [BOB] });
    expect(ctx.plans[0].ownerOf?.toLowerCase()).toBe(ARENA.toLowerCase());
    view.unmount();
    const withToken = ctxOf({ net, status: { arena: { code: 'ok', config: { ...cfg, token: BOB }, arenas: [{ id: 1, exists: true }] }, nft: { code: 'ok' } } as unknown as StatusSnapshot });
    ui(<DeployTab ctx={withToken} />);
    act(() => screen.getByTestId('create-arena').click());
    expect(withToken.plans[0].call).toMatchObject({ functionName: 'createArena', args: [2, 10_000n * 10n ** 18n, 300] });
  });

  it('offers the TestToken and its faucet off mainnet only', () => {
    const view = ui(<DeployTab ctx={ctxOf()} />);
    expect(screen.getByTestId('deploy-test-token')).toBeTruthy();
    view.unmount();
    ui(<DeployTab ctx={ctxOf({ net: resolveNetwork(chainStatus({ chainId: 4242, chainName: 'Elysium', arenaAddress: null })) })} />);
    expect(screen.queryByTestId('deploy-test-token')).toBeNull();
  });
});

describe('Mint tab', () => {
  const state = { phase: 0, phaseName: 'closed', price: 30_000_000_000_000_000n, minPrice: 0n, maxPrice: 0n, keeper: null, root: `0x${'0'.repeat(64)}`, maxSupply: 5000, totalSupply: 0, wlLimit: 1, publicLimit: 2, treasury: ALICE, frozen: false, soldOut: false };
  const mintCtx = (api: Partial<AdminApi>) =>
    ctxOf({
      api: { allowlist: vi.fn(async () => ({ snapshot: null, diff: { added: [], removed: [] }, onchainRoot: null, published: false })), mintPrice: vi.fn(async () => ({ hypeUsd: 33.3, targetUsdCents: 100, priceWei: '30000000000000000', fetchedAt: 1 })), ...api } as unknown as AdminApi,
      net: resolveNetwork(chainStatus({ arenaAddress: ARENA, nftAddress: NFT })),
      status: { nft: { address: NFT, code: 'ok', balance: 0n, state } } as unknown as StatusSnapshot,
    });

  it('"Open mint" with "activate the game for holders" (checked) also saves gameAccess = holders', async () => {
    const saveSettings = vi.fn(async () => ({ settings: {} }));
    const ctx = mintCtx({ saveSettings } as never);
    ui(<MintTab ctx={ctx} />);
    expect((within(screen.getByTestId('mint-activate')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    act(() => screen.getByTestId('mint-set-phase').click());
    const p = ctx.plans[0];
    expect(p.title).toBe('Open the mint (allowlist)');
    expect(p.call).toMatchObject({ functionName: 'setPhase', args: [1] });
    expect(p.ownerOf?.toLowerCase()).toBe(NFT.toLowerCase());
    await p.onDone!({ hash: HASH as `0x${string}`, receipt: {} as never, address: null });
    expect(saveSettings).toHaveBeenCalledWith({ gameAccess: 'holders' });
  });

  it('unchecking it leaves the game access alone', async () => {
    const saveSettings = vi.fn();
    const ctx = mintCtx({ saveSettings } as never);
    ui(<MintTab ctx={ctx} />);
    fireEvent.click(within(screen.getByTestId('mint-activate')).getByRole('checkbox'));
    act(() => screen.getByTestId('mint-set-phase').click());
    await ctx.plans[0].onDone!({ hash: HASH as `0x${string}`, receipt: {} as never, address: null });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('builds the allowlist on the server, then publishes its root with setMerkleRoot', async () => {
    const root = `0x${'ab'.repeat(32)}`;
    const allowlist = vi.fn(async () => ({ snapshot: { root, count: 3, wallets: [], builtAt: 1, builtBy: ALICE, sources: { wl: 2, collab: 1 } }, diff: { added: [], removed: [] }, onchainRoot: null, published: false }));
    const buildAllowlist = vi.fn(async () => ({ root, count: 3 }));
    const ctx = mintCtx({ allowlist, buildAllowlist } as never);
    ui(<MintTab ctx={ctx} />);
    expect((await screen.findByTestId('allowlist-warnings')).textContent).toMatch(/not the root on the contract/);
    act(() => screen.getByTestId('allowlist-build').click());
    await settle();
    expect(buildAllowlist).toHaveBeenCalled();
    act(() => screen.getByTestId('allowlist-publish').click());
    expect(ctx.plans[0].call).toMatchObject({ functionName: 'setMerkleRoot', args: [root] });
  });

  it('syncs the price to $1 and makes the server key the keeper', async () => {
    const ctx = mintCtx({});
    ui(<MintTab ctx={ctx} />);
    await waitFor(() => expect((screen.getByTestId('mint-sync-price') as HTMLButtonElement).disabled).toBe(false));
    act(() => screen.getByTestId('mint-sync-price').click());
    expect(ctx.plans[0].call).toMatchObject({ functionName: 'setPrice', args: [30_000_000_000_000_000n] });
    act(() => screen.getByTestId('mint-keeper').click());
    expect(ctx.plans[1].call).toMatchObject({ functionName: 'setPriceKeeper', args: ['0x000000000000000000000000000000000000bEEF'] });
    act(() => screen.getByTestId('mint-freeze').click());
    expect(ctx.plans[2]).toMatchObject({ confirmText: 'FREEZE' });
  });
});

describe('the chain panel', () => {
  it('shows the red MAINNET banner on mainnet and blocks signing without a server chain', () => {
    const view = ui(<AdminPanel net={resolveNetwork(chainStatus({ chainId: 4242, chainName: 'Elysium', rpcUrl: null, arenaAddress: null }))} api={null} tab="launch" go={() => {}} reloadNet={async () => {}} />);
    expect(screen.getByTestId('mainnet-banner')).toBeTruthy();
    view.unmount();
    ui(<AdminPanel net={resolveNetwork(null)} api={null} tab="launch" go={() => {}} reloadNet={async () => {}} />);
    expect(screen.getByText('SIGNING BLOCKED.')).toBeTruthy();
    expect(screen.queryByTestId('mainnet-banner')).toBeNull();
  });
});

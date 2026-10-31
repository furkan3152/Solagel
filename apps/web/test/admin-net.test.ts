import { createArenaCall, deployArenaParams, setFeeBpsCall } from '@elymum/sdk';
import type { StatusSnapshot } from '@elymum/sdk/ops';
import { describe, expect, it } from 'vitest';
import { activeStep, arenaDeployArgs, defaultNftForm, deploySteps, loadLocalDeploys, nftDeployArgs, saveLocalDeploy } from '../src/admin/deploy';
import { launchChecklist } from '../src/admin/LaunchTab';
import { allowlistWarnings } from '../src/admin/MintTab';
import { chainBlockers, resolveNetwork, walletChainNote } from '../src/admin/net';
import { planRefusals, previewOf } from '../src/admin/plan';
import { DEV_FAKE_ARENA_ADDRESS } from '../src/wallet/devFakeLoader';
import { ALICE, BOB, ONE, chainStatus } from './evm-helpers';

const ARENA = '0x00000000000000000000000000000000000A4E4A';
const NFT = '0x0000000000000000000000000000000000000F7E';

describe('admin network: exactly the server chain (no pinned program id)', () => {
  it('resolves the server chain, the registered contracts and mainnet', () => {
    const net = resolveNetwork(chainStatus({ nftAddress: NFT.toLowerCase() }));
    expect(net.info).toMatchObject({ id: 99801, name: 'Elysium Testnet' });
    expect(net.mainnet).toBe(false);
    expect(net.arenaAddress?.toLowerCase()).toBe(chainStatus().arenaAddress);
    expect(net.nftAddress?.toLowerCase()).toBe(NFT.toLowerCase());
    expect(net.serverKey).toMatch(/^0x/);
    expect(resolveNetwork(chainStatus({ chainId: 4242, chainName: 'Elysium', rpcUrl: null })).mainnet).toBe(true);
    expect(resolveNetwork(null)).toMatchObject({ chain: null, info: null, mainnet: false, arenaAddress: null });
    expect(resolveNetwork(chainStatus({ arenaAddress: DEV_FAKE_ARENA_ADDRESS })).fake).toBe(true);
  });

  it('blocks signing when the server is unreachable, has no chain, or the RPC disagrees', () => {
    expect(chainBlockers(resolveNetwork(null), null)[0]).toMatch(/cannot be reached/);
    expect(chainBlockers(resolveNetwork(chainStatus({ enabled: false, chainId: null })), null)[0]).toMatch(/no chain/);
    expect(chainBlockers(resolveNetwork(chainStatus()), 99801)).toEqual([]);
    expect(chainBlockers(resolveNetwork(chainStatus()), 1)[0]).toMatch(/RPC this panel reads is on chain 1/);
    expect(chainBlockers(resolveNetwork(chainStatus({ arenaAddress: DEV_FAKE_ARENA_ADDRESS })), 99801)[0]).toMatch(/DEV_FAKE_CHAIN/);
  });

  it('a wallet on another chain is a note (it is switched before it signs), not a blocker', () => {
    const net = resolveNetwork(chainStatus());
    expect(walletChainNote(net, 99801)).toBeNull();
    expect(walletChainNote(net, 1)).toMatch(/switch to Elysium Testnet \(99801\)/);
  });
});

const status = (o: { arenaCode?: 'ok' | 'missing' | 'mismatch'; token?: string | null; arenas?: number[]; nft?: boolean; phase?: 'closed' | 'allowlist'; root?: string; serverBalance?: bigint } = {}): StatusSnapshot =>
  ({
    chain: { id: 99801 },
    mainnet: false,
    block: 1n,
    account: null,
    arena: {
      address: ARENA,
      code: o.arenaCode ?? 'ok',
      config: { admin: ALICE, pendingAdmin: null, serverAuthority: '0x000000000000000000000000000000000000bEEF', feeWallet: ALICE, token: o.token === undefined ? null : o.token, decimals: 18, feeBps: 500, paused: false, totals: {} },
      token: null,
      arenas: (o.arenas ?? []).map((id) => ({ id, exists: true, entryFee: ONE, enabled: true, openSessions: 0, maxSessions: 300 })),
      serverBalance: o.serverBalance ?? 10n ** 17n,
    },
    nft: o.nft
      ? { address: NFT, code: 'ok', balance: 0n, state: { phaseName: o.phase ?? 'closed', price: 30_000_000_000_000_000n, root: o.root ?? `0x${'0'.repeat(64)}`, soldOut: false } }
      : null,
  }) as unknown as StatusSnapshot;

describe('the deploy wizard steps', () => {
  const base = { me: ALICE, walletChainId: 99801, local: {} };
  it('walks connect → chain → arena → nft → register → token → arenas', () => {
    const none = resolveNetwork(chainStatus({ arenaAddress: null }));
    expect(activeStep(deploySteps({ ...base, me: null, net: none, status: null }))).toBe('connect');
    expect(activeStep(deploySteps({ ...base, walletChainId: 1, net: none, status: null }))).toBe('chain');
    expect(activeStep(deploySteps({ ...base, net: none, status: null }))).toBe('arena');
    // the arena deployed from this browser (not registered yet): the NFT is next
    expect(activeStep(deploySteps({ ...base, net: none, status: null, local: { arena: { address: ARENA, txHash: null } } }))).toBe('nft');
    expect(activeStep(deploySteps({ ...base, net: none, status: null, local: { arena: { address: ARENA, txHash: null }, nft: { address: NFT, txHash: null } } }))).toBe('register');
    const both = resolveNetwork(chainStatus({ arenaAddress: ARENA, nftAddress: NFT }));
    expect(activeStep(deploySteps({ ...base, net: both, status: status({ nft: true }) }))).toBe('token');
    expect(activeStep(deploySteps({ ...base, net: both, status: status({ nft: true, token: BOB, arenas: [1, 2] }) }))).toBe('arenas');
    const done = deploySteps({ ...base, net: both, status: status({ nft: true, token: BOB, arenas: [1, 2, 3, 4] }) });
    expect(activeStep(done)).toBeNull();
    expect(done.every((s) => s.state === 'done')).toBe(true);
  });

  it('a registered arena whose code does not match is not done', () => {
    const net = resolveNetwork(chainStatus({ arenaAddress: ARENA }));
    expect(activeStep(deploySteps({ ...base, net, status: status({ arenaCode: 'mismatch' }) }))).toBe('arena');
  });

  it('arena args: admin = fee wallet = the connected wallet, server authority = the server key', () => {
    const args = arenaDeployArgs(ALICE, '0x000000000000000000000000000000000000beef');
    expect(args).toEqual({ admin: ALICE, serverAuthority: '0x000000000000000000000000000000000000bEEF', feeWallet: ALICE });
    expect(deployArenaParams(args).args).toEqual([ALICE, '0x000000000000000000000000000000000000bEEF', ALICE]);
    expect(() => arenaDeployArgs(null, '0x000000000000000000000000000000000000beef')).toThrow(/Connect the owner wallet/);
    expect(() => arenaDeployArgs(ALICE, null)).toThrow(/no server key/);
  });

  it('NFT defaults: 5,000, the $1 price, 1 / 2 per wallet, `${origin}/api/nft/`, treasury = you', () => {
    const form = defaultNftForm('https://elymum.test/', '30000000000000000', ALICE);
    expect(form).toEqual({ maxSupply: '5000', priceHype: '0.03', wlLimit: '1', publicLimit: '2', baseURI: 'https://elymum.test/api/nft/', treasury: ALICE });
    expect(nftDeployArgs(form, ALICE)).toEqual({ owner: ALICE, maxSupply: 5000, mintPrice: 30_000_000_000_000_000n, wlLimit: 1, publicLimit: 2, baseURI: 'https://elymum.test/api/nft/', treasury: ALICE });
    expect(() => nftDeployArgs({ ...form, priceHype: '' }, ALICE)).toThrow(/Mint price/);
    expect(() => nftDeployArgs({ ...form, baseURI: 'https://x.test/nft' }, ALICE)).toThrow(/Base URI/);
    expect(() => nftDeployArgs({ ...form, treasury: 'nope' }, ALICE)).toThrow(/Treasury/);
  });

  it('remembers deploys per chain until they are registered', () => {
    localStorage.clear();
    saveLocalDeploy(99801, 'arena', { address: ARENA, txHash: null });
    expect(loadLocalDeploys(99801).arena?.address).toBe(ARENA);
    expect(loadLocalDeploys(1)).toEqual({});
    saveLocalDeploy(99801, 'arena', null);
    expect(loadLocalDeploys(99801)).toEqual({});
  });
});

describe('transaction preview content and gating', () => {
  it('describes a call (function, named and typed args) and a deploy (constructor args)', () => {
    const p = previewOf({ title: 'fee', contract: 'ElymumArena', call: setFeeBpsCall(ARENA, 300) });
    expect(p).toMatchObject({ signature: 'setFeeBps(uint16)', functionName: 'setFeeBps', to: ARENA, valueText: null });
    expect(p.args).toEqual([{ name: 'bps', type: 'uint16', value: '300' }]);
    const create = previewOf({ title: 'c', contract: 'ElymumArena', call: createArenaCall(ARENA, { id: 1, entryFee: 1000n * ONE, maxSessions: 300 }) });
    expect(create.args.map((a) => [a.name, a.value])).toEqual([
      ['id', '1'],
      ['entryFee', (1000n * ONE).toString()],
      ['maxSessions', '300'],
    ]);
    const d = previewOf({ title: 'd', contract: 'ElymumArena', deploy: { name: 'ElymumArena', params: deployArenaParams({ admin: ALICE, serverAuthority: BOB, feeWallet: ALICE }) } });
    expect(d.signature).toBe('constructor(address,address,address)');
    expect(d.args.map((a) => a.name)).toEqual(['admin', 'serverAuthority', 'feeWallet']);
    expect(d.to).toBeNull();
  });

  it('refuses without a wallet, with chain blockers, or when the signer is not the owner', () => {
    const plan = { title: 'fee', contract: 'ElymumArena', call: setFeeBpsCall(ARENA, 300), owner: ALICE };
    expect(planRefusals(plan, { me: ALICE, blockers: [] })).toEqual([]);
    expect(planRefusals(plan, { me: null, blockers: [] })).toEqual(['Connect the owner wallet first.']);
    expect(planRefusals(plan, { me: BOB, blockers: [] })[0]).toMatch(/Owner check: the connected wallet .* is not the ElymumArena owner/);
    expect(planRefusals(plan, { me: ALICE, blockers: ['RPC mismatch'] })).toEqual(['RPC mismatch']);
  });
});

describe('launch checklist and allowlist warnings', () => {
  it('ticks what is done and points at the tab for the rest', () => {
    const net = resolveNetwork(chainStatus({ arenaAddress: ARENA, nftAddress: NFT }));
    const items = launchChecklist({
      net,
      status: status({ nft: true, token: BOB, arenas: [1, 2, 3, 4], phase: 'allowlist', root: `0x${'ab'.repeat(32)}` }),
      allowlist: { snapshot: { root: `0x${'ab'.repeat(32)}`, count: 3, wallets: [], builtAt: 1, builtBy: ALICE, sources: { wl: 2, collab: 1 } }, diff: { added: [], removed: [] }, onchainRoot: null, published: true },
      settings: { wlOpen: true, collabOpen: false, gameAccess: 'holders', xHandle: 'elymumio', launchPostUrl: null },
      quote: { hypeUsd: 33.3, targetUsdCents: 100, priceWei: '30000000000000000', fetchedAt: 1 },
    });
    const by = Object.fromEntries(items.map((i) => [i.id, i.ok]));
    expect(by).toMatchObject({ chain: true, 'server-key': true, arena: true, nft: true, token: true, arenas: true, allowlist: true, price: true, phase: true, access: true });
    expect(by.authority).toBe(true);
    // another server key than the arena's settler
    const other = launchChecklist({ net: resolveNetwork(chainStatus({ arenaAddress: ARENA, serverKey: BOB })), status: status(), allowlist: null, settings: null, quote: null });
    expect(other.find((i) => i.id === 'authority')?.ok).toBe(false);
    const empty = launchChecklist({ net: resolveNetwork(chainStatus({ arenaAddress: null })), status: null, allowlist: null, settings: null, quote: null });
    expect(empty.find((i) => i.id === 'arena')).toMatchObject({ ok: false, tab: 'deploy' });
    expect(empty.find((i) => i.id === 'access')?.ok).toBeNull();
  });

  it('warns when the published root is not the snapshot or approvals changed since', () => {
    const snap = { root: `0x${'ab'.repeat(32)}`, count: 3, wallets: [], builtAt: 1, builtBy: ALICE, sources: { wl: 2, collab: 1 } };
    expect(allowlistWarnings({ snapshot: snap, diff: { added: [], removed: [] }, onchainRoot: null, published: true }, `0x${'ab'.repeat(32)}`)).toEqual([]);
    expect(allowlistWarnings({ snapshot: snap, diff: { added: [], removed: [] }, onchainRoot: null, published: false }, `0x${'00'.repeat(32)}`)[0]).toMatch(/not the root on the contract/);
    expect(allowlistWarnings({ snapshot: snap, diff: { added: ['0x1'], removed: [] }, onchainRoot: null, published: true }, `0x${'ab'.repeat(32)}`)[0]).toMatch(/1 to add/);
    expect(allowlistWarnings({ snapshot: null, diff: { added: [], removed: [] }, onchainRoot: null, published: false }, null)[0]).toMatch(/No allowlist snapshot/);
  });
});

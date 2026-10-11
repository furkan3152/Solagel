import { Keypair } from '@solana/web3.js';
import type { ConfigView } from '@solagel/sdk';
import { releaseForSettings, type TokenMintInspection } from '@solagel/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/admin/service';
import { AdminStore, defaultSettings } from '../src/admin/store';
import { NullChain, type ChainGateway } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Leaderboards } from '../src/leaderboards';
import { RoomManager } from '../src/rooms/manager';
import { Journal, type SettlementItem } from '../src/stake/journal';

const wallet = () => Keypair.generate().publicKey.toBase58();
const adminWallet = wallet();
const mintAddress = wallet();
const inspection: TokenMintInspection = { mintAddress, cluster: 'localnet', tokenProgram: 'spl-token', decimals: 6,
  supply: '1000000000000', mintAuthority: null, freezeAuthority: null, extensions: [], warnings: [], gameplaySupported: false };

function fixture(allowlisted = true) {
  const cfg = loadConfig({ ADMIN_WALLETS: allowlisted ? adminWallet : '', SOLANA_RPC_URL: 'https://private-rpc.example/?api-key=secret-value' });
  const chain: ChainGateway = new NullChain();
  const journal = new Journal(null);
  const rooms = new RoomManager(cfg, { chain, journal, leaderboards: new Leaderboards(null), canRecord: () => false, recordMinScore: 0, log: () => {} }, chain);
  const store = new AdminStore(null, defaultSettings(cfg.bots));
  const inspectMint = vi.fn(async () => inspection);
  const service = new AdminService(cfg, { rooms, chain, journal, store, inspectMint });
  return { service, rooms, chain, journal, store, inspectMint };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

describe('administrative effects remain bounded', () => {
  it('publishes only an explicitly launched verified mint while keeping gameplay SOL-only', async () => {
    const f = fixture();
    const settings = f.store.snapshot().settings;
    settings.token = { status: 'configured', mintAddress, symbol: 'GEL', decimals: 6, launchUrl: `https://pump.fun/coin/${mintAddress}` };
    const staged = await f.service.update(adminWallet, 0, settings);
    expect(f.inspectMint).toHaveBeenCalledWith(mintAddress);
    expect(releaseForSettings(staged.settings).token.mintAddress).toBeNull();
    settings.token.status = 'launched';
    const announced = await f.service.update(adminWallet, 1, settings);
    expect(releaseForSettings(announced.settings)).toMatchObject({ currency: 'SOL', token: { status: 'launched', mintAddress, gameplayEnabled: false }, nft: { ownershipEnabled: false } });
    expect((await f.service.status(adminWallet)).capabilities).toEqual({ tokenGameplay: false, nftOwnership: false });
  });

  it('rejects wrong decimals before changing runtime settings and fills verified planned decimals', async () => {
    const f = fixture();
    const settings = f.store.snapshot().settings;
    settings.admissionsPaused = true;
    settings.token = { status: 'configured', mintAddress, symbol: 'GEL', decimals: 9, launchUrl: null };
    await expect(f.service.update(adminWallet, 0, settings)).rejects.toMatchObject({ code: 'mint_decimals_mismatch' });
    expect(f.rooms.admissionsPaused).toBe(false);
    expect(f.store.snapshot().revision).toBe(0);
    settings.token = { ...settings.token, status: 'planned', decimals: null };
    expect((await f.service.update(adminWallet, 0, settings)).settings.token.decimals).toBe(6);
  });

  it('does not leak private RPC endpoints from mint errors or admin status', async () => {
    const f = fixture();
    f.inspectMint.mockRejectedValueOnce(new Error('fetch https://private-rpc.example/?api-key=secret-value failed'));
    await expect(f.service.inspectToken(adminWallet, mintAddress)).rejects.toMatchObject({ code: 'mint_inspection_failed' });
    const status = JSON.stringify(await f.service.status(adminWallet));
    expect(status).not.toMatch(/private-rpc|secret-value|authSecret|serverKeypair/);
    expect((await f.service.status(adminWallet)).authority).toEqual({ wallet: adminWallet, offchainAdmin: true, onChainAdmin: false });
  });

  it('rechecks revision after asynchronous inspection so two editors cannot overwrite each other', async () => {
    const f = fixture();
    const wait = deferred<TokenMintInspection>();
    const entered = deferred<void>();
    f.inspectMint.mockImplementationOnce(async () => { entered.resolve(); return wait.promise; });
    const firstSettings = f.store.snapshot().settings;
    firstSettings.token = { status: 'configured', mintAddress, symbol: 'GEL', decimals: 6, launchUrl: null };
    const first = f.service.update(adminWallet, 0, firstSettings);
    await entered.promise;
    const otherSettings = f.store.snapshot().settings;
    otherSettings.admissionsPaused = true;
    await f.service.update(adminWallet, 0, otherSettings);
    wait.resolve(inspection);
    await expect(first).rejects.toMatchObject({ status: 409, code: 'revision_conflict' });
    expect(f.store.snapshot().settings).toEqual(otherSettings);
  });

  it('revoked on-chain authority cannot commit after a delayed mint inspection', async () => {
    const f = fixture(false);
    let currentAdmin = adminWallet;
    f.chain.readAdminConfig = async () => ({ admin: currentAdmin } as ConfigView);
    const wait = deferred<TokenMintInspection>();
    const entered = deferred<void>();
    f.inspectMint.mockImplementationOnce(async () => { entered.resolve(); return wait.promise; });
    const settings = f.store.snapshot().settings;
    settings.token = { status: 'configured', mintAddress, symbol: 'GEL', decimals: 6, launchUrl: null };
    const updating = f.service.update(adminWallet, 0, settings);
    await entered.promise;
    currentAdmin = wallet();
    wait.resolve(inspection);
    await expect(updating).rejects.toMatchObject({ code: 'admin_forbidden' });
    expect(f.store.snapshot().revision).toBe(0);
  });

  it('retrying preserves liabilities, attempt counters and signed transaction evidence', async () => {
    const f = fixture();
    f.chain.kick = vi.fn();
    const claim: SettlementItem = { kind: 'settle', key: 'session', session: 'session', sessionId: 42, player: wallet(), arenaId: 1,
      payout: 123_456, score: 500, kills: 2, xp: 100, attempts: 7, nextAttemptAt: Date.now() + 100_000,
      createdAt: 1000, submittedSignature: 'proof-of-previous-send', lastError: 'temporary RPC outage', reason: 'cashout' };
    f.journal.enqueue(claim);
    expect(await f.service.retrySettlements(adminWallet)).toEqual({ retried: 1 });
    const retried = f.journal.pending[0];
    expect({ ...retried, nextAttemptAt: claim.nextAttemptAt }).toEqual(claim);
    expect(retried.nextAttemptAt).toBeLessThan(claim.nextAttemptAt);
    expect(f.chain.kick).toHaveBeenCalledOnce();
    expect(f.store.snapshot().audit.at(-1)?.action).toBe('settlements.retry');
  });
});

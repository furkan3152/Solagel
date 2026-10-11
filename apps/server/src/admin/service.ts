import { Connection } from '@solana/web3.js';
import type { ConfigView } from '@solagel/sdk';
import type { AdminSettings, AdminSnapshot, AdminStatus, TokenMintInspection } from '@solagel/shared';
import { isValidPubkey } from '../auth';
import type { ChainGateway } from '../chain/types';
import type { ServerConfig } from '../config';
import type { RoomManager } from '../rooms/manager';
import type { Journal } from '../stake/journal';
import { inspectTokenMint } from './assets';
import { AdminAuth } from './auth';
import { AdminError, AdminStore, validateSettings } from './store';

interface Deps {
  rooms: RoomManager;
  chain: ChainGateway;
  journal: Journal;
  store: AdminStore;
  inspectMint?: (mintAddress: string) => Promise<TokenMintInspection>;
}

export class AdminService {
  readonly auth: AdminAuth;
  private readonly allowed: Set<string>;
  private readonly inspect: (mintAddress: string) => Promise<TokenMintInspection>;

  constructor(private readonly cfg: ServerConfig, private readonly deps: Deps) {
    this.auth = new AdminAuth(cfg.authSecret, JSON.stringify({ cluster: cfg.chain.cluster, programId: cfg.chain.programId, origin: cfg.corsOrigin }));
    if (cfg.adminWallets.some((wallet) => !isValidPubkey(wallet))) throw new Error('ADMIN_WALLETS must contain valid Solana public keys');
    this.allowed = new Set(cfg.adminWallets);
    this.inspect = deps.inspectMint ?? (async (mintAddress) => {
      if (!cfg.chain.rpcUrl) throw new AdminError(503, 'chain_unavailable');
      const connection = new Connection(cfg.chain.rpcUrl, { commitment: 'confirmed',
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) });
      return inspectTokenMint(connection, mintAddress, cfg.chain.cluster);
    });
    deps.rooms.applyRuntime(deps.store.snapshot().settings);
  }

  snapshot(): AdminSnapshot { return this.deps.store.snapshot(); }

  private async authority(wallet: string): Promise<{ authority: AdminStatus['authority']; config: ConfigView | null }> {
    if (!isValidPubkey(wallet)) throw new AdminError(403, 'admin_forbidden');
    // Never authorize an on-chain admin from the gateway's cached configuration.
    const config = await this.deps.chain.readAdminConfig?.().catch(() => null) ?? null;
    const authority = { wallet, offchainAdmin: this.allowed.has(wallet), onChainAdmin: config?.admin === wallet };
    if (!authority.offchainAdmin && !authority.onChainAdmin) throw new AdminError(403, 'admin_forbidden');
    return { authority, config };
  }

  async challenge(pubkey: unknown) {
    if (!isValidPubkey(pubkey)) throw new AdminError(400, 'invalid_pubkey');
    await this.authority(pubkey);
    return this.auth.issueNonce(pubkey);
  }

  async session(pubkey: unknown, message: unknown, signature: unknown) {
    if (typeof pubkey !== 'string' || typeof message !== 'string' || typeof signature !== 'string'
      || !this.auth.verifySignature(pubkey, message, signature)) throw new AdminError(401, 'admin_signature_invalid');
    await this.authority(pubkey);
    this.deps.store.record(pubkey, 'session.open', 'Opened a signed 15-minute administrator session.');
    return this.auth.issueToken(pubkey);
  }

  wallet(authorization: string | undefined): string {
    if (!authorization?.startsWith('Bearer ')) throw new AdminError(401, 'admin_session_required');
    const wallet = this.auth.verifyToken(authorization.slice(7));
    if (!wallet) throw new AdminError(401, 'admin_session_expired');
    return wallet;
  }

  async status(wallet: string): Promise<AdminStatus> {
    const { authority, config } = await this.authority(wallet);
    const { rooms, chain, journal } = this.deps;
    return { ...this.snapshot(), authority, online: rooms.online(), rooms: [...rooms.rooms.values()].map((r) => r.info()),
      chain: { ...chain.status(), admissionsPaused: rooms.admissionsPaused }, config: config ? { admin: config.admin, serverAuthority: config.serverAuthority,
        treasury: config.treasury, feeBps: config.feeBps, seasonShareBps: config.seasonShareBps,
        currentSeason: config.currentSeason, paused: config.paused } : null,
      journal: { healthy: journal.healthy, live: journal.live().map(({ roomId, session, sessionId, player, arenaId, value }) => ({ roomId, session, sessionId, player, arenaId, value })),
        pending: journal.pending.map(({ key, kind, player, arenaId, sessionId, payout, attempts, lastError, nextAttemptAt }) => ({ key, kind, player, arenaId, sessionId, payout, attempts,
          lastError: lastError?.replace(/https?:\/\/\S+/g, '[RPC endpoint]'), nextAttemptAt })),
        receipts: journal.allReceipts().map(({ player, arenaId, sessionId, signature, payout, settledAt }) => ({ player, arenaId, sessionId, signature, payout, settledAt })) },
      capabilities: { tokenGameplay: false, nftOwnership: false } };
  }

  async inspectToken(wallet: string, mintAddress: unknown): Promise<TokenMintInspection> {
    await this.authority(wallet);
    if (!isValidPubkey(mintAddress)) throw new AdminError(400, 'invalid_mint');
    try { return await this.inspect(mintAddress); }
    catch (error) { if (error instanceof AdminError) throw error; throw new AdminError(400, 'mint_inspection_failed', 'The mint could not be verified on the configured Solana cluster.'); }
  }

  async update(wallet: string, expectedRevision: unknown, input: unknown): Promise<AdminSnapshot> {
    await this.authority(wallet);
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new AdminError(400, 'invalid_revision');
    if (this.snapshot().revision !== expectedRevision) throw new AdminError(409, 'revision_conflict');
    let settings: AdminSettings;
    try { settings = validateSettings(input); }
    catch (error) { if (error instanceof AdminError) throw error; throw new AdminError(400, 'invalid_settings', (error as Error).message); }
    if (settings.token.mintAddress) {
      const mint = await this.inspectToken(wallet, settings.token.mintAddress);
      if (settings.token.decimals !== null && settings.token.decimals !== mint.decimals) throw new AdminError(400, 'mint_decimals_mismatch');
      settings.token.decimals = mint.decimals;
    }
    await this.authority(wallet);
    const snapshot = this.deps.store.update(expectedRevision as number, settings, wallet);
    this.deps.rooms.applyRuntime(snapshot.settings);
    return snapshot;
  }

  async retrySettlements(wallet: string): Promise<{ retried: number }> {
    await this.authority(wallet);
    if (!this.deps.journal.healthy) throw new AdminError(503, 'journal_unavailable');
    const count = this.deps.journal.pending.filter((p) => p.kind === 'settle').length;
    this.deps.store.record(wallet, 'settlements.retry', `Requested another attempt for ${count} existing financial claims; balances unchanged.`);
    const retried = this.deps.journal.retrySettlements();
    this.deps.chain.kick();
    return { retried };
  }
}

import { closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_ADMIN_SETTINGS, type AdminSettings, type AdminSnapshot } from '@solagel/shared';
import { validateNftSettings, validateTokenSettings } from './assets';

const MAX_AUDIT = 200;
const copy = <T>(value: T): T => structuredClone(value);

export interface AdminBinding { cluster: string; programId: string | null }

export class AdminError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

export function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw new AdminError(400, 'invalid_settings');
}

export function validateSettings(input: unknown): AdminSettings {
  exactKeys(input, ['admissionsPaused', 'bots', 'token', 'nft']);
  if (typeof input.admissionsPaused !== 'boolean') throw new AdminError(400, 'invalid_pause');
  exactKeys(input.bots, ['target', 'min', 'max', 'privateTarget']);
  const bots = input.bots as AdminSettings['bots'];
  if (![bots.target, bots.min, bots.max, bots.privateTarget].every((v) => Number.isInteger(v) && v >= 0 && v <= 100)
    || bots.min > bots.privateTarget) throw new AdminError(400, 'invalid_bot_limits');
  exactKeys(input.token, ['status', 'mintAddress', 'symbol', 'decimals', 'launchUrl']);
  exactKeys(input.nft, ['status', 'chain', 'standard', 'collectionAddress', 'openSeaUrl', 'skinMappings']);
  if (Array.isArray(input.nft.skinMappings)) for (const mapping of input.nft.skinMappings) exactKeys(mapping, ['skinId', 'assetId']);
  return { admissionsPaused: input.admissionsPaused, bots: { ...bots },
    token: validateTokenSettings(input.token), nft: validateNftSettings(input.nft) };
}

export function defaultSettings(bots: AdminSettings['bots']): AdminSettings {
  const bounded = (n: number) => Math.max(0, Math.min(100, Math.floor(Number.isFinite(n) ? n : 0)));
  const target = bounded(bots.target);
  const max = bounded(bots.max);
  const privateTarget = bounded(bots.privateTarget);
  return { ...copy(DEFAULT_ADMIN_SETTINGS), bots: { target, max, min: Math.min(bounded(bots.min), privateTarget), privateTarget } };
}

/** Settings and their successful-operation audit are one atomic durable snapshot. */
export class AdminStore {
  private state: AdminSnapshot;
  private failure: Error | null = null;

  constructor(private readonly path: string | null, initial: AdminSettings, private readonly binding: AdminBinding | null = null) {
    this.state = { revision: 0, updatedAt: 0, settings: validateSettings(initial), audit: [] };
    if (path && existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as AdminSnapshot & { version: number; binding?: AdminBinding | null };
        const stored = data.binding ?? null;
        if (!(stored === null && binding === null) && !(stored && binding && stored.cluster === binding.cluster && stored.programId === binding.programId)) {
          throw new Error('The saved administration settings belong to another network/program or have no deployment binding; an explicit settings migration is required');
        }
        if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0
          || !Number.isSafeInteger(data.updatedAt) || data.updatedAt < 0 || !Array.isArray(data.audit)
          || data.audit.some((a) => !a || !Number.isSafeInteger(a.at) || a.at < 0 || !Number.isSafeInteger(a.revision)
            || a.revision < 0 || typeof a.wallet !== 'string' || typeof a.action !== 'string' || typeof a.summary !== 'string')) throw new Error('invalid admin snapshot');
        this.state = { revision: data.revision, updatedAt: data.updatedAt, settings: validateSettings(data.settings), audit: data.audit.slice(-MAX_AUDIT) };
      } catch (error) {
        throw new Error(`Admin settings cannot be recovered; original file preserved. Restore a valid snapshot before starting. ${(error as Error).message}`, { cause: error });
      }
    }
  }

  snapshot(): AdminSnapshot { return copy(this.state); }

  update(expectedRevision: number, settings: AdminSettings, wallet: string, now = Date.now()): AdminSnapshot {
    if (!Number.isSafeInteger(now) || now < 0) throw new AdminError(400, 'invalid_time');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new AdminError(400, 'invalid_revision');
    if (this.state.revision !== expectedRevision) throw new AdminError(409, 'revision_conflict');
    const revision = this.state.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new AdminError(409, 'revision_limit');
    this.persist({ revision, updatedAt: now, settings: validateSettings(settings),
      audit: [...this.state.audit, { at: now, wallet, action: 'settings.update', revision,
        summary: 'Updated admission, bot population and staged asset settings.' }].slice(-MAX_AUDIT) });
    return this.snapshot();
  }

  record(wallet: string, action: string, summary: string, now = Date.now()): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new AdminError(400, 'invalid_time');
    this.persist({ ...this.state, audit: [...this.state.audit, { at: now, wallet, action,
      revision: this.state.revision, summary: summary.slice(0, 300) }].slice(-MAX_AUDIT) });
  }

  private persist(next: AdminSnapshot): void {
    if (this.failure) throw new AdminError(503, 'admin_storage_unavailable', this.failure.message);
    try {
      if (this.path) {
        mkdirSync(dirname(this.path), { recursive: true });
        const temp = `${this.path}.tmp`;
        const fd = openSync(temp, 'w', 0o600);
        try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify({ version: 1, binding: this.binding, ...next })); fsyncSync(fd); }
        finally { closeSync(fd); }
        renameSync(temp, this.path);
        const directory = openSync(dirname(this.path), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } catch (error) {
      this.failure = new Error('Admin persistence failed; settings remain unchanged until operator recovery.', { cause: error });
      throw new AdminError(503, 'admin_storage_unavailable', this.failure.message);
    }
    this.state = copy(next);
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { INTEGRITY_FLAG_KINDS, type IntegrityFlagKind } from '@slana/shared';
import { SiteFail } from '../site/validate';
import { IntegrityError, type FlagFilter, type IntegrityService } from './service';
import { SettingsError } from './settings';

type Send = (res: ServerResponse, status: number, body: unknown) => void;
type SendCsv = (res: ServerResponse, name: string, body: string) => void;
type Method = (req: IncomingMessage, ...allowed: string[]) => string;
type ReadJson = (req: IncomingMessage) => Promise<Record<string, unknown>>;

export interface IntegrityRouteIo {
  send: Send;
  sendCsv: SendCsv;
  method: Method;
  readJson: ReadJson;
}

function filterOf(q: URLSearchParams): FlagFilter {
  const status = q.get('status');
  const kind = q.get('kind');
  const min = q.get('minScore');
  if (status && status !== 'open' && status !== 'reviewed' && status !== 'dismissed') throw new SiteFail(400, 'bad_request', 'Unknown status', 'status');
  if (kind && !INTEGRITY_FLAG_KINDS.includes(kind as IntegrityFlagKind)) throw new SiteFail(400, 'bad_request', 'Unknown kind', 'kind');
  const minScore = min === null || min === '' ? null : Number(min);
  if (minScore !== null && !(minScore >= 0 && minScore <= 100)) throw new SiteFail(400, 'bad_request', 'minScore must be 0 to 100', 'minScore');
  return { status, kind, minScore, q: q.get('q') };
}

/**
 * `/api/admin/integrity/*` (the caller has already checked the admin session):
 *
 * | Method | Path | What |
 * |---|---|---|
 * | GET | `` (overview) | settings, defaults, counts, held settlements, bans |
 * | GET / PUT | `settings` | auto-hold, hold score, thresholds (`reset: true` restores the defaults) |
 * | GET | `flags`, `flags.csv` | flags (filters `status`, `kind`, `minScore`, `q`) |
 * | POST | `scan` | run the detectors now |
 * | GET | `flags/:id` | one flag |
 * | POST | `flags/:id/status` | `{ status: open \| reviewed \| dismissed, note? }` |
 * | GET | `wallet/:wallet` | tickets, flags and transfers of a wallet (`other` = only with that wallet) |
 * | POST | `bans` | `{ wallet, reason }` |
 * | DELETE | `bans/:wallet` | unban |
 * | GET | `held` | settlements held for review |
 * | POST | `held/:key/release` | pay it as it was |
 * | POST | `held/:key/settle-zero` | `{ reason }`: settle at 0, the value stays in the vault (journaled) |
 */
export async function integrityRoutes(svc: IntegrityService, io: IntegrityRouteIo, req: IncomingMessage, res: ServerResponse, seg: string[], q: URLSearchParams, admin: string): Promise<void> {
  const { send, sendCsv, method, readJson } = io;
  try {
    try {
      seg = seg.map((x) => decodeURIComponent(x));
    } catch {
      throw new SiteFail(400, 'bad_request', 'Bad path');
    }
    const [a, b, c] = seg;
    if (seg.length === 0 || (seg.length === 1 && a === '')) {
      method(req, 'GET');
      return send(res, 200, svc.overview());
    }
    switch (a) {
      case 'settings':
        if (seg.length !== 1) break;
        if (method(req, 'GET', 'PUT') === 'PUT') return send(res, 200, { settings: svc.updateSettings(await readJson(req), admin) });
        return send(res, 200, { settings: svc.settings });
      case 'scan':
        if (seg.length !== 1) break;
        method(req, 'POST');
        svc.scan();
        return send(res, 200, svc.overview());
      case 'flags':
        if (seg.length === 1) {
          method(req, 'GET');
          return send(res, 200, { flags: svc.listFlags(filterOf(q)).slice(0, 1000) });
        }
        if (seg.length === 2) {
          method(req, 'GET');
          return send(res, 200, { flag: svc.getFlag(b) });
        }
        if (seg.length === 3 && c === 'status') {
          method(req, 'POST');
          const body = await readJson(req);
          return send(res, 200, { flag: svc.setFlagStatus(b, body.status, body.note, admin) });
        }
        break;
      case 'flags.csv':
        if (seg.length !== 1) break;
        method(req, 'GET');
        return sendCsv(res, `slana-integrity-flags-${new Date().toISOString().slice(0, 10)}.csv`, svc.flagsCsv(filterOf(q)));
      case 'wallet':
        if (seg.length !== 2) break;
        method(req, 'GET');
        return send(res, 200, svc.walletView(b, q.get('other')));
      case 'bans':
        if (seg.length === 1) {
          if (method(req, 'GET', 'POST') === 'GET') return send(res, 200, { bans: svc.overview().bans });
          const body = await readJson(req);
          return send(res, 201, { ban: svc.ban(body.wallet, body.reason, admin) });
        }
        if (seg.length === 2) {
          method(req, 'DELETE');
          svc.unban(b, admin);
          return send(res, 200, { ok: true });
        }
        break;
      case 'held':
        if (seg.length === 1) {
          method(req, 'GET');
          return send(res, 200, { held: svc.heldList() });
        }
        if (seg.length === 3 && c === 'release') {
          method(req, 'POST');
          svc.release(b, admin);
          return send(res, 200, { ok: true, held: svc.heldList() });
        }
        if (seg.length === 3 && c === 'settle-zero') {
          method(req, 'POST');
          const body = await readJson(req);
          const forfeited = svc.settleZero(b, body.reason, admin);
          return send(res, 200, { ok: true, forfeited, held: svc.heldList() });
        }
        break;
    }
    throw new SiteFail(404, 'not_found', 'Not found');
  } catch (err) {
    if (err instanceof IntegrityError) throw new SiteFail(err.status, err.code, err.message, err.field);
    if (err instanceof SettingsError) throw new SiteFail(400, 'bad_request', err.message, err.field);
    throw err;
  }
}

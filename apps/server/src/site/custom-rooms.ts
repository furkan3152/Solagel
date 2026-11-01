import type { IncomingMessage, ServerResponse } from 'node:http';
import { INVITE_CODE_RE } from '@elymum/shared';
import { CustomRoomFail, type CustomRoomService } from '../rooms/custom';
import { SiteFail } from './validate';

interface Helpers {
  send: (res: ServerResponse, status: number, body: unknown) => void;
  method: (req: IncomingMessage, ...allowed: string[]) => string;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  /** The signed-in wallet, or null (guest). */
  wallet: (req: IncomingMessage) => string | null;
  /** The signed-in wallet of a rate-limited write (throws 401 / 429). */
  writer: (req: IncomingMessage) => string;
  isAdmin: (wallet: string | null) => boolean;
  /** Public origin for share links. */
  origin: (req: IncomingMessage) => string;
}

/** `CustomRoomFail` as the site's JSON error (`{ error, message, field?, paid? }`). */
export function sendCustomFail(h: Pick<Helpers, 'send'>, res: ServerResponse, err: CustomRoomFail): void {
  h.send(res, err.status, { error: err.code, message: err.message, ...(err.field ? { field: err.field } : {}), ...(err.paid ? { paid: true } : {}) });
}

const codeOf = (seg: string | undefined): string => {
  const c = (seg ?? '').toUpperCase();
  if (!INVITE_CODE_RE.test(c)) throw new SiteFail(404, 'not_found', 'No open room with that code.');
  return c;
};

/**
 * The custom rooms API:
 *  - `GET  /api/rooms/custom/quote`  what creating a room costs (signed-in: with the holder perk);
 *  - `POST /api/rooms/custom`        `{ config, txHash? }` (signed-in) → 201 `{ room, invite }`;
 *  - `GET  /api/rooms/custom/mine`   the signed-in wallet's live rooms;
 *  - `GET  /api/rooms/custom/<CODE>` a live room (anyone with the code);
 *  - `DELETE /api/rooms/custom/<CODE>` the creator (or an admin) closes it.
 */
export async function customRoomRoutes(svc: CustomRoomService, h: Helpers, req: IncomingMessage, res: ServerResponse, seg: string[]): Promise<void> {
  try {
    if (seg.length === 0 || (seg.length === 1 && seg[0] === '')) {
      h.method(req, 'POST');
      const wallet = h.writer(req);
      const body = await h.readJson(req);
      const room = await svc.create(wallet, body);
      return h.send(res, 201, { room, invite: `${h.origin(req)}/play?room=${room.code}` });
    }
    if (seg.length !== 1) throw new SiteFail(404, 'not_found', 'Not found');
    if (seg[0] === 'quote') {
      h.method(req, 'GET');
      return h.send(res, 200, await svc.quote(h.wallet(req)));
    }
    if (seg[0] === 'mine') {
      h.method(req, 'GET');
      const wallet = h.wallet(req);
      if (!wallet) throw new SiteFail(401, 'unauthorized', 'Sign in with your wallet first.');
      return h.send(res, 200, { rooms: svc.mine(wallet) });
    }
    const code = codeOf(seg[0]);
    if (h.method(req, 'GET', 'DELETE') === 'GET') {
      const room = svc.get(code);
      if (!room) throw new SiteFail(404, 'not_found', 'No open room with that code.');
      return h.send(res, 200, { room });
    }
    const wallet = h.writer(req);
    return h.send(res, 200, { closed: svc.close(code, { wallet, admin: h.isAdmin(wallet) }) });
  } catch (err) {
    if (err instanceof CustomRoomFail) return sendCustomFail(h, res, err);
    throw err;
  }
}

/**
 * `GET /api/admin/custom-rooms` (settings + live rooms), `PUT` (a partial settings update) and
 * `DELETE /api/admin/custom-rooms/<CODE>` (close a room). The caller checked the admin session.
 */
export async function customRoomAdminRoutes(svc: CustomRoomService, h: Pick<Helpers, 'send' | 'method' | 'readJson'>, req: IncomingMessage, res: ServerResponse, seg: string[], wallet: string): Promise<void> {
  try {
    if (seg.length === 1) {
      const code = codeOf(seg[0]);
      h.method(req, 'DELETE');
      return h.send(res, 200, { closed: svc.close(code, { wallet, admin: true }), rooms: svc.list() });
    }
    if (h.method(req, 'GET', 'PUT') === 'PUT') svc.updateSettings(await h.readJson(req));
    return h.send(res, 200, { settings: svc.settings, treasury: svc.treasury(), rooms: svc.list() });
  } catch (err) {
    if (err instanceof CustomRoomFail) return sendCustomFail(h, res, err);
    throw err;
  }
}

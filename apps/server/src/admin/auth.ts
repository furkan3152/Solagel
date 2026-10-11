import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { isValidPubkey } from '../auth.js';

const NONCE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 15 * 60_000;
const MAX_PENDING_NONCES = 1_000;
const TOKEN_PREFIX = 'admin';
const TOKEN_PURPOSE = 'solagel/admin-session/v1\0';

interface PendingNonce {
  pubkey: string;
  message: string;
  expiresAt: number;
}

function validTime(now: number): boolean {
  return Number.isSafeInteger(now) && now >= 0;
}

/** Wallet proof for admin controls. Authorization is checked separately on every request. */
export class AdminAuth {
  private readonly nonces = new Map<string, PendingNonce>();
  private readonly secret: Buffer;

  constructor(secret: Buffer, private readonly audience: string = 'Solagel Admin default') {
    this.secret = Buffer.from(secret);
  }

  issueNonce(pubkey: string, now = Date.now()): { nonce: string; message: string; expiresAt: number } {
    if (!isValidPubkey(pubkey)) throw new Error('invalid pubkey');
    if (!validTime(now) || !Number.isSafeInteger(now + NONCE_TTL_MS)) throw new Error('invalid time');
    this.prune(now);
    if (this.nonces.size >= MAX_PENDING_NONCES) throw new Error('admin nonce capacity reached');

    const nonce = randomBytes(16).toString('hex');
    const expiresAt = now + NONCE_TTL_MS;
    const message = [
      'Solagel Admin authorization',
      `Audience: ${this.audience}`,
      pubkey,
      '',
      'Scope: administer runtime/settings',
      'Sign to access administrative controls. This does not send a blockchain transaction.',
      '',
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expires At: ${new Date(expiresAt).toISOString()}`,
    ].join('\n');
    this.nonces.set(nonce, { pubkey, message, expiresAt });
    return { nonce, message, expiresAt };
  }

  /** Exact issued message, exact wallet, and one successful signature per nonce. */
  verifySignature(pubkey: string, message: string, signatureB58: string, now = Date.now()): boolean {
    if (!validTime(now) || !isValidPubkey(pubkey)
      || typeof message !== 'string' || message.length > 1_024
      || typeof signatureB58 !== 'string' || signatureB58.length > 88) return false;
    const match = /^Nonce: ([0-9a-f]{32})$/m.exec(message);
    if (!match) return false;
    const entry = this.nonces.get(match[1]);
    if (!entry) return false;
    if (entry.expiresAt <= now) {
      this.nonces.delete(match[1]);
      return false;
    }
    if (entry.pubkey !== pubkey || entry.message !== message) return false;
    try {
      const signature = bs58.decode(signatureB58);
      if (signature.length !== 64
        || !nacl.sign.detached.verify(new TextEncoder().encode(message), signature, bs58.decode(pubkey))) return false;
    } catch {
      return false;
    }
    this.nonces.delete(match[1]);
    return true;
  }

  issueToken(pubkey: string, now = Date.now()): { token: string; expiresAt: number } {
    if (!isValidPubkey(pubkey)) throw new Error('invalid pubkey');
    if (!validTime(now) || !Number.isSafeInteger(now + TOKEN_TTL_MS)) throw new Error('invalid time');
    const expiresAt = now + TOKEN_TTL_MS;
    const payload = `${TOKEN_PREFIX}.${pubkey}.${expiresAt}`;
    return { token: `${payload}.${this.mac(payload)}`, expiresAt };
  }

  /** A game session token cannot authenticate an administrator, even with the same secret. */
  verifyToken(token: unknown, now = Date.now()): string | null {
    if (!validTime(now) || typeof token !== 'string' || token.length > 200) return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [prefix, pubkey, expiry, mac] = parts;
    if (prefix !== TOKEN_PREFIX || !isValidPubkey(pubkey) || !/^[1-9][0-9]{0,15}$/.test(expiry)
      || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return null;
    const expiresAt = Number(expiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
    const expected = Buffer.from(this.mac(`${prefix}.${pubkey}.${expiry}`));
    const supplied = Buffer.from(mac);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    return pubkey;
  }

  private mac(payload: string): string {
    // Encode both values as a tuple so audience/payload boundaries cannot collide.
    return createHmac('sha256', this.secret).update(TOKEN_PURPOSE)
      .update(JSON.stringify([this.audience, payload])).digest('base64url');
  }

  private prune(now: number): void {
    for (const [nonce, entry] of this.nonces) {
      if (entry.expiresAt <= now) this.nonces.delete(nonce);
    }
  }
}

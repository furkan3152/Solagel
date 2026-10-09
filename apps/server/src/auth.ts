import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const NONCE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 24 * 60 * 60_000;

/** Builds the exact text a wallet signs to log in (Sign-In-With-Solana style). */
export function loginMessage(pubkey: string, nonce: string, issuedAt: string, domain = 'Solagel'): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    pubkey,
    '',
    'Sign this message to prove you own this wallet. It is free and does not send a transaction.',
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

export function isValidPubkey(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

/** Wallet login: one-time nonces signed by the wallet, then stateless HMAC tokens. */
export class Auth {
  private readonly nonces = new Map<string, { pubkey: string; message: string; expires: number }>();

  constructor(private readonly secret: Buffer) {}

  issueNonce(pubkey: string, now = Date.now()): { nonce: string; message: string } {
    if (!isValidPubkey(pubkey)) throw new Error('invalid pubkey');
    this.prune(now);
    const nonce = randomBytes(12).toString('hex');
    const message = loginMessage(pubkey, nonce, new Date(now).toISOString());
    this.nonces.set(nonce, { pubkey, message, expires: now + NONCE_TTL_MS });
    return { nonce, message };
  }

  /** Verifies a signed login message; the nonce is consumed on success. */
  verifySignature(pubkey: string, message: string, signatureB58: string, now = Date.now()): boolean {
    if (!isValidPubkey(pubkey) || typeof message !== 'string' || typeof signatureB58 !== 'string') return false;
    const m = /Nonce: ([0-9a-f]{24})/.exec(message);
    if (!m) return false;
    const entry = this.nonces.get(m[1]);
    if (!entry || entry.expires < now || entry.pubkey !== pubkey || entry.message !== message) return false;
    let sig: Uint8Array;
    try {
      sig = bs58.decode(signatureB58);
    } catch {
      return false;
    }
    if (sig.length !== 64) return false;
    const ok = nacl.sign.detached.verify(new TextEncoder().encode(message), sig, bs58.decode(pubkey));
    if (ok) this.nonces.delete(m[1]);
    return ok;
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  issueToken(pubkey: string, now = Date.now()): string {
    const payload = `${pubkey}.${now + TOKEN_TTL_MS}`;
    return `${payload}.${this.mac(payload)}`;
  }

  /** Returns the wallet for a valid, unexpired token. */
  verifyToken(token: unknown, now = Date.now()): string | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [pubkey, exp, mac] = parts;
    if (!isValidPubkey(pubkey) || !(Number(exp) > now)) return null;
    const expected = Buffer.from(this.mac(`${pubkey}.${exp}`));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return pubkey;
  }

  private prune(now: number): void {
    if (this.nonces.size < 1000) return;
    for (const [k, v] of this.nonces) if (v.expires < now) this.nonces.delete(k);
  }
}

import { Buffer } from 'node:buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { AdminAuth } from '../src/admin/auth';
import { Auth } from '../src/auth';

const NOW = 1_760_000_000_000;
const NONCE_TTL = 5 * 60_000;
const TOKEN_TTL = 15 * 60_000;
const SECRET = Buffer.alloc(32, 7);

function wallet() {
  const pair = nacl.sign.keyPair();
  return {
    pubkey: bs58.encode(pair.publicKey),
    sign: (message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey)),
  };
}

describe('AdminAuth wallet signatures', () => {
  it('states the admin scope, expires in five minutes, and consumes successful nonces', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const challenge = auth.issueNonce(owner.pubkey, NOW);

    expect(challenge.expiresAt).toBe(NOW + NONCE_TTL);
    expect(challenge.message).toContain('Solagel Admin');
    expect(challenge.message).toContain(owner.pubkey);
    expect(challenge.message).toContain(challenge.nonce);
    expect(challenge.message.toLowerCase()).toContain('administer');
    expect(challenge.message.toLowerCase()).toContain('runtime');
    expect(challenge.message.toLowerCase()).toContain('settings');

    const signature = owner.sign(challenge.message);
    expect(auth.verifySignature(owner.pubkey, challenge.message, signature, NOW)).toBe(true);
    expect(auth.verifySignature(owner.pubkey, challenge.message, signature, NOW + 1)).toBe(false);
  });

  it('accepts the last valid millisecond and rejects the exact expiry boundary', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const valid = auth.issueNonce(owner.pubkey, NOW);
    const expired = auth.issueNonce(owner.pubkey, NOW);

    expect(auth.verifySignature(owner.pubkey, valid.message, owner.sign(valid.message), NOW + NONCE_TTL - 1)).toBe(true);
    expect(auth.verifySignature(owner.pubkey, expired.message, owner.sign(expired.message), NOW + NONCE_TTL)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, expired.message, owner.sign(expired.message), NOW + NONCE_TTL + 1)).toBe(false);
  });

  it('rejects wrong wallets, forged signatures, and altered messages without consuming the real challenge', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const other = wallet();
    const { message } = auth.issueNonce(owner.pubkey, NOW);

    expect(auth.verifySignature(other.pubkey, message, other.sign(message), NOW)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, message, other.sign(message), NOW)).toBe(false);
    const altered = `${message}\nExtra authorization`;
    expect(auth.verifySignature(owner.pubkey, altered, owner.sign(altered), NOW)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, message, owner.sign(message), NOW)).toBe(true);
  });

  it('rejects malformed and unknown challenges without throwing', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const { message } = auth.issueNonce(owner.pubkey, NOW);
    const validSignature = owner.sign(message);

    for (const signature of ['', 'not-base58-0OIl', bs58.encode(new Uint8Array(63)), bs58.encode(new Uint8Array(65))]) {
      expect(auth.verifySignature(owner.pubkey, message, signature, NOW)).toBe(false);
    }
    expect(auth.verifySignature('invalid-wallet', message, validSignature, NOW)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, 'no nonce here', owner.sign('no nonce here'), NOW)).toBe(false);
    expect(new AdminAuth(SECRET).verifySignature(owner.pubkey, message, validSignature, NOW)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, message, validSignature, NOW)).toBe(true);
    expect(() => auth.issueNonce('invalid-wallet', NOW)).toThrow();
  });

  it('keeps game and admin signed messages separate in both directions', () => {
    const admin = new AdminAuth(SECRET);
    const game = new Auth(SECRET);
    const owner = wallet();
    const adminChallenge = admin.issueNonce(owner.pubkey, NOW);
    const gameChallenge = game.issueNonce(owner.pubkey, NOW);

    expect(admin.verifySignature(owner.pubkey, gameChallenge.message, owner.sign(gameChallenge.message), NOW)).toBe(false);
    expect(game.verifySignature(owner.pubkey, adminChallenge.message, owner.sign(adminChallenge.message), NOW)).toBe(false);

    // Changing only the declared domain also invalidates the server-issued challenge.
    const disguised = adminChallenge.message.replace('Solagel Admin', 'Solagel');
    expect(admin.verifySignature(owner.pubkey, disguised, owner.sign(disguised), NOW)).toBe(false);
    expect(admin.verifySignature(owner.pubkey, adminChallenge.message, owner.sign(adminChallenge.message), NOW)).toBe(true);
    expect(game.verifySignature(owner.pubkey, gameChallenge.message, owner.sign(gameChallenge.message), NOW)).toBe(true);
  });

  it('shows the exact deployment audience in the wallet challenge', () => {
    const audience = JSON.stringify({ cluster: 'devnet', programId: 'program-a', origin: 'https://admin.example' });
    const auth = new AdminAuth(SECRET, audience);
    const other = new AdminAuth(SECRET, `${audience} `);
    const owner = wallet();
    const challenge = auth.issueNonce(owner.pubkey, NOW);
    expect(challenge.message.split('\n')).toContain(`Audience: ${audience}`);
    expect(other.verifySignature(owner.pubkey, challenge.message, owner.sign(challenge.message), NOW)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, challenge.message, owner.sign(challenge.message), NOW)).toBe(true);
    expect(new AdminAuth(SECRET).issueNonce(owner.pubkey, NOW).message).toContain('Audience: Solagel Admin default');
  });

  it('caps pending challenges at 1,000 and frees capacity after successful verification', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const first = auth.issueNonce(owner.pubkey, NOW);
    for (let i = 1; i < 1_000; i += 1) auth.issueNonce(owner.pubkey, NOW);

    expect(() => auth.issueNonce(owner.pubkey, NOW)).toThrow(/capacity/i);
    expect(auth.verifySignature(owner.pubkey, first.message, owner.sign(first.message), NOW)).toBe(true);
    expect(() => auth.issueNonce(owner.pubkey, NOW)).not.toThrow();
    expect(() => auth.issueNonce(owner.pubkey, NOW)).toThrow(/capacity/i);
  });

  it('prunes expired challenges at the exact five-minute boundary before enforcing capacity', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const first = auth.issueNonce(owner.pubkey, NOW);
    for (let i = 1; i < 1_000; i += 1) auth.issueNonce(owner.pubkey, NOW);

    expect(() => auth.issueNonce(owner.pubkey, NOW + NONCE_TTL - 1)).toThrow(/capacity/i);
    const fresh = auth.issueNonce(owner.pubkey, NOW + NONCE_TTL);
    expect(fresh.expiresAt).toBe(NOW + 2 * NONCE_TTL);
    expect(auth.verifySignature(owner.pubkey, first.message, owner.sign(first.message), NOW + NONCE_TTL)).toBe(false);
    expect(auth.verifySignature(owner.pubkey, fresh.message, owner.sign(fresh.message), NOW + NONCE_TTL)).toBe(true);
  });
});

describe('AdminAuth tokens', () => {
  it('issues an admin token with a fifteen-minute expiry and a strict expiry boundary', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const { token, expiresAt } = auth.issueToken(owner.pubkey, NOW);

    expect(expiresAt).toBe(NOW + TOKEN_TTL);
    expect(token.split('.')).toHaveLength(4);
    expect(token.split('.').slice(0, 3)).toEqual(['admin', owner.pubkey, String(expiresAt)]);
    expect(auth.verifyToken(token, NOW)).toBe(owner.pubkey);
    expect(auth.verifyToken(token, expiresAt - 1)).toBe(owner.pubkey);
    expect(auth.verifyToken(token, expiresAt)).toBeNull();
    expect(auth.verifyToken(token, expiresAt + 1)).toBeNull();
  });

  it('rejects modified payloads, signatures, prefixes, and secrets', () => {
    const auth = new AdminAuth(SECRET);
    const owner = wallet();
    const other = wallet();
    const { token } = auth.issueToken(owner.pubkey, NOW);
    const [prefix, pubkey, expiry, mac] = token.split('.');
    const alteredMac = `${mac[0] === 'a' ? 'b' : 'a'}${mac.slice(1)}`;

    for (const altered of [
      `${prefix}.${other.pubkey}.${expiry}.${mac}`,
      `${prefix}.${pubkey}.${Number(expiry) + 1}.${mac}`,
      `${prefix}.${pubkey}.${expiry}.${alteredMac}`,
      `game.${pubkey}.${expiry}.${mac}`,
    ]) {
      expect(auth.verifyToken(altered, NOW)).toBeNull();
    }
    expect(new AdminAuth(Buffer.alloc(32, 8)).verifyToken(token, NOW)).toBeNull();
    expect(new AdminAuth(SECRET).verifyToken(token, NOW)).toBe(owner.pubkey);
  });

  it('rejects malformed tokens', () => {
    const auth = new AdminAuth(SECRET);
    const malformed: unknown[] = [undefined, null, 42, {}, '', 'admin', 'admin.wallet.exp.mac.extra', 'x'.repeat(1_000)];
    for (const value of malformed) expect(auth.verifyToken(value as string, NOW)).toBeNull();
  });

  it('rejects game tokens and admin tokens in the other scope even when they share a secret', () => {
    const admin = new AdminAuth(SECRET);
    const game = new Auth(SECRET);
    const owner = wallet();
    const adminToken = admin.issueToken(owner.pubkey, NOW).token;
    const gameToken = game.issueToken(owner.pubkey, NOW);

    expect(admin.verifyToken(gameToken, NOW)).toBeNull();
    expect(game.verifyToken(adminToken, NOW)).toBeNull();
    // Adding/removing a prefix cannot reuse the other scope's authenticated payload.
    expect(admin.verifyToken(`admin.${gameToken}`, NOW)).toBeNull();
    expect(game.verifyToken(adminToken.slice('admin.'.length), NOW)).toBeNull();
    expect(admin.verifyToken(adminToken, NOW)).toBe(owner.pubkey);
    expect(game.verifyToken(gameToken, NOW)).toBe(owner.pubkey);
  });

  it('binds tokens to the exact deployment audience even when deployments reuse a secret', () => {
    const audience = JSON.stringify({ cluster: 'devnet', programId: 'program-a', origin: 'https://admin.example' });
    const origin = new AdminAuth(SECRET, audience);
    const owner = wallet();
    const token = origin.issueToken(owner.pubkey, NOW).token;
    expect(new AdminAuth(SECRET, audience).verifyToken(token, NOW)).toBe(owner.pubkey);

    for (const different of [
      JSON.stringify({ cluster: 'mainnet-beta', programId: 'program-a', origin: 'https://admin.example' }),
      JSON.stringify({ cluster: 'devnet', programId: 'program-b', origin: 'https://admin.example' }),
      JSON.stringify({ cluster: 'devnet', programId: 'program-a', origin: 'https://another.example' }),
      `${audience} `,
      'Solagel Admin default',
    ]) {
      const destination = new AdminAuth(SECRET, different);
      expect(destination.verifyToken(token, NOW)).toBeNull();
      expect(origin.verifyToken(destination.issueToken(owner.pubkey, NOW).token, NOW)).toBeNull();
    }
  });
});

import { siwsMessage } from '@slana/shared';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { Auth, MAX_NONCES, loginMessage, type SiwsOrigin } from '../src/auth';
import { loadConfig } from '../src/config';
import { siwsOrigin } from '../src/http';

const origin: SiwsOrigin = { domain: 'slana.io', uri: 'https://slana.io', chainId: 'solana:mainnet' };

function signer() {
  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);
  const sign = (message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  return { pubkey, sign };
}

describe('SIWS login message (M1)', () => {
  it('names the domain, URI and chain, and the client can rebuild it from the fields', () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { pubkey, sign } = signer();
    const n = auth.issueNonce(pubkey, origin, 1_760_000_000_000);
    expect(n.message.split('\n')).toEqual([
      'slana.io wants you to sign in with your Solana account:',
      pubkey,
      '',
      'Sign this message to prove you own this wallet. It is free and does not send a transaction.',
      '',
      'URI: https://slana.io',
      'Chain ID: solana:mainnet',
      `Nonce: ${n.nonce}`,
      `Issued At: ${n.issuedAt}`,
    ]);
    expect(siwsMessage({ domain: n.domain, address: pubkey, uri: n.uri, chainId: n.chainId, nonce: n.nonce, issuedAt: n.issuedAt })).toBe(n.message);
    expect(auth.verifySignature(pubkey, n.message, sign(n.message), 1_760_000_000_001)).toBe(true);
  });

  it('refuses a message whose domain, URI or chain differ from the issued one', () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { pubkey, sign } = signer();
    const n = auth.issueNonce(pubkey, origin, 1_000);
    for (const forged of [
      loginMessage(pubkey, n.nonce, n.issuedAt, { ...origin, domain: 'evil.example' }),
      loginMessage(pubkey, n.nonce, n.issuedAt, { ...origin, uri: 'https://evil.example' }),
      loginMessage(pubkey, n.nonce, n.issuedAt, { ...origin, chainId: 'solana:devnet' }),
      n.message.replace('URI: ', 'URL: '),
    ]) {
      expect(auth.verifySignature(pubkey, forged, sign(forged), 1_001)).toBe(false);
    }
    expect(auth.verifySignature(pubkey, n.message, sign(n.message), 1_001)).toBe(true);
  });

  it('takes the domain from PUBLIC_URL, else the request host', () => {
    const req = { headers: { host: 'game.local:8787' } } as never;
    expect(siwsOrigin(loadConfig({ PUBLIC_URL: 'https://slana.io/', SOLANA_CLUSTER: 'mainnet-beta' }), req, false)).toEqual({
      domain: 'slana.io',
      uri: 'https://slana.io',
      chainId: 'solana:mainnet',
    });
    expect(siwsOrigin(loadConfig({ SOLANA_CLUSTER: 'devnet' }), req, false)).toEqual({ domain: 'game.local:8787', uri: 'http://game.local:8787', chainId: 'solana:devnet' });
  });
});

describe('nonce map (M2)', () => {
  it('is capped: the oldest nonces are evicted', () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { pubkey, sign } = signer();
    const first = auth.issueNonce(pubkey, origin, 0);
    for (let i = 0; i < MAX_NONCES + 50; i++) auth.issueNonce(pubkey, origin, 1);
    expect(auth.nonceCount).toBeLessThanOrEqual(MAX_NONCES);
    // the very first nonce was evicted; a recent one still works
    expect(auth.verifySignature(pubkey, first.message, sign(first.message), 2)).toBe(false);
    const last = auth.issueNonce(pubkey, origin, 3);
    expect(auth.verifySignature(pubkey, last.message, sign(last.message), 4)).toBe(true);
  });
});

import { SIWE_STATEMENT, siweMessage } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { Auth, MAX_NONCES, NONCE_TTL_MS, checksumAddress, loginMessage, type SiweOrigin } from '../src/auth';
import { assertPublicUrl, loadConfig } from '../src/config';
import { siweOrigin } from '../src/http';
import { testSigner } from './signers';

const origin: SiweOrigin = { domain: 'elymum.io', uri: 'https://elymum.io', chainId: 99801 };

describe('SIWE login message (EIP-4361)', () => {
  it('names the domain, URI and chain, and the client can rebuild it from the fields', async () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { address, sign } = testSigner();
    const n = auth.issueNonce(address.toLowerCase(), origin, 1_760_000_000_000);
    expect(n.address).toBe(address); // checksummed
    expect(n.message.split('\n')).toEqual([
      'elymum.io wants you to sign in with your Ethereum account:',
      address,
      '',
      SIWE_STATEMENT,
      '',
      'URI: https://elymum.io',
      'Version: 1',
      'Chain ID: 99801',
      `Nonce: ${n.nonce}`,
      `Issued At: ${n.issuedAt}`,
    ]);
    expect(siweMessage({ domain: n.domain, address, uri: n.uri, chainId: n.chainId, nonce: n.nonce, issuedAt: n.issuedAt })).toBe(n.message);
    expect(await auth.verifySignature(address.toLowerCase(), n.message, await sign(n.message), 1_760_000_000_001)).toBe(address);
  });

  it('a nonce is single use and expires after 10 minutes', async () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { address, sign } = testSigner();
    const n = auth.issueNonce(address, origin, 1_000);
    const sig = await sign(n.message);
    expect(await auth.verifySignature(address, n.message, sig, 2_000)).toBe(address);
    expect(await auth.verifySignature(address, n.message, sig, 2_001)).toBeNull();
    const late = auth.issueNonce(address, origin, 10_000);
    expect(await auth.verifySignature(address, late.message, await sign(late.message), 10_000 + NONCE_TTL_MS + 1)).toBeNull();
  });

  it('refuses another signer, a forged message, or a domain / URI / chain other than the issued one', async () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const me = testSigner();
    const other = testSigner();
    const n = auth.issueNonce(me.address, origin, 1_000);
    // someone else's signature over my message
    expect(await auth.verifySignature(me.address, n.message, await other.sign(n.message), 1_001)).toBeNull();
    // the nonce survives a failed attempt
    for (const forged of [
      loginMessage(me.address, n.nonce, n.issuedAt, { ...origin, domain: 'evil.example' }),
      loginMessage(me.address, n.nonce, n.issuedAt, { ...origin, uri: 'https://evil.example' }),
      loginMessage(me.address, n.nonce, n.issuedAt, { ...origin, chainId: 1 }),
      n.message.replace('URI: ', 'URL: '),
    ]) {
      expect(await auth.verifySignature(me.address, forged, await me.sign(forged), 1_001)).toBeNull();
    }
    // another wallet cannot use my nonce
    expect(await auth.verifySignature(other.address, n.message, await other.sign(n.message), 1_001)).toBeNull();
    expect(await auth.verifySignature(me.address, n.message, 'nothex', 1_001)).toBeNull();
    expect(await auth.verifySignature(me.address, n.message, await me.sign(n.message), 1_001)).toBe(me.address);
  });

  it('falls back to the on-chain check for smart wallets (ERC-1271 / ERC-6492)', async () => {
    const calls: string[] = [];
    const contractWallet = '0x00000000000000000000000000000000000c0de1';
    const auth = new Auth(Buffer.alloc(32, 1), {
      onChain: async (address, _message, signature) => {
        calls.push(address);
        return signature === '0x1271';
      },
    });
    const n = auth.issueNonce(contractWallet, origin, 1_000);
    expect(await auth.verifySignature(contractWallet, n.message, '0xdead', 1_001)).toBeNull();
    expect(await auth.verifySignature(contractWallet, n.message, '0x1271', 1_002)).toBe(checksumAddress(contractWallet));
    expect(calls).toEqual([checksumAddress(contractWallet), checksumAddress(contractWallet)]);
    // an EOA never needs the chain
    const eoa = testSigner();
    const m = auth.issueNonce(eoa.address, origin, 1_000);
    expect(await auth.verifySignature(eoa.address, m.message, await eoa.sign(m.message), 1_001)).toBe(eoa.address);
    expect(calls).toHaveLength(2);
  });

  it('tokens carry the checksummed address and are tamper-proof', () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { address } = testSigner();
    const token = auth.issueToken(address.toLowerCase(), 1_000);
    expect(auth.verifyToken(token, 2_000)).toBe(address);
    expect(auth.verifyToken(token.replace(address, address.toLowerCase()), 2_000)).toBeNull();
    expect(new Auth(Buffer.alloc(32, 2)).verifyToken(token, 2_000)).toBeNull();
    expect(auth.verifyToken(token, 1_000 + 25 * 3600_000)).toBeNull();
  });

  it('checksumAddress refuses a mixed-case address with a wrong checksum', () => {
    expect(checksumAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(checksumAddress('0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBeNull();
    expect(checksumAddress('D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm')).toBeNull();
  });

  it('takes the domain from PUBLIC_URL (the request host only in development); the chain id is the server\'s', () => {
    const req = { headers: { host: 'game.local:8787' } } as never;
    expect(siweOrigin(loadConfig({ PUBLIC_URL: 'https://elymum.io/' } as NodeJS.ProcessEnv), req, false, 99801)).toEqual({
      domain: 'elymum.io',
      uri: 'https://elymum.io',
      chainId: 99801,
    });
    const dev = loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    // chain off: the testnet id
    expect(siweOrigin(dev, req, false, null)).toEqual({ domain: 'game.local:8787', uri: 'http://game.local:8787', chainId: 99801 });
    expect(siweOrigin(dev, req, false, 31337).chainId).toBe(31337);
  });

  it('never lets a request choose the SIWE domain outside development (Host / X-Forwarded-Host spoofing)', async () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const victim = testSigner();
    const spoofs = [{ host: 'evil.example' }, { host: 'game.example', 'x-forwarded-host': 'evil.example, game.example' }];
    for (const headers of spoofs) {
      const req = { headers } as never;
      // PUBLIC_URL set: always its host
      expect(siweOrigin(loadConfig({ PUBLIC_URL: 'https://game.example' } as NodeJS.ProcessEnv), req, false, 99801).domain).toBe('game.example');
      // unset outside development (startup refuses this; the fallback is localhost, never the request)
      for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'test' }]) {
        const o = siweOrigin(loadConfig({ PORT: '8787', ...env } as NodeJS.ProcessEnv), req, false, 99801);
        expect(o.domain).toBe('localhost:8787');
        const n = auth.issueNonce(victim.address, o);
        expect(n.message).not.toContain('evil.example');
      }
      // development: Host only, X-Forwarded-Host is ignored
      expect(siweOrigin(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), req, false, 99801).domain).toBe(headers.host);
    }
  });

  it('refuses to start without PUBLIC_URL unless NODE_ENV=development', () => {
    expect(() => assertPublicUrl(loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv))).toThrow(/PUBLIC_URL is required \(NODE_ENV is production\)/);
    expect(() => assertPublicUrl(loadConfig({} as NodeJS.ProcessEnv))).toThrow(/PUBLIC_URL is required \(NODE_ENV is unset\)/);
    expect(() => assertPublicUrl(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv))).not.toThrow();
    expect(() => assertPublicUrl(loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://elymum.io/' } as NodeJS.ProcessEnv))).not.toThrow();
    for (const bad of ['elymum.io', 'ftp://elymum.io', 'https://elymum.io/app', 'https://u:p@elymum.io'])
      expect(() => assertPublicUrl(loadConfig({ NODE_ENV: 'production', PUBLIC_URL: bad } as NodeJS.ProcessEnv)), bad).toThrow(/PUBLIC_URL must be/);
  });
});

describe('nonce map (M2)', () => {
  it('is capped: the oldest nonces are evicted', async () => {
    const auth = new Auth(Buffer.alloc(32, 1));
    const { address, sign } = testSigner();
    const first = auth.issueNonce(address, origin, 0);
    for (let i = 0; i < MAX_NONCES + 50; i++) auth.issueNonce(address, origin, 1);
    expect(auth.nonceCount).toBeLessThanOrEqual(MAX_NONCES);
    // the very first nonce was evicted; a recent one still works
    expect(await auth.verifySignature(address, first.message, await sign(first.message), 2)).toBeNull();
    const last = auth.issueNonce(address, origin, 3);
    expect(await auth.verifySignature(address, last.message, await sign(last.message), 4)).toBe(address);
  });
});

import { siwsMessage } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { expectedLoginMessage } from '../src/solana/siws';

const pubkey = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const fields = { domain: 'slana.gg', uri: 'https://slana.gg', chainId: 'solana:mainnet', nonce: 'a'.repeat(24), issuedAt: '2026-10-15T00:00:00.000Z' };
const body = { ...fields, message: siwsMessage({ ...fields, address: pubkey }) };

describe('SIWS on the web (M1)', () => {
  it('signs only the message it rebuilds itself, for a domain it talks to', () => {
    expect(expectedLoginMessage(body, pubkey, ['slana.gg'])).toBe(body.message);
    // another domain than this page / the game server
    expect(expectedLoginMessage(body, pubkey, ['other.example'])).toBeNull();
    // the server text differs from its own fields (e.g. extra statement)
    expect(expectedLoginMessage({ ...body, message: body.message + '\nTransfer all funds' }, pubkey, ['slana.gg'])).toBeNull();
    // names another wallet
    expect(expectedLoginMessage(body, '11111111111111111111111111111111', ['slana.gg'])).toBeNull();
    // URI on another host than the domain
    expect(expectedLoginMessage({ ...body, uri: 'https://evil.example' }, pubkey, ['slana.gg'])).toBeNull();
    // an old server without the fields
    expect(expectedLoginMessage({ message: body.message }, pubkey, ['slana.gg'])).toBeNull();
  });
});

import { siweMessage } from '@elymum/shared';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { expectedLoginMessage, personalSign } from '../src/wallet/siwe';
import { ALICE, BOB, fakeProvider } from './evm-helpers';

const fields = { domain: 'elymum.test', uri: 'https://elymum.test', chainId: 99801, nonce: 'a'.repeat(24), issuedAt: '2026-10-29T00:00:00.000Z' };
const body = { ...fields, message: siweMessage({ ...fields, address: ALICE }) };

describe('SIWE on the web: sign only what the page rebuilt itself', () => {
  it('accepts the exact message for this page, this wallet and the server chain', () => {
    expect(expectedLoginMessage(body, ALICE, ['elymum.test'])).toBe(body.message);
    expect(expectedLoginMessage(body, ALICE, ['elymum.test'], { chainId: 99801 })).toBe(body.message);
    // the wallet address in any case: compared checksummed
    expect(expectedLoginMessage(body, ALICE.toLowerCase(), ['elymum.test'])).toBe(body.message);
    // a decimal-string chain id from the server is fine
    expect(expectedLoginMessage({ ...body, chainId: '99801' }, ALICE, ['elymum.test'])).toBe(body.message);
  });

  it('refuses another domain, URI host, wallet or chain', () => {
    expect(expectedLoginMessage(body, ALICE, ['other.example'])).toBeNull();
    expect(expectedLoginMessage({ ...body, uri: 'https://evil.example' }, ALICE, ['elymum.test'])).toBeNull();
    expect(expectedLoginMessage(body, BOB, ['elymum.test'])).toBeNull();
    expect(expectedLoginMessage(body, ALICE, ['elymum.test'], { chainId: 1 })).toBeNull();
    expect(expectedLoginMessage(body, 'not-an-address', ['elymum.test'])).toBeNull();
  });

  it('refuses a message that differs from its own fields', () => {
    expect(expectedLoginMessage({ ...body, message: body.message + '\nTransfer all funds' }, ALICE, ['elymum.test'])).toBeNull();
    // the fields say one nonce, the text another
    expect(expectedLoginMessage({ ...body, nonce: 'b'.repeat(24) }, ALICE, ['elymum.test'])).toBeNull();
    // the text names another address than the fields
    const other = siweMessage({ ...fields, address: BOB });
    expect(expectedLoginMessage({ ...body, message: other }, ALICE, ['elymum.test'])).toBeNull();
    // a lower-case (unchecksummed) address in the text is not the canonical message
    const carol = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    const lower = siweMessage({ ...fields, address: carol }).replace(carol, carol.toLowerCase());
    expect(expectedLoginMessage({ ...body, message: lower }, carol, ['elymum.test'])).toBeNull();
    expect(expectedLoginMessage({ ...body, message: siweMessage({ ...fields, address: carol }) }, carol.toLowerCase(), ['elymum.test'])).not.toBeNull();
    // an old server without the fields
    expect(expectedLoginMessage({ message: body.message }, ALICE, ['elymum.test'])).toBeNull();
    expect(expectedLoginMessage(null, ALICE, ['elymum.test'])).toBeNull();
  });

  it('asks the wallet for personal_sign of the UTF-8 hex of the text', async () => {
    const p = fakeProvider();
    const sig = await personalSign(p, getAddress(ALICE), 'hi');
    expect(sig).toMatch(/^0x[0-9a-f]+$/);
    expect(p.calls.at(-1)).toEqual({ method: 'personal_sign', params: ['0x6869', ALICE] });
  });
});

import { describe, expect, it } from 'vitest';
import { SIWE_STATEMENT, parseSiweMessage, siweFieldsError, siweMessage, type SiweFields } from '../src';

const FIELDS: SiweFields = {
  domain: 'elymum.io',
  address: '0x52908400098527886E0F7030069857D2E4169EE7',
  uri: 'https://elymum.io',
  chainId: 99801,
  nonce: '0123456789abcdef01234567',
  issuedAt: '2026-10-29T12:00:00.000Z',
};

const EXPECTED = [
  'elymum.io wants you to sign in with your Ethereum account:',
  '0x52908400098527886E0F7030069857D2E4169EE7',
  '',
  'Sign in to Elymum. This is free and sends no transaction.',
  '',
  'URI: https://elymum.io',
  'Version: 1',
  'Chain ID: 99801',
  'Nonce: 0123456789abcdef01234567',
  'Issued At: 2026-10-29T12:00:00.000Z',
].join('\n');

describe('siweMessage', () => {
  it('builds the exact EIP-4361 text', () => {
    expect(SIWE_STATEMENT).toBe('Sign in to Elymum. This is free and sends no transaction.');
    expect(siweMessage(FIELDS)).toBe(EXPECTED);
  });

  it('round-trips through the parser', () => {
    expect(parseSiweMessage(siweMessage(FIELDS))).toEqual(FIELDS);
    const local: SiweFields = { ...FIELDS, domain: 'localhost:5173', uri: 'http://localhost:5173', chainId: 31337, issuedAt: '2026-10-29T12:00:00+02:00' };
    expect(parseSiweMessage(siweMessage(local))).toEqual(local);
  });

  it('refuses to build from malformed fields', () => {
    const bad: [keyof SiweFields, unknown][] = [
      ['domain', 'https://elymum.io'],
      ['domain', 'elymum.io/path'],
      ['domain', ''],
      ['address', '0x1234'],
      ['address', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'],
      ['uri', 'not a uri'],
      ['chainId', 0],
      ['chainId', 1.5],
      ['chainId', '99801'],
      ['nonce', 'short'],
      ['nonce', '0123456789ABCDEF01234567'],
      ['issuedAt', 'yesterday'],
      ['issuedAt', '2026-13-45T99:00:00Z'],
    ];
    for (const [k, v] of bad) {
      const f = { ...FIELDS, [k]: v } as SiweFields;
      expect(siweFieldsError(f), `${k}=${String(v)}`).toBe(k);
      expect(() => siweMessage(f)).toThrow(RangeError);
    }
    expect(siweFieldsError(FIELDS)).toBeNull();
  });
});

describe('parseSiweMessage', () => {
  const swap = (i: number, line: string) => {
    const lines = EXPECTED.split('\n');
    lines[i] = line;
    return lines.join('\n');
  };

  it('rejects anything but the exact shape', () => {
    const cases: [string, unknown][] = [
      ['not a string', 42],
      ['empty', ''],
      ['other account kind', swap(0, 'elymum.io wants you to sign in with your Bitcoin account:')],
      ['bad address', swap(1, '0x1234')],
      ['other statement', swap(3, 'Sign this to win a prize.')],
      ['missing blank', swap(2, 'x')],
      ['other version', swap(6, 'Version: 2')],
      ['hex chain id', swap(7, 'Chain ID: 0x185d9')],
      ['leading zero chain id', swap(7, 'Chain ID: 099801')],
      ['bad nonce', swap(8, 'Nonce: zzz')],
      ['bad time', swap(9, 'Issued At: soon')],
      ['trailing space', swap(5, 'URI: https://elymum.io ')],
      ['extra field', `${EXPECTED}\nExpiration Time: 2026-10-30T00:00:00Z`],
      ['trailing newline', `${EXPECTED}\n`],
      ['CRLF', EXPECTED.replace(/\n/g, '\r\n')],
      ['missing line', EXPECTED.split('\n').slice(0, 9).join('\n')],
      ['reordered', swap(7, 'Nonce: 0123456789abcdef01234567')],
      ['too long', EXPECTED + 'x'.repeat(3000)],
    ];
    for (const [name, msg] of cases) expect(parseSiweMessage(msg), name).toBeNull();
  });
});

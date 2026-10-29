/**
 * Sign-In with Ethereum (EIP-4361) login message. The server issues the fields and the web
 * client rebuilds the message from them before asking the wallet to `personal_sign` it, so both
 * sides agree on every line. Only the fields Elymum uses are allowed (no Expiration Time,
 * Not Before, Request ID or Resources); the parser rejects anything else.
 *
 * The address must be EIP-55 checksummed by the caller (viem `getAddress`); this module has no
 * hashing and only checks the `0x` + 40 hex shape.
 */
export interface SiweFields {
  /** Host (and port) the player signs in to: the server's `PUBLIC_URL` host, else the request host. */
  domain: string;
  /** Wallet address, EIP-55 checksummed. */
  address: string;
  /** Base URL of the server the player signs in to (an RFC 3986 URI). */
  uri: string;
  /** The server's chain id (`eth_chainId` of its RPC). */
  chainId: number;
  /** One-time nonce (24 hex characters). */
  nonce: string;
  /** RFC 3339 time the nonce was issued. */
  issuedAt: string;
}

export const SIWE_STATEMENT = 'Sign in to Elymum. This is free and sends no transaction.';
export const SIWE_VERSION = '1';

const HEADER_SUFFIX = ' wants you to sign in with your Ethereum account:';
const DOMAIN_RE = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const URI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;
const CHAIN_ID_RE = /^[1-9]\d{0,15}$/;
const NONCE_RE = /^[0-9a-f]{24}$/;
const ISSUED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Why the fields cannot form a message, or null when they can. */
export function siweFieldsError(f: SiweFields): string | null {
  if (typeof f.domain !== 'string' || !DOMAIN_RE.test(f.domain)) return 'domain';
  if (typeof f.address !== 'string' || !ADDRESS_RE.test(f.address)) return 'address';
  if (typeof f.uri !== 'string' || !URI_RE.test(f.uri)) return 'uri';
  if (typeof f.chainId !== 'number' || !Number.isSafeInteger(f.chainId) || f.chainId <= 0) return 'chainId';
  if (typeof f.nonce !== 'string' || !NONCE_RE.test(f.nonce)) return 'nonce';
  if (typeof f.issuedAt !== 'string' || !ISSUED_AT_RE.test(f.issuedAt) || !Number.isFinite(Date.parse(f.issuedAt))) return 'issuedAt';
  return null;
}

/** The exact text a wallet signs to log in. Throws `RangeError` on a malformed field. */
export function siweMessage(f: SiweFields): string {
  const bad = siweFieldsError(f);
  if (bad) throw new RangeError(`invalid SIWE field: ${bad}`);
  return [
    `${f.domain}${HEADER_SUFFIX}`,
    f.address,
    '',
    SIWE_STATEMENT,
    '',
    `URI: ${f.uri}`,
    `Version: ${SIWE_VERSION}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ].join('\n');
}

/** Fields of a login message, or null when it is not exactly the message `siweMessage` builds. */
export function parseSiweMessage(message: unknown): SiweFields | null {
  if (typeof message !== 'string' || message.length > 2000) return null;
  const lines = message.split('\n');
  if (lines.length !== 10 || lines[2] !== '' || lines[3] !== SIWE_STATEMENT || lines[4] !== '') return null;
  if (!lines[0].endsWith(HEADER_SUFFIX)) return null;
  const uri = /^URI: (.+)$/.exec(lines[5]);
  const version = lines[6] === `Version: ${SIWE_VERSION}`;
  const chain = /^Chain ID: (.+)$/.exec(lines[7]);
  const nonce = /^Nonce: (.+)$/.exec(lines[8]);
  const issued = /^Issued At: (.+)$/.exec(lines[9]);
  if (!uri || !version || !chain || !nonce || !issued || !CHAIN_ID_RE.test(chain[1])) return null;
  const fields: SiweFields = {
    domain: lines[0].slice(0, -HEADER_SUFFIX.length),
    address: lines[1],
    uri: uri[1],
    chainId: Number(chain[1]),
    nonce: nonce[1],
    issuedAt: issued[1],
  };
  if (siweFieldsError(fields)) return null;
  // the canonical rebuild must match byte for byte (no stray spaces, no alternative spellings)
  return siweMessage(fields) === message ? fields : null;
}

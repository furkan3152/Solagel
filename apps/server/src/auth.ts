import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ELYSIUM_TESTNET_CHAIN_ID, parseSiweMessage, siweMessage } from '@elymum/shared';
import { getAddress, type Address, type Hex } from 'viem';
import { verifyEoa } from './chain/evm-client';

/** A nonce is single use and valid this long. */
export const NONCE_TTL_MS = 10 * 60_000;
const TOKEN_TTL_MS = 24 * 60 * 60_000;
/** Hard cap on outstanding nonces: the oldest are evicted beyond it (M2). */
export const MAX_NONCES = 10_000;

/** Where a login message says the player signs in (SIWE `domain`, `URI`, `Chain ID`). */
export interface SiweOrigin {
  domain: string;
  uri: string;
  /** The server's chain id (`eth_chainId` of its RPC). */
  chainId: number;
}

const DEFAULT_ORIGIN: SiweOrigin = { domain: 'localhost', uri: 'http://localhost', chainId: ELYSIUM_TESTNET_CHAIN_ID };

/** An EVM address: `0x` + 40 hex digits, any case. */
export function isValidAddress(s: unknown): s is string {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

/**
 * EIP-55 checksummed form of an address; null when it is not one, or when it is mixed-case with a
 * wrong checksum (a typo).
 */
export function checksumAddress(s: unknown): Address | null {
  if (!isValidAddress(s)) return null;
  try {
    const c = getAddress(s);
    const mixed = s.slice(2) !== s.slice(2).toLowerCase() && s.slice(2) !== s.slice(2).toUpperCase();
    return mixed && c !== s ? null : c;
  } catch {
    return null;
  }
}

/** Builds the exact text a wallet signs to log in (Sign-In with Ethereum, EIP-4361). */
export function loginMessage(address: string, nonce: string, issuedAt: string, origin: SiweOrigin = DEFAULT_ORIGIN): string {
  return siweMessage({ domain: origin.domain, address, uri: origin.uri, chainId: origin.chainId, nonce, issuedAt });
}

/** What `GET /api/auth/nonce` returns: the message and every field of it (the client rebuilds and compares). */
export interface IssuedNonce {
  nonce: string;
  message: string;
  /** EIP-55 checksummed. */
  address: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
}

/** On-chain check for smart-wallet signatures (ERC-1271 / ERC-6492); EOAs never need it. */
export type OnChainVerifier = (address: string, message: string, signature: string) => Promise<boolean>;

/** Wallet login: one-time SIWE nonces signed by the wallet, then stateless HMAC tokens. */
export class Auth {
  private readonly nonces = new Map<string, { address: string; message: string; expires: number; origin: SiweOrigin }>();
  private onChain: OnChainVerifier | null;

  constructor(
    private readonly secret: Buffer,
    opts: { onChain?: OnChainVerifier | null } = {},
  ) {
    this.onChain = opts.onChain ?? null;
  }

  /** Sets the smart-wallet fallback (the chain gateway's `verifyMessage`). */
  setOnChainVerifier(fn: OnChainVerifier | null): void {
    this.onChain = fn;
  }

  /**
   * A one-time nonce and the SIWE message for it. The fields are returned too, so the web client
   * can rebuild the message itself and refuse to sign anything else.
   */
  issueNonce(address: string, origin: SiweOrigin = DEFAULT_ORIGIN, now = Date.now()): IssuedNonce {
    const checksummed = checksumAddress(address);
    if (!checksummed) throw new Error('invalid address');
    this.prune(now);
    const nonce = randomBytes(12).toString('hex');
    const issuedAt = new Date(now).toISOString();
    const message = loginMessage(checksummed, nonce, issuedAt, origin);
    this.nonces.set(nonce, { address: checksummed, message, expires: now + NONCE_TTL_MS, origin });
    return { nonce, message, address: checksummed, domain: origin.domain, uri: origin.uri, chainId: origin.chainId, issuedAt };
  }

  /** Outstanding nonces (tests). */
  get nonceCount(): number {
    return this.nonces.size;
  }

  /**
   * Verifies a signed login message: the exact message issued for this nonce (domain, URI, chain id
   * and address of this server and wallet), signed by the wallet (`personal_sign`; an EOA is checked
   * locally, a smart wallet through the chain). The nonce is consumed on success. Returns the
   * checksummed address, or null.
   */
  async verifySignature(address: string, message: string, signature: string, now = Date.now()): Promise<string | null> {
    const checksummed = checksumAddress(address);
    if (!checksummed || typeof message !== 'string' || typeof signature !== 'string' || !/^0x[0-9a-fA-F]{2,4096}$/.test(signature)) return null;
    const fields = parseSiweMessage(message);
    if (!fields) return null;
    const entry = this.nonces.get(fields.nonce);
    if (!entry || entry.expires < now || entry.address !== checksummed || entry.message !== message) return null;
    // the signed text names this server: its domain, URI and chain, and the signing wallet
    const o = entry.origin;
    if (fields.address !== checksummed || fields.domain !== o.domain || fields.uri !== o.uri || fields.chainId !== o.chainId) return null;
    // single use: taken out before the (async) check so two concurrent replays cannot both pass
    this.nonces.delete(fields.nonce);
    let ok = await verifyEoa(checksummed, message, signature as Hex);
    if (!ok && this.onChain) ok = await this.onChain(checksummed, message, signature).catch(() => false);
    if (!ok && entry.expires >= now) this.nonces.set(fields.nonce, entry);
    return ok ? checksummed : null;
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  issueToken(address: string, now = Date.now()): string {
    const checksummed = checksumAddress(address);
    if (!checksummed) throw new Error('invalid address');
    const payload = `${checksummed}.${now + TOKEN_TTL_MS}`;
    return `${payload}.${this.mac(payload)}`;
  }

  /** Returns the (checksummed) wallet of a valid, unexpired token. */
  verifyToken(token: unknown, now = Date.now()): string | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [address, exp, mac] = parts;
    if (!isValidAddress(address) || !(Number(exp) > now)) return null;
    const expected = Buffer.from(this.mac(`${address}.${exp}`));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return address;
  }

  /** Drops expired nonces once there are many, then evicts the oldest beyond `MAX_NONCES`. */
  private prune(now: number): void {
    if (this.nonces.size < 1000) return;
    for (const [k, v] of this.nonces) if (v.expires < now) this.nonces.delete(k);
    // Map iteration is insertion order: the first keys are the oldest nonces
    while (this.nonces.size >= MAX_NONCES) this.nonces.delete(this.nonces.keys().next().value!);
  }
}

/**
 * Sign-In-With-Solana login message. The server issues it and the web client rebuilds it
 * from the same fields before asking the wallet to sign, so both sides agree on every line.
 */
export interface SiwsFields {
  /** Host (and port) the player signs in to: the server's `PUBLIC_URL` host, else the request host. */
  domain: string;
  /** Wallet address (base58). */
  address: string;
  /** Base URL of the server the player signs in to. */
  uri: string;
  /** `solana:<cluster>` (e.g. `solana:mainnet`, `solana:devnet`, `solana:localnet`). */
  chainId: string;
  /** One-time nonce (24 hex characters). */
  nonce: string;
  /** ISO-8601 time the nonce was issued. */
  issuedAt: string;
}

export const SIWS_STATEMENT = 'Sign this message to prove you own this wallet. It is free and does not send a transaction.';

/** The exact text a wallet signs to log in. */
export function siwsMessage(f: SiwsFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    '',
    SIWS_STATEMENT,
    '',
    `URI: ${f.uri}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ].join('\n');
}

/** `solana:<name>` for a cluster name (`mainnet-beta` → `solana:mainnet`). */
export function siwsChainId(cluster: string): string {
  const c = cluster.trim().toLowerCase();
  return `solana:${c === 'mainnet-beta' ? 'mainnet' : c || 'localnet'}`;
}

/** Fields of a login message, or null when it does not have the SIWS shape. */
export function parseSiwsMessage(message: string): SiwsFields | null {
  const lines = message.split('\n');
  if (lines.length !== 9 || lines[2] !== '' || lines[3] !== SIWS_STATEMENT || lines[4] !== '') return null;
  const head = /^(.+) wants you to sign in with your Solana account:$/.exec(lines[0]);
  const uri = /^URI: (.+)$/.exec(lines[5]);
  const chain = /^Chain ID: (.+)$/.exec(lines[6]);
  const nonce = /^Nonce: ([0-9a-f]{24})$/.exec(lines[7]);
  const issued = /^Issued At: (.+)$/.exec(lines[8]);
  if (!head || !uri || !chain || !nonce || !issued) return null;
  return { domain: head[1], address: lines[1], uri: uri[1], chainId: chain[1], nonce: nonce[1], issuedAt: issued[1] };
}

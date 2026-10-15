/**
 * `withdraw-treasury --to` resolution (admin CLI, I4). Pure: the CLI fetches the account and
 * passes it in, so the rules are unit-tested.
 */
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ata } from './token';

/** SPL token account base size; Token-2022 accounts with extensions are longer. */
const TOKEN_ACCOUNT_LEN = 165;
const MINT_LEN = 82;
const MULTISIG_LEN = 355;
/** Token-2022 `AccountType` byte after the 165-byte base (1 = mint, 2 = account). */
const ACCOUNT_TYPE_ACCOUNT = 2;

export interface DestinationAccount {
  /** Program that owns the account. */
  owner: PublicKey;
  data: Uint8Array;
}

export type WithdrawDestination =
  | { ok: true; destination: PublicKey; createAta: { owner: PublicKey } | null; note: string }
  | { ok: false; error: string };

const isTokenProgram = (p: PublicKey) => p.equals(TOKEN_PROGRAM_ID) || p.equals(TOKEN_2022_PROGRAM_ID);

/** Classifies a token-program account by its layout. */
function tokenAccountKind(data: Uint8Array): 'account' | 'mint' | 'multisig' | 'unknown' {
  if (data.length === TOKEN_ACCOUNT_LEN) return 'account';
  if (data.length === MINT_LEN) return 'mint';
  if (data.length === MULTISIG_LEN) return 'multisig';
  if (data.length > TOKEN_ACCOUNT_LEN) return data[TOKEN_ACCOUNT_LEN] === ACCOUNT_TYPE_ACCOUNT ? 'account' : 'mint';
  return 'unknown';
}

/**
 * Where `withdraw-treasury --to <address>` pays:
 * - a token account of the game mint (under the game token program) is used as is;
 * - any other token-program account (another mint's account, a mint, a multisig) is refused;
 * - otherwise `<address>` is an owner and its associated token account is the destination
 *   (created idempotently, the admin pays); an off-curve owner (a PDA, which may have no one
 *   able to sign for it) is refused unless `allowOffCurve`.
 */
export function resolveWithdrawDestination(
  to: PublicKey,
  account: DestinationAccount | null,
  game: { tokenMint: PublicKey; tokenProgram: PublicKey },
  allowOffCurve = false,
): WithdrawDestination {
  if (account && isTokenProgram(account.owner)) {
    const kind = tokenAccountKind(account.data);
    if (kind !== 'account') return { ok: false, error: `${to.toBase58()} is a token ${kind === 'unknown' ? 'program account' : kind}, not a token account or a wallet` };
    const mint = new PublicKey(account.data.subarray(0, 32));
    if (!account.owner.equals(game.tokenProgram) || !mint.equals(game.tokenMint)) {
      return { ok: false, error: `${to.toBase58()} is a token account of another mint (${mint.toBase58()}), not of the game token` };
    }
    return { ok: true, destination: to, createAta: null, note: 'token account of the game mint, used directly' };
  }
  if (!PublicKey.isOnCurve(to.toBytes()) && !allowOffCurve) {
    return { ok: false, error: `${to.toBase58()} is off the ed25519 curve (a PDA): nobody may be able to move tokens from its account. Pass --allow-off-curve if this is intended` };
  }
  return { ok: true, destination: ata(to, game.tokenMint, game.tokenProgram), createAta: { owner: to }, note: "the owner's associated token account (created if missing)" };
}

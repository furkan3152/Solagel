import { PublicKey } from '@solana/web3.js';
import idlJson from './idl/solagel.json';
import type { Solagel } from './idl/solagel';

export type { Solagel };

/**
 * The program IDL exactly as emitted by `anchor build` (snake_case). Typed with the camelCase
 * `Solagel` helper type like Anchor expects: `new Program<Solagel>(IDL, provider)`.
 * Re-sync with `pnpm -F @solagel/sdk sync-idl` after rebuilding the program.
 */
export const IDL = idlJson as unknown as Solagel;

/** Address the program was built for (`declare_id!`). Override per cluster with `PROGRAM_ID` env/config. */
export const PROGRAM_ID = new PublicKey(idlJson.address);

/** A public key or its base58 string. */
export type Address = PublicKey | string;

export const toPublicKey = (address: Address): PublicKey => (typeof address === 'string' ? new PublicKey(address) : address);

export const toBase58 = (address: Address): string => (typeof address === 'string' ? address : address.toBase58());

/** BPF upgradeable loader (owner of the program's ProgramData account). */
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

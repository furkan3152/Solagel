import {
  encodeFunctionData,
  formatEther,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';

/**
 * A contract call ready for a wallet: exactly the fields viem's `writeContract` /
 * `simulateContract` take. Every write helper of the SDK returns one, so the browser wallet (web),
 * the admin CLI and the server send the same thing, and the admin panel can preview it.
 */
export interface ContractCall<TAbi extends Abi = Abi> {
  address: Address;
  abi: TAbi;
  functionName: string;
  args: readonly unknown[];
  /** HYPE (wei) sent with the call. */
  value?: bigint;
}

/** Raw transaction fields of a call (`eth_sendTransaction` / `sendTransaction`). */
export function encodeCall(call: ContractCall): { to: Address; data: Hex; value?: bigint } {
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args } as never);
  return { to: call.address, data, ...(call.value !== undefined ? { value: call.value } : {}) };
}

/** Sends a call with the wallet client's account (or `opts.account`). Returns the transaction hash. */
export function sendCall(wallet: WalletClient, call: ContractCall, opts: { account?: Account | Address; chain?: Chain | null; gas?: bigint } = {}): Promise<Hash> {
  return wallet.writeContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    ...(call.value !== undefined ? { value: call.value } : {}),
    account: opts.account ?? wallet.account ?? null,
    chain: opts.chain === undefined ? wallet.chain : opts.chain,
    ...(opts.gas !== undefined ? { gas: opts.gas } : {}),
  } as never);
}

/** Dry-runs a call (`eth_call`) from `account`; throws the decoded revert (see `describeError`). */
export async function simulateCall(client: PublicClient, call: ContractCall, account: Account | Address): Promise<unknown> {
  const { result } = await client.simulateContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    ...(call.value !== undefined ? { value: call.value } : {}),
    account,
  } as never);
  return result;
}

/** One named argument of a call preview. */
export interface DescribedArg {
  name: string;
  type: string;
  /** Human text (addresses checksummed, bigints as decimal strings, structs as JSON). */
  value: string;
}

/** What a call will do, for the "preview before send" drawer and the CLI. */
export interface DescribedCall {
  to: Address;
  functionName: string;
  /** `setFeeBps(uint16)` */
  signature: string;
  args: DescribedArg[];
  /** Wei sent (0n when none). */
  value: bigint;
  /** e.g. `0.0312 HYPE`, or null without value. */
  valueText: string | null;
}

function show(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
}

/** Names, types and values of a call's arguments, read from its ABI. */
export function describeCall(call: ContractCall): DescribedCall {
  const fn = call.abi.find(
    (item): item is Extract<Abi[number], { type: 'function' }> =>
      item.type === 'function' && item.name === call.functionName && item.inputs.length === call.args.length,
  );
  const inputs = fn?.inputs ?? [];
  const value = call.value ?? 0n;
  return {
    to: call.address,
    functionName: call.functionName,
    signature: `${call.functionName}(${inputs.map((i) => i.type).join(',')})`,
    args: call.args.map((a, i) => ({ name: inputs[i]?.name || `arg${i}`, type: inputs[i]?.type ?? 'unknown', value: show(a) })),
    value,
    valueText: value > 0n ? `${formatEther(value)} HYPE` : null,
  };
}

/** One-line preview: `setFeeBps(bps=300) → 0xAbc…` (plus the value). */
export function describeCallLine(call: ContractCall): string {
  const d = describeCall(call);
  const args = d.args.map((a) => `${a.name}=${a.value}`).join(', ');
  return `${d.functionName}(${args}) → ${d.to}${d.valueText ? ` · value ${d.valueText}` : ''}`;
}

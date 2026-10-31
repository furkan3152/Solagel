import { planDefaultArenas, parseAddressInput, parseHypeInput, parseIntInput, AdminInputError, type StatusSnapshot } from '@elymum/sdk/ops';
import type { DeployArenaArgs, DeployNftArgs } from '@elymum/sdk';
import { formatEther, getAddress, type Address, type Hash } from 'viem';
import type { AdminNetwork } from './net';

/**
 * The deploy wizard of `/admin → Deploy` (spec section 5), as pure functions: connect the owner
 * wallet → check the chain → deploy the arena → deploy the NFT → register both with the server →
 * set the game token → create the default arenas. TestToken deploy + faucet are offered off
 * mainnet only. What was deployed from this browser but not registered yet is remembered locally
 * (`elymum.admin.deploy.v1`, per chain), so a failed registration can be retried.
 */
export type DeployStepId = 'connect' | 'chain' | 'arena' | 'nft' | 'register' | 'token' | 'arenas';
export type StepState = 'done' | 'active' | 'todo';

export interface DeployStep {
  id: DeployStepId;
  label: string;
  state: StepState;
  detail: string;
}

export interface LocalDeploy {
  address: Address;
  txHash: Hash | null;
}
export type LocalDeploys = Partial<Record<'arena' | 'nft' | 'token', LocalDeploy>>;

const KEY = 'elymum.admin.deploy.v1';

export function loadLocalDeploys(chainId: number | null | undefined): LocalDeploys {
  if (!chainId) return {};
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, LocalDeploys>;
    return all[String(chainId)] ?? {};
  } catch {
    return {};
  }
}

export function saveLocalDeploy(chainId: number, kind: 'arena' | 'nft' | 'token', d: LocalDeploy | null): LocalDeploys {
  let all: Record<string, LocalDeploys> = {};
  try {
    all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, LocalDeploys>;
  } catch {
    /* start fresh */
  }
  const mine = { ...(all[String(chainId)] ?? {}) };
  if (d) mine[kind] = d;
  else delete mine[kind];
  all[String(chainId)] = mine;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the wizard reads the server registry anyway */
  }
  return mine;
}

export interface WizardInput {
  me: Address | null;
  walletChainId: number | null;
  net: AdminNetwork;
  status: StatusSnapshot | null;
  local: LocalDeploys;
}

/** Each step's state: every step before the first unfinished one is done; that one is active. */
export function deploySteps(w: WizardInput): DeployStep[] {
  const target = w.net.info?.id ?? null;
  const arenaOk = (!!w.net.arenaAddress && w.status?.arena?.code === 'ok') || !!w.local.arena;
  const nftOk = (!!w.net.nftAddress && w.status?.nft?.code === 'ok') || !!w.local.nft;
  const registered = !!w.net.arenaAddress && !!w.net.nftAddress;
  const cfg = w.status?.arena?.config ?? null;
  const tokenSet = !!cfg?.token;
  const existing = (w.status?.arena?.arenas ?? []).filter((a) => a.exists).map((a) => a.id);
  const arenasLeft = cfg?.token ? planDefaultArenas(cfg.decimals, existing).create.length : 4;
  const raw: { id: DeployStepId; label: string; done: boolean; detail: string }[] = [
    { id: 'connect', label: 'Connect the owner wallet', done: !!w.me, detail: w.me ? `Connected: ${w.me}` : 'This wallet becomes the owner of both contracts.' },
    {
      id: 'chain',
      label: 'Check the chain',
      done: target !== null && w.walletChainId === target,
      detail: target === null ? 'The game server reports no chain yet.' : w.walletChainId === target ? `Wallet on ${w.net.info!.name} (${target}).` : `Switch the wallet to ${w.net.info!.name} (${target}).`,
    },
    { id: 'arena', label: 'Deploy ElymumArena', done: arenaOk, detail: w.net.arenaAddress ?? w.local.arena?.address ?? 'admin = you, server authority = the server key, fee wallet = you.' },
    { id: 'nft', label: 'Deploy ElymumNFT', done: nftOk, detail: w.net.nftAddress ?? w.local.nft?.address ?? 'Max supply 5,000, $1 in HYPE, 1 allowlist / 2 public per wallet.' },
    { id: 'register', label: 'Register both with the server', done: registered, detail: registered ? 'The server checked the code hash, the owner and the server authority.' : 'POST /api/admin/contracts for each.' },
    { id: 'token', label: 'Set the game token', done: tokenSet, detail: cfg?.token ?? 'Typed twice; it can be set only once.' },
    { id: 'arenas', label: 'Create the four arenas', done: tokenSet && arenasLeft === 0, detail: tokenSet ? (arenasLeft === 0 ? 'All four default arenas exist.' : `${arenasLeft} to create.`) : 'Needs the token.' },
  ];
  let activeSeen = false;
  return raw.map((s) => {
    if (s.done && !activeSeen) return { id: s.id, label: s.label, detail: s.detail, state: 'done' as const };
    if (!activeSeen) {
      activeSeen = true;
      return { id: s.id, label: s.label, detail: s.detail, state: 'active' as const };
    }
    return { id: s.id, label: s.label, detail: s.detail, state: s.done ? ('done' as const) : ('todo' as const) };
  });
}

/** The active step (null when everything is done). */
export const activeStep = (steps: readonly DeployStep[]): DeployStepId | null => steps.find((s) => s.state === 'active')?.id ?? null;

/** `ElymumArena` constructor arguments: admin = fee wallet = the connected wallet, server authority = the server's key. */
export function arenaDeployArgs(me: Address | null, serverKey: string | null | undefined): DeployArenaArgs {
  if (!me) throw new AdminInputError('Connect the owner wallet first.');
  if (!serverKey) throw new AdminInputError('The game server publishes no server key (serverKey), so the arena would have no settler. Fix the server first.');
  return { admin: getAddress(me), serverAuthority: parseAddressInput('Server key', serverKey), feeWallet: getAddress(me) };
}

export interface NftForm {
  maxSupply: string;
  /** HYPE per token (decimal text). */
  priceHype: string;
  wlLimit: string;
  publicLimit: string;
  baseURI: string;
  treasury: string;
}

/** The deploy form's defaults: 5,000 tokens, the $1 price from `/api/admin/mint/price`, 1 WL / 2 public, `${origin}/api/nft/`, treasury = you. */
export function defaultNftForm(origin: string, priceWei: string | null | undefined, me: Address | null): NftForm {
  return {
    maxSupply: '5000',
    priceHype: priceWei ? formatEther(BigInt(priceWei)) : '',
    wlLimit: '1',
    publicLimit: '2',
    baseURI: `${origin.replace(/\/+$/, '')}/api/nft/`,
    treasury: me ?? '',
  };
}

/** Parses the NFT deploy form (throws `AdminInputError` naming the field). */
export function nftDeployArgs(form: NftForm, me: Address | null): DeployNftArgs {
  if (!me) throw new AdminInputError('Connect the owner wallet first.');
  if (!form.priceHype.trim()) throw new AdminInputError('Mint price: enter a price in HYPE (the $1 price could not be read).');
  const baseURI = form.baseURI.trim();
  if (!/^https?:\/\/\S+\/$/.test(baseURI)) throw new AdminInputError('Base URI: an http(s) URL ending with "/" (tokenURI = baseURI + id).');
  return {
    owner: getAddress(me),
    maxSupply: parseIntInput('Max supply', form.maxSupply, 1, 4_294_967_295),
    mintPrice: parseHypeInput('Mint price', form.priceHype),
    wlLimit: parseIntInput('Allowlist limit', form.wlLimit, 0, 65_535),
    publicLimit: parseIntInput('Public limit', form.publicLimit, 0, 65_535),
    baseURI,
    treasury: parseAddressInput('Treasury', form.treasury),
  };
}

import {
  BPS,
  CLAIM_WINDOW_SECS,
  MAX_ARENA_PLAYERS,
  MAX_FEE_BPS,
  MIN_ARENA_PLAYERS,
  MIN_BUY_IN_LAMPORTS,
  solToLamports,
  type SolagelClient,
} from '@solagel/sdk';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';

export type AdminAction =
  | { kind: 'config'; paused: boolean; feeBps: string; seasonShareBps: string; treasury: string; serverAuthority: string }
  | { kind: 'createArena'; id: string; buyInSol: string; maxPlayers: string }
  | { kind: 'updateArena'; id: string; enabled: boolean; maxPlayers: string }
  | { kind: 'fundSeason'; seasonId: number; amountSol: string }
  | { kind: 'endSeason'; seasonId: number }
  | { kind: 'rolloverSeason'; seasonId: string; currentSeason: number }
  | { kind: 'sweepArena'; id: string };

export interface PreparedAdminAction {
  action: AdminAction;
  instruction: TransactionInstruction;
  title: string;
  details: { label: string; value: string }[];
  notices: string[];
  fingerprint: string;
}

type AdminClient = Pick<SolagelClient, 'programId' | 'ix' | 'fetchConfig' | 'fetchArena' | 'fetchSeason'>;

/** User-entered money must be an exact decimal; never silently round a lamport. */
export function parseAdminSol(value: string, minLamports = 1): number {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,9})?$/.test(text)) throw new Error('Enter a SOL amount with at most 9 decimal places, without signs or exponents.');
  const [whole, fraction = ''] = text.split('.');
  const exact = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This SOL amount exceeds the supported precise range.');
  if (exact < BigInt(minLamports)) throw new Error(`The minimum amount is ${formatAdminSol(minLamports)} SOL.`);
  // The SDK accepts numeric inputs too. Cross-check its result against the
  // exact decimal before giving it any admin-entered monetary value.
  const result = solToLamports(text);
  if (BigInt(result) !== exact) throw new Error('This amount cannot be represented exactly. Enter a smaller SOL amount.');
  return result;
}

export function formatAdminSol(lamports: number): string {
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('Invalid lamport amount.');
  const exact = BigInt(lamports);
  const fraction = (exact % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${exact / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`;
}

function integer(value: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return result;
}

function address(value: string, label: string, signer = false): string {
  let key: PublicKey;
  try { key = new PublicKey(value.trim()); } catch { throw new Error(`${label} must be a valid Solana public address.`); }
  if (key.equals(PublicKey.default)) throw new Error(`${label} cannot be the system program address.`);
  if (signer && !PublicKey.isOnCurve(key.toBytes())) throw new Error(`${label} must be a wallet public address that can sign.`);
  return key.toBase58();
}

/** Read fresh accounts, authorize the signing wallet and prepare an explicit review. No transaction is sent. */
export async function prepareAdminAction(
  client: AdminClient,
  actor: string,
  action: AdminAction,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<PreparedAdminAction> {
  const config = await client.fetchConfig();
  if (!config) throw new Error('The deployed program configuration is unavailable. Deploy and initialize it before using these controls.');
  if (config.admin !== actor) throw new Error('Connect the wallet that is the current on-chain administrator.');
  const details = [{ label: 'Signing administrator', value: actor }, { label: 'Program', value: client.programId.toBase58() }];
  const notices: string[] = ['Your wallet pays the Solana transaction fee and any required account rent.'];
  let instruction: TransactionInstruction;
  let title: string;
  const add = (label: string, value: string | number) => details.push({ label, value: String(value) });
  const requireSeason = (expected: number) => {
    if (config.currentSeason !== expected) throw new Error('The current season changed. Refresh and review the action again.');
  };

  switch (action.kind) {
    case 'config': {
      const feeBps = integer(action.feeBps, 'Profit fee in basis points', 0, MAX_FEE_BPS);
      const seasonShareBps = integer(action.seasonShareBps, 'Season share in basis points', 0, BPS);
      const treasury = address(action.treasury, 'Treasury');
      const serverAuthority = address(action.serverAuthority, 'Server authority', true);
      if (feeBps === config.feeBps && seasonShareBps === config.seasonShareBps && treasury === config.treasury && serverAuthority === config.serverAuthority && action.paused === config.paused) {
        throw new Error('These configuration values are already active.');
      }
      title = 'Update program configuration';
      add('New ticket admissions', `${config.paused ? 'Paused' : 'Open'} → ${action.paused ? 'Paused' : 'Open'}`);
      add('Profit fee', `${config.feeBps} → ${feeBps} basis points (${feeBps / 100}%)`);
      add('Season share of the fee', `${config.seasonShareBps} → ${seasonShareBps} basis points (${seasonShareBps / 100}%)`);
      add('Current treasury', config.treasury);
      add('New treasury', treasury);
      add('Current server authority', config.serverAuthority);
      add('New server authority', serverAuthority);
      notices.push('Fee and treasury changes apply to future settlements, including sessions already open. Pausing admissions does not stop cash-outs.');
      if (serverAuthority !== config.serverAuthority) notices.push('Changing the server authority requires the game server to use the matching signing wallet. Update its configuration before reopening admissions.');
      instruction = await client.ix.updateConfig(actor, { paused: action.paused, feeBps, seasonShareBps, treasury, serverAuthority });
      break;
    }
    case 'createArena': {
      const id = integer(action.id, 'Arena ID', 0, 65_535);
      const buyIn = parseAdminSol(action.buyInSol, MIN_BUY_IN_LAMPORTS);
      const maxPlayers = integer(action.maxPlayers, 'Capacity', MIN_ARENA_PLAYERS, MAX_ARENA_PLAYERS);
      if (await client.fetchArena(id)) throw new Error('That arena ID already exists. Choose a new ID for a new SOL entry tier.');
      title = 'Create a SOL arena';
      add('Arena ID', id);
      add('Entry price', `${formatAdminSol(buyIn)} SOL (${buyIn} lamports)`);
      add('Ticket capacity', maxPlayers);
      notices.push('The new arena starts enabled. Its SOL entry price is permanent; future price tiers need a new arena ID.');
      instruction = await client.ix.createArena(actor, id, buyIn, maxPlayers);
      break;
    }
    case 'updateArena': {
      const id = integer(action.id, 'Arena ID', 0, 65_535);
      const maxPlayers = integer(action.maxPlayers, 'Capacity', MIN_ARENA_PLAYERS, MAX_ARENA_PLAYERS);
      const arena = await client.fetchArena(id);
      if (!arena) throw new Error('This arena does not exist.');
      if (arena.maxPlayers === maxPlayers && arena.enabled === action.enabled) throw new Error('These arena settings are already active.');
      title = 'Update SOL arena admissions';
      add('Arena ID', id);
      add('Entry price, unchanged', `${formatAdminSol(arena.buyIn)} SOL`);
      add('Ticket capacity', `${arena.maxPlayers} → ${maxPlayers}`);
      add('New ticket admissions', `${arena.enabled ? 'Open' : 'Disabled'} → ${action.enabled ? 'Open' : 'Disabled'}`);
      add('Currently open tickets', arena.openSessions);
      notices.push('Existing sessions keep their original entry price and remain eligible for settlement. Disabling admissions does not remove their cells.');
      if (maxPlayers < arena.openSessions) notices.push('Open tickets exceed the new capacity. New tickets remain blocked until enough existing tickets close.');
      instruction = await client.ix.updateArena(actor, id, { enabled: action.enabled, maxPlayers });
      break;
    }
    case 'fundSeason': {
      requireSeason(action.seasonId);
      const amount = parseAdminSol(action.amountSol);
      const season = await client.fetchSeason(config.currentSeason);
      if (!season || season.finalized) throw new Error('The current season is unavailable or already finalized.');
      title = 'Fund the current season';
      add('Season', config.currentSeason);
      add('From wallet', actor);
      add('Prize pool account', season.address);
      add('Transfer amount', `${formatAdminSol(amount)} SOL (${amount} lamports)`);
      notices.push('This donation goes to the season prize pool and cannot be withdrawn by the administrator.');
      instruction = await client.ix.fundSeason(actor, config.currentSeason, amount);
      break;
    }
    case 'endSeason': {
      requireSeason(action.seasonId);
      if (config.currentSeason >= 4_294_967_295) throw new Error('The season counter cannot advance further.');
      const season = await client.fetchSeason(config.currentSeason);
      if (!season || season.finalized) throw new Error('This season is unavailable or already finalized.');
      title = 'End the current season';
      add('Season to finalize', config.currentSeason);
      add('Next season', config.currentSeason + 1);
      add('Current prize pool', `${formatAdminSol(season.pool)} SOL`);
      notices.push('This freezes the leaderboard and starts the 30-day reward claim window. Finalization cannot be undone.');
      instruction = await client.ix.endSeason(actor, config.currentSeason);
      break;
    }
    case 'rolloverSeason': {
      requireSeason(action.currentSeason);
      const id = integer(action.seasonId, 'Old season ID', 1, 4_294_967_295);
      if (id >= config.currentSeason) throw new Error('Choose a finalized season before the current one.');
      const [old, current] = await Promise.all([client.fetchSeason(id), client.fetchSeason(config.currentSeason)]);
      if (!old?.finalized || !old.endedAt) throw new Error('The old season has not been finalized.');
      if (nowSeconds <= old.endedAt + CLAIM_WINDOW_SECS) throw new Error('The full 30-day claim window must close before rolling over unclaimed rewards.');
      if (!current || current.finalized) throw new Error('The current season is unavailable.');
      if (old.pool <= 0) throw new Error('This season has no unclaimed SOL to roll over.');
      title = 'Roll over unclaimed season rewards';
      add('From season', id);
      add('To season', config.currentSeason);
      add('Unclaimed amount', `${formatAdminSol(old.pool)} SOL`);
      add('Destination prize pool', current.address);
      notices.push('The expired season’s remaining rewards move into the current prize pool.');
      instruction = await client.ix.rolloverSeason(actor, id, config.currentSeason);
      break;
    }
    case 'sweepArena': {
      const id = integer(action.id, 'Arena ID', 0, 65_535);
      const arena = await client.fetchArena(id);
      if (!arena) throw new Error('This arena does not exist.');
      if (arena.openSessions !== 0) throw new Error('Close and settle every arena ticket before sweeping. The arena still has open sessions.');
      if (arena.pot <= 0) throw new Error('This arena has no excess SOL to sweep.');
      title = 'Sweep an empty arena';
      add('Arena ID', id);
      add('Open sessions', 0);
      add('Transfer amount', `${formatAdminSol(arena.pot)} SOL`);
      add('Treasury destination', config.treasury);
      notices.push('Only funds above account rent move to the treasury. The transaction fails if another ticket opens before execution.');
      instruction = await client.ix.sweepArena(actor, id, config.treasury);
      break;
    }
  }
  const fingerprint = JSON.stringify({ title, details, notices, data: Array.from(instruction.data), keys: instruction.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]) });
  return { action, instruction, title, details, notices, fingerprint };
}

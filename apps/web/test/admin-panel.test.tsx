import { vi } from 'vitest';

// jsdom swaps in its own Uint8Array, so web3.js' PDA hashing (noble) rejects the Node-realm bytes it
// gets ("Unable to find a viable program address nonce"). Put Node's Uint8Array back for this file.
vi.hoisted(() => {
  globalThis.Uint8Array = Object.getPrototypeOf((globalThis as unknown as { Buffer: { prototype: object } }).Buffer.prototype).constructor as Uint8ArrayConstructor;
});

import { ConnectionContext, WalletContext, type WalletContextState } from '@solana/wallet-adapter-react';
import { ASSOCIATED_TOKEN_PROGRAM_ID, BPF_LOADER_UPGRADEABLE_ID, PROGRAM_ID, SlanaClient, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ata, pdas } from '@slana/sdk';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, type AccountInfo } from '@solana/web3.js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminPanel } from '../src/admin/AdminPanel';
import type { AdminNetwork } from '../src/admin/net';
import { Kb } from '../src/design';

/* ------------------------------------------------------------------ */
/* A tiny in-memory chain behind a Connection-shaped object.           */
/* ------------------------------------------------------------------ */

const sdk = new SlanaClient(new Connection('http://127.0.0.1:1'));
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const genesis = { hash: DEVNET_GENESIS };

const coder = {
  accounts: sdk.program.coder.accounts,
  // BorshInstructionCoder decodes; the public type only declares encode
  instruction: sdk.program.coder.instruction as unknown as { decode(data: Buffer): unknown },
};
/** bn.js (u64 fields) without a direct dependency: the class the SDK's coder decodes u64 into. */
type BN = { toNumber(): number };
const BN = await (async () => {
  const k = Keypair.generate().publicKey;
  const ix = await sdk.ix.initialize(k, { serverAuthority: k, feeWallet: k, feeBps: 0, settleFeeLamports: 1 });
  const d = coder.instruction.decode(ix.data) as unknown as { data: { args: { settleFeeLamports: object } } };
  return d.data.args.settleFeeLamports.constructor as new (n: number) => BN;
})();
type Acc = AccountInfo<Buffer>;
const accounts = new Map<string, Acc>();
const sent: Transaction[] = [];

const acc = (owner: PublicKey, data: Uint8Array, executable = false): Acc => ({ owner, data: Buffer.from(data), executable, lamports: 1_000_000, rentEpoch: 0 });

const connection = {
  rpcEndpoint: 'http://fake',
  commitment: 'confirmed',
  getAccountInfo: vi.fn(async (k: PublicKey) => accounts.get(k.toBase58()) ?? null),
  getMultipleAccountsInfo: vi.fn(async (ks: PublicKey[]) => ks.map((k) => accounts.get(k.toBase58()) ?? null)),
  getProgramAccounts: vi.fn(async () => {
    throw new Error('disabled');
  }),
  getBalance: vi.fn(async () => 2_000_000_000),
  getLatestBlockhash: vi.fn(async () => ({ blockhash: bs58.encode(Keypair.generate().publicKey.toBytes()), lastValidBlockHeight: 1_000 })),
  sendRawTransaction: vi.fn(async (bytes: Uint8Array) => {
    const tx = Transaction.from(bytes);
    sent.push(tx);
    return bs58.encode(tx.signature!);
  }),
  getSignatureStatuses: vi.fn(async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] })),
  getBlockHeight: vi.fn(async () => 1),
  getGenesisHash: vi.fn(async () => genesis.hash),
} as unknown as Connection;

const admin = Keypair.generate();
const server = Keypair.generate().publicKey;
const programData = pdas.programData(PROGRAM_ID);

function deploy(authority: PublicKey) {
  accounts.set(PROGRAM_ID.toBase58(), acc(BPF_LOADER_UPGRADEABLE_ID, new Uint8Array(36), true));
  const d = new Uint8Array(45 + 16);
  d[0] = 3;
  d[12] = 1;
  d.set(authority.toBytes(), 13);
  accounts.set(programData.toBase58(), acc(BPF_LOADER_UPGRADEABLE_ID, d));
}

async function initConfig(o: { admin: PublicKey; feeWallet?: PublicKey; mint?: PublicKey; tokenProgram?: PublicKey; decimals?: number }) {
  const data = await coder.accounts.encode('config', {
    admin: o.admin,
    serverAuthority: server,
    feeWallet: o.feeWallet ?? o.admin,
    tokenMint: o.mint ?? PublicKey.default,
    tokenProgram: o.tokenProgram ?? PublicKey.default,
    tokenDecimals: o.decimals ?? 0,
    feeBps: 500,
    settleFeeLamports: new BN(20_000),
    paused: false,
    bump: 255,
    totalPlayers: new BN(0),
    totalGames: new BN(0),
    totalSessions: new BN(0),
    totalStaked: new BN(0),
    totalPaidOut: new BN(0),
  });
  accounts.set(pdas.config(PROGRAM_ID).toBase58(), acc(PROGRAM_ID, data));
}

/** A mint account (82-byte base; Token-2022 extensions as TLV after the account type byte). */
function mintAccount(program: PublicKey, o: { freeze?: PublicKey; extensions?: number[] } = {}): Acc {
  const base = new Uint8Array(82);
  new DataView(base.buffer).setBigUint64(36, 1_000_000_000_000n, true);
  base[44] = 6;
  base[45] = 1;
  if (o.freeze) {
    base[46] = 1;
    base.set(o.freeze.toBytes(), 50);
  }
  if (!o.extensions) return acc(program, base);
  const tlv = o.extensions.flatMap((t) => [t, 0, 0, 0]);
  const out = new Uint8Array(166 + tlv.length);
  out.set(base);
  out[165] = 1;
  out.set(tlv, 166);
  return acc(program, out);
}

/* ------------------------------------------------------------------ */

const net: AdminNetwork = {
  rpcUrl: 'http://fake',
  cluster: 'devnet',
  programId: PROGRAM_ID.toBase58(),
  serverProgramId: PROGRAM_ID.toBase58(),
  claimedCluster: 'devnet',
  serverKey: server.toBase58(),
  fake: false,
  source: 'env',
  priorityMicroLamports: 20_000,
};

const signTransaction = vi.fn(async (tx: Transaction) => {
  tx.partialSign(admin);
  return tx;
});

function walletOf(kp: Keypair | null): WalletContextState {
  return {
    publicKey: kp?.publicKey ?? null,
    connected: !!kp,
    connecting: false,
    wallets: [],
    wallet: null,
    signTransaction,
    disconnect: vi.fn(),
    select: vi.fn(),
  } as unknown as WalletContextState;
}

function renderPanel(kp: Keypair | null, n: AdminNetwork = net) {
  return render(
    <ConnectionContext.Provider value={{ connection }}>
      <WalletContext.Provider value={walletOf(kp)}>
        <Kb>
          <AdminPanel net={n} />
        </Kb>
      </WalletContext.Provider>
    </ConnectionContext.Provider>,
  );
}

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp | string, value: string) => fireEvent.change(field(label), { target: { value } });

beforeEach(() => {
  genesis.hash = DEVNET_GENESIS;
  accounts.clear();
  sent.length = 0;
  signTransaction.mockClear();
});

describe('admin panel: the gate', () => {
  it('a wallet that is not the config admin sees the status read-only', async () => {
    deploy(admin.publicKey);
    await initConfig({ admin: admin.publicKey });
    renderPanel(Keypair.generate());
    expect(await screen.findByRole('heading', { name: 'Connect the admin wallet' })).toBeTruthy();
    await screen.findByText('not set');
    expect(screen.getByText(/the config admin, so the panel is read-only/)).toBeTruthy();
    // the admin is shown, no action can be started
    expect(screen.getAllByText(admin.publicKey.toBase58()).length).toBeGreaterThan(0);
    for (const name of [/Review/, /Pause/, /Create the 4 default arenas/, /Sweep/]) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('before initialize, only the upgrade authority gets the Initialize form', async () => {
    deploy(admin.publicKey);
    const { unmount } = renderPanel(Keypair.generate());
    expect(await screen.findByText(/upgrade authority, which alone can initialize it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Review initialize/ })).toBeNull();
    unmount();
    renderPanel(admin);
    expect(await screen.findByRole('button', { name: /Review initialize/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect the admin wallet' })).toBeNull();
  });

  it('the MAINNET banner comes from the genesis hash, not from the claim', async () => {
    genesis.hash = MAINNET_GENESIS;
    const { unmount } = renderPanel(null, { ...net, cluster: 'mainnet-beta', claimedCluster: 'mainnet-beta' });
    expect(await screen.findByText(/Every transaction signed here is final/)).toBeTruthy();
    expect(screen.getByText(/from the genesis hash/)).toBeTruthy();
    unmount();
    // claims mainnet, RPC is devnet: no banner, signing blocked
    genesis.hash = DEVNET_GENESIS;
    renderPanel(null, { ...net, cluster: 'mainnet-beta', claimedCluster: 'mainnet-beta' });
    expect(await screen.findByText(/The RPC is devnet \(genesis hash\), but the configuration claims mainnet-beta/)).toBeTruthy();
    expect(screen.queryByText(/Every transaction signed here is final/)).toBeNull();
  });
});

describe('admin panel: initialize', () => {
  beforeEach(() => deploy(admin.publicKey));

  it('validates the form: server required, fee bps at most 1000, settle fee an integer', async () => {
    renderPanel(admin);
    await screen.findByRole('button', { name: /Review initialize/ });
    // prefilled from the server's key, fee wallet from the connected wallet
    expect(field(/Server authority/).value).toBe(server.toBase58());
    expect(screen.getByText("Prefilled with this server's key.")).toBeTruthy();
    expect(field('Fee wallet').value).toBe(admin.publicKey.toBase58());
    type(/Server authority/, '');
    type('Fee (bps)', '1001');
    type('Settle fee (lamports)', '1.5');
    fireEvent.click(screen.getByRole('button', { name: /Review initialize/ }));
    expect(await screen.findByText('Server authority is required')).toBeTruthy();
    expect(screen.getByText('Fee (bps) must be an integer between 0 and 1000')).toBeTruthy();
    expect(screen.getByText(/Settle fee \(lamports\) must be an integer/)).toBeTruthy();
    type(/Server authority/, 'not-a-key');
    fireEvent.click(screen.getByRole('button', { name: /Review initialize/ }));
    expect(await screen.findByText(/not a valid public key/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('builds initialize, shows it, and signs it with the wallet', async () => {
    renderPanel(admin);
    await screen.findByRole('button', { name: /Review initialize/ });
    type('Fee (bps)', '250');
    fireEvent.click(screen.getByRole('button', { name: /Review initialize/ }));
    const dialog = await screen.findByRole('dialog');
    const ixs = within(dialog).getAllByTestId('review-ix');
    expect(ixs.map((li) => li.querySelector('strong')?.textContent)).toEqual(['Compute Budget · setComputeUnitPrice', 'Slana · initialize']);
    expect(within(ixs[1]).getByText(programData.toBase58())).toBeTruthy();

    // the config appears once the transaction lands
    await initConfig({ admin: admin.publicKey });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Sign with wallet' }));
    });
    await within(dialog).findByText(/Confirmed/);
    expect(signTransaction).toHaveBeenCalledTimes(1);
    const tx = sent[0];
    expect(tx.feePayer?.equals(admin.publicKey)).toBe(true);
    expect(tx.instructions.map((i) => i.programId.toBase58())).toEqual([ComputeBudgetProgram.programId.toBase58(), PROGRAM_ID.toBase58()]);
    const init = tx.instructions[1];
    expect(init.keys.map((k) => k.pubkey.toBase58())).toEqual([admin.publicKey, pdas.config(PROGRAM_ID), PROGRAM_ID, programData, SystemProgram.programId].map((k) => k.toBase58()));
    const decoded = coder.instruction.decode(init.data) as unknown as { name: string; data: { args: { feeBps: number; settleFeeLamports: BN; serverAuthority: PublicKey; feeWallet: PublicKey } } };
    expect(decoded.name).toBe('initialize');
    expect(decoded.data.args.feeBps).toBe(250);
    expect(decoded.data.args.settleFeeLamports.toNumber()).toBe(20_000);
    expect(decoded.data.args.serverAuthority.equals(server)).toBe(true);
    expect(decoded.data.args.feeWallet.equals(admin.publicKey)).toBe(true);
    // the status re-reads: the Set token step appears
    expect(await screen.findByRole('heading', { name: 'Set token' })).toBeTruthy();
  });
});

describe('admin panel: set token', () => {
  const feeWallet = Keypair.generate().publicKey;
  beforeEach(async () => {
    deploy(admin.publicKey);
    await initConfig({ admin: admin.publicKey, feeWallet });
  });

  async function check(mint: PublicKey) {
    renderPanel(admin);
    await screen.findByRole('heading', { name: 'Set token' });
    type('Mint address (CA)', mint.toBase58());
    fireEvent.click(screen.getByRole('button', { name: 'Check mint' }));
    return screen.findByTestId('mint-report');
  }

  it('blocks a mint the program refuses (Token-2022 transfer hook, freeze authority)', async () => {
    const hook = Keypair.generate().publicKey;
    accounts.set(hook.toBase58(), mintAccount(TOKEN_2022_PROGRAM_ID, { extensions: [18, 14] }));
    const report = await check(hook);
    expect(within(report).getByText('TransferHook (refused)')).toBeTruthy();
    expect(within(report).getByText(/refuses these Token-2022 extensions: TransferHook/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review set token' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks a mint with a freeze authority', async () => {
    const frozen = Keypair.generate().publicKey;
    accounts.set(frozen.toBase58(), mintAccount(TOKEN_PROGRAM_ID, { freeze: Keypair.generate().publicKey }));
    const report = await check(frozen);
    expect(within(report).getByText(/has a freeze authority/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review set token' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires the mint retyped, then sends ATA create + set_token_mint in one transaction', async () => {
    const mint = Keypair.generate().publicKey;
    accounts.set(mint.toBase58(), mintAccount(TOKEN_2022_PROGRAM_ID, { extensions: [18] }));
    const report = await check(mint);
    expect(within(report).getByText('The program accepts this mint.')).toBeTruthy();
    expect(within(report).getByText('Token-2022')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review set token' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('ONE-TIME AND IRREVERSIBLE')).toBeTruthy();
    const sign = within(dialog).getByRole('button', { name: 'Sign with wallet' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    const retype = within(dialog).getByLabelText('Type the mint address again to confirm');
    fireEvent.change(retype, { target: { value: mint.toBase58().slice(0, -1) + (mint.toBase58().endsWith('1') ? '2' : '1') } });
    expect(within(dialog).getByText('Does not match. Type the address exactly.')).toBeTruthy();
    expect(sign.disabled).toBe(true);
    fireEvent.click(sign);
    expect(signTransaction).not.toHaveBeenCalled();
    fireEvent.change(retype, { target: { value: mint.toBase58() } });
    expect(sign.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(sign);
    });
    await within(dialog).findByText(/Confirmed/);
    const tx = sent[0];
    expect(tx.instructions.map((i) => i.programId.toBase58())).toEqual([ComputeBudgetProgram.programId, ASSOCIATED_TOKEN_PROGRAM_ID, PROGRAM_ID].map((k) => k.toBase58()));
    const [, create, set] = tx.instructions;
    expect([...create.data]).toEqual([1]); // CreateIdempotent
    expect(create.keys.map((k) => k.pubkey.toBase58())).toEqual(
      [admin.publicKey, ata(feeWallet, mint, TOKEN_2022_PROGRAM_ID), feeWallet, mint, SystemProgram.programId, TOKEN_2022_PROGRAM_ID].map((k) => k.toBase58()),
    );
    expect((coder.instruction.decode(set.data) as { name: string }).name).toBe('setTokenMint');
    expect(set.keys.map((k) => k.pubkey.toBase58())).toEqual([admin.publicKey, pdas.config(PROGRAM_ID), mint, TOKEN_2022_PROGRAM_ID].map((k) => k.toBase58()));
  });
});

describe('admin panel: config and arenas', () => {
  it('warns when the server authority is not this server, and creates the default arenas in one transaction', async () => {
    const mint = Keypair.generate().publicKey;
    deploy(admin.publicKey);
    await initConfig({ admin: admin.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6 });
    accounts.set(mint.toBase58(), mintAccount(TOKEN_PROGRAM_ID));
    const other = Keypair.generate().publicKey.toBase58();
    renderPanel(admin, { ...net, serverKey: other });
    expect(await screen.findByText(/is not this server's key/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create the 4 default arenas' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByTestId('review-ix')).toHaveLength(5);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Sign with wallet' }));
    });
    await within(dialog).findByText(/Confirmed/);
    const created = sent[0].instructions.slice(1).map((i) => coder.instruction.decode(i.data) as unknown as { name: string; data: { id: number } });
    expect(created.map((c) => [c.name, c.data.id])).toEqual([
      ['createArena', 1],
      ['createArena', 2],
      ['createArena', 3],
      ['createArena', 4],
    ]);
  });
});

describe('admin panel: network pinning', () => {
  beforeEach(() => deploy(admin.publicKey));

  async function openInitReview(n: AdminNetwork) {
    renderPanel(admin, n);
    await screen.findByRole('button', { name: /Review initialize/ });
    fireEvent.click(screen.getByRole('button', { name: /Review initialize/ }));
    return screen.findByRole('dialog');
  }

  it('the pinned program id is shown; a different server program id blocks signing', async () => {
    const other = Keypair.generate().publicKey.toBase58();
    const dialog = await openInitReview({ ...net, serverProgramId: other });
    expect(screen.getAllByText(/SIGNING BLOCKED/).length).toBeGreaterThan(0);
    expect(screen.getByText(`MISMATCH: ${other}`)).toBeTruthy();
    expect(screen.getAllByText(PROGRAM_ID.toBase58()).length).toBeGreaterThan(0);
    expect(screen.getByText('Pinned program id')).toBeTruthy();
    const sign = within(dialog).getByRole('button', { name: 'Sign with wallet' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    fireEvent.click(sign);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('an unknown genesis hash blocks signing; a matching one allows it', async () => {
    genesis.hash = Keypair.generate().publicKey.toBase58();
    const dialog = await openInitReview(net);
    expect(within(dialog).getByText(/Unknown genesis hash/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Sign with wallet' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('signing waits for the genesis check and is enabled once it matches', async () => {
    const dialog = await openInitReview(net);
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Sign with wallet' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/SIGNING BLOCKED/)).toBeNull();
  });
});

describe('admin panel: admin transfer checks', () => {
  beforeEach(async () => {
    deploy(admin.publicKey);
    await initConfig({ admin: admin.publicKey });
  });

  async function review(newAdmin: string) {
    renderPanel(admin);
    await screen.findByRole('heading', { name: 'Update config' });
    type('Admin (transfer)', newAdmin);
    fireEvent.click(screen.getByRole('button', { name: 'Review config update' }));
  }

  it('refuses a PDA, the program id and the server key', async () => {
    await review(pdas.config(PROGRAM_ID).toBase58());
    expect(await screen.findByText(/Admin transfer refused: the new admin is the config account/)).toBeTruthy();
    type('Admin (transfer)', PROGRAM_ID.toBase58());
    fireEvent.click(screen.getByRole('button', { name: 'Review config update' }));
    expect(await screen.findByText(/the new admin is the program id/)).toBeTruthy();
    type('Admin (transfer)', server.toBase58());
    fireEvent.click(screen.getByRole('button', { name: 'Review config update' }));
    expect(await screen.findByText(/the new admin is the server key/)).toBeTruthy();
    const offCurve = PublicKey.findProgramAddressSync([Buffer.from('x')], PROGRAM_ID)[0].toBase58();
    type('Admin (transfer)', offCurve);
    fireEvent.click(screen.getByRole('button', { name: 'Review config update' }));
    expect(await screen.findByText(/not an on-curve wallet key/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('needs the new admin retyped and the acknowledgement', async () => {
    const next = Keypair.generate().publicKey.toBase58();
    await review(next);
    const dialog = await screen.findByRole('dialog');
    const sign = within(dialog).getByRole('button', { name: 'Sign with wallet' }) as HTMLButtonElement;
    await waitFor(() => expect(within(dialog).queryByText(/Checking the cluster/)).toBeNull());
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(sign.disabled).toBe(true);
    const retype = within(dialog).getByLabelText('Type the new admin address again to confirm');
    fireEvent.change(retype, { target: { value: next.slice(0, -1) } });
    expect(sign.disabled).toBe(true);
    fireEvent.change(retype, { target: { value: next } });
    await waitFor(() => expect(sign.disabled).toBe(false));
  });
});

describe('admin panel: arena update sends only edited fields', () => {
  it('disabling an arena with open sessions does not send an entry fee', async () => {
    const mint = Keypair.generate().publicKey;
    deploy(admin.publicKey);
    await initConfig({ admin: admin.publicKey, mint, tokenProgram: TOKEN_PROGRAM_ID, decimals: 9 });
    accounts.set(mint.toBase58(), mintAccount(TOKEN_PROGRAM_ID));
    const arena = pdas.arena(1, PROGRAM_ID);
    const vault = pdas.vault(arena, PROGRAM_ID);
    // 1,000.123456789 tokens: finer than the 6 digits the status shows
    const data = await coder.accounts.encode('arena', {
      id: 1,
      entryFee: new BN(1_000_123_456_789),
      maxSessions: 300,
      openSessions: 2,
      enabled: true,
      vault,
      vaultBump: 255,
      totalDeposited: new BN(0),
      totalPaidOut: new BN(0),
      bump: 255,
    });
    accounts.set(arena.toBase58(), acc(PROGRAM_ID, data));
    renderPanel(admin);
    await screen.findByRole('heading', { name: 'Update arena' });
    fireEvent.click(await screen.findByRole('button', { name: 'Disabled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review arena update' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Sign with wallet' }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Sign with wallet' }));
    });
    await within(dialog).findByText(/Confirmed/);
    const d = coder.instruction.decode(sent[0].instructions[1].data) as { name: string; data: { enabled: boolean | null; maxSessions: number | null; entryFee: unknown } };
    expect(d.name).toBe('updateArena');
    expect(d.data.enabled).toBe(false);
    expect(d.data.entryFee).toBeNull();
    expect(d.data.maxSessions).toBeNull();
  });
});

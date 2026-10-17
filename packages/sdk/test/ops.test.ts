import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { SlanaClient, pdas } from '../src';
import {
  AdminInputError,
  buildCreateArenasInstructions,
  buildSweepInstructions,
  buildUpdateConfigInstructions,
  createArenaRefusal,
  describeInstruction,
  initParams,
  inspectMintAccount,
  mintExtensionTypes,
  parseIntInput,
  parsePubkeyInput,
  parseUpgradeAuthority,
  planDefaultArenas,
  sweepRefusal,
  updateArenaRefusal,
  updateConfigParams,
} from '../src/ops';

const k = () => Keypair.generate().publicKey;

/** A mint account: base state (82 bytes), and for Token-2022 extensions the padding, account type and TLV entries. */
export function mintData(o: { supply?: bigint; decimals?: number; freeze?: PublicKey | null; extensions?: number[] } = {}): Uint8Array {
  const base = new Uint8Array(82);
  const view = new DataView(base.buffer);
  view.setBigUint64(36, o.supply ?? 1_000_000n, true);
  base[44] = o.decimals ?? 6;
  base[45] = 1;
  if (o.freeze) {
    base[46] = 1;
    base.set(o.freeze.toBytes(), 50);
  }
  if (!o.extensions) return base;
  const tlv: number[] = [];
  for (const t of o.extensions) tlv.push(t & 0xff, t >> 8, 4, 0, 1, 2, 3, 4);
  const out = new Uint8Array(166 + tlv.length);
  out.set(base);
  out[165] = 1;
  out.set(tlv, 166);
  return out;
}

describe('field parsers', () => {
  it('name the field in the message', () => {
    expect(() => parseIntInput('Fee (bps)', '1001', 0, 1000)).toThrow('Fee (bps) must be an integer between 0 and 1000');
    expect(() => parsePubkeyInput('Server authority', 'nope')).toThrow(AdminInputError);
    expect(parseIntInput('x', '1_000', 0, 2000)).toBe(1000);
  });

  it('init defaults and refusals', () => {
    const admin = k();
    const server = k();
    expect(initParams({ serverAuthority: server }, admin)).toEqual({ serverAuthority: server, feeWallet: admin, feeBps: 500, settleFeeLamports: 20_000 });
    expect(() => initParams({ serverAuthority: PublicKey.default }, admin)).toThrow(/default/);
    expect(() => initParams({ serverAuthority: server, feeBps: 1001 }, admin)).toThrow(AdminInputError);
  });

  it('update-config drops omitted fields', () => {
    expect(updateConfigParams({ paused: true, feeBps: undefined })).toEqual({ paused: true });
    expect(() => updateConfigParams({ admin: PublicKey.default })).toThrow(/default/);
  });
});

describe('inspectMintAccount (the set_token_mint check)', () => {
  const mint = k();
  it('accepts a plain SPL Token mint and a Token-2022 mint with metadata', () => {
    const a = inspectMintAccount(mint, { owner: TOKEN_PROGRAM_ID, data: mintData() });
    expect(a.refusals).toEqual([]);
    expect([a.ownerName, a.decimals, a.supply, a.freezeAuthority]).toEqual(['SPL Token', 6, 1_000_000n, null]);
    const b = inspectMintAccount(mint, { owner: TOKEN_2022_PROGRAM_ID, data: mintData({ extensions: [18, 19] }) });
    expect(b.refusals).toEqual([]);
    expect(b.extensions.map((e) => [e.name, e.denied])).toEqual([
      ['MetadataPointer', false],
      ['TokenMetadata', false],
    ]);
  });

  it('refuses a freeze authority, denied extensions, unknown extensions, a huge supply and non-mints', () => {
    expect(inspectMintAccount(mint, { owner: TOKEN_PROGRAM_ID, data: mintData({ freeze: k() }) }).refusals[0]).toMatch(/freeze authority/);
    const hook = inspectMintAccount(mint, { owner: TOKEN_2022_PROGRAM_ID, data: mintData({ extensions: [18, 14, 12] }) });
    expect(hook.refusals).toEqual(['the program refuses these Token-2022 extensions: TransferHook, PermanentDelegate']);
    expect(inspectMintAccount(mint, { owner: TOKEN_2022_PROGRAM_ID, data: mintData({ extensions: [28] }) }).refusals[0]).toMatch(/does not know/);
    expect(inspectMintAccount(mint, { owner: TOKEN_PROGRAM_ID, data: mintData({ supply: 1n << 60n }) }).refusals[0]).toMatch(/2\^53/);
    expect(inspectMintAccount(mint, { owner: SystemProgram.programId, data: new Uint8Array() }).refusals[0]).toMatch(/not an SPL Token/);
    expect(inspectMintAccount(mint, null).refusals[0]).toMatch(/no account/);
    expect(inspectMintAccount(mint, { owner: TOKEN_PROGRAM_ID, data: new Uint8Array(165) }).refusals).toEqual(['the account is not a mint']);
  });

  it('walks the TLV like the program', () => {
    expect(mintExtensionTypes(mintData())).toEqual([]);
    expect(mintExtensionTypes(mintData({ extensions: [1, 3] }))).toEqual([1, 3]);
    const truncated = mintData({ extensions: [1] }).subarray(0, 169);
    expect(mintExtensionTypes(truncated)).toBeNull();
  });
});

describe('status helpers', () => {
  it('reads the upgrade authority from ProgramData', () => {
    const auth = k();
    const d = new Uint8Array(45 + 10);
    d[0] = 3;
    d[12] = 1;
    d.set(auth.toBytes(), 13);
    expect(parseUpgradeAuthority(d)).toBe(auth.toBase58());
    d[12] = 0;
    expect(parseUpgradeAuthority(d)).toBeNull();
  });

  it('plans the default arenas and checks arena changes', () => {
    const plan = planDefaultArenas(6, [{ id: 2 }]);
    expect(plan.create.map((a) => a.id)).toEqual([1, 3, 4]);
    expect(plan.skipped.map((a) => a.id)).toEqual([2]);
    expect(createArenaRefusal({ id: 5, entryFee: 0n, maxSessions: 300 }, [])).toMatch(/greater than zero/);
    expect(createArenaRefusal({ id: 2, entryFee: 1n, maxSessions: 300 }, [{ id: 2 }])).toMatch(/already exists/);
    expect(createArenaRefusal({ id: 5, entryFee: 1n, maxSessions: 1 }, [])).toMatch(/between 2 and 2000/);
    expect(updateArenaRefusal({ id: 1, openSessions: 2 }, { entryFee: 5n })).toMatch(/open sessions/);
    expect(updateArenaRefusal({ id: 1, openSessions: 2 }, { enabled: false })).toBeNull();
    expect(updateArenaRefusal({ id: 1, openSessions: 0 }, {})).toBe('nothing to change');
    expect(sweepRefusal({ id: 1, enabled: true, openSessions: 0 })).toMatch(/disable/);
    expect(sweepRefusal({ id: 1, enabled: false, openSessions: 1 })).toMatch(/open sessions/);
    expect(sweepRefusal({ id: 1, enabled: false, openSessions: 0 })).toBeNull();
  });
});

describe('instruction plans and describeInstruction', () => {
  const client = new SlanaClient(new Connection('http://127.0.0.1:1'));
  const admin = k();
  const mint = k();
  const token = { tokenMint: mint.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(), tokenDecimals: 6 };
  const config = { feeWallet: k().toBase58(), ...token };

  it('a new fee wallet gets its token account first', async () => {
    const fw = k();
    const ixs = await buildUpdateConfigInstructions(client, admin, config, { feeWallet: fw });
    expect(ixs.map((i) => describeInstruction(client, i).name)).toEqual(['createIdempotent', 'updateConfig']);
    const d = describeInstruction(client, ixs[1]);
    expect(d.args).toContainEqual(['feeWallet', fw.toBase58()]);
    expect(d.args).toContainEqual(['feeBps', 'unchanged']);
    expect(d.accounts.map((a) => a.name)).toEqual(['admin', 'config']);
    const only = await buildUpdateConfigInstructions(client, admin, config, { paused: true });
    expect(only).toHaveLength(1);
  });

  it('create arenas in one transaction; sweep with the fee wallet account', async () => {
    const ixs = await buildCreateArenasInstructions(client, admin, token, planDefaultArenas(6, []).create);
    expect(ixs).toHaveLength(4);
    const d = describeInstruction(client, ixs[0]);
    expect(d.name).toBe('createArena');
    expect(d.args).toEqual([
      ['id', '1'],
      ['entryFee', '1000000000'],
      ['maxSessions', '300'],
    ]);
    expect(d.accounts.find((a) => a.name === 'arena')?.address).toBe(pdas.arena(1).toBase58());
    const sweep = await buildSweepInstructions(client, admin, config, token, 3);
    expect(sweep[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(describeInstruction(client, sweep[1]).name).toBe('sweepArena');
  });

  it('compute budget', () => {
    const d = describeInstruction(client, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }));
    expect([d.program, d.name, d.args]).toEqual(['Compute Budget', 'setComputeUnitPrice', [['microLamports', '20000']]]);
  });
});

describe('token2022Symbol', () => {
  it('reads the symbol of the TokenMetadata extension', async () => {
    const { token2022Symbol } = await import('../src/ops');
    const str = (s: string) => {
      const b = new TextEncoder().encode(s);
      return [b.length, 0, 0, 0, ...b];
    };
    const value = [...new Uint8Array(64), ...str('Slana'), ...str('SLANA'), ...str('https://x'), 0, 0, 0, 0];
    const data = new Uint8Array(166 + 4 + value.length);
    data[44] = 6;
    data[45] = 1;
    data[165] = 1;
    data.set([19, 0, value.length & 0xff, value.length >> 8, ...value], 166);
    expect(token2022Symbol(data)).toBe('SLANA');
    expect(token2022Symbol(new Uint8Array(82))).toBeNull();
  });
});

describe('admin transfer and symbol hygiene', () => {
  it('adminTransferRefusal', async () => {
    const { adminTransferRefusal } = await import('../src/ops');
    const { PROGRAM_ID } = await import('../src');
    const current = k();
    const serverKey = k();
    const ctx = { programId: PROGRAM_ID, currentAdmin: current, serverKeys: [serverKey] };
    expect(adminTransferRefusal(k(), ctx)).toBeNull();
    expect(adminTransferRefusal(current, ctx)).toMatch(/current admin/);
    expect(adminTransferRefusal(PROGRAM_ID, ctx)).toMatch(/program id/);
    expect(adminTransferRefusal(pdas.config(PROGRAM_ID), ctx)).toMatch(/config account/);
    expect(adminTransferRefusal(serverKey, ctx)).toMatch(/server key/);
    expect(adminTransferRefusal(pdas.arena(1, PROGRAM_ID), ctx)).toMatch(/on-curve/);
    expect(adminTransferRefusal(PublicKey.default, ctx)).toMatch(/default/);
  });

  it('sanitizeSymbol strips bidi and control characters and caps the length', async () => {
    const { sanitizeSymbol } = await import('../src/ops');
    expect(sanitizeSymbol('SLANA')).toBe('SLANA');
    expect(sanitizeSymbol('US‮DC\u0000')).toBe('USDC');
    expect(sanitizeSymbol('​ ⁦')).toBeNull();
    expect(sanitizeSymbol('A'.repeat(40))).toBe(`${'A'.repeat(16)}…`);
  });
});

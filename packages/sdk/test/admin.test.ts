import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEE_BPS,
  DEFAULT_SETTLE_FEE_LAMPORTS,
  SlanaClient,
  ata,
  pdas,
  type ArenaView,
  type ConfigView,
} from '../src';
import {
  USAGE,
  UsageError,
  buildSetTokenInstructions,
  defaultArenaParams,
  flag,
  formatStatus,
  inferCluster,
  int,
  metaplexMetadataPda,
  MPL_TOKEN_METADATA_ID,
  parseArgs,
  parseInitOptions,
  parseMetaplexMetadata,
  parseUpdateConfigOptions,
  tokenProgramName,
  tokens,
  type StatusSnapshot,
} from '../src/admin-lib';

const k = () => Keypair.generate().publicKey;
const opts = (...argv: string[]) => parseArgs(['cmd', ...argv]).opts;

describe('parseArgs', () => {
  it('reads the command, --name value, --name=value and bare flags', () => {
    const { command, opts: o } = parseArgs(['create-arena', '--id', '5', '--entry=1_000.5', '--defaults', '--max', '300', '--force']);
    expect(command).toBe('create-arena');
    expect([...o.entries()]).toEqual([
      ['id', '5'],
      ['entry', '1_000.5'],
      ['defaults', true],
      ['max', '300'],
      ['force', true],
    ]);
    expect(parseArgs([]).command).toBeNull();
    expect(parseArgs(['--', 'status']).command).toBe('status');
    expect(() => parseArgs(['status', 'extra'])).toThrow(UsageError);
  });

  it('typed option readers', () => {
    expect(int(opts('--n', '7'), 'n', 0, 10)).toBe(7);
    expect(int(opts('--n', '1_000'), 'n', 0, 2_000)).toBe(1_000);
    expect(int(opts(), 'n', 0, 10)).toBeUndefined();
    expect(() => int(opts('--n', '11'), 'n', 0, 10)).toThrow(/between 0 and 10/);
    expect(() => int(opts('--n', '1.5'), 'n', 0, 10)).toThrow(UsageError);
    expect(() => int(opts('--n'), 'n', 0, 10)).toThrow(/needs a value/);
    expect(tokens(opts('--entry', '1_000.5'), 'entry', 6)).toBe(1_000_500_000n);
    expect(tokens(opts('--entry', '50000'), 'entry', 0)).toBe(50_000n);
    expect(() => tokens(opts('--entry', '0.0000001'), 'entry', 6)).toThrow(UsageError);
    expect(inferCluster('https://api.devnet.solana.com')).toBe('devnet');
    expect(inferCluster('https://mainnet.helius-rpc.com')).toBe('mainnet-beta');
    expect(inferCluster('http://127.0.0.1:8899')).toBe('localnet');
  });
});

describe('flag', () => {
  it('accepts --x and --x=true, not false or absent', () => {
    expect(flag(opts('--defaults'), 'defaults')).toBe(true);
    expect(flag(opts('--defaults=true'), 'defaults')).toBe(true);
    expect(flag(opts('--defaults=false'), 'defaults')).toBe(false);
    expect(flag(opts(), 'defaults')).toBe(false);
  });
});

describe('init options', () => {
  const admin = k();
  const server = k();

  it('the fee wallet defaults to the admin; fee and settle deposit to the plan defaults', () => {
    const p = parseInitOptions(opts('--server', server.toBase58()), admin);
    expect(p.feeWallet.equals(admin)).toBe(true);
    expect(p.serverAuthority.equals(server)).toBe(true);
    expect([p.feeBps, p.settleFeeLamports]).toEqual([DEFAULT_FEE_BPS, DEFAULT_SETTLE_FEE_LAMPORTS]);
    expect(DEFAULT_FEE_BPS).toBe(500);
  });

  it('--fee-wallet, --fee-bps and --settle-fee-lamports override', () => {
    const fw = k();
    const p = parseInitOptions(opts('--server', server.toBase58(), '--fee-wallet', fw.toBase58(), '--fee-bps', '250', '--settle-fee-lamports', '10000'), admin);
    expect(p.feeWallet.equals(fw)).toBe(true);
    expect([p.feeBps, p.settleFeeLamports]).toEqual([250, 10_000]);
  });

  it('refuses a missing server, a mint, bad numbers and default keys', () => {
    expect(() => parseInitOptions(opts(), admin)).toThrow(/--server/);
    expect(() => parseInitOptions(opts('--server', server.toBase58(), '--mint', k().toBase58()), admin)).toThrow(/set-token/);
    expect(() => parseInitOptions(opts('--server', server.toBase58(), '--fee-bps', '1001'), admin)).toThrow(/between 0 and 1000/);
    expect(() => parseInitOptions(opts('--server', server.toBase58(), '--settle-fee-lamports', '1000001'), admin)).toThrow(UsageError);
    expect(() => parseInitOptions(opts('--server', 'not-a-key'), admin)).toThrow(/valid public key/);
    expect(() => parseInitOptions(opts('--server', server.toBase58(), '--fee-wallet', PublicKey.default.toBase58()), admin)).toThrow(/default/);
  });
});

describe('update-config options', () => {
  it('keeps only the given fields', () => {
    const fw = k();
    expect(parseUpdateConfigOptions(opts('--fee-wallet', fw.toBase58(), '--paused', 'false'))).toEqual({ feeWallet: fw, paused: false });
    expect(parseUpdateConfigOptions(opts('--fee-bps', '0'))).toEqual({ feeBps: 0 });
    const all = parseUpdateConfigOptions(opts('--admin', fw.toBase58(), '--server', fw.toBase58(), '--settle-fee-lamports', '5'));
    expect(Object.keys(all).sort()).toEqual(['admin', 'serverAuthority', 'settleFeeLamports']);
  });

  it('refuses nothing to change, Pass/split leftovers and bad values', () => {
    expect(() => parseUpdateConfigOptions(opts())).toThrow(/nothing to change/);
    expect(() => parseUpdateConfigOptions(opts('--split', '5000/3000/2000'))).toThrow(/nothing to change/);
    expect(() => parseUpdateConfigOptions(opts('--paused', 'yes'))).toThrow(/true or false/);
    expect(() => parseUpdateConfigOptions(opts('--fee-bps', '2000'))).toThrow(UsageError);
    expect(() => parseUpdateConfigOptions(opts('--fee-wallet', PublicKey.default.toBase58()))).toThrow(/default/);
  });
});

describe('create-arena --defaults', () => {
  it('four open arenas, entry fees scaled by the mint decimals', () => {
    expect(defaultArenaParams(6)).toEqual([
      { id: 1, entryFee: 1_000_000_000n, maxSessions: 300 },
      { id: 2, entryFee: 10_000_000_000n, maxSessions: 300 },
      { id: 3, entryFee: 50_000_000_000n, maxSessions: 300 },
      { id: 4, entryFee: 250_000_000_000n, maxSessions: 300 },
    ]);
    expect(defaultArenaParams(0).map((a) => a.entryFee)).toEqual([1_000n, 10_000n, 50_000n, 250_000n]);
  });
});

describe('set-token', () => {
  const client = new SlanaClient(new Connection('http://127.0.0.1:1'));
  const admin = k();
  const feeWallet = k();
  const mint = k();

  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    it(`creates the fee wallet ATA (admin pays), then set_token_mint (${tokenProgramName(program)})`, async () => {
      const [create, set] = await buildSetTokenInstructions(client, admin, { tokenMint: null, feeWallet: feeWallet.toBase58() }, mint, program);
      const feeToken = ata(feeWallet, mint, program);
      expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
      expect([...create.data]).toEqual([1]); // CreateIdempotent
      expect(create.keys.map((m) => [m.pubkey.toBase58(), m.isSigner, m.isWritable])).toEqual([
        [admin.toBase58(), true, true], // payer
        [feeToken.toBase58(), false, true],
        [feeWallet.toBase58(), false, false],
        [mint.toBase58(), false, false],
        [SystemProgram.programId.toBase58(), false, false],
        [program.toBase58(), false, false],
      ]);
      expect(set.programId.equals(client.programId)).toBe(true);
      expect([...set.data]).toEqual([204, 233, 179, 83, 12, 31, 139, 120]);
      expect(set.keys.map((m) => m.pubkey.toBase58())).toEqual([admin, pdas.config(), mint, program].map((x) => x.toBase58()));
    });
  }

  it('refuses when the mint is already set or the owner is not a token program', async () => {
    await expect(buildSetTokenInstructions(client, admin, { tokenMint: k().toBase58(), feeWallet: feeWallet.toBase58() }, mint, TOKEN_PROGRAM_ID)).rejects.toThrow(/already set/);
    await expect(buildSetTokenInstructions(client, admin, { tokenMint: null, feeWallet: feeWallet.toBase58() }, mint, SystemProgram.programId)).rejects.toThrow(
      /not an SPL Token/,
    );
  });

  it('reads the symbol from Metaplex metadata', () => {
    const str = (s: string, pad: number) => {
      const b = new TextEncoder().encode(s.padEnd(pad, '\0'));
      return [b.length, 0, 0, 0, ...b];
    };
    const data = Uint8Array.from([4, ...k().toBytes(), ...mint.toBytes(), ...str('Slana', 32), ...str('SLANA', 10), ...str('https://x', 200)]);
    expect(parseMetaplexMetadata(data)).toEqual({ name: 'Slana', symbol: 'SLANA' });
    expect(parseMetaplexMetadata(data.subarray(0, 80))).toBeNull();
    expect(parseMetaplexMetadata(Uint8Array.from([5, ...data.subarray(1)]))).toBeNull();
    const expected = PublicKey.findProgramAddressSync([Buffer.from('metadata'), MPL_TOKEN_METADATA_ID.toBuffer(), mint.toBuffer()], MPL_TOKEN_METADATA_ID)[0];
    expect(metaplexMetadataPda(mint).equals(expected)).toBe(true);
  });
});

describe('status', () => {
  const base = (config: ConfigView | null, extra: Partial<StatusSnapshot> = {}): StatusSnapshot => ({
    url: 'http://127.0.0.1:8899',
    cluster: 'localnet',
    programId: 'Prog111',
    deployed: true,
    configAddress: 'Conf111',
    config,
    ...extra,
  });
  const config = (over: Partial<ConfigView> = {}): ConfigView => ({
    admin: 'Admin111',
    serverAuthority: 'Server111',
    feeWallet: 'FeeWallet111',
    tokenMint: null,
    tokenProgram: null,
    tokenDecimals: 0,
    feeBps: 500,
    settleFeeLamports: 20_000,
    paused: false,
    totals: { players: 0, games: 0, sessions: 0, staked: 0n, paidOut: 0n },
    ...over,
  });

  it('not deployed / not initialized', () => {
    expect(formatStatus(base(null, { deployed: false })).join('\n')).toMatch(/✗ not deployed/);
    expect(formatStatus(base(null)).join('\n')).toMatch(/not initialized \(run `pnpm admin init --server <pubkey>`\)/);
  });

  it('shows "token: not set" until set-token', () => {
    const text = formatStatus(base(config(), { serverBalance: 2_500_000_000 })).join('\n');
    expect(text).toMatch(/^ {2}token: +not set/m);
    expect(text).toContain('set-token --mint <CA>');
    expect(text).toMatch(/fee wallet: +FeeWallet111/);
    expect(text).toMatch(/fee: +5\.00 % of profit, 100 % to the fee wallet/);
    expect(text).toContain('◎2.5');
    expect(text).toContain('arenas    none (set the token first');
    expect(text).not.toMatch(/pass|season|treasury/i);
  });

  it('with the token set: mint, program, decimals, symbol, fee wallet balance and arenas', () => {
    const arena: ArenaView = { id: 3, address: 'Arena3', entryFee: 50_000_000_000n, maxSessions: 300, openSessions: 2, enabled: true, vault: 'V', pot: 1_234_500_000n };
    const lines = formatStatus(
      base(config({ tokenMint: 'Mint111', tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(), tokenDecimals: 6, paused: true }), {
        mint: { supply: 1_000_000_000_000_000n, mintAuthority: null, freezeAuthority: null, symbol: 'SLANA' },
        feeWalletToken: 'FeeAta111',
        feeWalletBalance: 42_000_000n,
        arenas: [arena],
      }),
    );
    const text = lines.join('\n');
    expect(text).toMatch(/token: +Mint111 {2}\(Token-2022, 6 decimals, SLANA\)/);
    expect(text).toMatch(/supply: +1,000,000,000 SLANA/);
    expect(text).toMatch(/mint\/freeze auth: +none \/ none/);
    expect(text).toMatch(/fee wallet token: +FeeAta111 {2}\(42 SLANA\)/);
    expect(text).toMatch(/paused: +YES/);
    expect(lines.find((l) => l.includes('#3'))).toMatch(/Gold Lake +entry 50,000 +open 2\/300 · pot 1,234.5 · enabled {2}Arena3/);
    expect(text).not.toContain('not set');
  });

  it('a missing fee wallet token account is flagged', () => {
    const text = formatStatus(
      base(config({ tokenMint: 'Mint111', tokenProgram: TOKEN_PROGRAM_ID.toBase58(), tokenDecimals: 0 }), { mint: null, feeWalletToken: 'FeeAta111', feeWalletBalance: null }),
    ).join('\n');
    expect(text).toMatch(/SPL Token, 0 decimals/);
    expect(text).toMatch(/mint account not readable/);
    expect(text).toMatch(/account missing/);
    expect(text).toContain('arenas    none (run `pnpm admin create-arena --defaults`)');
  });
});

describe('CLI process', () => {
  const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const run = (...args: string[]) => spawnSync(tsx, ['src/admin.ts', ...args], { encoding: 'utf8', env: { ...process.env, SOLANA_RPC_URL: 'http://127.0.0.1:1' } });

  it('help lists the simple command set', () => {
    const r = run('help');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${USAGE}\n`);
    for (const cmd of ['init', 'set-token --mint <CA>', 'create-arena --defaults', 'update-config', 'pause', 'unpause', 'update-arena', 'sweep', 'status', '--fee-wallet']) {
      expect(r.stdout).toContain(cmd);
    }
    expect(r.stdout).not.toMatch(/pass|season|treasury|reveal|collection/i);
  }, 30_000);

  it('usage errors exit 2 before any RPC', () => {
    const missing = run('set-token');
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('set-token needs --mint <CA>');
    const unknown = run('withdraw-treasury', '--amount', '1');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown command: withdraw-treasury');
  }, 30_000);
});

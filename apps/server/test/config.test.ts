import { describe, expect, it } from 'vitest';
import { invalidAdminWallets, loadConfig, parseAdminWallets, parseRoundConfig } from '../src/config';

describe('Elymum config', () => {
  it('has no Pass power, marketplace links or fake Pass collection any more', () => {
    const cfg = loadConfig({ PASS_START_MASS_MUL: '1.3', MARKET_URL_OPENSEA: 'https://opensea.io/x', DEV_FAKE_PASS: 'revealed' });
    expect('pass' in cfg).toBe(false);
    expect('markets' in cfg).toBe(false);
    expect('devFakePass' in cfg).toBe(false);
  });

  it('DEV_FAKE_TOKEN=1 starts the fake chain with its token set (default: unset)', () => {
    expect(loadConfig({}).devFakeToken).toBe(false);
    expect(loadConfig({ DEV_FAKE_TOKEN: '1' }).devFakeToken).toBe(true);
  });
});

describe('chain env (EVM)', () => {
  it('reads every Elysium variable and ignores the old chain variables', () => {
    const cfg = loadConfig({
      EVM_RPC_URL: 'https://rpc.example/key123/',
      PUBLIC_RPC_URL: 'https://public.example/',
      CHAIN_NAME: 'Elysium',
      EXPLORER_URL: 'https://explorer.example/',
      ARENA_ADDRESS: '0x00000000000000000000000000000000000000a1',
      NFT_ADDRESS: '0x00000000000000000000000000000000000000b2',
      SERVER_PRIVATE_KEY: 'auto',
      MINT_USD_CENTS: '250',
      HYPE_PRICE_URL: 'https://price.example/info',
      TOKEN_SYMBOL: '$TEST',
      GAME_ACCESS: 'holders',
      SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      PROGRAM_ID: 'x',
      SERVER_KEYPAIR: 'y',
    } as NodeJS.ProcessEnv);
    expect(cfg.chain).toMatchObject({
      rpcUrl: 'https://rpc.example/key123',
      publicRpcUrl: 'https://public.example',
      chainName: 'Elysium',
      explorerUrl: 'https://explorer.example',
      arenaAddress: '0x00000000000000000000000000000000000000a1',
      nftAddress: '0x00000000000000000000000000000000000000b2',
      serverKey: 'auto',
      tokenSymbol: '$TEST',
    });
    expect(cfg.mint).toEqual({ usdCents: 250, hypePriceUrl: 'https://price.example/info' });
    expect(cfg.gameAccess).toBe('holders');
    for (const gone of ['cluster', 'programId', 'serverKeypair', 'priorityFeeMicroLamports', 'wsUrl']) expect(gone in cfg.chain).toBe(false);
  });

  it('defaults: chain off, $ELYMUM, $1 mint on Hyperliquid, the setting decides who plays', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.chain).toMatchObject({ rpcUrl: null, publicRpcUrl: null, serverKey: null, arenaAddress: null, nftAddress: null, tokenSymbol: '$ELYMUM' });
    expect(cfg.mint).toEqual({ usdCents: 100, hypePriceUrl: 'https://api.hyperliquid.xyz/info' });
    expect(cfg.gameAccess).toBeNull();
    expect(loadConfig({ GAME_ACCESS: 'everyone' } as NodeJS.ProcessEnv).gameAccess).toBeNull();
    expect(loadConfig({ GAME_ACCESS: ' PUBLIC ' } as NodeJS.ProcessEnv).gameAccess).toBe('public');
  });

  it('hands the public testnet RPC to browsers, never a private one', () => {
    expect(loadConfig({ EVM_RPC_URL: 'https://testnet-rpc.elysium.kinetiq.xyz' } as NodeJS.ProcessEnv).chain.publicRpcUrl).toBe('https://testnet-rpc.elysium.kinetiq.xyz');
    expect(loadConfig({ EVM_RPC_URL: 'https://paid.example/secret' } as NodeJS.ProcessEnv).chain.publicRpcUrl).toBeNull();
  });

  it('ADMIN_WALLETS: 0x addresses, checksummed and de-duplicated, no default', () => {
    expect(parseAdminWallets(undefined)).toEqual([]);
    expect(parseAdminWallets('')).toEqual([]);
    expect(parseAdminWallets('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266, 0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266,nope,D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm')).toEqual([
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    ]);
    expect(invalidAdminWallets('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266,nope')).toEqual(['nope']);
    expect(loadConfig({} as NodeJS.ProcessEnv).adminWallets).toEqual([]);
  });
});

describe('sweeper tunables', () => {
  it('default to 15 min and read STALE_SESSION_AFTER_S / STALE_SWEEP_ACK', () => {
    expect(loadConfig({}).chain).toMatchObject({ staleSessionAfterS: 900, staleSweepAck: false });
    expect(loadConfig({ STALE_SESSION_AFTER_S: '5', STALE_SWEEP_ACK: '1' }).chain).toMatchObject({ staleSessionAfterS: 5, staleSweepAck: true });
    expect(loadConfig({ STALE_SESSION_AFTER_S: '0' }).chain).toMatchObject({ staleSessionAfterS: 1 });
  });
});

describe('round clock config', () => {
  it('defaults to 5-minute rounds with joins closed in the last minute', () => {
    expect(loadConfig({}).round).toEqual({ roundMs: 300_000, closeMs: 60_000 });
    expect(parseRoundConfig({ ROUND_SECONDS: '', ROUND_JOIN_CLOSE_SECONDS: ' ' })).toEqual({ roundMs: 300_000, closeMs: 60_000 });
  });

  it('reads ROUND_SECONDS / ROUND_JOIN_CLOSE_SECONDS (tests, localnet e2e)', () => {
    expect(loadConfig({ ROUND_SECONDS: '30', ROUND_JOIN_CLOSE_SECONDS: '5' }).round).toEqual({ roundMs: 30_000, closeMs: 5_000 });
    expect(parseRoundConfig({ ROUND_SECONDS: '600', ROUND_JOIN_CLOSE_SECONDS: '0' })).toEqual({ roundMs: 600_000, closeMs: 0 });
  });

  it('keeps joins open for at least half a round and rounds of at least 2 s', () => {
    // a 30 s round with the default 60 s closed window would never open: capped at half the round
    expect(parseRoundConfig({ ROUND_SECONDS: '30' })).toEqual({ roundMs: 30_000, closeMs: 15_000 });
    expect(parseRoundConfig({ ROUND_SECONDS: '0', ROUND_JOIN_CLOSE_SECONDS: '-4' })).toEqual({ roundMs: 2_000, closeMs: 0 });
    expect(parseRoundConfig({ ROUND_SECONDS: 'soon' })).toEqual({ roundMs: 300_000, closeMs: 60_000 });
  });
});

import type { ChainStatus } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseMarketUrls, publicChainStatus } from '../src/config';

const status: ChainStatus = {
  enabled: false,
  cluster: 'devnet',
  programId: null,
  rpcUrl: null,
  arenasEnabled: false,
  currentSeason: null,
  token: null,
  pass: null,
};

describe('MARKET_URLS', () => {
  it('is empty by default, so the web hides every marketplace link', () => {
    expect(loadConfig({}).markets).toEqual({});
    expect(publicChainStatus(status, { markets: {} })).toBe(status);
    expect('markets' in publicChainStatus(status, { markets: {} })).toBe(false);
  });

  it('reads the JSON form with forgiving keys', () => {
    const m = parseMarketUrls({
      MARKET_URLS: JSON.stringify({
        magic_eden: 'https://magiceden.io/marketplace/slana_pass',
        Tensor: 'https://www.tensor.trade/trade/slana_pass',
        OpenSea: 'https://opensea.io/collection/slana-pass',
        unknown: 'https://example.com',
      }),
    });
    expect(m).toEqual({
      magicEden: 'https://magiceden.io/marketplace/slana_pass',
      tensor: 'https://www.tensor.trade/trade/slana_pass',
      opensea: 'https://opensea.io/collection/slana-pass',
    });
  });

  it('lets the single-link variables override the JSON', () => {
    const m = parseMarketUrls({
      MARKET_URLS: '{"tensor":"https://old.example/t","opensea":"https://opensea.io/collection/slana-pass"}',
      MARKET_URL_TENSOR: 'https://www.tensor.trade/trade/slana_pass',
      MARKET_URL_MAGICEDEN: 'https://magiceden.io/marketplace/slana_pass',
    });
    expect(m).toEqual({
      tensor: 'https://www.tensor.trade/trade/slana_pass',
      opensea: 'https://opensea.io/collection/slana-pass',
      magicEden: 'https://magiceden.io/marketplace/slana_pass',
    });
  });

  it('drops anything that is not an absolute https URL, and bad JSON', () => {
    // plain http is refused too: a marketplace link must not be downgradable
    expect(parseMarketUrls({ MARKET_URL_OPENSEA: 'http://opensea.io/collection/slana-pass', MARKET_URLS: '{"tensor":"http://www.tensor.trade/trade/slana_pass"}' })).toEqual({});
    expect(parseMarketUrls({ MARKET_URLS: 'not json', MARKET_URL_OPENSEA: 'javascript:alert(1)', MARKET_URL_TENSOR: '/relative' })).toEqual({});
    expect(parseMarketUrls({ MARKET_URLS: '["https://opensea.io"]' })).toEqual({});
    expect(parseMarketUrls({ MARKET_URLS: '{"opensea": 42, "tensor": "ftp://x.example"}' })).toEqual({});
  });

  it('adds the links to the public chain status', () => {
    const markets = { opensea: 'https://opensea.io/collection/slana-pass' };
    const pub = publicChainStatus(status, loadConfig({ MARKET_URL_OPENSEA: markets.opensea }));
    expect(pub.markets).toEqual(markets);
    expect(pub.cluster).toBe('devnet');
  });
});

describe('sweeper tunables', () => {
  it('default to 15 min and read STALE_SESSION_AFTER_S / STALE_SWEEP_ACK', () => {
    expect(loadConfig({}).chain).toMatchObject({ staleSessionAfterS: 900, staleSweepAck: false });
    expect(loadConfig({ STALE_SESSION_AFTER_S: '5', STALE_SWEEP_ACK: '1' }).chain).toMatchObject({ staleSessionAfterS: 5, staleSweepAck: true });
    expect(loadConfig({ STALE_SESSION_AFTER_S: '0' }).chain).toMatchObject({ staleSessionAfterS: 1 });
  });
});

describe('Pass power in the public status (I3)', () => {
  it('publishes the configured Pass power, not the RULES defaults', () => {
    const cfg = loadConfig({ PASS_START_MASS_MUL: '1.3', PASS_CASHOUT_MS: '1500' });
    expect(publicChainStatus(status, cfg).passPower).toEqual({ startMassMul: 1.3, cashoutMs: 1500 });
    expect(publicChainStatus(status, loadConfig({})).passPower).toEqual({ startMassMul: 1.15, cashoutMs: 2000 });
    // without a pass config (older callers) nothing is added
    expect('passPower' in publicChainStatus(status, { markets: {} })).toBe(false);
  });
});

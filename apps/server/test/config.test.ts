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

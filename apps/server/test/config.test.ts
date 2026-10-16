import { describe, expect, it } from 'vitest';
import { loadConfig, parseRoundConfig } from '../src/config';

describe('Slana Simple config', () => {
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

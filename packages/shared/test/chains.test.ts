import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  CHAIN_NAME_DEFAULT,
  ELYSIUM_TESTNET_CHAIN_ID,
  HYPE,
  LOCALNET_CHAIN_ID,
  addEthereumChainParams,
  chainByKey,
  chainInfo,
  chainKeyOf,
  explorerAddressUrl,
  explorerTxUrl,
  isMainnet,
  toHexChainId,
} from '../src';

const TESTNET_EXPLORER = 'https://explorer-elysium-testnet.t.conduit.xyz';

describe('chain table', () => {
  it('has the three chains of the spec', () => {
    expect(CHAINS.map((c) => [c.key, c.id])).toEqual([
      ['elysium-testnet', 99801],
      ['elysium', null],
      ['localnet', 31337],
    ]);
    expect(chainByKey('elysium-testnet').rpcUrl).toBe('https://testnet-rpc.elysium.kinetiq.xyz');
    expect(chainByKey('elysium-testnet').explorerUrl).toBe(TESTNET_EXPLORER);
    expect(chainByKey('localnet').rpcUrl).toBe('http://127.0.0.1:8545');
    expect(chainByKey('localnet').explorerUrl).toBeNull();
    expect(chainByKey('elysium').rpcUrl).toBeNull();
  });

  it('pays gas in HYPE with 18 decimals', () => {
    expect(HYPE).toEqual({ name: 'HYPE', symbol: 'HYPE', decimals: 18 });
    expect(chainInfo(99801).nativeCurrency).toEqual(HYPE);
    expect(chainInfo(123).nativeCurrency).toEqual(HYPE);
  });

  it('treats every id but the testnet and the localnet as mainnet', () => {
    expect(isMainnet(ELYSIUM_TESTNET_CHAIN_ID)).toBe(false);
    expect(isMainnet(LOCALNET_CHAIN_ID)).toBe(false);
    expect(isMainnet(1338)).toBe(true); // viem's unrelated "elysiumTestnet"
    expect(isMainnet(424242)).toBe(true);
    expect(chainKeyOf(99801)).toBe('elysium-testnet');
    expect(chainKeyOf(31337)).toBe('localnet');
    expect(chainKeyOf(7)).toBe('elysium');
  });
});

describe('chainInfo', () => {
  it('resolves known ids', () => {
    expect(chainInfo(99801)).toEqual({
      key: 'elysium-testnet',
      id: 99801,
      name: 'Elysium Testnet',
      rpcUrl: 'https://testnet-rpc.elysium.kinetiq.xyz',
      explorerUrl: TESTNET_EXPLORER,
      nativeCurrency: HYPE,
      testnet: true,
    });
    expect(chainInfo(31337)).toMatchObject({ key: 'localnet', name: 'Localnet', explorerUrl: null, testnet: true });
  });

  it('names unknown ids Elysium (mainnet) unless CHAIN_NAME says otherwise', () => {
    expect(chainInfo(555)).toEqual({ key: 'elysium', id: 555, name: CHAIN_NAME_DEFAULT, rpcUrl: null, explorerUrl: null, nativeCurrency: HYPE, testnet: false });
    expect(chainInfo(555, { name: 'Elysium Mainnet', rpcUrl: 'https://rpc.example', explorerUrl: 'https://scan.example/' })).toMatchObject({
      name: 'Elysium Mainnet',
      rpcUrl: 'https://rpc.example',
      explorerUrl: 'https://scan.example',
    });
    expect(chainInfo(555, { name: '  ' }).name).toBe('Elysium');
  });

  it('applies overrides to known ids; null clears, undefined keeps', () => {
    expect(chainInfo(99801, { rpcUrl: null }).rpcUrl).toBeNull();
    expect(chainInfo(99801, { rpcUrl: undefined }).rpcUrl).toBe('https://testnet-rpc.elysium.kinetiq.xyz');
    expect(chainInfo(31337, { explorerUrl: 'http://localhost:4000' }).explorerUrl).toBe('http://localhost:4000');
  });

  it('rejects malformed ids', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 60]) expect(() => chainInfo(bad), String(bad)).toThrow(RangeError);
  });

  it('builds wallet parameters', () => {
    expect(toHexChainId(99801)).toBe('0x185d9');
    expect(toHexChainId(31337)).toBe('0x7a69');
    expect(addEthereumChainParams(chainInfo(99801))).toEqual({
      chainId: '0x185d9',
      chainName: 'Elysium Testnet',
      nativeCurrency: HYPE,
      rpcUrls: ['https://testnet-rpc.elysium.kinetiq.xyz'],
      blockExplorerUrls: [TESTNET_EXPLORER],
    });
    expect(addEthereumChainParams(chainInfo(31337))).not.toHaveProperty('blockExplorerUrls');
    expect(addEthereumChainParams(chainInfo(555))).toBeNull();
  });
});

describe('explorer links', () => {
  it('uses the Blockscout layout', () => {
    expect(explorerTxUrl(TESTNET_EXPLORER, '0xabc')).toBe(`${TESTNET_EXPLORER}/tx/0xabc`);
    expect(explorerAddressUrl(`${TESTNET_EXPLORER}/`, '0xdef')).toBe(`${TESTNET_EXPLORER}/address/0xdef`);
  });

  it('is null without an explorer', () => {
    expect(explorerTxUrl(null, '0xabc')).toBeNull();
    expect(explorerAddressUrl(undefined, '0xdef')).toBeNull();
    expect(explorerTxUrl(chainInfo(31337).explorerUrl, '0xabc')).toBeNull();
  });
});

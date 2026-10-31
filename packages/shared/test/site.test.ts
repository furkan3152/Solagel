import { describe, expect, it } from 'vitest';
import {
  CONTRACT_KINDS,
  GAME_ACCESS_DEFAULT,
  GAME_ACCESS_MODES,
  MINT_PHASES,
  SITE_SETTINGS_DEFAULT,
  SITE_X_HANDLE_DEFAULT,
  isEvmAddress,
  isGameAccess,
  isXStatusUrl,
  normalizeEvmAddress,
  normalizeXHandle,
  sameEvmAddress,
  type ContractsRegistry,
  type ErrorCode,
  type MintProofResponse,
  type SiteErrorCode,
} from '../src';

const ADDR = '0x52908400098527886E0F7030069857D2E4169EE7';

describe('site helpers', () => {
  it('normalises X handles', () => {
    expect(normalizeXHandle('@ElymumIO')).toBe('elymumio');
    expect(normalizeXHandle('  elymum_io ')).toBe('elymum_io');
    expect(normalizeXHandle('https://x.com/ElymumIO')).toBe('elymumio');
    expect(normalizeXHandle('https://twitter.com/elymumio/')).toBe('elymumio');
    expect(normalizeXHandle('x.com/elymumio?s=21')).toBe('elymumio');
    expect(normalizeXHandle('')).toBeNull();
    expect(normalizeXHandle('@')).toBeNull();
    expect(normalizeXHandle('a'.repeat(16))).toBeNull();
    expect(normalizeXHandle('bad-handle')).toBeNull();
    expect(normalizeXHandle(42)).toBeNull();
  });

  it('accepts X status links only', () => {
    expect(isXStatusUrl('https://x.com/elymumio/status/1790000000000000000')).toBe(true);
    expect(isXStatusUrl('https://twitter.com/a_b/status/1?s=20')).toBe(true);
    expect(isXStatusUrl('http://x.com/elymumio/status/1')).toBe(false);
    expect(isXStatusUrl('https://x.com/elymumio')).toBe(false);
    expect(isXStatusUrl('https://evil.com/x.com/elymumio/status/1')).toBe(false);
    expect(isXStatusUrl('https://x.com/toolonghandle1234/status/1')).toBe(false);
    expect(isXStatusUrl('https://x.com/a/status/1 javascript:')).toBe(false);
  });

  it('defaults: WL open, collab closed, game for admins only, X handle elymumio', () => {
    expect(SITE_X_HANDLE_DEFAULT).toBe('elymumio');
    expect(SITE_SETTINGS_DEFAULT).toEqual({ wlOpen: true, collabOpen: false, gameAccess: 'admins', xHandle: 'elymumio', launchPostUrl: null });
  });

  it('knows the game access modes', () => {
    expect(GAME_ACCESS_MODES).toEqual(['admins', 'holders', 'public']);
    expect(GAME_ACCESS_DEFAULT).toBe('admins');
    for (const m of GAME_ACCESS_MODES) expect(isGameAccess(m)).toBe(true);
    for (const bad of ['', 'Admins', 'everyone', true, null, undefined, 1]) expect(isGameAccess(bad)).toBe(false);
  });

  it('has the game_closed error code', () => {
    const code: ErrorCode = 'game_closed';
    const site: SiteErrorCode = 'game_closed';
    expect([code, site]).toEqual(['game_closed', 'game_closed']);
  });
});

describe('EVM addresses', () => {
  it('accepts 0x + 40 hex in any case', () => {
    expect(isEvmAddress(ADDR)).toBe(true);
    expect(isEvmAddress(ADDR.toLowerCase())).toBe(true);
    expect(isEvmAddress('0x' + 'A'.repeat(40))).toBe(true);
  });

  it('rejects everything else', () => {
    for (const bad of [
      '',
      '0x',
      ADDR.slice(0, -1),
      ADDR + '0',
      ADDR.slice(2),
      '0X' + ADDR.slice(2),
      '0x' + 'g'.repeat(40),
      ` ${ADDR}`,
      'elymumio.eth',
      42,
      null,
      undefined,
    ]) {
      expect(isEvmAddress(bad), String(bad)).toBe(false);
    }
  });

  it('normalises to lower case for comparing', () => {
    expect(normalizeEvmAddress(ADDR)).toBe(ADDR.toLowerCase());
    expect(normalizeEvmAddress(`  ${ADDR}\n`)).toBe(ADDR.toLowerCase());
    expect(normalizeEvmAddress('0x123')).toBeNull();
    expect(normalizeEvmAddress({})).toBeNull();
    expect(sameEvmAddress(ADDR, ADDR.toLowerCase())).toBe(true);
    expect(sameEvmAddress(ADDR, '0x' + '0'.repeat(40))).toBe(false);
    expect(sameEvmAddress('nope', 'nope')).toBe(false);
  });
});

describe('mint and registry types', () => {
  it('lists the phases in contract order and the contract kinds', () => {
    expect(MINT_PHASES).toEqual(['closed', 'allowlist', 'public']);
    expect(CONTRACT_KINDS).toEqual(['arena', 'nft', 'token']);
  });

  it('type-checks the payloads', () => {
    const reg: ContractsRegistry = {
      arena: { address: ADDR, txHash: '0x' + 'a'.repeat(64), chainId: 99801, registeredAt: 1, registeredBy: ADDR },
      nft: null,
      token: null,
    };
    const proof: MintProofResponse = { eligible: false, proof: [], root: null, onchainRoot: null };
    expect([reg.arena?.chainId, proof.eligible]).toEqual([99801, false]);
  });
});

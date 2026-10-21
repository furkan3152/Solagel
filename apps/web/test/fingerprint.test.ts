import { isFingerprint } from '@slana/shared';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/integrity/fingerprint';

describe('browser fingerprint', () => {
  it('is a hex hash the server accepts, stable in one browser, and keeps no readable data', async () => {
    fingerprint();
    await new Promise((r) => setTimeout(r, 50));
    const fp = fingerprint();
    expect(isFingerprint(fp)).toBe(true);
    expect(fp).toHaveLength(32);
    expect(fingerprint()).toBe(fp);
    // only a random install id is stored
    expect(localStorage.getItem('slana.device.v1')).toMatch(/^[0-9a-f]{32}$/);
  });
});

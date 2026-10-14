import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passTraits } from '@slana/art';
import type { PassStatus } from '@slana/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { NullChain, type ChainGateway, type OwnedPassInfo } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { createHttpServer } from '../src/http';
import { PassImages } from '../src/pass/images';
import { collectionMetadata, passMetadata } from '../src/pass/metadata';

const SEED = 'c0ffee'.repeat(10) + 'beef';
const BASE = 'https://slana.example';

const sealed: PassStatus = {
  collection: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  supply: 3333,
  minted: 40,
  perWallet: 1,
  mintOpen: true,
  mintStartTs: 1_700_000_000,
  revealed: false,
  seed: null,
};
const revealed: PassStatus = { ...sealed, mintOpen: false, minted: 3333, revealed: true, seed: SEED };

/** PNG width/height from the IHDR chunk. */
const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

describe('pass metadata', () => {
  it('metadata json is sealed before reveal and has traits after', () => {
    const before = passMetadata(42, sealed, BASE)!;
    expect(before).toMatchObject({ name: 'Slana Pass #42', symbol: 'SLANA', image: `${BASE}/pass/42.png` });
    expect(before.attributes).toEqual([{ trait_type: 'Status', value: 'Sealed' }]);
    expect(before.description).toMatch(/sealed/i);
    expect(JSON.stringify(before)).not.toMatch(/Rarity/);

    const after = passMetadata(42, revealed, BASE)!;
    const t = passTraits(SEED, 42, 3333);
    expect(after).toMatchObject({ name: 'Slana Pass #42', symbol: 'SLANA', image: `${BASE}/pass/42.png` });
    const attrs = Object.fromEntries(after.attributes.map((a) => [a.trait_type, a.value]));
    expect(attrs).toMatchObject({
      Ink: t.ink,
      Overprint: t.overprint,
      Symbol: t.symbol,
      Eyes: t.eyes,
      Mouth: t.mouth,
      Accessory: t.accessory,
      Paper: t.paper,
      Rarity: t.rarity[0].toUpperCase() + t.rarity.slice(1),
    });
    expect(after.properties.files).toEqual([{ uri: `${BASE}/pass/42.png`, type: 'image/png' }]);

    expect(passMetadata(0, revealed, BASE)).toBeNull();
    expect(passMetadata(3334, revealed, BASE)).toBeNull();

    const col = collectionMetadata(sealed, BASE);
    expect(col).toMatchObject({ name: 'Slana Pass', symbol: 'SLANA', image: `${BASE}/pass/collection.png` });
  });
});

describe('pass images', () => {
  it('png renders 1024 and is cached', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-pass-'));
    const images = new PassImages(dir);
    const png = (await images.png(7, revealed))!;
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(pngSize(png)).toEqual({ w: 1024, h: 1024 });
    const file = join(dir, SEED.slice(0, 16), '7.png');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).equals(png)).toBe(true);
    expect(images.renders).toBe(1);

    // served from the cache (memory or disk) without drawing again
    expect((await images.png(7, revealed))!.equals(png)).toBe(true);
    expect((await new PassImages(dir).png(7, revealed))!.equals(png)).toBe(true);
    expect(images.renders).toBe(1);

    // concurrent first requests share one render
    await Promise.all([images.png(8, revealed), images.png(8, revealed)]);
    expect(images.renders).toBe(2);

    // the sealed image lives under its own key, never a seed prefix
    const sealedPng = (await images.png(7, sealed))!;
    expect(pngSize(sealedPng)).toEqual({ w: 1024, h: 1024 });
    expect(sealedPng.equals(png)).toBe(false);
    expect(existsSync(join(dir, 'sealed', '7.png'))).toBe(true);
    expect(images.cacheKey(sealed)).not.toMatch(/^[0-9a-f]{16}$/);

    expect(await images.png(0, revealed)).toBeNull();
    expect(await images.png(3334, revealed)).toBeNull();
  }, 30_000);
});

class PassChain extends NullChain {
  status_: PassStatus | null = revealed;
  owned: OwnedPassInfo[] = [{ asset: 'Asset1', number: 3 }];
  calls: string[] = [];
  override passStatus(): PassStatus | null {
    return this.status_;
  }
  override async ownedPasses(wallet: string): Promise<OwnedPassInfo[]> {
    this.calls.push(wallet);
    return this.owned;
  }
}

describe('pass http routes', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function start(chain: ChainGateway, env: Record<string, string> = {}): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'slana-pass-http-'));
    const cfg = loadConfig({ DATA_DIR: dir, PUBLIC_URL: BASE, ...env } as NodeJS.ProcessEnv);
    server = createHttpServer(cfg, { chain, rooms: {} as never, leaderboards: {} as never, auth: {} as never, startedAt: Date.now() });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }

  it('out of range is 404', async () => {
    const chain = new PassChain();
    const url = await start(chain);
    for (const path of ['/pass/0.json', '/pass/3334.json', '/pass/0.png', '/pass/99999.png', '/pass/-1.json', '/pass/abc.json', '/pass/1.5.json']) {
      expect((await fetch(url + path)).status, path).toBe(404);
    }
    const ok = await fetch(`${url}/pass/1.json`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { name: string; image: string };
    expect(body).toMatchObject({ name: 'Slana Pass #1', image: `${BASE}/pass/1.png` });
    expect((await fetch(`${url}/pass/collection.json`)).status).toBe(200);

    // no collection yet: nothing to describe
    chain.status_ = null;
    expect((await fetch(`${url}/pass/1.json`)).status).toBe(404);
    expect((await fetch(`${url}/pass/collection.json`)).status).toBe(404);
  });

  it('serves owned passes, derives the image host without PUBLIC_URL and rate-limits 60/min/IP', async () => {
    const chain = new PassChain();
    const url = await start(chain, { PUBLIC_URL: '', PORT: '9999' });
    const wallet = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
    const owned = await fetch(`${url}/api/pass/owned?wallet=${wallet}`);
    expect(owned.status).toBe(200);
    expect(await owned.json()).toEqual({ passes: [{ asset: 'Asset1', number: 3 }] });
    expect(chain.calls).toEqual([wallet]);
    expect((await fetch(`${url}/api/pass/owned?wallet=nope`)).status).toBe(400);

    const meta = (await (await fetch(`${url}/pass/2.json`)).json()) as { image: string };
    expect(meta.image).toBe(`${url}/pass/2.png`);

    let limited = 0;
    for (let i = 0; i < 60; i++) if ((await fetch(`${url}/pass/collection.json`)).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
    expect((await fetch(`${url}/api/pass/owned?wallet=${wallet}`)).status).toBe(429);
    expect((await fetch(`${url}/api/config`)).status).toBe(200); // other routes keep their own limit
  });
});

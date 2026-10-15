import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectionJson, passJson, serializePassJson } from '../src/index';
import { finalSeedHex, main } from '../src/cli/common';
import { runGenerate } from '../src/cli/generate';
import { runPreview } from '../src/cli/preview';

const SEED = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
const SEED_HEX = Buffer.from(SEED).toString('hex');
/** Config.pass_entropy: the SlotHashes entry captured when the mint ended. */
const ENTROPY_HEX = '5a'.repeat(32);
/** sha256(seed || entropy): what every trait derives from. */
const FINAL_HEX = createHash('sha256').update(SEED).update(Buffer.from(ENTROPY_HEX, 'hex')).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'slana-art-cli-'));
const seedFile = join(dir, 'seed.json');
writeFileSync(seedFile, JSON.stringify([...SEED]));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const pngSize = (f: string): [number, number] => {
  const b = readFileSync(f);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('pass:generate', () => {
  it('generate writes N images and metadata for a range', async () => {
    const out = join(dir, 'out');
    await runGenerate(['--seed-file', seedFile, '--entropy', ENTROPY_HEX, '--supply', '3333', '--out', out, '--from', '1', '--to', '5']);
    for (let n = 1; n <= 5; n++) {
      expect(existsSync(join(out, `${n}.png`))).toBe(true);
      expect(existsSync(join(out, `${n}.json`))).toBe(true);
    }
    expect(existsSync(join(out, '6.png'))).toBe(false);
    expect(pngSize(join(out, '3.png'))).toEqual([1024, 1024]);
    expect(pngSize(join(out, 'collection.png'))).toEqual([1024, 1024]);
    expect(pngSize(join(out, 'banner.png'))).toEqual([1500, 500]);
    const meta = JSON.parse(readFileSync(join(out, '3.json'), 'utf8'));
    expect(meta.name).toBe('Slana Pass #3');
    expect(meta.image).toBe('3.png');
    expect(meta.attributes.some((a: { trait_type: string }) => a.trait_type === 'Rarity')).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'collection.json'), 'utf8')).name).toBe('Slana Pass');
    expect(readFileSync(join(out, 'rarity-report.md'), 'utf8')).toContain('Legendary');
    // byte-identical to the shared builder the server uses
    expect(meta).not.toHaveProperty('external_url');
    expect(readFileSync(join(out, '3.json'), 'utf8')).toBe(serializePassJson(passJson(3, FINAL_HEX, 3333)));
  });

  it('--site-url writes exactly the bytes the server serves', async () => {
    const out = join(dir, 'out-site');
    await runGenerate(['--seed-file', seedFile, '--entropy', ENTROPY_HEX, '--out', out, '--from', '3', '--to', '3', '--site-url', 'https://h/']);
    const bytes = readFileSync(join(out, '3.json'), 'utf8');
    expect(bytes).toBe(serializePassJson(passJson(3, FINAL_HEX, 3333, { siteUrl: 'https://h' })));
    expect(JSON.parse(bytes)).toMatchObject({ image: 'https://h/pass/3.png', external_url: 'https://h' });
    expect(readFileSync(join(out, 'collection.json'), 'utf8')).toBe(serializePassJson(collectionJson(3333, { siteUrl: 'https://h' })));
  });

  it('--base-url drives the image, --site-url the external_url', async () => {
    const out = join(dir, 'out-both');
    await runGenerate(['--seed-file', seedFile, '--entropy', ENTROPY_HEX, '--out', out, '--from', '1', '--to', '1', '--base-url', 'ipfs://cid/', '--site-url', 'https://h']);
    expect(JSON.parse(readFileSync(join(out, '1.json'), 'utf8'))).toMatchObject({ image: 'ipfs://cid/1.png', external_url: 'https://h' });
  });

  it('groups 1/1 rows in the rarity report', async () => {
    const report = readFileSync(join(dir, 'out', 'rarity-report.md'), 'utf8');
    expect(report).toContain('| 1/1 | 10 |');
    expect(report).not.toContain('oneOfOne');
  });

  it('main sets a non-zero exit code on a missing seed', async () => {
    const prev = process.exitCode;
    const err = console.error;
    console.error = () => {};
    try {
      await main(() => runGenerate(['--seed-file', join(dir, 'nope.json'), '--out', join(dir, 'o4')]));
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = err;
      process.exitCode = prev;
    }
  });

  it('prefixes image URLs with --base-url and requires a trailing slash', async () => {
    const out = join(dir, 'out2');
    await runGenerate(['--seed-file', seedFile, '--entropy', ENTROPY_HEX, '--out', out, '--from', '2', '--to', '2', '--base-url', 'https://x.test/pass/']);
    expect(JSON.parse(readFileSync(join(out, '2.json'), 'utf8')).image).toBe('https://x.test/pass/2.png');
    await expect(runGenerate(['--seed-file', seedFile, '--entropy', ENTROPY_HEX, '--out', out, '--base-url', 'https://x.test/pass'])).rejects.toThrow(/end with/);
  });

  it('points at pass-seed --new when the seed file is missing, without leaking anything', async () => {
    await expect(runGenerate(['--seed-file', join(dir, 'nope.json'), '--out', join(dir, 'o3')])).rejects.toThrow(/pnpm admin pass-seed --new/);
  });
});

describe('final seed', () => {
  it('is sha256(seed || entropy), like the program', () => {
    expect(finalSeedHex(SEED_HEX, ENTROPY_HEX)).toBe(FINAL_HEX);
    // known vector: sha256 of 64 zero bytes
    expect(finalSeedHex('00'.repeat(32), '00'.repeat(32))).toBe('f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b');
    expect(() => finalSeedHex(SEED_HEX, 'abc')).toThrow(/--entropy/);
  });

  it('refuses to generate from the bare admin seed', async () => {
    await expect(runGenerate(['--seed-file', seedFile, '--out', join(dir, 'o5')])).rejects.toThrow(/--entropy/);
  });

  it('--final-seed (public after the reveal) writes the same bytes as --seed-file + --entropy', async () => {
    const out = join(dir, 'out-final');
    await runGenerate(['--final-seed', FINAL_HEX, '--out', out, '--from', '3', '--to', '3']);
    expect(readFileSync(join(out, '3.json'), 'utf8')).toBe(readFileSync(join(dir, 'out', '3.json'), 'utf8'));
    expect(readFileSync(join(out, '3.png')).equals(readFileSync(join(dir, 'out', '3.png')))).toBe(true);
    await expect(runGenerate(['--final-seed', FINAL_HEX, '--entropy', ENTROPY_HEX, '--out', out])).rejects.toThrow(/one or the other/);
    await expect(runGenerate(['--final-seed', 'xyz', '--out', out])).rejects.toThrow(/64 hex/);
  });
});

describe('pass:preview', () => {
  it('writes an HTML grid with data-URI thumbnails and rarity badges', async () => {
    const out = join(dir, 'preview.html');
    await runPreview(['--seed', SEED_HEX, '--count', '6', '--out', out]);
    const html = readFileSync(out, 'utf8');
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(6);
    expect(html).toMatch(/Common|Rare|Legendary/);
  });
});

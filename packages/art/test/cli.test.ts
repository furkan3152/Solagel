import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { passTraits, revealedPassMetadata } from '../src/index';
import { runGenerate } from '../src/cli/generate';
import { runPreview } from '../src/cli/preview';

const SEED = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
const SEED_HEX = Buffer.from(SEED).toString('hex');
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
    await runGenerate(['--seed-file', seedFile, '--supply', '3333', '--out', out, '--from', '1', '--to', '5']);
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
    const expected = JSON.stringify(revealedPassMetadata(passTraits(SEED_HEX, 3, 3333), 3, '3.png', ''), null, 2) + '\n';
    expect(readFileSync(join(out, '3.json'), 'utf8')).toBe(expected);
  });

  it('prefixes image URLs with --base-url and requires a trailing slash', async () => {
    const out = join(dir, 'out2');
    await runGenerate(['--seed-file', seedFile, '--out', out, '--from', '2', '--to', '2', '--base-url', 'https://x.test/pass/']);
    expect(JSON.parse(readFileSync(join(out, '2.json'), 'utf8')).image).toBe('https://x.test/pass/2.png');
    await expect(runGenerate(['--seed-file', seedFile, '--out', out, '--base-url', 'https://x.test/pass'])).rejects.toThrow(/end with/);
  });

  it('points at pass-seed --new when the seed file is missing, without leaking anything', async () => {
    await expect(runGenerate(['--seed-file', join(dir, 'nope.json'), '--out', join(dir, 'o3')])).rejects.toThrow(/pnpm admin pass-seed --new/);
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

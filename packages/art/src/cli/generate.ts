import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectionJson, passCollection, passJson, serializePassJson, type PassTraits, type PassUrlOptions } from '../index';
import { CliError, createCanvas, DEFAULT_SEED_FILE, drawPassCard, int, main, parseArgs, renderCard, str, traitSeedHex, userPath } from './common';

const USAGE = `pnpm pass:generate (--seed-file ${DEFAULT_SEED_FILE} --entropy <hex> | --final-seed <hex>)
                   [--supply 3333] [--out out/pass] [--site-url https://host] [--base-url https://ipfs/dir/]
                   [--from 1] [--to <supply>]

Traits derive from the final seed sha256(seed || entropy), where entropy is Config.pass_entropy:
the hash of the slot the program fixed when the seed was revealed, stored by capture_pass_entropy
(\`pnpm admin status\` prints it).
After the reveal the final seed is public (Config.pass_final_seed), so anyone can regenerate with
--final-seed.`;

const title = (s: string): string => s[0].toUpperCase() + s.slice(1);

function tally(rows: string[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
}

/** Markdown: counts per tier and per trait value over the whole collection. */
export function rarityReport(col: PassTraits[]): string {
  const sections: [string, (t: PassTraits) => string][] = [
    ['Rarity', (t) => title(t.rarity)],
    ['Special', (t) => (t.special?.startsWith('oneOfOne:') ? '1/1' : (t.special ?? 'none'))],
    ['Ink', (t) => t.ink],
    ['Overprint', (t) => t.overprint],
    ['Symbol', (t) => t.symbol],
    ['Eyes', (t) => t.eyes],
    ['Mouth', (t) => t.mouth],
    ['Accessory', (t) => t.accessory],
    ['Paper', (t) => t.paper],
  ];
  const parts = [`# Slana Pass rarity report\n\nSupply: ${col.length}\n`];
  for (const [name, pick] of sections) parts.push(`## ${name}\n\n| Value | Count |\n| --- | ---: |\n${tally(col.map(pick))}\n`);
  return parts.join('\n');
}

async function banner(col: PassTraits[]): Promise<Buffer> {
  const canvas = createCanvas(1500, 500);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  // one legendary, one rare, one common
  const picks = (['legendary', 'rare', 'common'] as const).map((r) => col.findIndex((t) => t.rarity === r)).map((i) => (i < 0 ? 0 : i));
  picks.forEach((i, slot) => {
    ctx.save();
    ctx.translate(slot * 500, 0);
    drawPassCard(ctx, col[i], i + 1, 500);
    ctx.restore();
  });
  return canvas.encode('png');
}

export async function runGenerate(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.has('help')) return console.log(USAGE);
  const seedHex = traitSeedHex(opts);
  const supply = int(opts, 'supply', 3333);
  const from = int(opts, 'from', 1);
  const to = int(opts, 'to', supply);
  if (supply < 1) throw new CliError('--supply must be at least 1');
  if (from < 1 || to > supply || from > to) throw new CliError(`--from/--to must satisfy 1 <= from <= to <= ${supply}`);
  const baseUrl = str(opts, 'base-url');
  if (baseUrl !== undefined && !baseUrl.endsWith('/')) throw new CliError('--base-url must end with "/"');
  const siteUrl = str(opts, 'site-url')?.replace(/\/+$/, '');
  const urls: PassUrlOptions = { baseUrl, siteUrl };
  const out = userPath(str(opts, 'out') ?? 'out/pass');
  mkdirSync(out, { recursive: true });

  const col = passCollection(seedHex, supply);
  for (let n = from; n <= to; n++) {
    const t = col[n - 1];
    writeFileSync(join(out, `${n}.png`), await renderCard(t, n, 1024));
    writeFileSync(join(out, `${n}.json`), serializePassJson(passJson(n, seedHex, supply, urls)));
    if (n % 100 === 0 || n === to) console.log(`  ${n - from + 1}/${to - from + 1}`);
  }
  writeFileSync(join(out, 'collection.png'), await renderCard(null, 0, 1024));
  writeFileSync(join(out, 'collection.json'), serializePassJson(collectionJson(supply, urls)));
  writeFileSync(join(out, 'banner.png'), await banner(col));
  writeFileSync(join(out, 'rarity-report.md'), rarityReport(col));
  console.log(`wrote Passes ${from}-${to} of ${supply} to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(runGenerate);

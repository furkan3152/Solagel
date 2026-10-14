import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { passTraits } from '../index';
import { CliError, int, main, parseArgs, renderCard, str, userPath } from './common';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const title = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Writes an HTML grid of the first `--count` Passes for a hex seed (throwaway seeds welcome). */
export async function runPreview(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const seed = str(opts, 'seed');
  if (!seed || !/^[0-9a-fA-F]{64}$/.test(seed)) throw new CliError('--seed <64 hex chars> is required (use a throwaway seed, never the real one)');
  const supply = int(opts, 'supply', 3333);
  const count = Math.min(int(opts, 'count', 60), supply);
  const out = userPath(str(opts, 'out') ?? 'out/preview.html');

  const cells: string[] = [];
  for (let n = 1; n <= count; n++) {
    const t = passTraits(seed, n, supply);
    const png = await renderCard(t, n, 256);
    const label = t.special ? `${title(t.rarity)} / ${t.special.startsWith('oneOfOne:') ? '1/1' : title(t.special)}` : title(t.rarity);
    cells.push(
      `<figure class="${t.rarity}"><img alt="Slana Pass #${n}" width="256" height="256" src="data:image/png;base64,${png.toString('base64')}">` +
        `<figcaption><b>#${n}</b><span class="badge">${esc(label)}</span></figcaption></figure>`,
    );
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slana Pass preview</title>
<style>
body{margin:0;padding:24px;background:#f4ecd8;color:#1f1a2e;font-family:system-ui,sans-serif}
h1{margin:0 0 16px;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
figure{margin:0;background:#fff;border:2px solid #1f1a2e;border-radius:8px;padding:8px}
img{display:block;width:100%;height:auto;border-radius:4px}
figcaption{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:14px}
.badge{padding:2px 8px;border-radius:999px;border:1px solid #1f1a2e;font-size:12px}
.rare .badge{background:#9fe0d6}.legendary .badge{background:#f7a8c4}
</style></head><body>
<h1>Slana Pass preview (${count} of ${supply})</h1>
<div class="grid">
${cells.join('\n')}
</div></body></html>
`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`wrote ${count} Passes to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(runPreview);

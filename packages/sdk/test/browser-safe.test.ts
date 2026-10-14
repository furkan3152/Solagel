import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The SDK is bundled by Vite for the browser, so nothing reachable from src/index.ts may
 * import Node built-ins or rely on Node globals (src/admin.ts is the Node-only CLI).
 */
const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const NODE_BUILTINS = /^(node:|fs$|path$|os$|crypto$|child_process$|url$|util$|stream$|http$|https$|net$|tls$|zlib$|worker_threads$)/;

function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = readFileSync(entry, 'utf8');
  for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
    let file = join(dirname(entry), m[1]);
    if (!file.endsWith('.ts') && !file.endsWith('.json')) file += '.ts';
    if (file.endsWith('.ts')) reachable(file, seen);
  }
  return seen;
}

describe('browser safety', () => {
  const files = [...reachable(join(src, 'index.ts'))];

  it('index.ts does not reach the admin CLI', () => {
    expect(files.some((f) => f.endsWith('admin.ts'))).toBe(false);
    expect(files.length).toBeGreaterThan(5);
    for (const name of ['token.ts', 'core.ts', 'passes.ts']) expect(files.some((f) => f.endsWith(name)), name).toBe(true);
  });

  it('no Node built-ins or Node globals in browser modules', () => {
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        expect(NODE_BUILTINS.test(spec), `${file} imports ${spec}`).toBe(false);
      }
      const body = code.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
      expect(/\bprocess\.|\b__dirname\b|\brequire\(/.test(body), `${file} uses a Node global`).toBe(false);
      // `Buffer` may only come from the `buffer` package (never the Node global)
      if (/\bBuffer\b/.test(body)) expect(/import (type )?\{ Buffer \} from 'buffer'/.test(code), `${file} uses global Buffer`).toBe(true);
    }
  });
});

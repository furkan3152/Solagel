import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // workspace packages ship TypeScript sources → bundle them; npm deps (viem, ws) stay external
  noExternal: [/^@elymum\//],
  splitting: false,
  // a CommonJS dependency bundled through a workspace package would need `require`, `__filename` and
  // `__dirname`, which an ESM bundle does not have: define them so such a dependency never crashes the process
  banner: {
    js: [
      "import { createRequire as __elymumCreateRequire } from 'node:module';",
      "import { fileURLToPath as __elymumFileURLToPath } from 'node:url';",
      "import { dirname as __elymumDirname } from 'node:path';",
      'const require = __elymumCreateRequire(import.meta.url);',
      'const __filename = __elymumFileURLToPath(import.meta.url);',
      'const __dirname = __elymumDirname(__filename);',
    ].join('\n'),
  },
});

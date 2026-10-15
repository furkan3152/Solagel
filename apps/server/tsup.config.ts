import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // workspace packages ship TypeScript sources → bundle them; npm deps stay external
  noExternal: [/^@slana\//],
  splitting: false,
  // CommonJS deps bundled with the SDK (@solana/buffer-layout, bn.js, bigint-buffer's `bindings`, …) use
  // `require`, `__filename` and `__dirname`, which an ESM bundle does not have: define them (otherwise the
  // chain fails to load, or the process crashes, in production).
  banner: {
    js: [
      "import { createRequire as __slanaCreateRequire } from 'node:module';",
      "import { fileURLToPath as __slanaFileURLToPath } from 'node:url';",
      "import { dirname as __slanaDirname } from 'node:path';",
      'const require = __slanaCreateRequire(import.meta.url);',
      'const __filename = __slanaFileURLToPath(import.meta.url);',
      'const __dirname = __slanaDirname(__filename);',
    ].join('\n'),
  },
});

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { build } from 'tsup';
import { describe, expect, it } from 'vitest';
import config from '../tsup.config';

/**
 * The Docker image runs the tsup bundle (`node dist/index.js`). CommonJS deps bundled with the SDK
 * (@solana/buffer-layout, bn.js, bigint-buffer's `bindings`) use `require`, `__filename` and `__dirname`,
 * which an ESM bundle lacks: the chain then failed to load ("Dynamic require of "buffer"") or the process
 * crashed. Build the real entry like `pnpm build` and start it with a (unreachable) chain configured.
 */
describe('production bundle (tsup)', () => {
  it('starts with the Solana gateway loaded and stays up', async () => {
    // inside the package so the external npm deps resolve from its node_modules, like dist/ does
    mkdirSync(join(__dirname, '../node_modules/.cache'), { recursive: true });
    const outDir = mkdtempSync(join(__dirname, '../node_modules/.cache/bundle-test-'));
    try {
      const opts = (Array.isArray(config) ? config[0] : config) as object;
      await build({ ...opts, entry: [join(__dirname, '../src/index.ts')], outDir, sourcemap: false, clean: false, silent: true });
      const child = spawn(process.execPath, [join(outDir, 'index.js')], {
        cwd: outDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: '0',
          HOST: '127.0.0.1',
          DATA_DIR: join(outDir, 'data'),
          SOLANA_CLUSTER: 'localnet',
          SOLANA_RPC_URL: 'http://127.0.0.1:1',
          PROGRAM_ID: '5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472',
          SERVER_KEYPAIR: JSON.stringify([...Keypair.generate().secretKey]),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (d) => (log += d));
      child.stderr.on('data', (d) => (log += d));
      let exited = false;
      child.on('exit', () => (exited = true));
      const deadline = Date.now() + 15_000;
      while (!/Slana server on/.test(log) && !exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1_500));
      child.kill();
      expect(exited, log).toBe(false);
      expect(log).toMatch(/Slana server on/);
      expect(log).not.toMatch(/failed to initialise|Dynamic require|ReferenceError/);
      expect(log).toMatch(/chain: RPC localnet .* unreachable/); // the gateway itself loaded
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});

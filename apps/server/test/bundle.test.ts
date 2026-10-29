import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { build } from 'tsup';
import { describe, expect, it } from 'vitest';
import config from '../tsup.config';

/**
 * The Docker image runs the tsup bundle (`node dist/index.js`) with the workspace packages bundled in
 * (`@elymum/*` ship TypeScript sources) and viem external. Build the real entry like `pnpm build` and
 * start it with an (unreachable) EVM chain configured: the gateway must load and keep the process up.
 */
describe('production bundle (tsup)', () => {
  it('starts with the EVM gateway loaded and stays up', async () => {
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
          EVM_RPC_URL: 'http://127.0.0.1:1',
          SERVER_PRIVATE_KEY: generatePrivateKey(),
          ADMIN_WALLETS: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (d) => (log += d));
      child.stderr.on('data', (d) => (log += d));
      let exited = false;
      child.on('exit', () => (exited = true));
      const deadline = Date.now() + 15_000;
      while (!/Elymum server on/.test(log) && !exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1_500));
      child.kill();
      expect(exited, log).toBe(false);
      expect(log).toMatch(/Elymum server on/);
      expect(log).not.toMatch(/failed to initialise|Dynamic require|ReferenceError/);
      expect(log).toMatch(/chain: server key 0x[0-9a-fA-F]{40}/);
      expect(log).toMatch(/chain: RPC http:\/\/127\.0\.0\.1:1 unreachable/); // the gateway itself loaded
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});

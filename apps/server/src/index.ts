import { createApp } from './app';
import { assertPublicUrl, invalidAdminWallets, loadConfig } from './config';
import { redactUrls } from './http';
import { installProcessGuards } from './process-guards';

// every line is URL-redacted: `EVM_RPC_URL` (which may carry an API key) appears in chain logs and RPC errors
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${redactUrls(m)}`);

async function main(): Promise<void> {
  const cfg = loadConfig();
  assertPublicUrl(cfg);
  if (!process.env.AUTH_SECRET) log('auth: AUTH_SECRET not set — using the generated secret kept in DATA_DIR/auth-secret');
  // the secret signs every session token (admin sessions too): a short one can be brute-forced offline from any token
  else if (process.env.AUTH_SECRET.length < 32) log('!!! auth: AUTH_SECRET is shorter than 32 characters — use a long random value (e.g. `openssl rand -hex 32`)');
  const badAdmins = invalidAdminWallets(process.env.ADMIN_WALLETS);
  if (badAdmins.length > 0) log(`!!! ADMIN_WALLETS: ignoring ${badAdmins.length} entr${badAdmins.length === 1 ? 'y' : 'ies'} that are not 0x addresses (${badAdmins.join(', ')})`);
  const app = await createApp(cfg, { log });
  const port = await app.listen();
  const status = app.chain.status();
  log(
    `Elymum server on http://${cfg.host}:${port} (ws: /ws) — chain: ${
      status.enabled ? `${status.chainName} (${status.chainId}) · arena ${status.arenaAddress ?? 'not registered yet'}` : 'off (practice only)'
    }`,
  );

  let stopping = false;
  const shutdown = async (signal: string, code = 0) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received — cashing out stake players and saving state…`);
    // a close that hangs (e.g. on a dead RPC) must not keep a broken process alive
    setTimeout(() => process.exit(code), 15_000).unref();
    await app.close().catch((err) => log(`shutdown: close failed: ${redactUrls(String((err as Error)?.stack ?? err))}`));
    setTimeout(() => process.exit(code), 200).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  installProcessGuards(log, (why) => void shutdown(why, 1));
}

main().catch((err) => {
  console.error(redactUrls(String((err as Error)?.stack ?? err)));
  process.exit(1);
});

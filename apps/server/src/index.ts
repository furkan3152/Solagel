import { createApp } from './app';
import { assertPublicUrl, invalidAdminWallets, loadConfig } from './config';

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

async function main(): Promise<void> {
  const cfg = loadConfig();
  assertPublicUrl(cfg);
  if (!process.env.AUTH_SECRET) log('auth: AUTH_SECRET not set — login tokens reset on every restart');
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
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received — cashing out stake players and saving state…`);
    await app.close();
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

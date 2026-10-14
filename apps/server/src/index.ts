import { createApp } from './app';
import { loadConfig } from './config';

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!process.env.AUTH_SECRET) log('auth: AUTH_SECRET not set — login tokens reset on every restart');
  const app = await createApp(cfg, { log });
  const port = await app.listen();
  const status = app.chain.status();
  log(
    `🪙 Slana server on http://${cfg.host}:${port} (ws: /ws) — chain: ${status.enabled ? `${status.cluster} · ${status.programId}` : 'off (free play only)'}`,
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

import { redactUrls } from './http';

/**
 * Process-level safety net. A stray promise rejection in a background task (a timer, a fire-and-forget
 * refresh) is logged and the server keeps running: by default Node 15+ would crash the whole process (every
 * live round) on it. An uncaught exception leaves the process in an unknown state: it is logged and
 * `fatal` shuts the server down cleanly (live stakes are journaled), so the host restarts it. Messages are
 * URL-redacted (an RPC URL can carry an API key).
 */
export function installProcessGuards(log: (m: string) => void, fatal: (why: string) => void, proc: Pick<NodeJS.Process, 'on'> = process): void {
  proc.on('unhandledRejection', (reason: unknown) => {
    log(`!!! unhandled promise rejection (kept running): ${redactUrls(String((reason as Error)?.stack ?? reason))}`);
  });
  proc.on('uncaughtException', (err: Error) => {
    log(`!!! uncaught exception — shutting down: ${redactUrls(String(err?.stack ?? err))}`);
    fatal('uncaughtException');
  });
}

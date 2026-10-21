/**
 * A small, privacy-preserving browser fingerprint sent with `join` (`fp`) for the server's
 * multi-account check (several wallets playing one arena from one browser at the same time).
 *
 * It is a SHA-256 prefix of a random id kept in this browser's localStorage plus a few coarse
 * settings (language, time zone, screen size, CPU count). No canvas, audio or font probing, and
 * nothing readable leaves the browser: only the hash, which the server hashes again with its own
 * secret and treats as untrusted evidence. Clearing site data or a private window gives a new one.
 */
const KEY = 'slana.device.v1';

let value: string | null = null;
let started = false;

function installId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      id = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

async function compute(): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* ignore */
  }
  const parts = [
    installId(),
    navigator.language ?? '',
    tz,
    typeof screen === 'undefined' ? '' : `${screen.width}x${screen.height}@${Math.round((window.devicePixelRatio || 1) * 100)}`,
    String(navigator.hardwareConcurrency ?? ''),
  ];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`slana-fp|${parts.join('|')}`));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** The fingerprint, or undefined until it is ready (it is computed once, in the background). */
export function fingerprint(): string | undefined {
  if (!started) {
    started = true;
    compute().then(
      (v) => {
        value = v;
      },
      () => {
        value = null;
      },
    );
  }
  return value ?? undefined;
}

// start at load, so the first join already carries it
if (typeof window !== 'undefined') fingerprint();

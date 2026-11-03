import { updateSettings, useUi } from '../store';

/**
 * "Your own music": a file from the player's device, played from a blob URL in this browser.
 * It is never uploaded. A copy is kept in this browser's IndexedDB (when the browser allows it and
 * the file is not huge) so the pick survives a reload; "Clear" removes it. Every IndexedDB call is
 * guarded: in a private window or with storage blocked the file simply lasts for the session.
 */

/** Files above this are played for the session but not kept (IndexedDB quotas vary). */
export const CUSTOM_SAVE_MAX = 80 * 1024 * 1024;
/** Above this a file is refused outright (it would not be a song). */
export const CUSTOM_MAX = 400 * 1024 * 1024;

const DB_NAME = 'elymum.music';
const STORE = 'files';
const KEY = 'custom';

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|weba|mp4)$/i;

/** Does this look like an audio file the browser may play? */
export function isAudioFile(file: Pick<File, 'name' | 'type' | 'size'>): boolean {
  if (file.size <= 0 || file.size > CUSTOM_MAX) return false;
  return file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
}

/** The file name shown in the settings (no extension). */
export function displayName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  return base || name;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE);
        } catch {
          /* exists */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

interface Saved {
  name: string;
  blob: Blob;
}

let currentUrl: string | null = null;

function show(name: string, blob: Blob, saved: boolean): void {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  useUi.setState({ customMusic: { name: displayName(name), url: currentUrl, saved, error: false } });
}

/** The player picked a file: play it now, keep a copy in this browser if possible. */
export async function pickCustomMusic(file: File): Promise<boolean> {
  if (!isAudioFile(file)) {
    useUi.setState({ customMusicRefused: true });
    return false;
  }
  show(file.name, file, false);
  useUi.setState({ customMusicRefused: false });
  updateSettings({ musicTrack: 'custom', musicOn: true });
  if (file.size <= CUSTOM_SAVE_MAX) {
    const ok = await withStore('readwrite', (s) => s.put({ name: file.name, blob: file } satisfies Saved, KEY));
    if (ok !== null) useUi.setState((s) => (s.customMusic && s.customMusic.url === currentUrl ? { customMusic: { ...s.customMusic, saved: true } } : {}));
  } else {
    await withStore('readwrite', (s) => s.delete(KEY));
  }
  return true;
}

/** Forget the file (and its saved copy); the soundtrack goes back to the default. */
export async function clearCustomMusic(): Promise<void> {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  useUi.setState({ customMusic: null, customMusicRefused: false });
  if (useUi.getState().settings.musicTrack === 'custom') updateSettings({ musicTrack: 'classic' });
  await withStore('readwrite', (s) => s.delete(KEY));
}

/** At start: bring back a kept file. If the pick was "your own music" and none is kept, the default plays. */
export async function restoreCustomMusic(): Promise<void> {
  const saved = (await withStore<Saved | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<Saved | undefined>)) ?? null;
  if (useUi.getState().customMusic) return; // a file picked meanwhile wins
  if (saved && saved.blob instanceof Blob && saved.blob.size > 0) {
    show(saved.name, saved.blob, true);
    return;
  }
  if (useUi.getState().settings.musicTrack === 'custom') updateSettings({ musicTrack: 'classic' });
}

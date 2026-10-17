import type {
  ChainStatus,
  DeathStats,
  LbEntry,
  PowerUpType,
  ProfileSummary,
  RoomInfo,
  RoundStanding,
} from '@slana/shared';
import { create } from 'zustand';
import { AUDIO_DEFAULTS } from './audio/mixer';

export type Screen = 'lobby' | 'playing' | 'dead' | 'spectating' | 'roundover';
export type Quality = 'high' | 'low';
export type Theme = 'light' | 'dark';

export interface Settings {
  name: string;
  skin: number;
  theme: Theme;
  quality: Quality;
  /** Master switch (the header's mute) and master volume. */
  sound: boolean;
  volume: number;
  /** Per-bus levels and switches (audio/mixer.ts). */
  music: number;
  musicOn: boolean;
  sfx: number;
  sfxOn: boolean;
  voice: number;
  /** The announcer's short spoken lines. */
  announcer: boolean;
  showNames: boolean;
  showMass: boolean;
  showFps: boolean;
  showMinimap: boolean;
  showChat: boolean;
  /** Last arena the player bought a ticket for (Quick Play goes back there). */
  lastArena: number | null;
}

export interface KillItem {
  id: number;
  killer: string;
  killerSkin: number;
  victim: string;
  victimSkin: number;
  cause: 'eat' | 'virus';
  at: number;
}

export interface ChatItem {
  id: number;
  pid: number;
  from: string;
  skin: number;
  text: string;
  system?: boolean;
  at: number;
}

export interface RoundResult {
  kind: 'round' | 'exit';
  /** Round number (`round` only). */
  round: number | null;
  /** The till at the end, before the fee (raw token units). */
  payout: number;
  stats: DeathStats | null;
  /** Top stakers at the bell (`round` only); `you` marks this player. */
  standings: RoundStanding[];
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
  link?: { href: string; label: string };
  at: number;
}

export type Modal = 'settings' | 'howto' | 'wallet' | null;

/** Lobby pages: the ticket front page, the newspaper leaderboard, the profile, the player guide. */
export type LobbyPage = 'play' | 'ranks' | 'profile' | 'docs';
const PAGES: readonly LobbyPage[] = ['play', 'ranks', 'profile', 'docs'];
/** The player guide also lives at the path `/docs` (the server's SPA fallback serves index.html there). */
const DOCS_PATH = /^\/docs\/?$/;

export interface AuthState {
  pubkey: string;
  token: string;
  profile: ProfileSummary | null;
}

export interface UiState {
  screen: Screen;
  connected: boolean;
  connecting: boolean;
  ping: number;
  fps: number;
  online: number;
  rooms: RoomInfo[];
  /** Arenas the server keeps closed (R20: vault short of its journal); their tickets are not sold. */
  blockedArenas: number[];
  chain: ChainStatus | null;
  room: RoomInfo | null;
  me: { pid: number; name: string; skin: number } | null;
  hud: { mass: number; cells: number; value: number | null; rank: number; players: number };
  /** Last arena value change, for the till slip's "+X" chip (id changes per message). */
  valueDelta: { id: number; delta: number; reason: 'eat' | 'loot' | 'eaten' | 'spill' } | null;
  /** The arena ticket being played: its own price, arena and session. */
  ticket: { entryFee: number; arenaId: number | null; session: string | null } | null;
  lb: LbEntry[];
  leaders: { x: number; y: number }[];
  killfeed: KillItem[];
  chat: ChatItem[];
  chatOpen: boolean;
  powerups: { type: PowerUpType; until: number }[];
  banner: { kind: 'coinrain' | 'airdrop'; until: number; text?: string } | null;
  death: { stats: DeathStats; killer: string | null; killerSkin: number | null } | null;
  /**
   * A paid game that ended with a payout: `round` at the bell (`roundOver`, with the room's
   * standings), `exit` when the operator ended it (an admin kick or a server shutdown pays
   * the current value).
   */
  roundResult: RoundResult | null;
  /**
   * A ticket bought (or resumed) while the round's joins were closed: it is held, and joins by
   * itself when the next round opens (`opensAt`, server clock).
   */
  held: { arenaId: number; opensAt: number } | null;
  /** Last `settled` message; `session` matches it to a ticket (ruling R16). */
  /** `collect`: R24, settled without a usable token account; the net waits in the vault for "Collect payout". */
  lastSettlement: { session: string | null; arenaId: number | null; signature: string; payout: number; fee?: number; net?: number; collect?: boolean; at: number } | null;
  spectateTarget: number | null;
  toasts: Toast[];
  modal: Modal;
  /** Lobby page (mirrored in the URL hash: `#ranks`, `#profile`, `#docs`; the guide also at `/docs`). */
  page: LobbyPage;
  /** Death / receipt "New ticket": the lobby selects this ticket and opens its confirm sheet. */
  lobbyIntent: { ticket: 'practice' | `arena:${number}`; open: boolean; at: number } | null;
  auth: AuthState | null;
  /** The server refused a room entry with `game_closed`: the game is admin-only and this session is no admin. */
  gameClosed: boolean;
  settings: Settings;
}

const SETTINGS_KEY = 'slana.settings.v1';

function loadSettings(): Settings {
  const defaults: Settings = {
    name: '',
    skin: 0,
    theme: 'light',
    quality: 'high',
    sound: true,
    volume: AUDIO_DEFAULTS.master,
    music: AUDIO_DEFAULTS.music,
    musicOn: true,
    sfx: AUDIO_DEFAULTS.sfx,
    sfxOn: true,
    voice: AUDIO_DEFAULTS.voice,
    announcer: true,
    showNames: true,
    showMass: true,
    showFps: false,
    showMinimap: true,
    showChat: true,
    lastArena: null,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      // retired fields: `lang` (the interface is English only) and `passSkin` (the Slana Pass is gone)
      const { lang: _lang, passSkin: _passSkin, ...saved } = JSON.parse(raw) as Partial<Settings> & { lang?: unknown; passSkin?: unknown };
      return { ...defaults, ...saved };
    }
  } catch {
    /* storage unavailable */
  }
  return defaults;
}

export const useUi = create<UiState>(() => ({
  screen: 'lobby',
  connected: false,
  connecting: true,
  ping: 0,
  fps: 0,
  online: 0,
  rooms: [],
  blockedArenas: [],
  chain: null,
  room: null,
  me: null,
  hud: { mass: 0, cells: 0, value: null, rank: 0, players: 0 },
  valueDelta: null,
  ticket: null,
  lb: [],
  leaders: [],
  killfeed: [],
  chat: [],
  chatOpen: false,
  powerups: [],
  banner: null,
  death: null,
  roundResult: null,
  held: null,
  lastSettlement: null,
  spectateTarget: null,
  toasts: [],
  modal: null,
  page: pageFromLocation(),
  lobbyIntent: null,
  auth: null,
  gameClosed: false,
  settings: loadSettings(),
}));

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...useUi.getState().settings, ...patch };
  useUi.setState({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

let toastId = 1;
export function toast(kind: Toast['kind'], text: string, link?: Toast['link'], ttlMs = 5000): void {
  const t: Toast = { id: toastId++, kind, text, link, at: Date.now() };
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), ttlMs);
}

export const openModal = (modal: Modal) => useUi.setState({ modal });

/** The page a URL names: a known hash wins, else `/docs` is the guide, else the front page. */
export function pageFromUrl(pathname: string, hash: string): LobbyPage {
  const h = hash.replace(/^#/, '') as LobbyPage;
  if (PAGES.includes(h)) return h;
  return DOCS_PATH.test(pathname) ? 'docs' : 'play';
}

function pageFromLocation(): LobbyPage {
  try {
    return pageFromUrl(location.pathname, location.hash);
  } catch {
    return 'play';
  }
}

/**
 * The URL for `page` seen from `pathname`: pages are hashes (`/#ranks`); the guide keeps
 * the path `/docs` when it was opened there, and leaving it from `/docs` goes back to `/`.
 */
export function urlForPage(page: LobbyPage, pathname: string, search: string): string {
  const onDocs = DOCS_PATH.test(pathname);
  if (page === 'docs') return onDocs ? `${pathname}${search}` : `${pathname}${search}#docs`;
  const path = onDocs ? '/' : pathname;
  return `${path}${search}${page === 'play' ? '' : `#${page}`}`;
}

/** Opens a lobby page (and keeps the URL in step, so a page can be linked: `/#ranks`, `/docs`). */
export function goPage(page: LobbyPage): void {
  useUi.setState({ page });
  try {
    const url = urlForPage(page, location.pathname, location.search);
    if (`${location.pathname}${location.search}${location.hash}` !== url) history.replaceState(null, '', url);
  } catch {
    /* no history (tests) */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const page = pageFromLocation();
    if (page !== useUi.getState().page) useUi.setState({ page });
  });
}

/** "New ticket": back to the lobby with this ticket selected (and its confirm sheet open for arenas). */
export function requestTicket(arenaId: number | null): void {
  useUi.setState({ lobbyIntent: { ticket: arenaId === null ? 'practice' : `arena:${arenaId}`, open: arenaId !== null, at: Date.now() } });
}
export const closeModal = () => useUi.setState({ modal: null });

import type {
  ChainStatus,
  DeathStats,
  LbEntry,
  PowerUpType,
  ProfileSummary,
  RoomInfo,
} from '@slana/shared';
import { create } from 'zustand';

export type Screen = 'lobby' | 'playing' | 'dead' | 'spectating' | 'cashedout';
export type Lang = 'en' | 'tr';
export type Quality = 'high' | 'low';
export type Theme = 'light' | 'dark';

export interface Settings {
  name: string;
  skin: number;
  lang: Lang;
  theme: Theme;
  quality: Quality;
  sound: boolean;
  volume: number;
  showNames: boolean;
  showMass: boolean;
  showFps: boolean;
  showMinimap: boolean;
  showChat: boolean;
  /** Last arena the player bought a ticket for (Quick Play goes back there). */
  lastArena: number | null;
  /** Slana Pass asset worn as the look (server-verified at join), null = basic skin. */
  passSkin: string | null;
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

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
  link?: { href: string; label: string };
  at: number;
}

export type Modal = 'settings' | 'howto' | 'wallet' | null;

/** Lobby pages: the ticket front page, the newspaper leaderboard, the Pass office, the profile. */
export type LobbyPage = 'play' | 'ranks' | 'pass' | 'profile';
const PAGES: readonly LobbyPage[] = ['play', 'ranks', 'pass', 'profile'];

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
  chain: ChainStatus | null;
  room: RoomInfo | null;
  me: { pid: number; name: string; skin: number } | null;
  hud: { mass: number; cells: number; value: number | null; rank: number; players: number };
  /** Last arena value change, for the KASA slip's "+X" chip (id changes per message). */
  valueDelta: { id: number; delta: number; reason: 'eat' | 'loot' | 'eaten' | 'spill' } | null;
  /** The arena ticket being played: its own price and whether it carries a Slana Pass. */
  ticket: { entryFee: number; hasPass: boolean; arenaId: number | null; session: string | null } | null;
  lb: LbEntry[];
  leaders: { x: number; y: number }[];
  killfeed: KillItem[];
  chat: ChatItem[];
  chatOpen: boolean;
  powerups: { type: PowerUpType; until: number }[];
  banner: { kind: 'coinrain' | 'airdrop'; until: number; text?: string } | null;
  /** Cash-out channel: `until` is a performance.now() time, `total` the channel length in ms. */
  cashout: { state: 'idle' | 'channel'; until: number; total: number };
  death: { stats: DeathStats; killer: string | null; killerSkin: number | null } | null;
  cashoutResult: { value: number; stats: DeathStats | null } | null;
  /** Last `settled` message; `session` matches it to a ticket (ruling R16). */
  lastSettlement: { session: string | null; arenaId: number | null; signature: string; payout: number; fee?: number; net?: number; at: number } | null;
  spectateTarget: number | null;
  toasts: Toast[];
  modal: Modal;
  /** Lobby page (mirrored in the URL hash: `#pass`, `#ranks`, `#profile`). */
  page: LobbyPage;
  /** Death / receipt "Yeni bilet": the lobby selects this ticket and opens its confirm sheet. */
  lobbyIntent: { ticket: 'practice' | `arena:${number}`; open: boolean; at: number } | null;
  auth: AuthState | null;
  settings: Settings;
}

const SETTINGS_KEY = 'slana.settings.v1';

function defaultLang(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  } catch {
    return 'en';
  }
}

function loadSettings(): Settings {
  const defaults: Settings = {
    name: '',
    skin: 0,
    lang: defaultLang(),
    theme: 'light',
    quality: 'high',
    sound: true,
    volume: 0.6,
    showNames: true,
    showMass: true,
    showFps: false,
    showMinimap: true,
    showChat: true,
    lastArena: null,
    passSkin: null,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
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
  cashout: { state: 'idle', until: 0, total: 0 },
  death: null,
  cashoutResult: null,
  lastSettlement: null,
  spectateTarget: null,
  toasts: [],
  modal: null,
  page: pageFromHash(),
  lobbyIntent: null,
  auth: null,
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

function pageFromHash(): LobbyPage {
  try {
    const h = location.hash.replace(/^#/, '') as LobbyPage;
    return PAGES.includes(h) ? h : 'play';
  } catch {
    return 'play';
  }
}

/** Opens a lobby page (and keeps the URL hash in step, so a page can be linked: `/#pass`). */
export function goPage(page: LobbyPage): void {
  useUi.setState({ page });
  try {
    const hash = page === 'play' ? '' : `#${page}`;
    if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  } catch {
    /* no history (tests) */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const page = pageFromHash();
    if (page !== useUi.getState().page) useUi.setState({ page });
  });
}

/** "Yeni bilet": back to the lobby with this ticket selected (and its confirm sheet open for arenas). */
export function requestTicket(arenaId: number | null): void {
  useUi.setState({ lobbyIntent: { ticket: arenaId === null ? 'practice' : `arena:${arenaId}`, open: arenaId !== null, at: Date.now() } });
}
export const closeModal = () => useUi.setState({ modal: null });

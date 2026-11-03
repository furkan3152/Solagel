import { isCountryCode, suggestCountry } from '@elymum/shared';
import type {
  BoostKind,
  BoostState,
  ChainStatus,
  DeathStats,
  LbEntry,
  StandingRow,
  PowerUpType,
  ProfileSummary,
  RoomInfo,
  RoundStanding,
} from '@elymum/shared';
import { create } from 'zustand';
import { AUDIO_DEFAULTS } from './audio/mixer';
import { DEFAULT_TRACK, musicChoice, type MusicChoice } from './audio/tracks';

export type Screen = 'lobby' | 'playing' | 'dead' | 'spectating' | 'roundover';
export type Quality = 'high' | 'low';
export type Theme = 'light' | 'dark';

export interface Settings {
  name: string;
  skin: number;
  /** Wear the uploaded profile picture on the coin (signed-in wallets with a picture; `join.pic`). */
  picture: boolean;
  /** The country the player plays for (ISO 3166-1 alpha-2, a flag by the name; `join.country`); '' for none. */
  country: string;
  /**
   * `country` is only the first-visit guess (from the browser's languages), not a choice: a signed-in
   * profile's saved country replaces it. Picking a country (or none) clears it.
   */
  countryAuto: boolean;
  /**
   * Wear the country's flag as the coin skin (`join.flag`; saved with a signed-in profile). Needs a
   * country; a worn profile picture wins over it.
   */
  flagSkin: boolean;
  theme: Theme;
  quality: Quality;
  /** Master switch (the header's mute) and master volume. */
  sound: boolean;
  volume: number;
  /** Per-bus levels and switches (audio/mixer.ts). */
  music: number;
  /** The music switch: off is "No music". */
  musicOn: boolean;
  /** The soundtrack (audio/tracks.ts); `custom` is a file from the player's device. */
  musicTrack: MusicChoice;
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
  /**
   * "Approve only this ticket": each ticket approves exactly its entry fee (two wallet prompts
   * every time). Off (default): the first ticket approves once for all later ones.
   */
  exactApprove: boolean;
}

export interface KillItem {
  id: number;
  killer: string;
  killerSkin: number;
  victim: string;
  victimSkin: number;
  /** `left`: the victim went home (a bot making room for a person, or retiring); there is no killer. */
  cause: 'eat' | 'virus' | 'left';
  /** BOT tags. */
  killerIsBot?: boolean;
  victimIsBot?: boolean;
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

export type Modal = 'settings' | 'howto' | 'wallet' | 'shop' | 'standings' | null;

/** Lobby pages: the ticket front page, the newspaper leaderboard, the profile, the player guide. */
export type LobbyPage = 'play' | 'ranks' | 'profile' | 'docs';
const PAGES: readonly LobbyPage[] = ['play', 'ranks', 'profile', 'docs'];
/** The player guide also lives at the path `/docs` (the server's SPA fallback serves index.html there). */
const DOCS_PATH = /^\/docs\/?$/;

export interface AuthState {
  /** The signed-in wallet, EIP-55 checksummed. */
  address: string;
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
  /** Arenas the server keeps closed (vault short of its journal); their tickets are not sold. */
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
  /** The full room standings (`standings`), while the standings sheet is open; null otherwise. */
  standings: { rows: StandingRow[]; players: number; watching: number; at: number } | null;
  leaders: { x: number; y: number }[];
  killfeed: KillItem[];
  chat: ChatItem[];
  chatOpen: boolean;
  powerups: { type: PowerUpType; until: number }[];
  /** Bought power-ups in this room (`boosts`): charges, arena allowance; null outside a game. */
  boosts: BoostState | null;
  /** Local clock (`Date.now`) at which each bought power-up is ready again (cooldown rings). */
  boostReady: Record<BoostKind, number>;
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
  /** Last `settled` message; `session` matches it to a ticket. */
  /** `collect`: the token transfer to the player failed; the net waits in the arena vault for "Collect payout". Amounts are ledger units. */
  lastSettlement: {
    session: string | null;
    arenaId: number | null;
    txHash: string;
    payout: number;
    fee?: number;
    net?: number;
    /** The fee was taken from the entry fee (arena v2): the whole payout reached the wallet. */
    feeOnEntry?: boolean;
    collect?: boolean;
    at: number;
  } | null;
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
  /** "Your own music" this session: the file's name and its blob URL (audio/custom.ts); never uploaded. */
  customMusic: CustomMusic | null;
  /** The last file picked was not audio (or too big). */
  customMusicRefused: boolean;
}

export interface CustomMusic {
  name: string;
  url: string;
  /** A copy is kept in this browser (IndexedDB) for the next visit. */
  saved: boolean;
  /** The browser would not play it. */
  error: boolean;
}

const SETTINGS_KEY = 'elymum.settings.v1';

/** The first-visit guess at the player's country: the browser's language regions (`suggestCountry`). */
export function guessCountry(): string {
  try {
    return suggestCountry(typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : null) ?? '';
  } catch {
    return '';
  }
}

/** Saved settings over the defaults; a country is kept only when it is on the allowlist. */
export function mergeSettings(defaults: Settings, saved: Partial<Settings>): Settings {
  const out = { ...defaults, ...saved };
  if (typeof saved.country !== 'string') {
    // saved before countries existed: the guess, until the player picks
    out.country = defaults.country;
    out.countryAuto = true;
  } else if (saved.country !== '' && !isCountryCode(saved.country)) {
    out.country = '';
  }
  out.countryAuto = out.countryAuto === true;
  out.flagSkin = out.flagSkin === true;
  return out;
}

function loadSettings(): Settings {
  const defaults: Settings = {
    name: '',
    skin: 0,
    picture: false,
    country: guessCountry(),
    countryAuto: true,
    flagSkin: false,
    theme: 'light',
    quality: 'high',
    sound: true,
    volume: AUDIO_DEFAULTS.master,
    music: AUDIO_DEFAULTS.music,
    musicOn: true,
    musicTrack: DEFAULT_TRACK,
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
    exactApprove: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      // retired fields: `lang` (the interface is English only) and `passSkin` (the old pass is gone)
      const { lang: _lang, passSkin: _passSkin, ...saved } = JSON.parse(raw) as Partial<Settings> & { lang?: unknown; passSkin?: unknown };
      const out = mergeSettings(defaults, saved);
      out.musicTrack = musicChoice(out.musicTrack);
      return out;
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
  standings: null,
  leaders: [],
  killfeed: [],
  chat: [],
  chatOpen: false,
  powerups: [],
  boosts: null,
  boostReady: { magnet: 0, shock: 0, speed: 0 },
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
  customMusic: null,
  customMusicRefused: false,
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

/**
 * A signed-in profile was loaded: its saved country (or its "none") replaces the first-visit guess.
 * A country the player picked on this device stays (saving the profile sends it to the server).
 */
export function adoptProfileCountry(profile: { country?: string | null; flagSkin?: boolean } | null): void {
  if (!profile) return;
  // the flag skin turned on on another device follows the player here (turning it on here saves it)
  if (profile.flagSkin === true && !useUi.getState().settings.flagSkin) updateSettings({ flagSkin: true });
  if (profile.country === undefined || !useUi.getState().settings.countryAuto) return;
  updateSettings({ country: isCountryCode(profile.country) ? profile.country : '', countryAuto: false });
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

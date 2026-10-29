import { CARD_PAPER, INK, RISO } from '@elymum/art';
import {
  PowerUpType,
  arenaMeta,
  clamp,
  formatToken,
  encodeEject,
  encodeSplit,
  encodeTarget,
  levelFromXp,
  type DeathStats,
  type RoundStanding,
  type ServerMessage,
  type SnapshotData,
} from '@elymum/shared';
import { ledgerDecimals } from '@elymum/sdk';
import { SERVER } from '../config';
import { DROP_LAND, DUR, SLOWMO_TOTAL, slowmoScale } from '../design/curves';
import { t } from '../i18n';
import { FrameGovernor } from '../render/governor';
import { Renderer } from '../render/renderer';
import { FOOD_COLORS } from '../render/sprites';
import { toast, useUi } from '../store';
import { Camera } from './camera';
import { serverClock } from './clock';
import { HeldTicket } from './held';
import { Input } from './input';
import { Net } from './net';
import { Particles } from './particles';
import { announce, sound, unlockAudio } from '../audio';
import { currentRound } from './round';
import { RoundCues } from './roundCues';
import { ClientWorld } from './state';
import { fingerprint } from '../integrity/fingerprint';

/** "Whale alert." once a life reaches this mass (25 times the start mass). */
const WHALE_MASS = 500;
/** The world stands still this long on the bell (the receipt prints over it), then catches up. */
export const BELL_FREEZE_MS = 2500;

const TOKEN_KEY = 'elymum.auth.v1';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
let killId = 1;
let chatId = 1;

/** Owns the canvas, network, client world and the render loop; talks to React through the store. */
export class GameEngine {
  readonly world = new ClientWorld();
  readonly camera = new Camera();
  readonly particles = new Particles();
  readonly input: Input;
  private readonly renderer: Renderer;
  /** Automatic quality drop while frames stay slow (resolution first, then the low look). */
  readonly governor = new FrameGovernor();
  private readonly net: Net;
  private raf = 0;
  private last = performance.now();
  private lastExpr = 0;
  private lastHud = 0;
  private lastMinimap = 0;
  private lastTargetSent = 0;
  private lastTarget = { x: NaN, y: NaN };
  private minimap: HTMLCanvasElement | null = null;
  private frames = 0;
  private fpsAt = performance.now();
  private snapNext = true;
  private rngState = 7;
  /** Arena id of the stake room we were in (reclaimed after a reconnect). */
  private wasArena: number | null = null;
  private reduced = false;
  /** My coin dropping onto the paper after a join / respawn (performance.now() start). */
  private drop: { at: number; rung: boolean } | null = null;
  /** This life's bites, for the announcer (first bite, double, triple, whale). */
  private life = { bites: 0, streak: 0, streakAt: -Infinity, whale: false };
  /** Death slow motion start (performance.now()), renderer time only. */
  private slowmoAt = -Infinity;
  /** The bell rang on my game: the world stands still until then (performance.now()). */
  private frozenUntil = -Infinity;
  /** Snapshots held back while frozen (they are deltas: applied in order on the thaw). */
  private snapQueue: SnapshotData[] = [];
  /** The last join asked for (a held ticket repeats it when the next round opens). */
  private lastJoin: { room: string } | null = null;
  /** A ticket held through the closed window; it joins when the next round opens. */
  private readonly heldTicket = new HeldTicket({
    join: (room) => {
      // the socket is down: the hold waits for the next `welcome` (rearm)
      if (!this.net.open) return false;
      this.ticketRetry = { room, left: 2 };
      this.sendJoin(room);
      return true;
    },
    // only from the lobby (or watching): never pull a player out of a game, practice included
    free: () => {
      const screen = useUi.getState().screen;
      return screen === 'lobby' || screen === 'spectating';
    },
    released: (reason) => {
      toast(reason === 'busy' ? 'info' : 'warn', t(reason === 'busy' ? 'lo.held.busy' : 'lo.held.gaveUp'), undefined, 9000);
    },
  });
  /** Round clock cues: last-seconds ticks, the bell and the announcer lines. */
  private readonly cues = new RoundCues({
    tick: (s) => sound.roundTick(s),
    bell: () => sound.bell(),
    say: (line) => announce(line),
  });
  private readonly unsub: () => void;
  private readonly reducedQuery: MediaQueryList | null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.net = new Net(
      SERVER.ws,
      {
        onOpen: () => useUi.setState({ connected: true, connecting: false }),
        onClose: () => useUi.setState({ connected: false, connecting: true }),
        onMessage: (m) => this.onMessage(m),
        onSnapshot: (s) => this.onSnapshot(s),
      },
    );
    this.input = new Input(
      canvas,
      {
        split: () => this.split(),
        eject: () => this.eject(),
        emote: (id) => this.emote(id),
        openChat: () => {
          const s = useUi.getState();
          if (s.screen === 'playing' && s.settings.showChat) useUi.setState({ chatOpen: true });
        },
        escape: () => {
          const s = useUi.getState();
          if (s.chatOpen) useUi.setState({ chatOpen: false });
          else if (s.modal) useUi.setState({ modal: null });
        },
        spectateNext: () => {
          if (useUi.getState().screen === 'spectating') this.spectateNext();
        },
      },
      (dy) => this.camera.wheel(dy),
      unlockAudio,
    );
    const applySettings = () => {
      const s = useUi.getState().settings;
      if (s.quality !== this.quality) {
        this.quality = s.quality;
        this.syncCanvas();
      }
      this.particles.lowQuality = s.quality === 'low' || this.renderer.autoLow;
    };
    // `localStorage['elymum.autoQuality'] = 'off'` keeps full quality whatever the frame rate (testing)
    try {
      this.governor.enabled = localStorage.getItem('elymum.autoQuality') !== 'off';
    } catch {
      /* storage blocked: keep the default */
    }
    applySettings();
    this.unsub = useUi.subscribe((s, prev) => {
      if (s.settings !== prev.settings) applySettings();
    });
    this.reducedQuery = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_QUERY) : null;
    this.reducedQuery?.addEventListener?.('change', this.onReducedChange);
    this.onReducedChange();
    // dev builds, and production builds made for the perf benchmark (scripts/perf.mjs --prod)
    if (import.meta.env.DEV || import.meta.env.VITE_PERF_HOOK === '1') (window as unknown as { __elymum?: unknown }).__elymum = { engine: this, useUi };
    this.resize();
    window.addEventListener('resize', this.resize);
    this.net.connect();
    this.raf = requestAnimationFrame(this.frame);
  }

  private onReducedChange = (): void => {
    this.reduced = this.reducedQuery?.matches ?? false;
    this.particles.reduced = this.reduced;
  };

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.clearHeld();
    this.reducedQuery?.removeEventListener?.('change', this.onReducedChange);
    window.removeEventListener('resize', this.resize);
    this.input.destroy();
    this.net.close();
    this.unsub();
  }

  private rand = (): number => {
    this.rngState = (this.rngState * 16807) % 2147483647;
    return this.rngState / 2147483647;
  };

  private quality = useUi.getState().settings.quality;

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.resize(w, h);
    this.syncCanvas();
    this.net.send({ t: 'viewport', w, h });
  };

  /** Canvas size and pixel ratio for the window, the quality setting and the automatic level. */
  private syncCanvas(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight, this.quality);
    this.governor.maxLevel = this.renderer.levels.length - 1;
    this.governor.reset(performance.now());
    this.renderer.setLevel(this.governor.level);
    this.particles.lowQuality = this.quality === 'low' || this.renderer.autoLow;
  }

  setMinimap(el: HTMLCanvasElement | null): void {
    this.minimap = el;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Joins a room. `awaitTicket`:
   * the ticket was bought a moment ago, so a `no_session` answer (the server's
   * RPC may lag the confirmation) is retried quietly a few times.
   */
  play(room: string, opts: { awaitTicket?: boolean } = {}): void {
    unlockAudio();
    this.ticketRetry = opts.awaitTicket ? { room, left: 4 } : null;
    this.sendJoin(room);
  }

  private ticketRetry: { room: string; left: number } | null = null;

  private sendJoin(room: string): void {
    const { settings } = useUi.getState();
    this.lastJoin = { room };
    this.net.send({ t: 'join', room, name: settings.name || 'Coinie', skin: settings.skin, fp: fingerprint() });
  }

  spectate(room?: string): void {
    this.net.send({ t: 'spectate', room });
  }

  spectateNext(): void {
    this.net.send({ t: 'spectate', next: true });
  }

  /** Leaves the current game and shows the lobby (spectating the busiest room). */
  backToLobby(): void {
    const s = useUi.getState();
    if (s.screen === 'playing') this.net.send({ t: 'leave' });
    this.world.myPid = null;
    this.world.value = null;
    this.thaw();
    useUi.setState({
      screen: 'lobby',
      death: null,
      roundResult: null,
      chatOpen: false,
      powerups: [],
      ticket: null,
      valueDelta: null,
    });
    this.net.send({ t: 'spectate' });
  }

  watch(): void {
    this.thaw();
    useUi.setState({ screen: 'spectating', death: null, roundResult: null });
    this.net.send({ t: 'spectate', room: useUi.getState().room?.id });
  }

  split(): void {
    if (useUi.getState().screen !== 'playing') return;
    this.sendTarget(true);
    this.net.sendBinary(encodeSplit());
    sound.split();
    for (const c of this.world.myCells()) this.particles.dots(c.x, c.y, c.r * 0.6, INK, 5);
  }

  eject(): void {
    if (useUi.getState().screen !== 'playing') return;
    this.sendTarget(true);
    this.net.sendBinary(encodeEject());
    sound.eject();
  }

  emote(id: number): void {
    if (useUi.getState().screen !== 'playing') return;
    this.net.send({ t: 'emote', id });
  }

  /* ---------------------------------------------------------------- */
  /* Rounds                                                           */
  /* ---------------------------------------------------------------- */

  /** Drops a held ticket's automatic join (it joined, or the player left it). */
  clearHeld(): void {
    this.heldTicket.clear();
  }

  /** My paid game ended with a payout: the bell (`round`) or an operator exit (`exit`). */
  private endGame(kind: 'round' | 'exit', round: number | null, payout: number, stats: DeathStats | null, standings: RoundStanding[]): void {
    const me = this.world.myStats();
    if (kind === 'round' && round !== null) {
      // the world stops on the bell; the receipt prints over it
      this.frozenUntil = performance.now() + BELL_FREEZE_MS;
      this.cues.ring(round);
    } else {
      this.world.myPid = null;
      sound.cashout();
      announce('paid');
    }
    if (me && !this.reduced) this.particles.coinBurst(me.x, me.y, Math.max(60, me.maxR), 36);
    this.wasArena = null;
    useUi.setState({
      screen: 'roundover',
      roundResult: { kind, round, payout, stats, standings },
      powerups: [],
      chatOpen: false,
    });
  }

  chat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.net.send({ t: 'chat', text: trimmed });
  }

  authToken(token: string): void {
    this.net.send({ t: 'auth', token });
  }

  /** SIWE sign-in: `message` is the rebuilt `siweMessage`, `signature` the wallet's `personal_sign` (0x hex). */
  authSignature(address: string, message: string, signature: string): void {
    this.net.send({ t: 'auth', address, message, signature });
  }

  logout(): void {
    this.net.send({ t: 'logout' });
    useUi.setState({ auth: null });
  }

  static storedToken(address: string): string | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as { address: string; token: string; exp: number };
      return typeof data.address === 'string' && data.address.toLowerCase() === address.toLowerCase() && data.exp > Date.now() + 60_000 ? data.token : null;
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Network                                                          */
  /* ---------------------------------------------------------------- */

  private get frozen(): boolean {
    return performance.now() < this.frozenUntil;
  }

  /** Ends the bell's freeze: the world catches up with what the server sent meanwhile. */
  private thaw(): void {
    this.frozenUntil = -Infinity;
    const now = performance.now();
    for (const s of this.snapQueue) this.world.apply(s, now);
    this.snapQueue = [];
  }

  private onSnapshot(s: SnapshotData): void {
    // the bell froze the world: the next round's snapshots wait (in order) until the thaw
    if (this.frozen) {
      this.snapQueue.push(s);
      return;
    }
    this.world.apply(s, performance.now());
  }

  private onMessage(m: ServerMessage): void {
    const now = performance.now();
    switch (m.t) {
      case 'welcome': {
        serverClock.sync(m.serverNow);
        // a held ticket whose join was lost with the old socket (or still waits) goes again
        this.heldTicket.rearm();
        useUi.setState({ connected: true, connecting: false, rooms: m.rooms, chain: m.chain, online: m.online, blockedArenas: (m.blocked ?? []).map((b) => b.arenaId) });
        const auth = useUi.getState().auth;
        if (auth) this.authToken(auth.token);
        this.resize();
        const screen = useUi.getState().screen;
        if (this.wasArena !== null && (screen === 'playing' || screen === 'lobby')) {
          // reconnect: our stake cells are still in the arena (AFK), reclaim them
          this.play(`arena:${this.wasArena}`);
        } else {
          if (screen === 'playing') useUi.setState({ screen: 'lobby' });
          this.net.send({ t: 'spectate' });
        }
        return;
      }
      case 'chain':
        // the chain status changed (the game token was set): the lobby opens its arenas live
        useUi.setState({ chain: m.chain });
        return;
      case 'rooms':
        useUi.setState({ rooms: m.rooms, online: m.online, blockedArenas: (m.blocked ?? []).map((b) => b.arenaId) });
        return;
      case 'authed': {
        useUi.setState({ auth: { address: m.address, token: m.token, profile: m.profile } });
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify({ address: m.address, token: m.token, exp: Date.now() + 23 * 3600_000 }));
        } catch {
          /* ignore */
        }
        return;
      }
      case 'xp': {
        const auth = useUi.getState().auth;
        if (auth?.profile) useUi.setState({ auth: { ...auth, profile: { ...auth.profile, xp: m.xp, level: m.level } } });
        return;
      }
      case 'joined': {
        if (this.world.myPid !== m.playerId) this.snapNext = true;
        const from = useUi.getState().screen;
        if (!this.reduced) {
          // the coin drops onto the paper; out of the lobby the camera also falls into the world
          const fromPaper = from === 'lobby' || from === 'spectating';
          // out of the lobby the drop waits until the paper wipe has opened over it
          this.drop = { at: now + (fromPaper ? DUR.dropDelay * 1000 : 0), rung: false };
          this.camera.zoomIntro(fromPaper ? DUR.zoomIn : 0);
        }
        this.slowmoAt = -Infinity;
        this.thaw();
        this.clearHeld();
        this.life = { bites: 0, streak: 0, streakAt: -Infinity, whale: false };
        if (this.world.myPid !== m.playerId) {
          const where = m.room.mode === 'arena' && m.room.arenaId !== undefined ? arenaMeta(m.room.arenaId).name : t('an.practice');
          announce('joined', { room: where });
        }
        this.world.myPid = m.playerId;
        this.world.width = m.room.width;
        this.world.height = m.room.height;
        this.ticketRetry = null;
        this.wasArena = m.room.mode === 'arena' ? (m.room.arenaId ?? null) : null;
        this.world.value = m.value ?? null;
        useUi.setState({
          screen: 'playing',
          room: m.room,
          me: { pid: m.playerId, name: m.name, skin: m.skin },
          death: null,
          roundResult: null,
          powerups: [],
          hud: { ...useUi.getState().hud, value: m.value ?? null },
          valueDelta: null,
          // a new ticket: any earlier settlement belongs to an earlier ticket (the server only lets us
          // join once the previous one is settled), so receipts match `settled.session` from here on
          lastSettlement: null,
          ticket:
            m.room.mode === 'arena'
              ? {
                  entryFee: m.entryFee ?? m.room.entryFee ?? 0,
                  arenaId: m.room.arenaId ?? null,
                  session: m.session ?? null,
                }
              : null,
        });
        return;
      }
      case 'spectating': {
        this.thaw();
        const prev = useUi.getState().room;
        if (prev?.id !== m.room.id) this.world.reset();
        this.world.width = m.room.width;
        this.world.height = m.room.height;
        useUi.setState({ room: m.room, spectateTarget: m.targetPid });
        return;
      }
      case 'left':
        return;
      case 'lb': {
        // the bell's freeze keeps the final standings on the slip
        if (this.frozen) return;
        const s = useUi.getState();
        useUi.setState({
          lb: m.top,
          leaders: m.leaders,
          hud: { ...s.hud, rank: m.me?.rank ?? 0, value: s.room?.mode === 'arena' ? (m.me?.value ?? s.hud.value) : null, players: m.players },
        });
        return;
      }
      case 'kf':
        useUi.setState((s) => ({ killfeed: [...s.killfeed.slice(-4), { id: killId++, ...m, at: Date.now() }] }));
        return;
      case 'chat':
        useUi.setState((s) => ({ chat: [...s.chat.slice(-59), { id: chatId++, pid: m.pid, from: m.from, skin: m.skin, text: m.text, system: m.system, at: Date.now() }] }));
        return;
      case 'history':
        useUi.setState({ chat: m.chat.map((c) => ({ id: chatId++, ...c, at: Date.now() })) });
        return;
      case 'emote': {
        const p = this.world.players.get(m.pid);
        if (p) p.emote = { id: m.id, at: now };
        return;
      }
      case 'death': {
        const me = this.world.myStats();
        if (me) {
          // an ink splash where the coin was, then the world slows for a beat (renderer only)
          this.particles.splat(me.x, me.y, INK, Math.max(26, me.maxR * 0.7));
          if (!this.reduced) this.slowmoAt = now;
          this.particles.scraps(me.x, me.y, Math.max(60, me.maxR), 34);
          // a bot ate a staker: the tokens spill onto the map
          if (m.stats.byBot && (m.stats.lootSpilled ?? 0) > 0) this.particles.coinBurst(me.x, me.y, Math.max(60, me.maxR), 22);
        }
        sound.death();
        announce('eaten');
        this.world.myPid = null;
        this.wasArena = null;
        useUi.setState({
          screen: 'dead',
          death: { stats: m.stats, killer: m.killer, killerSkin: m.killerSkin },
          powerups: [],
          chatOpen: false,
        });
        return;
      }
      case 'cashout':
        // paid arenas have no cash-out; a `done` is an operator exit (admin kick, shutdown) paid at value
        if (m.state === 'done') this.endGame('exit', null, m.value ?? 0, m.stats ?? null, []);
        return;
      case 'roundOver':
        this.endGame('round', m.round, m.payout, m.stats, m.standings);
        return;
      case 'value': {
        this.world.applyValue(m, now);
        useUi.setState((s) => ({
          hud: { ...s.hud, value: m.value },
          valueDelta: m.delta !== 0 ? { id: (s.valueDelta?.id ?? 0) + 1, delta: m.delta, reason: m.reason } : s.valueDelta,
        }));
        if (m.delta > 0) sound.coin();
        return;
      }
      case 'settled':
        // `fee` is taken from the profit; `net` is what reached the wallet
        useUi.setState({
          lastSettlement: {
            session: m.session ?? null,
            arenaId: m.arenaId ?? null,
            txHash: m.txHash,
            payout: m.payout,
            fee: m.fee,
            net: m.net,
            ...(m.collect ? { collect: true } : {}),
            at: Date.now(),
          },
        });
        return;
      case 'event': {
        if (m.kind === 'coinrain') {
          if (m.state === 'start') {
            useUi.setState({ banner: { kind: 'coinrain', until: Date.now() + (m.ms ?? 25_000) } });
            sound.coinRain();
          } else useUi.setState({ banner: null });
        } else if (m.kind === 'airdrop') {
          const s = useUi.getState();
          if (!s.banner || s.banner.kind !== 'coinrain') useUi.setState({ banner: { kind: 'airdrop', until: Date.now() + 3500 } });
        }
        return;
      }
      case 'powerup': {
        sound.powerup();
        useUi.setState((s) => ({ powerups: [...s.powerups.filter((p) => p.type !== m.type), { type: m.type, until: Date.now() + m.ms }] }));
        const me = this.world.myStats();
        if (me) this.particles.text(me.x, me.y - me.maxR, `${t(`pu.${m.type}` as 'pu.1')}!`, undefined, 24, RISO.mustard);
        if (m.type === PowerUpType.Bag && me) this.particles.coinBurst(me.x, me.y, me.maxR, 18);
        return;
      }
      case 'error': {
        if (m.code === 'round_closed') {
          // joins are closed until the next round: hold the ticket and join when it opens
          const join = this.lastJoin;
          this.ticketRetry = null;
          if (join?.room.startsWith('arena:')) {
            const arenaId = Number(join.room.slice('arena:'.length));
            this.heldTicket.hold(join.room, m.opensAt ?? currentRound(arenaId)?.endsAt ?? serverClock.now());
          }
          return;
        }
        if (m.code === 'round_ended') {
          // back after a bell that settled our ticket while we were away: the till was paid
          this.ticketRetry = null;
          this.wasArena = null;
          this.clearHeld();
          if (useUi.getState().screen !== 'lobby') this.backToLobby();
          toast('info', t('err.round_ended'), undefined, 9000);
          return;
        }
        const retry = this.ticketRetry;
        if (m.code === 'no_session' && retry && retry.left > 0) {
          retry.left--;
          setTimeout(() => {
            if (this.ticketRetry === retry && useUi.getState().screen !== 'playing') this.sendJoin(retry.room);
          }, 1500);
          return;
        }
        this.ticketRetry = null;
        if (m.code === 'game_closed') {
          // the game is admin-only for now: no toast loop, one friendly "opens soon" sheet
          this.heldTicket.refused();
          this.wasArena = null;
          if (useUi.getState().screen !== 'lobby') this.backToLobby();
          useUi.setState({ gameClosed: true });
          return;
        }
        // a held join refused for any other reason: the hold lets go (the lobby offers the ticket again)
        this.heldTicket.refused();
        const key = `err.${m.code}` as const;
        toast(m.code === 'rate_limited' ? 'warn' : 'error', t(key as 'err.bad_request') || m.message, undefined, m.code === 'version_mismatch' ? 600_000 : 5000);
        if (m.code === 'skin_locked') useUi.setState((s) => ({ settings: { ...s.settings, skin: 0 } }));
        return;
      }
      case 'pong':
        serverClock.sync(m.serverNow, this.net.rtt);
        useUi.setState({ ping: Math.round(this.net.rtt) });
        return;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                            */
  /* ---------------------------------------------------------------- */

  private aimPoint(): { x: number; y: number } | null {
    const me = this.world.myStats();
    if (this.input.stick.active && me) {
      const reach = Math.max(260, me.maxR * 3);
      return { x: me.x + this.input.stick.x * reach, y: me.y + this.input.stick.y * reach };
    }
    if (this.input.mouse.active) return this.camera.toWorld(this.input.mouse.x, this.input.mouse.y);
    return me ? { x: me.x, y: me.y } : null;
  }

  private sendTarget(force = false): void {
    if (useUi.getState().screen !== 'playing') return;
    const aim = this.aimPoint();
    if (!aim) return;
    const now = performance.now();
    const moved = Math.hypot(aim.x - this.lastTarget.x, aim.y - this.lastTarget.y) > 1.5;
    if (!force && (now - this.lastTargetSent < 33 || (!moved && now - this.lastTargetSent < 250))) return;
    this.lastTargetSent = now;
    this.lastTarget = aim;
    this.net.sendBinary(encodeTarget(aim.x, aim.y));
  }

  /** A cell of mine ate a coin: first bite of this life, then doubles and triples within 4 s. */
  private bite(now: number): void {
    const l = this.life;
    l.streak = now - l.streakAt < 4000 ? l.streak + 1 : 1;
    l.streakAt = now;
    l.bites++;
    if (l.bites === 1) announce('firstBite');
    else if (l.streak === 2) announce('double');
    else if (l.streak === 3) announce('triple');
  }

  private handleEats(): void {
    const arena = useUi.getState().room?.mode === 'arena';
    for (const ev of this.world.drainEats()) {
      switch (ev.type) {
        case 'food':
          if (ev.mine) {
            sound.blip(ev.variant === 7);
            const ink = ev.variant < 6 ? FOOD_COLORS[ev.variant][0] : ev.variant === 7 ? RISO.mustard : RISO.aqua;
            this.particles.splat(ev.x, ev.y, ink, ev.variant === 7 ? 15 : ev.variant === 6 ? 10 : 7);
            if (ev.variant === 7) this.particles.text(ev.x, ev.y, '+8', undefined, 18, RISO.mustard);
          }
          break;
        case 'eject':
          if (ev.mine) sound.blip();
          break;
        case 'loot':
          // the value message that follows floats the amount; here the pickup itself
          if (ev.mine) this.particles.splat(ev.x, ev.y, RISO.mustard, 12 + ev.variant * 4);
          break;
        case 'cell': {
          const victim = this.world.players.get(ev.victimPid);
          const look = this.renderer.lookFor(victim?.skin ?? 0);
          if (ev.mine) {
            sound.chomp();
            this.bite(performance.now());
            this.particles.scraps(ev.x, ev.y, ev.r, 16, [look.body, look.overprint, CARD_PAPER]);
            if (!arena) this.particles.text(ev.x, ev.y, `+${Math.floor((ev.r * ev.r) / 100)}`, undefined, 24);
          } else if (ev.me) {
            sound.ouch();
          } else if (!this.particles.lowQuality) {
            this.particles.scraps(ev.x, ev.y, ev.r, 6, [look.body, look.overprint]);
          }
          // a bot ate a staker: the victim's tokens spill as loot
          if (arena && this.world.isBot(ev.eaterPid) && !this.world.isBot(ev.victimPid)) this.particles.coinBurst(ev.x, ev.y, ev.r, 16);
          break;
        }
        case 'virus':
          this.particles.scraps(ev.x, ev.y, 70, ev.mine ? 26 : 10, [RISO.green, RISO.teal, CARD_PAPER, RISO.fluoPink]);
          if (ev.mine) {
            sound.boing();
            this.particles.text(ev.x, ev.y, t('fx.rugged'), RISO.green, 26, RISO.fluoPink);
          }
          break;
        case 'powerup':
          this.particles.ring(ev.x, ev.y, 50, RISO.fluoPink);
          break;
      }
    }
  }

  /** Floating "+X $ELYMUM" ink numbers from `value` messages (ledger units). */
  private handleFloats(): void {
    const floats = this.world.drainFloats();
    if (floats.length === 0) return;
    const ui = useUi.getState();
    const decimals = ledgerDecimals(ui.chain?.token?.decimals ?? 18);
    for (const f of floats) {
      const amount = formatToken(Math.abs(f.delta), decimals, { compact: true, maxFrac: 1 });
      // dust that rounds to nothing floats nothing (no "+0" / "−0")
      if (amount === '0') continue;
      const gain = f.delta > 0;
      this.particles.text(f.x, f.y, `${gain ? '+' : '−'}${amount}`, gain ? undefined : RISO.red, gain ? 26 : 22, gain ? RISO.mustard : RISO.fluoPink);
    }
  }

  private frame = (): void => {
    const now = performance.now();
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const ui = useUi.getState();
    const world = this.world;

    // death slow motion: the renderer's own clocks (particles, jelly, camera) run slow; the
    // world keeps the server's pace
    const sinceDeath = (now - this.slowmoAt) / 1000;
    const ts = sinceDeath < SLOWMO_TOTAL ? slowmoScale(sinceDeath) : 1;
    const rdt = dt * ts;
    this.camera.push = 1 + 0.1 * ((1 - ts) / 0.7);

    if (this.snapQueue.length > 0 && !this.frozen) this.thaw();
    if (!this.frozen) {
      world.update(now, dt);
      if (now - this.lastExpr > 150) {
        this.lastExpr = now;
        world.computeExpressions(now);
      }
      this.handleEats();
      this.handleFloats();
    }
    this.particles.update(rdt);
    // the round clock's sounds, while an arena is on screen (playing, eaten or watching it)
    // (not on the round's receipt: the next round's clock is none of its business)
    this.cues.update(ui.room?.mode === 'arena' && ui.screen !== 'lobby' && ui.screen !== 'roundover' ? currentRound(ui.room.arenaId ?? null) : null);

    // camera
    const me = world.myStats();
    if (me) {
      let short = this.camera.visibleShortFor(me.mass);
      const bw = (me.bbox.x1 - me.bbox.x0) * 1.25;
      const bh = (me.bbox.y1 - me.bbox.y0) * 1.25;
      const aspect = this.camera.w / Math.max(1, this.camera.h);
      short = Math.max(short, aspect >= 1 ? Math.max(bh, bw / aspect) : Math.max(bw, bh * aspect));
      this.camera.follow(me.x, me.y, short, dt, this.snapNext);
      this.snapNext = false;
      if (this.drop && !this.drop.rung && (now - this.drop.at) / (DUR.drop * 1000) >= DROP_LAND) {
        // the coin lands: an ink ring goes off on the paper
        this.drop.rung = true;
        sound.drop();
        this.particles.ring(me.x, me.y, Math.max(40, me.maxR * 1.25), INK);
        this.particles.dots(me.x, me.y, Math.max(40, me.maxR), RISO.fluoPink, 8);
      }
    } else {
      const v = world.serverView;
      // lobby: the room is the front-page photo (a window in the paper), so show it wide like a spectator
      const short = ui.screen === 'lobby' || ui.screen === 'spectating' ? this.camera.visibleShortFor(0, true) * 0.85 : this.camera.visibleShortFor(400);
      if (v.at > 0) this.camera.follow(v.x, v.y, short, rdt * (ui.screen === 'lobby' ? 0.35 : 1));
    }

    this.sendTarget();

    const dropT = this.drop ? Math.max(0, (now - this.drop.at) / (DUR.drop * 1000)) : 1;
    if (dropT >= 1) this.drop = null;
    this.renderer.draw({
      now,
      dt: rdt,
      drop: dropT < 1 ? dropT : null,
      world,
      camera: this.camera,
      particles: this.particles,
      settings: ui.settings,
      reduced: this.reduced,
      aim: ui.screen === 'playing' ? this.aimPoint() : null,
      coinRain: !!ui.banner && ui.banner.kind === 'coinrain' && ui.banner.until > Date.now(),
      rand: this.rand,
    });

    if (this.minimap && ui.settings.showMinimap && now - this.lastMinimap > 66) {
      this.lastMinimap = now;
      this.renderer.drawMinimap(this.minimap, { world, camera: this.camera, leaders: ui.leaders, dark: ui.settings.theme === 'dark', now, reduced: this.reduced });
    }

    this.frames++;
    if (now - this.fpsAt >= 1000) {
      useUi.setState({ fps: Math.round((this.frames * 1000) / (now - this.fpsAt)) });
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.lastHud > 120) {
      this.lastHud = now;
      const mass = me ? Math.floor(me.mass) : 0;
      if (ui.hud.mass !== mass || ui.hud.cells !== (me?.count ?? 0)) useUi.setState({ hud: { ...ui.hud, mass, cells: me?.count ?? 0 } });
      // a big coin now: once per life
      if (mass >= WHALE_MASS && !this.life.whale && ui.screen === 'playing') {
        this.life.whale = true;
        announce('whale');
      }
      // expire power-up timers, banners and kill feed
      const wall = Date.now();
      if (ui.powerups.some((p) => p.until <= wall)) useUi.setState({ powerups: ui.powerups.filter((p) => p.until > wall) });
      if (ui.banner && ui.banner.until <= wall) useUi.setState({ banner: null });
      if (ui.killfeed.length && wall - ui.killfeed[0].at > 6000) useUi.setState({ killfeed: ui.killfeed.filter((k) => wall - k.at <= 6000) });
    }

    // automatic quality: measured while the world is what is on screen
    const active = (ui.screen === 'playing' || ui.screen === 'spectating' || ui.screen === 'dead') && !this.camera.introducing && document.visibilityState !== 'hidden';
    if (this.governor.frame(now, active)) {
      this.renderer.setLevel(this.governor.level);
      this.particles.lowQuality = this.quality === 'low' || this.renderer.autoLow;
    }

    this.raf = requestAnimationFrame(this.frame);
  };
}

/** Level progress helper for the profile UI. */
export function levelProgress(xp: number): { level: number; cur: number; next: number; pct: number } {
  const level = levelFromXp(xp);
  const cur = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, cur, next, pct: Math.max(0, Math.min(1, (xp - cur) / (next - cur))) };
}

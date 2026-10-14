import { RISO } from '@slana/art';
import {
  PowerUpType,
  RULES,
  clamp,
  formatToken,
  encodeEject,
  encodeSplit,
  encodeTarget,
  getSkin,
  levelFromXp,
  type ServerMessage,
  type SnapshotData,
} from '@slana/shared';
import { SERVER } from '../config';
import { t } from '../i18n';
import { Renderer } from '../render/renderer';
import { FOOD_COLORS } from '../render/sprites';
import { useChainData } from '../solana/chain';
import { toast, useUi, type Screen } from '../store';
import { Camera } from './camera';
import { Input } from './input';
import { Net } from './net';
import { Particles } from './particles';
import { sound } from './sound';
import { ClientWorld } from './state';

const TOKEN_KEY = 'slana.auth.v1';
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
  private readonly unsub: () => void;
  private readonly reducedQuery: MediaQueryList | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.net = new Net(
      SERVER.ws,
      {
        onOpen: () => useUi.setState({ connected: true, connecting: false }),
        onClose: () => useUi.setState({ connected: false, connecting: true }),
        onMessage: (m) => this.onMessage(m),
        onSnapshot: (s) => this.onSnapshot(s),
      },
      () => useUi.getState().settings.lang,
    );
    this.input = new Input(
      canvas,
      {
        split: () => this.split(),
        eject: () => this.eject(),
        emote: (id) => this.emote(id),
        cashout: () => this.cashout(),
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
      () => sound.unlock(),
    );
    const applySettings = () => {
      const s = useUi.getState().settings;
      sound.enabled = s.sound;
      sound.setVolume(s.volume);
      this.particles.lowQuality = s.quality === 'low';
    };
    applySettings();
    this.unsub = useUi.subscribe((s, prev) => {
      if (s.settings !== prev.settings) applySettings();
    });
    this.reducedQuery = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_QUERY) : null;
    this.reducedQuery?.addEventListener?.('change', this.onReducedChange);
    this.onReducedChange();
    if (import.meta.env.DEV) (window as unknown as { __slana?: unknown }).__slana = { engine: this, useUi };
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

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.resize(w, h);
    this.renderer.resize(w, h);
    this.net.send({ t: 'viewport', w, h });
  };

  setMinimap(el: HTMLCanvasElement | null): void {
    this.minimap = el;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Joins a room. `pass`: the Slana Pass asset to wear (defaults to the equipped
   * one; in an arena the ticket's own Pass wins on the server). `awaitTicket`:
   * the ticket was bought a moment ago, so a `no_session` answer (the server's
   * RPC may lag the confirmation) is retried quietly a few times.
   */
  play(room: string, opts: { pass?: string | null; awaitTicket?: boolean } = {}): void {
    sound.unlock();
    const { settings } = useUi.getState();
    // the equipped Pass look only while the connected wallet still holds it (else the server says pass_invalid)
    const equipped = settings.passSkin && useChainData.getState().passes.some((p) => p.asset === settings.passSkin) ? settings.passSkin : null;
    const pass = opts.pass === undefined ? equipped : opts.pass;
    this.ticketRetry = opts.awaitTicket ? { room, pass, left: 4 } : null;
    this.sendJoin(room, pass);
  }

  private ticketRetry: { room: string; pass: string | null; left: number } | null = null;

  private sendJoin(room: string, pass: string | null): void {
    const { settings } = useUi.getState();
    this.net.send({ t: 'join', room, name: settings.name || 'Coinie', skin: settings.skin, ...(pass ? { pass } : {}) });
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
    useUi.setState({
      screen: 'lobby',
      death: null,
      cashoutResult: null,
      chatOpen: false,
      powerups: [],
      cashout: { state: 'idle', until: 0, total: 0 },
      ticket: null,
      valueDelta: null,
    });
    this.net.send({ t: 'spectate' });
  }

  watch(): void {
    useUi.setState({ screen: 'spectating', death: null, cashoutResult: null });
    this.net.send({ t: 'spectate', room: useUi.getState().room?.id });
  }

  split(): void {
    if (useUi.getState().screen !== 'playing') return;
    this.sendTarget(true);
    this.net.sendBinary(encodeSplit());
    sound.split();
    for (const c of this.world.myCells()) this.particles.dots(c.x, c.y, c.r * 0.6, '#1E1B2E', 5);
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

  cashout(): void {
    const s = useUi.getState();
    if (s.screen !== 'playing' || s.room?.mode !== 'arena' || s.cashout.state !== 'idle') return;
    this.net.send({ t: 'cashout' });
    sound.click();
  }

  /** Cash-out channel length for the current ticket (Pass tickets print faster). */
  cashoutMs(): number {
    return useUi.getState().ticket?.hasPass ? RULES.passCashoutMs : RULES.cashoutMs;
  }

  chat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.net.send({ t: 'chat', text: trimmed });
  }

  authToken(token: string): void {
    this.net.send({ t: 'auth', token });
  }

  authSignature(pubkey: string, message: string, signature: string): void {
    this.net.send({ t: 'auth', pubkey, message, signature });
  }

  logout(): void {
    this.net.send({ t: 'logout' });
    useUi.setState({ auth: null });
  }

  static storedToken(pubkey: string): string | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as { pubkey: string; token: string; exp: number };
      return data.pubkey === pubkey && data.exp > Date.now() + 60_000 ? data.token : null;
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Network                                                          */
  /* ---------------------------------------------------------------- */

  private onSnapshot(s: SnapshotData): void {
    this.world.apply(s, performance.now());
  }

  private setScreen(screen: Screen): void {
    useUi.setState({ screen });
  }

  private onMessage(m: ServerMessage): void {
    const now = performance.now();
    switch (m.t) {
      case 'welcome': {
        useUi.setState({ connected: true, connecting: false, rooms: m.rooms, chain: m.chain, online: m.online });
        const auth = useUi.getState().auth;
        if (auth) this.authToken(auth.token);
        this.resize();
        const screen = useUi.getState().screen;
        if (this.wasArena !== null && (screen === 'playing' || screen === 'lobby')) {
          // reconnect: our stake cells are still in the arena (AFK) — reclaim them
          this.play(`arena:${this.wasArena}`);
        } else {
          if (screen === 'playing') useUi.setState({ screen: 'lobby' });
          this.net.send({ t: 'spectate' });
        }
        return;
      }
      case 'rooms':
        useUi.setState({ rooms: m.rooms, online: m.online });
        return;
      case 'authed': {
        useUi.setState({ auth: { pubkey: m.pubkey, token: m.token, profile: m.profile } });
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify({ pubkey: m.pubkey, token: m.token, exp: Date.now() + 23 * 3600_000 }));
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
          cashoutResult: null,
          powerups: [],
          cashout: { state: 'idle', until: 0, total: 0 },
          hud: { ...useUi.getState().hud, value: m.value ?? null },
          valueDelta: null,
          // a new ticket: any earlier settlement belongs to an earlier ticket (the server only lets us
          // join once the previous one is settled), so receipts match `settled.session` from here on
          lastSettlement: null,
          ticket:
            m.room.mode === 'arena'
              ? {
                  entryFee: m.entryFee ?? m.room.entryFee ?? 0,
                  hasPass: m.hasPass === true,
                  arenaId: m.room.arenaId ?? null,
                  session: m.session ?? null,
                }
              : null,
        });
        return;
      }
      case 'spectating': {
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
          this.particles.scraps(me.x, me.y, Math.max(60, me.maxR), 34);
          // a bot ate a staker: the tokens spill onto the map
          if (m.stats.byBot && (m.stats.lootSpilled ?? 0) > 0) this.particles.coinBurst(me.x, me.y, Math.max(60, me.maxR), 22);
        }
        sound.death();
        this.world.myPid = null;
        this.wasArena = null;
        useUi.setState({
          screen: 'dead',
          death: { stats: m.stats, killer: m.killer, killerSkin: m.killerSkin },
          powerups: [],
          cashout: { state: 'idle', until: 0, total: 0 },
          chatOpen: false,
        });
        return;
      }
      case 'cashout': {
        if (m.state === 'started') {
          const total = m.ms ?? this.cashoutMs();
          useUi.setState({ cashout: { state: 'channel', until: now + total, total } });
          sound.print(total);
          return;
        }
        if (m.state === 'canceled') {
          useUi.setState({ cashout: { state: 'idle', until: 0, total: 0 } });
          sound.stopPrint();
          toast('warn', t('hud.cashoutCanceled'));
          return;
        }
        sound.cashout();
        const me = this.world.myStats();
        if (me) this.particles.coinBurst(me.x, me.y, Math.max(60, me.maxR), 36);
        this.world.myPid = null;
        this.wasArena = null;
        useUi.setState({
          screen: 'cashedout',
          cashoutResult: { value: m.value ?? 0, stats: m.stats ?? null },
          cashout: { state: 'idle', until: 0, total: 0 },
          chatOpen: false,
        });
        return;
      }
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
          lastSettlement: { session: m.session ?? null, arenaId: m.arenaId ?? null, signature: m.signature, payout: m.payout, fee: m.fee, net: m.net, at: Date.now() },
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
        const retry = this.ticketRetry;
        if (m.code === 'no_session' && retry && retry.left > 0) {
          retry.left--;
          setTimeout(() => {
            if (this.ticketRetry === retry && useUi.getState().screen !== 'playing') this.sendJoin(retry.room, retry.pass);
          }, 1500);
          return;
        }
        this.ticketRetry = null;
        const key = `err.${m.code}` as const;
        toast(m.code === 'rate_limited' ? 'warn' : 'error', t(key as 'err.bad_request') || m.message, undefined, m.code === 'version_mismatch' ? 600_000 : 5000);
        if (m.code === 'skin_locked') useUi.setState((s) => ({ settings: { ...s.settings, skin: 0 } }));
        return;
      }
      case 'pong':
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
          const look = this.renderer.lookFor(victim?.skin ?? 0, victim?.pass ?? 0, useUi.getState().chain?.pass ?? null);
          if (ev.mine) {
            sound.chomp();
            this.particles.scraps(ev.x, ev.y, ev.r, 16, [look.body, look.overprint, '#FFFCF4']);
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
          this.particles.scraps(ev.x, ev.y, 70, ev.mine ? 26 : 10, [RISO.green, RISO.teal, '#FFFCF4', RISO.fluoPink]);
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

  /** Floating "+X $SLANA" ink numbers from `value` messages. */
  private handleFloats(): void {
    const floats = this.world.drainFloats();
    if (floats.length === 0) return;
    const ui = useUi.getState();
    const decimals = ui.chain?.token?.decimals ?? 6;
    for (const f of floats) {
      const amount = formatToken(Math.abs(f.delta), decimals, ui.settings.lang, { compact: true, maxFrac: 1 });
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

    world.update(now, dt);
    if (now - this.lastExpr > 150) {
      this.lastExpr = now;
      world.computeExpressions(now);
    }
    this.handleEats();
    this.handleFloats();
    this.particles.update(dt);

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
    } else {
      const v = world.serverView;
      // lobby: the room is the front-page photo (a window in the paper), so show it wide like a spectator
      const short = ui.screen === 'lobby' || ui.screen === 'spectating' ? this.camera.visibleShortFor(0, true) * 0.85 : this.camera.visibleShortFor(400);
      if (v.at > 0) this.camera.follow(v.x, v.y, short, dt * (ui.screen === 'lobby' ? 0.35 : 1));
    }

    this.sendTarget();

    this.renderer.draw({
      now,
      dt,
      world,
      camera: this.camera,
      particles: this.particles,
      settings: ui.settings,
      pass: ui.chain?.pass ?? null,
      reduced: this.reduced,
      aim: ui.screen === 'playing' ? this.aimPoint() : null,
      cashout: ui.cashout.state === 'channel' ? { until: ui.cashout.until, total: ui.cashout.total || this.cashoutMs() } : null,
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
      // expire power-up timers, banners and kill feed
      const wall = Date.now();
      if (ui.powerups.some((p) => p.until <= wall)) useUi.setState({ powerups: ui.powerups.filter((p) => p.until > wall) });
      if (ui.banner && ui.banner.until <= wall) useUi.setState({ banner: null });
      if (ui.killfeed.length && wall - ui.killfeed[0].at > 6000) useUi.setState({ killfeed: ui.killfeed.filter((k) => wall - k.at <= 6000) });
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

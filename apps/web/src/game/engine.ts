import {
  PowerUpType,
  RULES,
  clamp,
  encodeEject,
  encodeSplit,
  encodeTarget,
  getSkin,
  levelFromXp,
  type ClientMessage,
  type ServerMessage,
  type SnapshotData,
} from '@solagel/shared';
import { SERVER } from '../config';
import { t } from '../i18n';
import { Renderer } from '../render/renderer';
import { FOOD_COLORS } from '../render/sprites';
import { toast, useUi, type Screen } from '../store';
import { Camera } from './camera';
import { Input } from './input';
import { Net } from './net';
import { Particles } from './particles';
import { sound } from './sound';
import { ClientWorld } from './state';

const TOKEN_KEY = 'solagel.auth.v1';
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
  private wasStakeRoom: string | null = null;
  private authenticated = false;
  private authPending = false;
  private pendingJoin: string | null = null;
  private resumeStakeRoom: string | null = null;
  private stakeSession: { arenaId: number; sessionId: number } | null = null;
  private cashoutRequested = false;
  private cashoutRequestedAt = 0;
  private exitStakeRequested = false;
  private deferredIdentity: { auth: Extract<ClientMessage, { t: 'auth' }> | null } | null = null;
  private unsub: () => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.net = new Net(
      SERVER.ws,
      {
        onOpen: () => useUi.setState({ connected: true, connecting: false }),
        onClose: () => {
          this.authenticated = false;
          this.authPending = false;
          this.pendingJoin = null;
          this.cashoutRequested = false;
          useUi.setState({ connected: false, connecting: true, cashout: { state: 'idle', until: 0 } });
        },
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
    this.resize();
    window.addEventListener('resize', this.resize);
    this.net.connect();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
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

  play(room: string): void {
    sound.unlock();
    if (this.hasActiveStake()) {
      if (room !== this.wasStakeRoom) this.requestStakeExit();
      return;
    }
    if (!this.net.open) {
      toast('warn', 'Reconnecting to the arena. Please wait.');
      return;
    }
    const auth = useUi.getState().auth;
    if (auth && !this.authenticated) {
      this.pendingJoin = room;
      if (!this.authPending) this.sendAuthentication({ t: 'auth', token: auth.token });
      return;
    }
    this.sendJoin(room);
  }

  private sendJoin(room: string): void {
    const { settings } = useUi.getState();
    this.net.send({ t: 'join', room, name: settings.name || 'Coinie', skin: settings.skin });
  }

  spectate(room?: string): void {
    if (this.requestStakeExit()) return;
    this.pendingJoin = null;
    this.net.send({ t: 'spectate', room });
  }

  spectateNext(): void {
    if (this.requestStakeExit()) return;
    this.net.send({ t: 'spectate', next: true });
  }

  /** Leaves the current game and shows the lobby (spectating the busiest room). */
  backToLobby(): void {
    if (this.requestStakeExit()) return;
    this.pendingJoin = null;
    const s = useUi.getState();
    if (s.screen === 'playing') this.net.send({ t: 'leave' });
    this.world.myPid = null;
    useUi.setState({ screen: 'lobby', death: null, cashoutResult: null, chatOpen: false, powerups: [], cashout: { state: 'idle', until: 0 } });
    this.net.send({ t: 'spectate' });
  }

  watch(): void {
    if (this.requestStakeExit()) return;
    this.pendingJoin = null;
    useUi.setState({ screen: 'spectating', death: null, cashoutResult: null });
    this.net.send({ t: 'spectate', room: useUi.getState().room?.id });
  }

  split(): void {
    if (useUi.getState().screen !== 'playing') return;
    this.sendTarget(true);
    this.net.sendBinary(encodeSplit());
    sound.split();
    for (const c of this.world.myCells()) this.particles.puff(c.x, c.y, c.r * 0.5);
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
    if (!this.hasActiveStake() || s.cashout.state !== 'idle' || (this.cashoutRequested && performance.now() - this.cashoutRequestedAt < 1500)) return;
    if (!this.net.open || this.resumeStakeRoom || this.world.myPid === null) {
      this.exitStakeRequested = true;
      toast('warn', 'Reconnecting before cash-out. Your cell remains in the arena.');
      return;
    }
    this.cashoutRequested = true;
    this.cashoutRequestedAt = performance.now();
    this.net.send({ t: 'cashout' });
  }

  private hasActiveStake(): boolean {
    const s = useUi.getState();
    return s.screen === 'playing' && (s.room?.mode === 'stake' || this.wasStakeRoom !== null);
  }

  /** Paid cells must stay visible until the server finishes cash-out or reports death. */
  private requestStakeExit(): boolean {
    if (!this.hasActiveStake()) return false;
    const alreadyRequested = this.exitStakeRequested;
    this.exitStakeRequested = true;
    this.cashout();
    if (!alreadyRequested && this.net.open && !this.resumeStakeRoom) {
      toast('info', 'Cash-out requested. Stay in the arena until it completes; taking damage interrupts it.');
    }
    return true;
  }

  chat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.net.send({ t: 'chat', text: trimmed });
  }

  authToken(token: string): void {
    this.authenticate({ t: 'auth', token });
  }

  authSignature(pubkey: string, message: string, signature: string): void {
    this.authenticate({ t: 'auth', pubkey, message, signature });
  }

  logout(): void {
    if (this.hasActiveStake()) {
      this.deferredIdentity = { auth: null };
      this.requestStakeExit();
      return;
    }
    this.authenticated = false;
    this.authPending = false;
    this.pendingJoin = null;
    this.net.send({ t: 'logout' });
    useUi.setState({ auth: null });
  }

  private authenticate(message: Extract<ClientMessage, { t: 'auth' }>): void {
    const auth = useUi.getState().auth;
    const sameWallet = 'token' in message ? message.token === auth?.token : message.pubkey === auth?.pubkey;
    if (this.hasActiveStake() && (!sameWallet || this.deferredIdentity)) {
      this.deferredIdentity = { auth: message };
      this.requestStakeExit();
      return;
    }
    this.sendAuthentication(message);
  }

  private sendAuthentication(message: Extract<ClientMessage, { t: 'auth' }>): void {
    if (!this.net.open) return;
    this.authPending = true;
    this.net.send(message);
  }

  private flushIdentityChange(): void {
    const change = this.deferredIdentity;
    this.deferredIdentity = null;
    if (!change) return;
    this.logout();
    if (change.auth) this.sendAuthentication(change.auth);
  }

  private failStakeResume(): void {
    this.resumeStakeRoom = null;
    this.pendingJoin = null;
    this.wasStakeRoom = null;
    this.exitStakeRequested = false;
    this.cashoutRequested = false;
    this.world.reset();
    useUi.setState({ screen: 'lobby', me: null, chatOpen: false, powerups: [], cashout: { state: 'idle', until: 0 } });
    this.flushIdentityChange();
    this.net.send({ t: 'spectate' });
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
        this.world.reset();
        this.snapNext = true;
        const auth = useUi.getState().auth;
        this.resize();
        const screen = useUi.getState().screen;
        if (this.wasStakeRoom && (screen === 'playing' || screen === 'lobby')) {
          // The server refreshes the wallet profile asynchronously. Reclaim AFK
          // cells only after it acknowledges authentication on this connection.
          this.resumeStakeRoom = this.wasStakeRoom;
          this.pendingJoin = this.wasStakeRoom;
          if (!auth) {
            this.failStakeResume();
            toast('warn', 'Sign in with the original wallet to resume your SOL session.');
            return;
          }
        } else {
          if (screen === 'playing') useUi.setState({ screen: 'lobby' });
          this.net.send({ t: 'spectate' });
        }
        if (auth && !this.authPending) this.sendAuthentication({ t: 'auth', token: auth.token });
        return;
      }
      case 'rooms':
        useUi.setState({ rooms: m.rooms, online: m.online, ...(m.chain ? { chain: m.chain } : {}) });
        return;
      case 'authed': {
        if (!this.authPending) return;
        this.authPending = false;
        this.authenticated = true;
        useUi.setState({ auth: { pubkey: m.pubkey, token: m.token, profile: m.profile } });
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify({ pubkey: m.pubkey, token: m.token, exp: Date.now() + 23 * 3600_000 }));
        } catch {
          /* ignore */
        }
        const room = this.pendingJoin;
        this.pendingJoin = null;
        if (room) this.sendJoin(room);
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
        const arenaId = m.arenaId ?? m.room.arenaId;
        // Public room IDs use "stake-1"; join requests use "stake:1".
        this.wasStakeRoom = m.room.mode === 'stake' && arenaId !== undefined ? `stake:${arenaId}` : null;
        this.resumeStakeRoom = null;
        this.pendingJoin = null;
        this.cashoutRequested = false;
        this.stakeSession = m.room.mode === 'stake' && m.arenaId !== undefined && m.sessionId !== undefined
          ? { arenaId: m.arenaId, sessionId: m.sessionId }
          : null;
        useUi.setState({
          screen: 'playing',
          room: m.room,
          me: { pid: m.playerId, name: m.name, skin: m.skin },
          death: null,
          cashoutResult: null,
          lastSettlement: null,
          powerups: [],
          cashout: { state: 'idle', until: 0 },
          hud: { ...useUi.getState().hud, value: m.value ?? null },
        });
        if (this.exitStakeRequested) this.cashout();
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
          hud: { ...s.hud, rank: m.me?.rank ?? 0, value: m.me?.value ?? (s.room?.mode === 'stake' ? s.hud.value : null), players: m.players },
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
        if (me) this.particles.confetti(me.x, me.y, Math.max(60, me.maxR), 40);
        sound.death();
        this.world.myPid = null;
        this.wasStakeRoom = null;
        this.exitStakeRequested = false;
        this.cashoutRequested = false;
        useUi.setState({ screen: 'dead', death: { stats: m.stats, killer: m.killer, killerSkin: m.killerSkin }, powerups: [], cashout: { state: 'idle', until: 0 }, chatOpen: false });
        this.flushIdentityChange();
        return;
      }
      case 'cashout': {
        this.cashoutRequested = false;
        if (m.state === 'started') {
          useUi.setState({ cashout: { state: 'channel', until: now + (m.ms ?? RULES.cashoutMs) } });
          return;
        }
        if (m.state === 'canceled') {
          this.exitStakeRequested = false;
          useUi.setState({ cashout: { state: 'idle', until: 0 } });
          toast('warn', 'Cash-out interrupted. Stay in the arena and try again before leaving.');
          return;
        }
        sound.cashout();
        const me = this.world.myStats();
        if (me) this.particles.coinBurst(me.x, me.y, Math.max(60, me.maxR), ['#FFD54A', '#FFE873', '#FFC93C'], 40);
        this.world.myPid = null;
        this.wasStakeRoom = null;
        this.exitStakeRequested = false;
        useUi.setState({ screen: 'cashedout', cashoutResult: { value: m.value ?? 0, stats: m.stats ?? null }, cashout: { state: 'idle', until: 0 }, chatOpen: false });
        this.flushIdentityChange();
        return;
      }
      case 'settled':
        // An earlier game may settle after a new one starts. Only its exact
        // arena/session receipt can confirm the current paid game's result.
        if (m.kind !== 'record' && (!this.stakeSession || m.arenaId !== this.stakeSession.arenaId || m.sessionId !== this.stakeSession.sessionId)) return;
        if (m.kind === 'record' && this.stakeSession) return;
        useUi.setState({ lastSettlement: { kind: m.kind, signature: m.signature, payout: m.payout, at: Date.now() } });
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
        if (me) this.particles.text(me.x, me.y - me.maxR, `${t(`pu.${m.type}` as 'pu.1')}!`, '#FFE873', 26);
        if (m.type === PowerUpType.Bag && me) this.particles.coinBurst(me.x, me.y, me.maxR, ['#FFD54A', '#FFE873'], 18);
        return;
      }
      case 'error': {
        this.cashoutRequested = false;
        if (m.code === 'auth_failed' || m.code === 'auth_required') {
          this.authenticated = false;
          this.authPending = false;
          useUi.setState({ auth: null });
          try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
        }
        if (this.resumeStakeRoom) this.failStakeResume();
        else this.pendingJoin = null;
        if (m.code === 'rate_limited') this.authPending = false;
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
    for (const ev of this.world.drainEats()) {
      switch (ev.type) {
        case 'food':
          if (ev.mine) {
            sound.blip(ev.variant === 7);
            const color = ev.variant < 6 ? FOOD_COLORS[ev.variant][0] : ev.variant === 7 ? '#FFD54A' : '#8DF2FF';
            this.particles.sparkle(ev.x, ev.y, color, ev.variant === 7 ? 6 : 2, ev.variant === 7 ? 9 : 5);
            if (ev.variant === 7) this.particles.text(ev.x, ev.y, '+8', '#FFD54A', 18);
          }
          break;
        case 'eject':
          if (ev.mine) sound.blip();
          break;
        case 'cell': {
          const victim = this.world.players.get(ev.victimPid);
          const skin = getSkin(victim?.skin ?? 0);
          if (ev.mine) {
            sound.chomp();
            this.particles.coinBurst(ev.x, ev.y, ev.r, [skin.colors.base, skin.colors.light, '#FFD54A']);
            this.particles.text(ev.x, ev.y, `+${Math.floor((ev.r * ev.r) / 100)}`, '#FFFFFF', 24);
          } else if (ev.me) {
            sound.ouch();
            this.particles.puff(ev.x, ev.y, ev.r, 'rgba(255,143,184,0.6)');
          } else if (!this.particles.lowQuality) {
            this.particles.coinBurst(ev.x, ev.y, ev.r, [skin.colors.base, skin.colors.light], 6);
          }
          break;
        }
        case 'virus':
          this.particles.confetti(ev.x, ev.y, 70, ev.mine ? 30 : 12);
          if (ev.mine) {
            sound.boing();
            this.particles.text(ev.x, ev.y, 'RUGGED! 🌵', '#4FE0A8', 26);
          }
          break;
        case 'powerup':
          this.particles.ring(ev.x, ev.y, 50, '#FFFFFF');
          break;
      }
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
      const short = ui.screen === 'lobby' ? 1500 : ui.screen === 'spectating' ? this.camera.visibleShortFor(0, true) * 0.85 : this.camera.visibleShortFor(400);
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
      aim: ui.screen === 'playing' ? this.aimPoint() : null,
      cashout: ui.cashout.state === 'channel' ? { until: ui.cashout.until, total: RULES.cashoutMs } : null,
      coinRain: !!ui.banner && ui.banner.kind === 'coinrain' && ui.banner.until > Date.now(),
      rand: this.rand,
    });

    if (this.minimap && ui.settings.showMinimap && now - this.lastMinimap > 66) {
      this.lastMinimap = now;
      this.renderer.drawMinimap(this.minimap, { world, camera: this.camera, leaders: ui.leaders, dark: ui.settings.theme === 'dark', now });
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

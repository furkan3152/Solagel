export interface InputActions {
  split(): void;
  eject(): void;
  emote(id: number): void;
  openChat(): void;
  escape(): void;
  spectateNext(): void;
  /** True while a game is being played: move keys steer (and arrows stop scrolling the page). */
  steering(): boolean;
}

export type MoveDir = 'up' | 'down' | 'left' | 'right';

/** WASD and the arrow keys, by `KeyboardEvent.code` (layout independent: W is where W is on QWERTY). */
export const MOVE_KEYS: Readonly<Record<string, MoveDir>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/**
 * The direction the held move keys point (screen axes, y down): opposite keys
 * cancel, diagonals are normalized so they are no faster than straight lines.
 */
export function keyVector(codes: Iterable<string>): { x: number; y: number } {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  for (const c of codes) {
    const d = MOVE_KEYS[c];
    if (d === 'up') up = true;
    else if (d === 'down') down = true;
    else if (d === 'left') left = true;
    else if (d === 'right') right = true;
  }
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
  return { x, y };
}

/** How far (CSS px) the mouse must travel while move keys are held to take the steering back. */
export const MOUSE_TAKEBACK_PX = 24;

/**
 * Keyboard steering: a held move key takes over from the mouse; the mouse takes
 * it back by moving once the keys are up, or by moving meaningfully while they
 * are still held. With every key up and the mouse still, the coin rests in place.
 */
export class KeySteer {
  /** Unit direction (or 0, 0) while the keyboard steers. */
  x = 0;
  y = 0;
  /** The keyboard has the steering. */
  active = false;
  private readonly held = new Set<string>();
  /** Where the mouse was when the keyboard took over (null: not seen yet). */
  private anchor: { x: number; y: number } | null = null;

  /** A key went down; returns true for a move key. Auto-repeats of a held key change nothing. */
  down(code: string, mouse: { x: number; y: number } | null): boolean {
    if (!(code in MOVE_KEYS)) return false;
    if (this.held.has(code)) return true;
    this.held.add(code);
    this.active = true;
    this.anchor = mouse ? { x: mouse.x, y: mouse.y } : null;
    this.update();
    return true;
  }

  /** A key went up; returns true for a move key. */
  up(code: string): boolean {
    if (!this.held.delete(code)) return code in MOVE_KEYS;
    this.update();
    return true;
  }

  /** The mouse moved to (x, y): it takes the steering back when the keys are up or it moved far enough. */
  mouseMoved(x: number, y: number): void {
    if (!this.active) return;
    if (this.held.size === 0) {
      this.active = false;
      return;
    }
    if (!this.anchor) {
      this.anchor = { x, y };
      return;
    }
    if (Math.hypot(x - this.anchor.x, y - this.anchor.y) >= MOUSE_TAKEBACK_PX) {
      this.active = false;
      this.held.clear();
      this.update();
    }
  }

  /** Lets go of every key (window blur, chat opening): the coin rests until a key or the mouse moves. */
  clear(): void {
    this.held.clear();
    this.update();
  }

  get holding(): boolean {
    return this.held.size > 0;
  }

  private update(): void {
    const v = keyVector(this.held);
    this.x = v.x;
    this.y = v.y;
  }
}

/** Keyboard + mouse (WASD / arrows steer too). Touch controls live in React (MobileControls) and write `stick`. */
export class Input {
  mouse = { x: 0, y: 0, active: false };
  /** Virtual joystick: direction (-1..1) and whether it is held. */
  stick = { x: 0, y: 0, active: false };
  /** WASD / arrow keys: a unit direction, fed to the aim like the stick at full reach. */
  readonly keys = new KeySteer();
  private ejectTimer: number | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    private readonly actions: InputActions,
    private readonly onWheel: (deltaY: number) => void,
    private readonly onGesture: () => void,
  ) {
    const on = <K extends keyof WindowEventMap>(el: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY, active: true };
      this.keys.mouseMoved(e.clientX, e.clientY);
    });
    on(this.target, 'mousedown', () => this.onGesture());
    on(
      this.target,
      'wheel',
      (e) => {
        e.preventDefault();
        this.onWheel(e.deltaY);
      },
      { passive: false },
    );
    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => this.keyUp(e));
    on(window, 'blur', () => {
      this.stopEject();
      this.keys.clear();
    });
  }

  private typing(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.actions.escape();
      return;
    }
    if (this.typing(e)) return;
    if (e.code in MOVE_KEYS) {
      if (!this.actions.steering()) return;
      // arrows would scroll the page under the game
      e.preventDefault();
      if (!e.repeat) this.onGesture();
      this.keys.down(e.code, this.mouse.active ? this.mouse : null);
      return;
    }
    this.onGesture();
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) this.actions.split();
        return;
      case 'KeyE':
        if (!e.repeat) this.startEject();
        return;
      case 'KeyQ':
        if (!e.repeat) this.actions.spectateNext();
        return;
      case 'Enter':
        e.preventDefault();
        this.actions.openChat();
        return;
    }
    if (/^Digit[1-8]$/.test(e.code) && !e.repeat) this.actions.emote(Number(e.code.slice(5)) - 1);
  }

  private keyUp(e: KeyboardEvent): void {
    // released even while typing: a key held into the chat line must not stick
    if (this.keys.up(e.code)) return;
    if (e.code === 'KeyE') this.stopEject();
  }

  /**
   * Virtual joystick from a thumb offset (px) inside a base of radius `max`:
   * clamped to the rim, with a small dead zone so a resting thumb does not drift.
   * Returns the clamped knob offset for the UI.
   */
  setStick(dx: number, dy: number, max: number): { x: number; y: number } {
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    const dead = max * 0.12;
    const k = d < dead ? 0 : Math.min(1, (Math.min(d, max) - dead) / (max - dead)) / Math.max(1e-6, Math.min(d, max));
    this.stick = { x: dx * k, y: dy * k, active: true };
    return { x: dx, y: dy };
  }

  releaseStick(): void {
    this.stick = { x: 0, y: 0, active: false };
  }

  startEject(): void {
    this.actions.eject();
    if (this.ejectTimer !== null) return;
    this.ejectTimer = window.setInterval(() => this.actions.eject(), 110);
  }

  stopEject(): void {
    if (this.ejectTimer !== null) clearInterval(this.ejectTimer);
    this.ejectTimer = null;
  }

  destroy(): void {
    this.stopEject();
    for (const fn of this.cleanup) fn();
  }
}

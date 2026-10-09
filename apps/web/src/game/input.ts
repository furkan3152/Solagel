export interface InputActions {
  split(): void;
  eject(): void;
  emote(id: number): void;
  cashout(): void;
  openChat(): void;
  escape(): void;
  spectateNext(): void;
}

/** Keyboard + mouse. Touch controls live in React (MobileControls) and write `stick`. */
export class Input {
  mouse = { x: 0, y: 0, active: false };
  /** Virtual joystick: direction (-1..1) and whether it is held. */
  stick = { x: 0, y: 0, active: false };
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
    on(window, 'blur', () => this.stopEject());
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
    this.onGesture();
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) this.actions.split();
        return;
      case 'KeyW':
        if (!e.repeat) this.startEject();
        return;
      case 'KeyC':
        if (!e.repeat) this.actions.cashout();
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
    if (e.code === 'KeyW') this.stopEject();
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

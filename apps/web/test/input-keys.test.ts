import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, KeySteer, MOUSE_TAKEBACK_PX, keyVector, type InputActions } from '../src/game/input';

const H = Math.SQRT1_2;

describe('keyVector', () => {
  it('points where the held keys say, WASD and arrows alike', () => {
    expect(keyVector([])).toEqual({ x: 0, y: 0 });
    expect(keyVector(['KeyW'])).toEqual({ x: 0, y: -1 });
    expect(keyVector(['ArrowDown'])).toEqual({ x: 0, y: 1 });
    expect(keyVector(['KeyA'])).toEqual({ x: -1, y: 0 });
    expect(keyVector(['ArrowRight'])).toEqual({ x: 1, y: 0 });
  });

  it('normalizes diagonals (no faster than a straight line)', () => {
    const v = keyVector(['KeyW', 'KeyD']);
    expect(v.x).toBeCloseTo(H);
    expect(v.y).toBeCloseTo(-H);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    const w = keyVector(['ArrowDown', 'KeyA']);
    expect(w.x).toBeCloseTo(-H);
    expect(w.y).toBeCloseTo(H);
  });

  it('cancels opposite keys and counts a doubled direction once', () => {
    expect(keyVector(['KeyA', 'KeyD'])).toEqual({ x: 0, y: 0 });
    expect(keyVector(['KeyW', 'ArrowUp'])).toEqual({ x: 0, y: -1 });
    expect(keyVector(['KeyW', 'KeyS', 'KeyD'])).toEqual({ x: 1, y: 0 });
  });

  it('ignores keys that do not move', () => {
    expect(keyVector(['KeyE', 'Space', 'KeyQ'])).toEqual({ x: 0, y: 0 });
  });
});

describe('KeySteer', () => {
  it('takes over on a move key, rests when the keys are up, hands back on the next mouse move', () => {
    const k = new KeySteer();
    expect(k.down('KeyE', null)).toBe(false);
    expect(k.active).toBe(false);
    expect(k.down('KeyD', { x: 100, y: 100 })).toBe(true);
    expect(k.active).toBe(true);
    expect([k.x, k.y]).toEqual([1, 0]);
    // a small wobble of the hand on the mouse does not steal it
    k.mouseMoved(105, 103);
    expect(k.active).toBe(true);
    k.up('KeyD');
    expect(k.active).toBe(true);
    expect([k.x, k.y]).toEqual([0, 0]);
    // keys up: any mouse move takes it back
    k.mouseMoved(106, 103);
    expect(k.active).toBe(false);
  });

  it('a meaningful mouse move takes it back even with keys held; a key repeat does not re-take it', () => {
    const k = new KeySteer();
    k.down('KeyW', { x: 0, y: 0 });
    k.mouseMoved(MOUSE_TAKEBACK_PX + 1, 0);
    expect(k.active).toBe(false);
    expect([k.x, k.y]).toEqual([0, 0]);
    // the held key's auto-repeat arrives as keydowns too: still the mouse's (the key was dropped, so it re-takes only on a fresh press)
    k.up('KeyW');
    expect(k.active).toBe(false);
    k.down('KeyW', { x: 30, y: 0 });
    expect(k.active).toBe(true);
  });

  it('repeats of a held key change nothing; a second key turns the vector', () => {
    const k = new KeySteer();
    k.down('ArrowUp', null);
    k.down('ArrowUp', null);
    k.down('ArrowLeft', null);
    expect(k.x).toBeCloseTo(-H);
    expect(k.y).toBeCloseTo(-H);
    k.up('ArrowUp');
    expect([k.x, k.y]).toEqual([-1, 0]);
  });

  it('with no mouse seen yet, the first mouse position is the anchor', () => {
    const k = new KeySteer();
    k.down('KeyS', null);
    k.mouseMoved(400, 400);
    expect(k.active).toBe(true);
    k.mouseMoved(400 + MOUSE_TAKEBACK_PX, 400);
    expect(k.active).toBe(false);
  });

  it('clear() lets go of every key', () => {
    const k = new KeySteer();
    k.down('KeyW', null);
    k.down('KeyA', null);
    k.clear();
    expect(k.holding).toBe(false);
    expect([k.x, k.y]).toEqual([0, 0]);
  });
});

describe('Input keys', () => {
  let input: Input | null = null;
  afterEach(() => {
    input?.destroy();
    input = null;
    vi.useRealTimers();
  });
  const make = (steering = true) => {
    const actions: InputActions = {
      split: vi.fn(),
      eject: vi.fn(),
      emote: vi.fn(),
      openChat: vi.fn(),
      escape: vi.fn(),
      spectateNext: vi.fn(),
      steering: () => steering,
    };
    input = new Input(document.createElement('div'), actions, () => {}, () => {});
    return { actions, input };
  };
  const key = (type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent(type, { code, key: code, cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };

  it('W steers up (no eject); E ejects and repeats while held', () => {
    vi.useFakeTimers();
    const { actions, input } = make();
    key('keydown', 'KeyW');
    expect(input.keys.active).toBe(true);
    expect([input.keys.x, input.keys.y]).toEqual([0, -1]);
    expect(actions.eject).not.toHaveBeenCalled();
    key('keyup', 'KeyW');
    key('keydown', 'KeyE');
    expect(actions.eject).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect((actions.eject as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    key('keyup', 'KeyE');
    const n = (actions.eject as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(actions.eject).toHaveBeenCalledTimes(n);
  });

  it('arrows stop the page scrolling in a game, and are left alone outside one', () => {
    make();
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(true);
    input!.destroy();
    const { input: idle } = make(false);
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(false);
    expect(idle.keys.active).toBe(false);
  });

  it('ignores move keys typed into a field, but a key released there still lets go', () => {
    const { input } = make();
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true }));
    expect(input.keys.active).toBe(false);
    key('keydown', 'KeyD');
    expect(input.keys.holding).toBe(true);
    field.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd', bubbles: true }));
    expect(input.keys.holding).toBe(false);
    field.remove();
  });

  it('a window blur lets go of held keys', () => {
    const { input } = make();
    key('keydown', 'KeyA');
    window.dispatchEvent(new Event('blur'));
    expect(input.keys.holding).toBe(false);
    expect([input.keys.x, input.keys.y]).toEqual([0, 0]);
  });

  it('mouse movement takes the steering back', () => {
    const { input } = make();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    key('keydown', 'KeyS');
    expect(input.keys.active).toBe(true);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80, clientY: 10 }));
    expect(input.keys.active).toBe(false);
  });
});

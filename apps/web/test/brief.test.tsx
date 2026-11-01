import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import { BRIEF_KEY, briefSeen, closeBrief, holdForBrief, resetBrief, useBrief } from '../src/game/brief';
import { FirstPlayBrief } from '../src/ui/game/FirstPlayBrief';

beforeEach(() => {
  localStorage.clear();
  resetBrief();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('first-play brief gate', () => {
  it('holds a newcomer\'s first join until the brief closes, then remembers it', () => {
    const join = vi.fn();
    expect(holdForBrief('practice', join)).toBe(true);
    expect(useBrief.getState()).toMatchObject({ open: true, mode: 'first', room: 'practice' });
    expect(join).not.toHaveBeenCalled();
    closeBrief();
    expect(join).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(BRIEF_KEY)).toBe('1');
    expect(briefSeen()).toBe(true);
    // the next join goes straight through
    const again = vi.fn();
    expect(holdForBrief('practice', again)).toBe(false);
  });

  it('still works (for this page) when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const join = vi.fn();
    expect(holdForBrief('arena:1', join)).toBe(true);
    closeBrief();
    expect(join).toHaveBeenCalledTimes(1);
    expect(holdForBrief('arena:1', vi.fn())).toBe(false);
  });
});

describe('FirstPlayBrief', () => {
  const show = () =>
    render(
      <Kb>
        <FirstPlayBrief />
      </Kb>,
    );

  it('shows four steps and the practice line; the button lets the join go', () => {
    show();
    const join = vi.fn();
    act(() => void holdForBrief('practice', join));
    expect(screen.getByRole('dialog', { name: 'You are a coin.' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(document.body.textContent).toMatch(/WASD or the arrow keys/);
    expect(document.body.textContent).toMatch(/Practice is free/);
    fireEvent.click(screen.getByRole('button', { name: /let me in/i }));
    expect(join).toHaveBeenCalledTimes(1);
    expect(useBrief.getState().open).toBe(false);
  });

  it('names the ticket for an arena and closes on Esc', () => {
    show();
    const join = vi.fn();
    act(() => void holdForBrief('arena:2', join));
    expect(document.body.textContent).toMatch(/your ticket buys you in/);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(join).toHaveBeenCalledTimes(1);
  });
});

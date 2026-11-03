import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import type { GameEngine } from '../src/game/engine';
import { Input } from '../src/game/input';
import { setEngine } from '../src/game/instance';
import { MobileControls } from '../src/ui/game/MobileControls';

afterEach(() => setEngine(null));

/** An engine with a real `Input` (the stick and the Tip timer live there). */
function engineWithInput() {
  const eject = vi.fn();
  const input = new Input(
    document.createElement('div'),
    { split: vi.fn(), eject, emote: vi.fn(), openChat: vi.fn(), escape: vi.fn(), spectateNext: vi.fn(), steering: () => true },
    () => {},
    () => {},
  );
  setEngine({ input, split: vi.fn() } as unknown as GameEngine);
  return { input, eject };
}

describe('phone controls that leave mid-press', () => {
  it('let go of the stick and stop tipping when they unmount (eaten, the bell, the lobby)', () => {
    vi.useFakeTimers();
    try {
      const { input, eject } = engineWithInput();
      const view = render(
        <Kb>
          <MobileControls />
        </Kb>,
      );
      const stick = screen.getByRole('application');
      stick.setPointerCapture = () => {};
      fireEvent.pointerDown(stick, { pointerId: 1, clientX: 40, clientY: 0, buttons: 1 });
      expect(input.stick.active).toBe(true);
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Tip' }));
      expect(eject).toHaveBeenCalledTimes(1);
      // the HUD goes (death): no pointerup ever arrives
      view.unmount();
      expect(input.stick.active).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(eject).toHaveBeenCalledTimes(1);
      input.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

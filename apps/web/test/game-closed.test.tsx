import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kb } from '../src/design';
import { t } from '../src/i18n';
import { useUi } from '../src/store';
import { GameClosedSheet } from '../src/ui/gate/GameClosedSheet';

describe('game_closed from the WebSocket', () => {
  it('has a friendly string and opens one calm sheet instead of an error toast', () => {
    expect(t('err.game_closed')).toMatch(/opens soon/);
    render(
      <Kb>
        <GameClosedSheet />
      </Kb>,
    );
    expect(screen.queryByText('The arena opens soon.')).toBeNull();
    act(() => useUi.setState({ gameClosed: true }));
    expect(screen.getByText('The arena opens soon.')).toBeTruthy();
    expect(screen.getByText(t('err.game_closed'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to slana.io' })).toBeTruthy();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteHeader } from '../src/site/Shell';

describe('the phone menu', () => {
  it('keeps Tab inside the open menu and gives focus back to its button on Escape', async () => {
    render(<SiteHeader />);
    const btn = screen.getByRole('button', { name: 'Open the menu' });
    act(() => btn.click());
    btn.focus();
    const sheet = screen.getByRole('navigation', { name: 'Site menu' });
    const stops = [btn, ...sheet.querySelectorAll<HTMLElement>('a[href]')];
    for (let i = 1; i <= stops.length; i++) {
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(document.activeElement).toBe(stops[i % stops.length]);
    }
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(stops[stops.length - 1]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

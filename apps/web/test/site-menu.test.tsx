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
    // its links, then the language tag (a button since the picker opens its own list)
    const stops = [btn, ...sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    expect(stops.at(-1)?.getAttribute('data-testid')).toBe('lang-pick');
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

  it('Escape in the language list closes the list, not the menu', () => {
    render(<SiteHeader />);
    act(() => screen.getByRole('button', { name: 'Open the menu' }).click());
    const sheet = screen.getByRole('navigation', { name: 'Site menu' });
    const tag = sheet.querySelector<HTMLElement>('[data-testid="lang-pick"]')!;
    fireEvent.click(tag);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Site menu' })).toBeTruthy();
    expect(document.activeElement).toBe(tag);
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../src/i18n';
import { LanguagePicker } from '../src/ui/LanguagePicker';

afterEach(async () => {
  await act(async () => {
    await setLocale('en');
  });
});

describe('the language picker', () => {
  it('opens a listbox of the languages in their own names, the current one selected', () => {
    render(<LanguagePicker />);
    const tag = screen.getByTestId('lang-pick');
    expect(tag.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(tag);
    expect(tag.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox');
    const opts = screen.getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Türkçe'), expect.stringContaining('Русский')]));
    expect(opts.find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toContain('English');
    expect(document.activeElement).toBe(list);
  });

  it('arrows and Enter pick a language; the list closes and focus returns to the tag', async () => {
    render(<LanguagePicker compact />);
    const tag = screen.getByTestId('lang-pick');
    tag.focus();
    fireEvent.keyDown(tag, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    await waitFor(() => expect(getLocale()).toBe('tr'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(tag);
  });

  it('Escape closes without a change and a click outside closes too', () => {
    render(
      <div>
        <LanguagePicker />
        <p>outside</p>
      </div>,
    );
    const tag = screen.getByTestId('lang-pick');
    fireEvent.click(tag);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(getLocale()).toBe('en');
    expect(document.activeElement).toBe(tag);
    fireEvent.click(tag);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

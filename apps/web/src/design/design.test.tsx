import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Kb, Sheet, Tabs, Ticket, TicketGroup, TicketStub } from './index';

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Kb>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Cut the ticket?" closeLabel="Close">
        <button type="button">first action</button>
        <button type="button">last action</button>
      </Sheet>
    </Kb>
  );
}

describe('Sheet', () => {
  it('traps focus, closes on Esc and restores focus to the opener', async () => {
    render(<SheetHarness />);
    const opener = screen.getByRole('button', { name: 'open' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Cut the ticket?' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last.
    const last = screen.getByRole('button', { name: 'last action' });
    const close = screen.getByRole('button', { name: 'Close' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Focus that escaped the dialog is pulled back in.
    opener.focus();
    fireEvent.keyDown(opener, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

function TabsHarness() {
  const [v, setV] = useState<'season' | 'today' | 'all'>('season');
  return (
    <Tabs
      label="Period"
      value={v}
      onChange={setV}
      items={[
        { id: 'season', label: 'Season' },
        { id: 'today', label: 'Today' },
        { id: 'all', label: 'All time' },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('moves selection and focus with Left/Right/Home/End', () => {
    render(<TabsHarness />);
    const season = screen.getByRole('tab', { name: 'Season' });
    expect(season.getAttribute('aria-selected')).toBe('true');
    expect(season.tabIndex).toBe(0);
    season.focus();

    fireEvent.keyDown(season, { key: 'ArrowRight' });
    const today = screen.getByRole('tab', { name: 'Today' });
    expect(today.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(today);
    expect(screen.getByRole('tab', { name: 'Season' }).tabIndex).toBe(-1);

    fireEvent.keyDown(today, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'All time' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Season' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'All time' }).getAttribute('aria-selected')).toBe('true');

    // Vertical arrows do nothing on a horizontal tablist.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'All time' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders the phone bar as navigation with aria-current', () => {
    render(
      <Tabs
        variant="nav"
        label="Main menu"
        value="play"
        onChange={() => {}}
        items={[
          { id: 'play', label: 'Play', icon: 'ticket' },
          { id: 'ranks', label: 'Ranks', icon: 'trophy' },
        ]}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' }).getAttribute('aria-current')).toBe('page');
  });
});

function GroupHarness({ initial = 'penny' as string | null }) {
  const [v, setV] = useState<string | null>(initial);
  return (
    <TicketGroup label="Rooms" value={v} onChange={setV}>
      {['practice', 'penny', 'gold'].map((id) => (
        <Ticket key={id} value={id} title={id} stub={<TicketStub value="1" />} aria-label={id} />
      ))}
    </TicketGroup>
  );
}

describe('TicketGroup', () => {
  it('is one tab stop and arrows move the selection', () => {
    render(<GroupHarness />);
    const group = screen.getByRole('radiogroup', { name: 'Rooms' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByRole('radio', { name: 'penny' }).getAttribute('aria-checked')).toBe('true');

    radios[1].focus();
    fireEvent.keyDown(radios[1], { key: 'ArrowDown' });
    const gold = screen.getByRole('radio', { name: 'gold' });
    expect(gold.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(gold);

    fireEvent.keyDown(gold, { key: 'ArrowDown' }); // wraps
    expect(screen.getByRole('radio', { name: 'practice' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(gold.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'practice' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(gold.getAttribute('aria-checked')).toBe('true');
  });

  it('makes the first ticket the tab stop when nothing is selected', async () => {
    render(<GroupHarness initial={null} />);
    await act(async () => {});
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('a standalone ticket is a toggle button', () => {
    render(<Ticket title="Solo" stub="1" selected aria-label="Solo" />);
    const b = screen.getByRole('button', { name: 'Solo' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('role')).toBeNull();
  });
});

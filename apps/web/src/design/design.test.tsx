import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { setReducedMotion } from '../test/media';
import { ArcGauge, CoinCharacter, Kb, QuantityStepper, Sheet, Stepper, Tabs, Ticket, TicketGroup, TicketStub, TxPreview, Wordmark, formatWei, shortAddress } from './index';

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Kb>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Buy this ticket?" closeLabel="Close">
        <button type="button">first action</button>
        <button type="button">last action</button>
      </Sheet>
    </Kb>
  );
}

async function exerciseSheet() {
  render(<SheetHarness />);
  const opener = screen.getByRole('button', { name: 'open' });
  opener.focus();
  fireEvent.click(opener);

  const dialog = await screen.findByRole('dialog', { name: 'Buy this ticket?' });
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
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 4000 });
  expect(document.activeElement).toBe(opener);
}

describe('Sheet', () => {
  it('traps focus, closes on Esc and restores focus (reduced motion on)', async () => {
    setReducedMotion(true);
    await exerciseSheet();
  });

  it('traps focus, closes on Esc and restores focus (full motion, the default)', async () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
    await exerciseSheet();
  });
});

function TabsHarness() {
  const [v, setV] = useState<'week' | 'today' | 'all'>('week');
  return (
    <Tabs
      label="Period"
      value={v}
      onChange={setV}
      items={[
        { id: 'week', label: 'Week' },
        { id: 'today', label: 'Today' },
        { id: 'all', label: 'All time' },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('moves selection and focus with Left/Right/Home/End', () => {
    render(<TabsHarness />);
    const week = screen.getByRole('tab', { name: 'Week' });
    expect(week.getAttribute('aria-selected')).toBe('true');
    expect(week.tabIndex).toBe(0);
    week.focus();

    fireEvent.keyDown(week, { key: 'ArrowRight' });
    const today = screen.getByRole('tab', { name: 'Today' });
    expect(today.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(today);
    expect(screen.getByRole('tab', { name: 'Week' }).tabIndex).toBe(-1);

    fireEvent.keyDown(today, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'All time' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Week' }).getAttribute('aria-selected')).toBe('true');
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

function GroupHarness({ initial = 'penny' as string | null, disabled = [] as string[], ids = ['practice', 'penny', 'gold'] }) {
  const [v, setV] = useState<string | null>(initial);
  return (
    <TicketGroup label="Rooms" value={v} onChange={setV}>
      {ids.map((id) => (
        <Ticket key={id} value={id} title={id} stub={<TicketStub value="1" />} aria-label={id} disabled={disabled.includes(id)} />
      ))}
      <button type="button">outside</button>
    </TicketGroup>
  );
}

const tabStops = () => screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);

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

  it('keeps exactly one tab stop as the selection changes', () => {
    render(<GroupHarness initial={null} />);
    expect(tabStops().map((r) => r.getAttribute('aria-label'))).toEqual(['practice']);
    fireEvent.click(screen.getByRole('radio', { name: 'penny' }));
    expect(screen.getByRole('radio', { name: 'penny' }).getAttribute('aria-checked')).toBe('true');
    expect(tabStops().map((r) => r.getAttribute('aria-label'))).toEqual(['penny']);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'penny' }), { key: 'ArrowDown' });
    expect(tabStops().map((r) => r.getAttribute('aria-label'))).toEqual(['gold']);
  });

  it('skips disabled tickets and ignores keys from non-tickets', () => {
    render(<GroupHarness initial={null} ids={['a', 'b', 'c', 'd']} disabled={['a', 'c']} />);
    // first ENABLED ticket is the tab stop
    expect(tabStops().map((r) => r.getAttribute('aria-label'))).toEqual(['b']);
    const b = screen.getByRole('radio', { name: 'b' });
    b.focus();
    fireEvent.keyDown(b, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'd' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(b.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(b, { key: 'End' });
    expect(screen.getByRole('radio', { name: 'd' }).getAttribute('aria-checked')).toBe('true');

    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'd' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(outside);
  });

  it('never has zero tab stops when the value is disabled or unknown', () => {
    const { unmount } = render(<GroupHarness initial="penny" disabled={['penny']} />);
    expect(tabStops().map((r) => r.getAttribute('aria-label'))).toEqual(['practice']);
    unmount();
    render(<GroupHarness initial="nope" ids={['a', 'b']} disabled={['a']} />);
    expect(tabStops().map((r) => r.getAttribute('aria-label'))).toEqual(['b']);
  });

  it('a standalone ticket is a toggle button', () => {
    render(<Ticket title="Solo" stub="1" selected aria-label="Solo" />);
    const b = screen.getByRole('button', { name: 'Solo' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('role')).toBeNull();
  });
});

describe('Storybook building blocks', () => {
  it('formats wei exactly and shortens addresses', () => {
    expect(formatWei(21_300_000_000_000_000n)).toBe('0.0213');
    expect(formatWei(1_234_567_890_000_000_000_000_000n, 2)).toBe('1,234,567.89');
    expect(formatWei(49_999n, 4)).toBe('0.0000');
    expect(shortAddress('0x7a3f9c2e1b4d5a6f708192a3b4c5d6e7f809e91c')).toBe('0x7a3f…e91c');
  });

  it('QuantityStepper clamps to min/max and is a spinbutton', () => {
    function H() {
      const [v, setV] = useState(1);
      return <QuantityStepper value={v} onChange={setV} max={3} label="How many" />;
    }
    render(<H />);
    const less = screen.getByRole('button', { name: 'One fewer' }) as HTMLButtonElement;
    const more = screen.getByRole('button', { name: 'One more' }) as HTMLButtonElement;
    expect(less.disabled).toBe(true);
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    const spin = screen.getByRole('spinbutton', { name: 'How many' });
    expect(spin.getAttribute('aria-valuenow')).toBe('3');
    expect(more.disabled).toBe(true);
    fireEvent.keyDown(spin, { key: 'Home' });
    expect(spin.getAttribute('aria-valuenow')).toBe('1');
  });

  it('TxPreview never sends twice on a double click', async () => {
    let calls = 0;
    let release: () => void = () => {};
    render(
      <TxPreview
        fn="setToken"
        args={[{ name: 'token', type: 'address', value: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' }]}
        network={{ name: 'Elysium Testnet', chainId: 4207 }}
        onConfirm={() => {
          calls++;
          return new Promise<void>((r) => (release = r));
        }}
      />,
    );
    expect(screen.getByText('setToken(address token)')).toBeTruthy();
    const go = screen.getByRole('button', { name: /Open wallet/ });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(calls).toBe(1);
    await act(async () => release());
    fireEvent.click(go);
    expect(calls).toBe(2);
  });

  it('ArcGauge is a meter; Stepper marks done steps; art is labelled or hidden', () => {
    render(
      <Kb>
        <ArcGauge value={2614} max={5000} />
        <Stepper
          label="Chores"
          steps={[
            { id: 'a', title: 'Follow', state: 'done' },
            { id: 'b', title: 'Repost', state: 'active' },
          ]}
        />
        <Wordmark />
        <CoinCharacter mood="chomp" />
      </Kb>,
    );
    expect(screen.getByRole('meter', { name: 'Minted' }).getAttribute('aria-valuetext')).toBe('2,614 of 5,000');
    expect(screen.getByRole('progressbar', { name: 'Chores' }).getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByText('DONE')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Elymum' })).toBeTruthy();
  });
});

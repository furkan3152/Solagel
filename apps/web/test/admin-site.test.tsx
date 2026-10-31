import type { CollabAdmin, SiteCounts, WlEntryAdmin, WlTask } from '@elymum/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollabsTab } from '../src/admin/site/CollabsTab';
import { PlayTab } from '../src/admin/site/PlayTab';
import { SettingsTab } from '../src/admin/site/SettingsTab';
import { TasksTab } from '../src/admin/site/TasksTab';
import { WlTab } from '../src/admin/site/WlTab';
import { Kb } from '../src/design';
import { adminApi } from '../src/site/api';
import { SETTINGS, installDomStubs, mockFetch, type Call } from './site-helpers';

const api = adminApi('admin-token');
const COUNTS: SiteCounts = { wl: { pending: 2, approved: 1, rejected: 0, total: 3 }, collab: { pending: 1, rejected: 0, approved: 1, submitted: 0, total: 2, closed: 0, wallets: 0 } };
const W = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const wl = (id: string, xHandle: string): WlEntryAdmin => ({
  id,
  wallet: W,
  xHandle,
  status: 'pending',
  tasks: [{ id: 'post_x', kind: 'post_x', title: 'Post about Elymum', target: null, required: true, answer: 'https://x.com/a/status/1' }],
  createdAt: 1,
  updatedAt: 1,
  note: '',
  dupCollabs: [],
});
const task = (id: string, order: number): WlTask => ({ id, kind: 'follow_x', title: `Task ${id}`, body: '', target: 'https://x.com/elymumio', required: true, enabled: true, order });
const cb = (over: Partial<CollabAdmin> = {}): CollabAdmin => ({
  id: 'c1',
  wallet: W,
  community: 'Riso Guild',
  type: 'guild',
  members: 2500,
  communityX: 'risoguild',
  contactX: 'riso_rita',
  discord: '',
  role: 'founder',
  postUrl: 'https://x.com/risoguild/status/2',
  about: 'Printers.',
  status: 'pending',
  phase: 'in_review',
  spots: null,
  deadline: null,
  wallets: [],
  raffleUrl: null,
  submittedAt: null,
  createdAt: 1,
  updatedAt: 1,
  note: '',
  ...over,
});

let restore = () => {};
let calls: Call[] = [];
beforeEach(() => installDomStubs());
afterEach(() => restore());
const ui = (node: ReactElement) => render(<Kb>{node}</Kb>);
const sent = (method: string, path: string) => calls.find((c) => c.method === method && c.path === path);

describe('admin: site tabs (Bearer session, mocked fetch)', { timeout: 30_000 }, () => {
  it('Play opens /play and says whether the game is admin-only', async () => {
    ({ calls, restore } = mockFetch({ 'GET /api/admin/settings': { settings: SETTINGS, gameAccessEnv: null } }));
    ui(<PlayTab api={api} />);
    expect(await screen.findByText('Admins only')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the arena' }).getAttribute('href')).toBe('/play');
    expect(calls[0].auth).toBe('Bearer admin-token');
  });

  it('WL: counts, then approve in bulk; a row opens a detail with clickable links', async () => {
    ({ calls, restore } = mockFetch({
      'GET /api/admin/wl': { items: [wl('w1', 'alice'), wl('w2', 'bob')], total: 2, page: 1, pageSize: 50 },
      'GET /api/admin/counts': COUNTS,
      'POST /api/admin/wl/status': { updated: 2 },
      'PUT /api/admin/wl/w1/status': { entry: { ...wl('w1', 'alice'), status: 'rejected' } },
    }));
    ui(<WlTab api={api} />);
    await screen.findByText('@alice');
    expect(within(screen.getByLabelText('Counts')).getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select all on this page'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));
    await screen.findByText('2 entries set to approved.');
    expect(sent('POST', '/api/admin/wl/status')?.body).toEqual({ ids: ['w1', 'w2'], status: 'approved' });
    expect(sent('POST', '/api/admin/wl/status')?.auth).toBe('Bearer admin-token');
    // the list is filtered and searched on the server
    expect(calls.some((c) => c.path.startsWith('/api/admin/wl?status=pending'))).toBe(true);

    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    const link = await screen.findByRole('link', { name: 'https://x.com/a/status/1' });
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(sent('PUT', '/api/admin/wl/w1/status')?.body).toEqual({ status: 'rejected' }));
  });

  it('Tasks: create a task and reorder', async () => {
    ({ calls, restore } = mockFetch({
      'GET /api/admin/tasks': { tasks: [task('a', 0), task('b', 1)] },
      'GET /api/admin/settings': { settings: SETTINGS, gameAccessEnv: null },
      'POST /api/admin/tasks': (c: Call) => ({ task: { ...task('t_new', 2), ...(c.body as object) } }),
      'PUT /api/admin/tasks/order': { tasks: [task('b', 0), task('a', 1)] },
    }));
    ui(<TasksTab api={api} />);
    await screen.findByText('Task a');
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('A title is required.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Join our Discord' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'join_link' } });
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'https://discord.gg/elymum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByText('Task created.');
    expect(sent('POST', '/api/admin/tasks')?.body).toEqual({ kind: 'join_link', title: 'Join our Discord', body: '', target: 'https://discord.gg/elymum', required: true, enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Move Task a down' }));
    await waitFor(() => expect(sent('PUT', '/api/admin/tasks/order')?.body).toEqual({ ids: ['b', 'a', 't_new'] }));
  });

  it('Collabs: approve with spots and a deadline; duplicates are flagged', async () => {
    const dup = cb({ id: 'c2', community: 'Dup DAO', status: 'submitted', phase: 'submitted', spots: 2, deadline: Date.now() + 86_400_000, wallets: [{ name: 'x', wallet: W, dupWl: true, dupCollabs: ['c9'] }] });
    ({ calls, restore } = mockFetch({
      'GET /api/admin/collabs': { items: [cb(), dup] },
      'GET /api/admin/counts': COUNTS,
      'POST /api/admin/collabs/c1/approve': (c: Call) => ({ collab: cb({ status: 'approved', phase: 'approved', ...(c.body as object) }) }),
    }));
    ui(<CollabsTab api={api} />);
    await screen.findByText('Riso Guild');
    expect(screen.getByText('· 1 dup')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    fireEvent.change(await screen.findByLabelText('Spots'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Approved.');
    const body = sent('POST', '/api/admin/collabs/c1/approve')?.body as { spots: number; deadline: number };
    expect(body.spots).toBe(25);
    expect(body.deadline).toBeGreaterThan(Date.now());
  });

  it('Settings: switch collabs on and save only what changed', async () => {
    ({ calls, restore } = mockFetch({
      'GET /api/admin/settings': { settings: { ...SETTINGS, collabOpen: false }, gameAccessEnv: null },
      'PUT /api/admin/settings': (c: Call) => ({ settings: { ...SETTINGS, ...(c.body as object) }, gameAccessEnv: null }),
    }));
    ui(<SettingsTab api={api} />);
    fireEvent.click(await screen.findByLabelText(/Collab applications open/));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Settings saved.');
    expect(sent('PUT', '/api/admin/settings')?.body).toEqual({ collabOpen: true });
  });

  it('Settings: who may play is a three-way choice (admins, NFT holders, everyone); the env override is shown', async () => {
    ({ calls, restore } = mockFetch({
      'GET /api/admin/settings': { settings: SETTINGS, gameAccessEnv: null },
      'PUT /api/admin/settings': (c: Call) => ({ settings: { ...SETTINGS, ...(c.body as object) }, gameAccessEnv: null }),
    }));
    ui(<SettingsTab api={api} />);
    const holders = (await screen.findByRole('radio', { name: /NFT holders/ })) as HTMLInputElement;
    expect((screen.getByRole('radio', { name: /Admins only/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(holders);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Settings saved.');
    expect(sent('PUT', '/api/admin/settings')?.body).toEqual({ gameAccess: 'holders' });
    restore();
    ({ calls, restore } = mockFetch({ 'GET /api/admin/settings': { settings: SETTINGS, gameAccessEnv: 'public' } }));
    ui(<SettingsTab api={api} />);
    expect(await screen.findByText(/GAME_ACCESS=public is set on the server/)).toBeTruthy();
  });
});

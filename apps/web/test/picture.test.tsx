import { EntityKind, PlayerFlag, encodeSnapshot, type ProfileView } from '@elymum/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/game/state';
import { AVATAR_BUCKETS, AvatarCache, bucketFor } from '../src/render/avatars';
import { useUi, updateSettings } from '../src/store';
import { PicturePanel, PictureTile, usePicture } from '../src/ui/profile/PicturePicker';
import { centerCrop, clampCrop, coverScale, pictureStatus, sourceRect, wearsPicture, zoomCrop } from '../src/ui/profile/picture';
import { useChainData } from '../src/wallet/chain';
import { useWallet } from '../src/wallet/store';
import { ALICE } from './evm-helpers';

const PIC = '0123456789abcdef';

describe('picture picker state', () => {
  it('knows what the player can do', () => {
    expect(pictureStatus({ owner: null, token: null, avatar: PIC })).toBe('guest');
    expect(pictureStatus({ owner: ALICE, token: null, avatar: PIC })).toBe('verify');
    expect(pictureStatus({ owner: ALICE, token: 't', avatar: null })).toBe('empty');
    expect(pictureStatus({ owner: ALICE, token: 't', avatar: 'nothex' })).toBe('empty');
    expect(pictureStatus({ owner: ALICE, token: 't', avatar: PIC })).toBe('ready');
  });

  it('wears the picture only when chosen and present (a removed one falls back to the basic coin)', () => {
    expect(wearsPicture(true, PIC)).toBe(true);
    expect(wearsPicture(false, PIC)).toBe(false);
    expect(wearsPicture(true, null)).toBe(false);
    expect(wearsPicture(true, undefined)).toBe(false);
  });

  it('centre-crops, zooms about the centre and never shows past the image', () => {
    const S = 200;
    // a 400 x 200 landscape: cover scale 1, centred horizontally
    expect(coverScale(400, 200, S)).toBe(1);
    const c = centerCrop(400, 200, S);
    expect(c).toEqual({ zoom: 1, x: -100, y: 0 });
    expect(sourceRect(c, 400, 200, S)).toEqual({ sx: 100, sy: 0, size: 200 });
    // dragging past the edge is clamped
    expect(clampCrop({ zoom: 1, x: 50, y: 30 }, 400, 200, S)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCrop({ zoom: 1, x: -900, y: -30 }, 400, 200, S)).toEqual({ zoom: 1, x: -200, y: 0 });
    // zoom 2 about the centre keeps the centre pixel in place
    const z = zoomCrop(c, 2, 400, 200, S);
    expect(z.zoom).toBe(2);
    const r = sourceRect(z, 400, 200, S);
    expect(r.size).toBe(100);
    expect(r.sx + r.size / 2).toBeCloseTo(200);
    expect(r.sy + r.size / 2).toBeCloseTo(100);
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, 400, 200, S).zoom).toBe(4);
    expect(clampCrop({ zoom: 0.1, x: NaN, y: 0 }, 400, 200, S).zoom).toBe(1);
  });
});

describe('avatar cache', () => {
  it('picks the smallest bucket covering the size, capped at the largest', () => {
    expect(bucketFor(1)).toBe(0);
    expect(AVATAR_BUCKETS[bucketFor(30)]).toBe(32);
    expect(AVATAR_BUCKETS[bucketFor(33)]).toBe(48);
    expect(AVATAR_BUCKETS[bucketFor(5000)]).toBe(128);
  });

  it('answers null while a picture loads and for bad ids, and loads each id once', () => {
    const urls: string[] = [];
    const cache = new AvatarCache((id) => {
      urls.push(id);
      return `data:,${id}`;
    });
    expect(cache.disc('not-an-id', 40)).toBeNull();
    expect(cache.disc(PIC, 40)).toBeNull();
    expect(cache.disc(PIC, 80)).toBeNull();
    expect(urls).toEqual([PIC]);
    expect(cache.state(PIC)).toMatch(/loading|queued|error/);
  });
});

describe('client world avatars', () => {
  const snap = (players: Parameters<typeof encodeSnapshot>[0]['players']) =>
    encodeSnapshot({ tick: 1, view: { x: 0, y: 0, h: 1000 }, players, upserts: [{ id: 1, kind: EntityKind.Cell, x: 0, y: 0, r: 30, playerId: 4, flags: 0 }], removals: [] });

  it('keeps the avatar id of a player, drops it when the info comes without one, and never gives one to a bot', () => {
    const w = new ClientWorld();
    w.applyBinary(snap([{ id: 4, skin: 2, flags: 0, name: 'pic', avatar: PIC }]), 0);
    expect(w.players.get(4)?.avatar).toBe(PIC);
    const same = w.players.get(4)!.avatar;
    w.applyBinary(snap([{ id: 4, skin: 2, flags: 0, name: 'pic', avatar: PIC }]), 1);
    expect(w.players.get(4)!.avatar).toBe(same);
    w.applyBinary(snap([{ id: 4, skin: 2, flags: 0, name: 'pic' }]), 2);
    expect(w.players.get(4)!.avatar).toBeUndefined();
    w.applyBinary(snap([{ id: 4, skin: 2, flags: PlayerFlag.Bot, name: 'bot', avatar: PIC }]), 3);
    expect(w.players.get(4)!.avatar).toBeUndefined();
  });
});

function Picker() {
  const pic = usePicture();
  return (
    <>
      <PictureTile pic={pic} skin={1} group="g" />
      <PicturePanel pic={pic} skin={1} />
    </>
  );
}

const profile = (avatar: string | null): ProfileView => ({ wallet: ALICE, name: 'Alice', skin: 1, stats: { games: 0, kills: 0, best: 0 }, updatedAt: null, avatar });

describe('PicturePicker', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ profile: profile(null) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useWallet.setState({ status: 'disconnected', address: null });
    useUi.setState({ auth: null });
    useChainData.setState({ profile: null });
    updateSettings({ picture: false });
  });

  it('tells a guest to connect a wallet (basic coins stay free)', () => {
    render(<Picker />);
    expect(screen.getByText(/Connect a wallet to play with your own picture/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Your picture' })).toHaveProperty('checked', false);
  });

  it('asks a connected wallet to verify before an upload', () => {
    useWallet.setState({ status: 'connected', address: ALICE });
    render(<Picker />);
    expect(screen.getByText(/Verify your wallet/)).toBeTruthy();
  });

  it('offers the upload when signed in without a picture', () => {
    useWallet.setState({ status: 'connected', address: ALICE });
    useUi.setState({ auth: { address: ALICE, token: 'tok', profile: null } });
    useChainData.setState({ profile: profile(null) });
    render(<Picker />);
    expect(screen.getByRole('button', { name: 'Upload picture' })).toBeTruthy();
  });

  it('wears a saved picture when its tile is picked, and removes it', async () => {
    useWallet.setState({ status: 'connected', address: ALICE });
    useUi.setState({ auth: { address: ALICE, token: 'tok', profile: null } });
    useChainData.setState({ profile: profile(PIC) });
    render(<Picker />);
    expect(screen.getByText(/Pick the tile to wear it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Your picture' }));
    expect(useUi.getState().settings.picture).toBe(true);
    expect(screen.getByText(/inside the rim of Goldie/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/profile\/avatar$/);
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(useChainData.getState().profile?.avatar).toBeNull();
    expect(useUi.getState().settings.picture).toBe(false);
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetLoader, assetUrls, type AssetUrls } from '../src/audio/assets';
import { displayName, isAudioFile } from '../src/audio/custom';
import { Mixer, prefsFromSettings } from '../src/audio/mixer';
import { CROSSFADE, Music, TRACKS } from '../src/audio/music';
import { BUILTIN_TRACKS, musicChoice } from '../src/audio/tracks';
import { FakeGain, FakeMediaElement, FakeSource, fakeCtor, fakeFile, flush } from './fake-audio';

const settings = (patch: Record<string, unknown> = {}) => ({ sound: true, volume: 0.6, ...patch });
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};

describe('the soundtrack files', () => {
  it('every pickable track ships as Ogg Opus and AAC, a 60-120 s loop with a pad', () => {
    const urls = assetUrls();
    for (const id of BUILTIN_TRACKS.filter((t) => t !== 'classic')) {
      expect(Object.keys(urls[`music/${id}`] ?? {}).sort(), id).toEqual(['m4a', 'ogg']);
      const t = TRACKS[id];
      expect(t.loop, id).toBeGreaterThanOrEqual(60);
      expect(t.loop, id).toBeLessThanOrEqual(120);
      expect(t.pad, id).toBeGreaterThan(0.1);
    }
  });
});

describe('music: picking a soundtrack', () => {
  const urls: AssetUrls = Object.fromEntries(['lobby', 'game', 'tension', 'chill', 'arcade', 'chiptune', 'lofi'].map((n) => [`music/${n}`, { ogg: `${n}.ogg` }]));

  function make(patch: Record<string, unknown> = {}) {
    const { ctx, create } = fakeCtor();
    const mixer = new Mixer(create);
    const fetcher = vi.fn(async (url: string) => fakeFile(`${url}:61`));
    const timers: (() => void)[] = [];
    const els: FakeMediaElement[] = [];
    const onCustomError = vi.fn();
    const music = new Music(mixer, {
      loader: new AssetLoader(urls, ['ogg'], fetcher),
      setTimer: (fn) => timers.push(fn),
      media: (url) => {
        const el = new FakeMediaElement(url);
        els.push(el);
        return el as unknown as HTMLAudioElement;
      },
      onCustomError,
    });
    mixer.apply(prefsFromSettings(settings(patch)));
    const loops = () => ctx.sources().filter((s): s is FakeSource => s.loop);
    const tag = (s: FakeSource) => (s.buffer as { tag: string }).tag;
    const fetched = () => fetcher.mock.calls.map((c) => c[0]);
    return { ctx, mixer, music, fetched, loops, tag, timers, els, onCustomError };
  }

  it('fetches only the picked track (nothing before the gesture)', async () => {
    const { mixer, music, fetched, loops, tag } = make();
    music.setChoice('chiptune');
    expect(fetched()).toEqual([]);
    mixer.unlock();
    await settle();
    expect(fetched()).toEqual(['chiptune.ogg']);
    const [src] = loops();
    expect(tag(src)).toBe('chiptune.ogg:61');
    expect(src.loopStart).toBe(TRACKS.chiptune.pad);
    expect(src.loopEnd).toBeCloseTo(TRACKS.chiptune.pad + TRACKS.chiptune.loop, 6);
  });

  it('cross-fades from the default to the new pick', async () => {
    const { ctx, mixer, music, fetched, loops, tag } = make();
    mixer.unlock();
    await settle();
    ctx.currentTime = 10;
    music.setChoice('lofi');
    await settle();
    const [old, next] = loops();
    expect(tag(old)).toBe('lobby.ogg:61');
    expect(tag(next)).toBe('lofi.ogg:61');
    expect((old.outputs[0] as FakeGain).gain.events.at(-1)).toEqual(['linear', 0, 10 + CROSSFADE]);
    expect((next.outputs[0] as FakeGain).gain.events.at(-1)![2]).toBeCloseTo(10.05 + CROSSFADE, 6);
    expect((next.outputs[0] as FakeGain).outputs).toContain(mixer.busNode('music'));
    expect(fetched()).toEqual(['lobby.ogg', 'lofi.ogg']);
  });

  it('a picked track plays through lobby and room alike; no tension layer over it', async () => {
    const { mixer, music, fetched, loops } = make();
    music.setChoice('arcade');
    mixer.unlock();
    await settle();
    music.setMood('game');
    music.setTension(true);
    await settle();
    expect(loops().length).toBe(1);
    expect(music.layers()).toEqual([{ name: 'arcade', ending: false }]);
    expect(fetched()).toEqual(['arcade.ogg']);
    // back to the default: the classic room loop and its tension layer
    music.setChoice('classic');
    await settle();
    expect(music.layers().filter((l) => !l.ending).map((l) => l.name)).toEqual(['game', 'tension']);
  });

  it('no music (the switch off) stops the pick; on again fades it back in', async () => {
    const { mixer, music, loops } = make();
    music.setChoice('chill');
    mixer.unlock();
    await settle();
    mixer.apply(prefsFromSettings(settings({ musicOn: false })));
    expect(music.playing).toBe(false);
    expect(loops()[0].stoppedAt).not.toBeNull();
    mixer.apply(prefsFromSettings(settings()));
    await settle();
    expect(music.playing).toBe(true);
    expect(music.layers().filter((l) => !l.ending)).toEqual([{ name: 'chill', ending: false }]);
  });

  it('your own music: the default plays until a file is there, then the file through the music bus', async () => {
    const { ctx, mixer, music, loops, els, timers } = make();
    music.setChoice('custom');
    mixer.unlock();
    await settle();
    expect(music.track()).toBe('classic');
    expect(loops().length).toBe(1);
    music.setCustom('blob:own-1');
    await settle();
    expect(els.length).toBe(1);
    expect(els[0].src).toBe('blob:own-1');
    expect(els[0].loop).toBe(true);
    expect(els[0].paused).toBe(false);
    const media = ctx.nodes.find((n) => n.kind === 'media')!;
    const gain = media.outputs[0] as FakeGain;
    expect(gain.outputs).toContain(mixer.busNode('music'));
    expect(gain.gain.events.at(-1)![0]).toBe('linear');
    expect(gain.gain.events.at(-1)![1]).toBeLessThan(1); // own files are usually far louder
    expect(loops()[0].stoppedAt).not.toBeNull(); // the default fades out
    // the music switch off: the element pauses once faded
    mixer.apply(prefsFromSettings(settings({ musicOn: false })));
    for (const t of timers.splice(0)) t();
    expect(els[0].paused).toBe(true);
    expect(music.layers().some((l) => l.name === 'custom')).toBe(false);
  });

  it('your own music pauses with a hidden tab and resumes when it is back', async () => {
    const { mixer, music, els } = make();
    music.setChoice('custom');
    music.setCustom('blob:own-2');
    mixer.unlock();
    await settle();
    expect(els[0].paused).toBe(false);
    mixer.setHidden(true);
    expect(els[0].paused).toBe(true);
    mixer.setHidden(false);
    expect(els[0].paused).toBe(false);
  });

  it('a file that will not play reports it; clearing the file falls back to the default', async () => {
    const { mixer, music, els, loops, tag, onCustomError } = make();
    music.setChoice('custom');
    music.setCustom('blob:bad');
    mixer.unlock();
    await settle();
    els[0].onerror?.();
    expect(onCustomError).toHaveBeenCalledTimes(1);
    music.setCustom(null);
    await settle();
    expect(music.track()).toBe('classic');
    expect(tag(loops().at(-1)!)).toBe('lobby.ogg:61');
  });
});

describe('own-file checks', () => {
  it('takes audio files, refuses others and empty ones', () => {
    expect(isAudioFile({ name: 'song.mp3', type: 'audio/mpeg', size: 4_000_000 })).toBe(true);
    expect(isAudioFile({ name: 'track.flac', type: '', size: 30_000_000 })).toBe(true);
    expect(isAudioFile({ name: 'photo.png', type: 'image/png', size: 100_000 })).toBe(false);
    expect(isAudioFile({ name: 'empty.mp3', type: 'audio/mpeg', size: 0 })).toBe(false);
    expect(displayName('My Song (live).mp3')).toBe('My Song (live)');
  });
});

describe('the music setting persists', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('defaults to the classic soundtrack and round-trips a pick', async () => {
    const first = await import('../src/store');
    expect(first.useUi.getState().settings.musicTrack).toBe('classic');
    first.updateSettings({ musicTrack: 'lofi' });
    vi.resetModules();
    const second = await import('../src/store');
    expect(second.useUi.getState().settings.musicTrack).toBe('lofi');
  });

  it('an unknown saved track falls back to the default; old saves gain the field', async () => {
    localStorage.setItem('elymum.settings.v1', JSON.stringify({ musicTrack: 'polka', volume: 0.3 }));
    const { useUi } = await import('../src/store');
    expect(useUi.getState().settings.musicTrack).toBe('classic');
    expect(musicChoice(undefined)).toBe('classic');
    expect(musicChoice('custom')).toBe('custom');
  });
});

describe('the music picker (settings)', () => {
  const created: string[] = [];
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    created.length = 0;
    URL.createObjectURL = vi.fn(() => {
      const u = `blob:test-${created.length + 1}`;
      created.push(u);
      return u;
    });
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function mount() {
    const store = await import('../src/store');
    const { MusicPicker } = await import('../src/ui/profile/MusicPicker');
    render(<MusicPicker />);
    return store;
  }

  it('lists the tracks, no music and your own music as one radio group', async () => {
    await mount();
    const group = screen.getByRole('radiogroup', { name: 'Music' });
    const names = [...group.querySelectorAll('[role="radio"] .gs-track__name')].map((n) => n.textContent);
    expect(names).toEqual(['Classic', 'Chill', 'Arcade', 'Chiptune', 'Lo-fi', 'No music', 'Your own music']);
    expect(screen.getByRole('radio', { name: /Classic/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('picking a track saves it; no music turns the switch off; a track turns it back on', async () => {
    const { useUi } = await mount();
    fireEvent.click(screen.getByRole('radio', { name: /Chill/ }));
    expect(useUi.getState().settings.musicTrack).toBe('chill');
    expect(screen.getByRole('radio', { name: /Chill/ }).getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem('elymum.settings.v1')!).musicTrack).toBe('chill');
    fireEvent.click(screen.getByRole('radio', { name: /No music/ }));
    expect(useUi.getState().settings.musicOn).toBe(false);
    expect(useUi.getState().settings.musicTrack).toBe('chill');
    expect(screen.getByRole('radio', { name: /No music/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Arcade/ }));
    expect(useUi.getState().settings).toMatchObject({ musicOn: true, musicTrack: 'arcade' });
  });

  it('arrow keys move the pick', async () => {
    const { useUi } = await mount();
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(useUi.getState().settings.musicTrack).toBe('chill');
    expect(document.activeElement?.getAttribute('data-track')).toBe('chill');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(useUi.getState().settings.musicTrack).toBe('classic');
    // wraps onto "your own music": focus only (no file yet, and arrows never open the file dialog)
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('data-track')).toBe('custom');
    expect(useUi.getState().settings.musicTrack).toBe('classic');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(useUi.getState().settings).toMatchObject({ musicTrack: 'classic', musicOn: false });
  });

  it('your own music: a local file plays from a blob URL, never leaves the page, and clears', async () => {
    const { useUi } = await mount();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clicked = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('radio', { name: /Your own music/ }));
    expect(clicked).toHaveBeenCalled();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const file = new File(['RIFF....'], 'Night Drive.mp3', { type: 'audio/mpeg' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await settle();
    });
    expect(useUi.getState().customMusic).toMatchObject({ name: 'Night Drive', url: 'blob:test-1', error: false });
    expect(useUi.getState().settings).toMatchObject({ musicTrack: 'custom', musicOn: true });
    expect(screen.getByRole('radio', { name: /Your own music/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/never uploaded/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    // the saved setting says custom, but the file itself is not in localStorage
    expect(localStorage.getItem('elymum.settings.v1')).not.toContain('blob:');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      await settle();
    });
    expect(useUi.getState().customMusic).toBeNull();
    expect(useUi.getState().settings.musicTrack).toBe('classic');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });

  it('refuses a file that is not audio', async () => {
    const { useUi } = await mount();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
      await settle();
    });
    expect(useUi.getState().customMusic).toBeNull();
    expect(useUi.getState().settings.musicTrack).toBe('classic');
    expect(screen.getByRole('status').textContent).toMatch(/not audio/);
  });

  it('a saved "your own music" with no kept file falls back to the default on start', async () => {
    localStorage.setItem('elymum.settings.v1', JSON.stringify({ musicTrack: 'custom' }));
    const { useUi } = await import('../src/store');
    const { restoreCustomMusic } = await import('../src/audio/custom');
    await restoreCustomMusic();
    expect(useUi.getState().settings.musicTrack).toBe('classic');
  });
});

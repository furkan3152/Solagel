import { describe, expect, it, vi } from 'vitest';
import { Announcer, GLOBAL_COOLDOWN_MS, LINES, LINE_IDS, VariantBag, lineKey, lineText, type LineId } from '../src/audio/announcer';
import { AssetLoader, BufferCache, assetUrls, preferredFormats, type AssetUrls } from '../src/audio/assets';
import { Caller, CHASED_MS, type CallerFx } from '../src/audio/caller';
import { Mixer, prefsFromSettings } from '../src/audio/mixer';
import { CROSSFADE, Music, TENSION_FADE, TRACKS } from '../src/audio/music';
import spec from '../src/audio/lines.json';
import { RoundCues } from '../src/game/roundCues';
import { FakeGain, FakeSource, fakeCtor, fakeFile, flush, type FakeAudioContext } from './fake-audio';

const settings = (patch: Record<string, unknown> = {}) => ({ sound: true, volume: 0.6, ...patch });

async function liveMixer(patch: Record<string, unknown> = {}): Promise<{ mixer: Mixer; ctx: FakeAudioContext }> {
  const { ctx, create } = fakeCtor();
  const mixer = new Mixer(create);
  mixer.apply(prefsFromSettings(settings(patch)));
  mixer.unlock();
  await flush();
  return { mixer, ctx };
}

/** Lets a chain of awaited promises (fetch → decode → play) settle. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};

/** Every line's files, served from memory: `<key>.<fmt>` → "<key>:<seconds>". */
function voiceUrls(): AssetUrls {
  const urls: AssetUrls = {};
  for (const id of LINE_IDS) spec.lines[id].variants.forEach((_, i) => (urls[lineKey(id, i)] = { ogg: `${lineKey(id, i)}.ogg`, m4a: `${lineKey(id, i)}.m4a` }));
  return urls;
}

const serve = (fail: (url: string) => boolean = () => false) =>
  vi.fn(async (url: string) => {
    if (fail(url)) throw new Error('404');
    return fakeFile(`${url}:1.5`);
  });

describe('voice line set', () => {
  it('every event has 2-4 short variants (the countdown has one), no join or death line', () => {
    for (const id of LINE_IDS) {
      const n = spec.lines[id].variants.length;
      if (id === 'countdown') expect(n).toBe(1);
      else {
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(4);
      }
      for (const text of lineText(id)) {
        expect(text.split(/\s+/).length).toBeLessThanOrEqual(7);
        expect(text).not.toMatch(/[^\x20-\x7e]/);
      }
      expect(LINES[id]).toBeTruthy();
    }
    expect(LINE_IDS.some((id) => /join|welcome|start|death|dead|die|killed|eaten/i.test(id))).toBe(false);
    expect(lineText('countdown')).toEqual(['Three! Two! One!']);
    expect(Object.keys(LINES).sort()).toEqual([...LINE_IDS].sort());
  });

  it('every variant ships as Ogg Opus and as AAC (.m4a), and the whole set stays small', () => {
    const urls = assetUrls();
    for (const id of LINE_IDS) spec.lines[id].variants.forEach((_, i) => expect(Object.keys(urls[lineKey(id, i)] ?? {}).sort()).toEqual(['m4a', 'ogg']));
    for (const t of ['lobby', 'game', 'tension']) expect(Object.keys(urls[`music/${t}`] ?? {}).sort()).toEqual(['m4a', 'ogg']);
  });

  it('the bag never repeats a variant back to back and plays each once per round', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bag = new VariantBag(3, random);
    const picks = Array.from({ length: 300 }, () => bag.next());
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    for (let r = 0; r < 100; r++) expect(new Set(picks.slice(r * 3, r * 3 + 3)).size).toBe(3);
    expect(new VariantBag(1).next()).toBe(0);
  });
});

describe('asset loading', () => {
  it('Ogg Opus first where the browser plays it, else AAC first', () => {
    expect(preferredFormats(() => 'probably')).toEqual(['ogg', 'm4a']);
    expect(preferredFormats(() => '')).toEqual(['m4a', 'ogg']);
    expect(preferredFormats(() => {
      throw new Error('no audio element');
    })).toEqual(['m4a', 'ogg']);
  });

  it('maps bundled paths to keys and formats', () => {
    expect(assetUrls({ './assets/voice/paid-2.ogg': '/a.ogg', './assets/voice/paid-2.m4a': '/a.m4a', './assets/music/game.ogg': '/g.ogg', './x.txt': '/x' })).toEqual({
      'voice/paid-2': { ogg: '/a.ogg', m4a: '/a.m4a' },
      'music/game': { ogg: '/g.ogg' },
    });
  });

  it('a file that will not fetch falls back to the other format', async () => {
    const { ctx } = await liveMixer();
    const fetcher = serve((u) => u.endsWith('.ogg'));
    const loader = new AssetLoader({ k: { ogg: 'k.ogg', m4a: 'k.m4a' } }, ['ogg', 'm4a'], fetcher);
    const buf = (await loader.decode(ctx as unknown as AudioContext, 'k')) as unknown as { tag: string };
    expect(buf.tag).toBe('k.m4a:1.5');
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(['k.ogg', 'k.m4a']);
  });

  it('a file that fetches but will not decode (old Safari and Ogg) falls back to AAC', async () => {
    const { ctx } = await liveMixer();
    const fetcher = vi.fn(async (url: string) => fakeFile(url.endsWith('.ogg') ? 'bad ogg' : `${url}:2`));
    const loader = new AssetLoader({ k: { ogg: 'k.ogg', m4a: 'k.m4a' } }, ['ogg', 'm4a'], fetcher);
    const buf = (await loader.decode(ctx as unknown as AudioContext, 'k')) as unknown as { tag: string; duration: number };
    expect(buf.duration).toBe(2);
    // a second decode goes straight to the format that works (the bytes are kept)
    await loader.decode(ctx as unknown as AudioContext, 'k');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ctx.decoded).toEqual(['bad ogg', 'k.m4a:2', 'k.m4a:2']);
  });

  it('nothing works: null, no endless retries', async () => {
    const { ctx } = await liveMixer();
    const fetcher = vi.fn(async () => fakeFile('bad'));
    const loader = new AssetLoader({ k: { ogg: 'k.ogg', m4a: 'k.m4a' } }, ['ogg', 'm4a'], fetcher);
    expect(await loader.decode(ctx as unknown as AudioContext, 'k')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await loader.decode(ctx as unknown as AudioContext, 'missing')).toBeNull();
  });

  it('decoded buffers live in a small LRU', () => {
    const c = new BufferCache(2);
    const b = (n: number) => ({ n }) as unknown as AudioBuffer;
    c.set('a', b(1));
    c.set('b', b(2));
    c.get('a');
    c.set('c', b(3));
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeTruthy();
    expect(c.size).toBe(2);
  });
});

describe('announcer', () => {
  async function make(patch: Record<string, unknown> = {}, fail?: (u: string) => boolean) {
    const { mixer, ctx } = await liveMixer(patch);
    let now = 100_000;
    const fetcher = serve(fail);
    const loader = new AssetLoader(voiceUrls(), ['ogg', 'm4a'], fetcher);
    const a = new Announcer(mixer, { loader, now: () => now, idle: (fn) => fn(), random: () => 0.3 });
    mixer.apply(prefsFromSettings(settings(patch)));
    await settle();
    const voiceSources = () => ctx.sources().filter((s) => s.kind === 'buffer' && (s.buffer as { tag?: string } | null)?.tag?.startsWith('voice/'));
    return { a, mixer, ctx, fetcher, voiceSources, tick: (ms: number) => (now += ms) };
  }

  it('fetches every line in the background after the gesture, then plays them on the voice bus', async () => {
    const { a, mixer, fetcher, voiceSources } = await make();
    const files = LINE_IDS.reduce((n, id) => n + spec.lines[id].variants.length, 0);
    expect(fetcher).toHaveBeenCalledTimes(files);
    expect(fetcher.mock.calls.every((c) => String(c[0]).endsWith('.ogg'))).toBe(true);
    expect(a.say('whale')).toBe(true);
    await settle();
    const src = voiceSources()[0];
    expect((src.buffer as { tag: string }).tag).toMatch(/^voice\/whale-\d\.ogg/);
    // source → line gain → voice bus
    const gain = src.outputs[0] as FakeGain;
    expect(gain.outputs).toContain(mixer.busNode('voice'));
    expect(src.startedAt).not.toBeNull();
  });

  it('nothing is fetched before the first gesture', async () => {
    const { create } = fakeCtor();
    const mixer = new Mixer(create);
    mixer.apply(prefsFromSettings(settings()));
    const fetcher = serve();
    const a = new Announcer(mixer, { loader: new AssetLoader(voiceUrls(), ['ogg', 'm4a'], fetcher), idle: (fn) => fn() });
    expect(a.say('paid')).toBe(false);
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps a 4 s global cooldown and per-line cooldowns', async () => {
    const { a, tick } = await make();
    expect(a.say('firstBite')).toBe(true);
    tick(1000);
    expect(a.say('double')).toBe(false);
    tick(GLOBAL_COOLDOWN_MS);
    expect(a.say('double')).toBe(true);
    tick(GLOBAL_COOLDOWN_MS + 1);
    // first bite again inside its own 30 s cooldown
    expect(a.say('firstBite')).toBe(false);
    tick(LINES.firstBite.cooldown);
    expect(a.say('firstBite')).toBe(true);
    expect(a.log.map((l) => l.id)).toEqual(['firstBite', 'double', 'firstBite']);
  });

  it('variants rotate: the same event twice in a row never reads the same line', async () => {
    const { a, tick } = await make();
    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      expect(a.say('double')).toBe(true);
      seen.push(a.log.at(-1)!.variant);
      tick(LINES.double.cooldown + 1);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBe(3);
  });

  it('round lines are priority: they skip the global cooldown and cut the line talking', async () => {
    const { a, tick, voiceSources } = await make();
    expect(a.say('tenSeconds')).toBe(true);
    await settle();
    const first = voiceSources()[0];
    tick(1000);
    expect(a.say('chased')).toBe(false);
    expect(a.say('countdown')).toBe(true);
    await settle();
    expect(first.stoppedAt).not.toBeNull();
    tick(3000);
    expect(a.say('roundOver')).toBe(true);
    tick(3000);
    expect(a.say('paid')).toBe(true);
    expect(a.log.map((l) => l.id)).toEqual(['tenSeconds', 'countdown', 'roundOver', 'paid']);
  });

  it('is silent with the master mute or the announcer off', async () => {
    expect((await make({ sound: false })).a.say('paid')).toBe(false);
    expect((await make({ announcer: false })).a.say('paid')).toBe(false);
    const { a, mixer } = await make();
    mixer.setHidden(true);
    await flush();
    expect(a.say('paid')).toBe(false);
  });

  it('a line whose files have not arrived is skipped without spending its cooldown', async () => {
    const { a, fetcher, tick } = await make({}, () => true);
    expect(a.say('leader')).toBe(false);
    tick(10);
    expect(a.say('coinRain')).toBe(false);
    // the files fail in both formats: every one was tried once per format, then left alone
    const calls = fetcher.mock.calls.length;
    expect(a.say('leader')).toBe(false);
    await settle();
    expect(fetcher.mock.calls.length).toBe(calls);
  });

  it('falls back to AAC when the browser cannot decode the Ogg files', async () => {
    const { mixer, ctx } = await liveMixer();
    const fetcher = vi.fn(async (url: string) => fakeFile(url.endsWith('.ogg') ? 'bad' : `${url}:1`));
    const a = new Announcer(mixer, { loader: new AssetLoader(voiceUrls(), ['ogg', 'm4a'], fetcher), idle: (fn) => fn(), now: () => 5e5 });
    mixer.apply(prefsFromSettings(settings()));
    await settle();
    expect(a.say('magnet')).toBe(true);
    await settle();
    const played = ctx.sources().filter((s) => (s.buffer as { tag?: string } | null)?.tag);
    expect((played[0].buffer as { tag: string }).tag).toMatch(/^voice\/magnet-\d\.m4a/);
  });

  it('ducks the music while a line plays and lets go when it ends', async () => {
    const { a, mixer, ctx, voiceSources } = await make();
    a.say('whale');
    await settle();
    expect(mixer.isDucked()).toBe(true);
    voiceSources()[0].onended?.();
    ctx.currentTime = 10;
    expect(mixer.isDucked()).toBe(false);
    expect(a.speaking).toBe(false);
  });

  it('stops talking when the announcer is switched off mid-line', async () => {
    const { a, mixer, voiceSources } = await make();
    a.say('comeback');
    await settle();
    expect(a.speaking).toBe(true);
    mixer.apply(prefsFromSettings(settings({ announcer: false })));
    expect(a.speaking).toBe(false);
    expect(voiceSources()[0].stoppedAt).not.toBeNull();
  });
});

describe('music loops', () => {
  const musicUrls: AssetUrls = { 'music/lobby': { ogg: 'lobby.ogg' }, 'music/game': { ogg: 'game.ogg' }, 'music/tension': { ogg: 'tension.ogg' } };

  async function make(patch: Record<string, unknown> = {}) {
    const { ctx, create } = fakeCtor();
    const mixer = new Mixer(create);
    const fetcher = vi.fn(async (url: string) => fakeFile(`${url}:61`));
    const timers: (() => void)[] = [];
    const music = new Music(mixer, { loader: new AssetLoader(musicUrls, ['ogg'], fetcher), setTimer: (fn) => timers.push(fn) });
    mixer.apply(prefsFromSettings(settings(patch)));
    const loops = () => ctx.sources().filter((s): s is FakeSource => s.loop);
    return { ctx, mixer, music, fetcher, loops, timers };
  }

  it('the loops: 60 s lobby and game, a 30 s tension layer (half the game loop), padded files', () => {
    expect(TRACKS.lobby.loop).toBeGreaterThanOrEqual(60);
    expect(TRACKS.game.loop).toBeGreaterThanOrEqual(60);
    expect(TRACKS.tension.loop * 2).toBeCloseTo(TRACKS.game.loop, 6);
    for (const t of Object.values(TRACKS)) expect(t.pad).toBeGreaterThan(0.1);
  });

  it('waits for the gesture, then loops the lobby track seamlessly with a fade-in', async () => {
    const { ctx, mixer, music, fetcher, loops } = await make();
    expect(fetcher).not.toHaveBeenCalled();
    mixer.unlock();
    await settle();
    expect(music.playing).toBe(true);
    const [src] = loops();
    expect((src.buffer as { tag: string }).tag).toBe('lobby.ogg:61');
    expect(src.loopStart).toBe(TRACKS.lobby.pad);
    expect(src.loopEnd).toBeCloseTo(TRACKS.lobby.pad + TRACKS.lobby.loop, 6);
    expect(src.offset).toBe(TRACKS.lobby.pad);
    const gain = src.outputs[0] as FakeGain;
    expect(gain.outputs).toContain(mixer.busNode('music'));
    expect(gain.gain.events[0][1]).toBe(0);
    expect(gain.gain.events.at(-1)![0]).toBe('linear');
    expect(ctx.state).toBe('running');
  });

  it('cross-fades lobby → game over 1.5 s', async () => {
    const { ctx, mixer, music, loops } = await make();
    mixer.unlock();
    await settle();
    ctx.currentTime = 4;
    music.setMood('game');
    await settle();
    const [lobby, game] = loops();
    expect((game.buffer as { tag: string }).tag).toBe('game.ogg:61');
    expect((lobby.outputs[0] as FakeGain).gain.events.at(-1)).toEqual(['linear', 0, 4 + CROSSFADE]);
    expect((game.outputs[0] as FakeGain).gain.events.at(-1)![0]).toBe('linear');
    expect((game.outputs[0] as FakeGain).gain.events.at(-1)![2]).toBeCloseTo(4.05 + CROSSFADE, 6);
    expect(lobby.stoppedAt).toBeCloseTo(4 + CROSSFADE + 0.05, 6);
  });

  it('the tension layer joins the game loop in phase and leaves with the bell', async () => {
    const { ctx, mixer, music, loops } = await make();
    music.setMood('game');
    mixer.unlock();
    await settle();
    const game = loops()[0];
    const t0 = game.startedAt!;
    ctx.currentTime = 241.3;
    music.setTension(true);
    await settle();
    const tension = loops()[1];
    expect((tension.buffer as { tag: string }).tag).toBe('tension.ogg:61');
    const at = tension.startedAt!;
    const phase = (at - t0) % TRACKS.tension.loop;
    expect(tension.offset).toBeCloseTo(TRACKS.tension.pad + phase, 6);
    expect((tension.outputs[0] as FakeGain).gain.events.at(-1)![2]).toBeCloseTo(at + TENSION_FADE, 6);
    music.setTension(false);
    expect(tension.stoppedAt).not.toBeNull();
    // back to the lobby: the tension is gone with the game loop
    music.setTension(true);
    music.setMood('lobby');
    expect(music.tension).toBe(false);
  });

  it('stops when the music is switched off or muted, fades back in when on again', async () => {
    const { mixer, music, loops } = await make();
    mixer.unlock();
    await settle();
    mixer.apply(prefsFromSettings(settings({ musicOn: false })));
    expect(music.playing).toBe(false);
    expect(loops()[0].stoppedAt).not.toBeNull();
    mixer.apply(prefsFromSettings(settings()));
    await settle();
    expect(music.playing).toBe(true);
    expect(loops().length).toBe(2);
    mixer.apply(prefsFromSettings(settings({ sound: false })));
    expect(music.playing).toBe(false);
  });

  it('a loop not heard for a while is released (it decodes again from the kept bytes)', async () => {
    const { mixer, music, loops, timers, fetcher } = await make();
    mixer.unlock();
    await settle();
    music.setMood('game');
    await settle();
    expect(music.holds('lobby')).toBe(true);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    loops()[0].onended?.();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    for (const t of timers) t();
    expect(music.holds('lobby')).toBe(false);
    expect(music.holds('game')).toBe(true);
    music.setMood('lobby');
    await settle();
    expect(fetcher.mock.calls.filter((c) => c[0] === 'lobby.ogg').length).toBe(1);
    expect(music.holds('lobby')).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('caller (game moments)', () => {
  function make() {
    let now = 0;
    const said: LineId[] = [];
    const fx: CallerFx & { calls: string[] } = {
      calls: [],
      chomp: (s) => fx.calls.push(`chomp:${s.toFixed(2)}`),
      danger: () => fx.calls.push('danger'),
      rankUp: (top) => fx.calls.push(`rank:${top}`),
      coinRain: () => fx.calls.push('rain'),
      powerup: () => fx.calls.push('powerup'),
    };
    const c = new Caller((id) => (said.push(id), true), fx, () => now);
    return { c, said, fx, tick: (ms: number) => (now += ms) };
  }

  it('first bite, then double, triple and multi within 4 s; a chomp every time', () => {
    const { c, said, fx, tick } = make();
    c.bite(10, 40);
    tick(1000);
    c.bite(10, 40);
    tick(1000);
    c.bite(10, 40);
    tick(1000);
    c.bite(10, 40);
    tick(5000);
    c.bite(10, 40);
    expect(said).toEqual(['firstBite', 'double', 'triple', 'multi']);
    expect(fx.calls.filter((x) => x.startsWith('chomp')).length).toBe(5);
    expect(fx.calls[0]).toBe('chomp:0.25');
  });

  it('a bite of a coin near my size is a big eat', () => {
    const { c, said, tick } = make();
    c.bite(10, 40);
    tick(8000);
    c.bite(70, 90);
    expect(said).toEqual(['firstBite', 'bigEat']);
  });

  it('whale once a life; a comeback after a big loss', () => {
    const { c, said } = make();
    c.mass(300, 500);
    c.mass(600, 500);
    c.mass(700, 500);
    c.mass(250, 500); // under 45 % of 700
    c.mass(500, 500);
    c.mass(640, 500); // 90 % of 700
    c.mass(650, 500);
    expect(said).toEqual(['whale', 'comeback']);
    c.life();
    c.mass(600, 500);
    expect(said).toEqual(['whale', 'comeback', 'whale']);
  });

  it('up the board: a mallet; to the top: "new king of the ring"', () => {
    const { c, said, fx } = make();
    c.ranked(5, 10); // the first report sets the baseline
    c.ranked(3, 10);
    c.ranked(4, 10);
    c.ranked(1, 10);
    c.ranked(1, 10);
    expect(fx.calls).toEqual(['rank:false', 'rank:true']);
    expect(said).toEqual(['leader']);
    // two players: the top is no story
    c.end();
    c.ranked(2, 2);
    c.ranked(1, 2);
    expect(said).toEqual(['leader']);
  });

  it('chased: a whoosh at once, "watch your back" if it lasts; the phew is the escape', () => {
    const { c, said, fx, tick } = make();
    c.threat(true);
    expect(fx.calls).toEqual(['danger']);
    tick(CHASED_MS - 100);
    c.threat(true);
    expect(said).toEqual([]);
    tick(200);
    c.threat(true);
    c.threat(true);
    expect(said).toEqual(['chased']);
    c.threat(false);
    c.escaped();
    expect(said).toEqual(['chased', 'escape']);
  });

  it('power-ups: magnet and push have their own lines, the rest the generic one', () => {
    const { c, said, fx } = make();
    c.powerUp('magnet');
    c.powerUp('push');
    c.powerUp('other');
    expect(said).toEqual(['magnet', 'push', 'powerUp']);
    expect(fx.calls).toEqual(['powerup', 'powerup', 'powerup']);
    c.coinRain();
    expect(said.at(-1)).toBe('coinRain');
  });

  it('says nothing at a new life or at the end of one', () => {
    const { c, said, fx } = make();
    c.life();
    c.end();
    expect(said).toEqual([]);
    expect(fx.calls).toEqual([]);
  });
});

describe('round cues', () => {
  function make() {
    const said: string[] = [];
    const tension: boolean[] = [];
    const cues = new RoundCues({ tick: () => {}, bell: () => said.push('bell'), say: (l) => said.push(l), tension: (on) => tension.push(on) });
    return { cues, said, tension };
  }

  it('one minute, ten seconds, the countdown, the bell; the tension layer through the final minute', () => {
    const { cues, said, tension } = make();
    let ms = 62_000;
    while (ms > 0) {
      cues.update({ n: 4, msLeft: ms } as never);
      ms -= 500;
    }
    cues.update({ n: 4, msLeft: 0 } as never);
    cues.ring(4);
    expect(said).toEqual(['oneMinute', 'tenSeconds', 'countdown', 'bell', 'roundOver']);
    expect(tension).toEqual([true, false]);
  });

  it('the lobby turns the tension off', () => {
    const { cues, tension } = make();
    cues.update({ n: 1, msLeft: 30_000 } as never);
    cues.update(null);
    expect(tension).toEqual([true, false]);
  });
});

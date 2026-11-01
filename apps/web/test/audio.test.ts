import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer, GLOBAL_COOLDOWN_MS, LINES, pickVoice } from '../src/audio/announcer';
import { AUDIO_DEFAULTS, CEILING, DUCK_GAIN, Mixer, limiterCurve, prefsFromSettings } from '../src/audio/mixer';
import { CROSSFADE, EIGHTH, LOOKAHEAD, Music, phrase } from '../src/audio/music';
import { HOVER_GAP_MS, Sfx, TICK_GAP_MS, rateLimiter } from '../src/audio/sfx';
import { FakeGain, FakeShaper, fakeCtor, flush, type FakeAudioContext } from './fake-audio';

const settings = (patch: Record<string, unknown> = {}) => ({ sound: true, volume: 0.6, ...patch });

async function liveMixer(patch: Record<string, unknown> = {}): Promise<{ mixer: Mixer; ctx: FakeAudioContext }> {
  const { ctx, create } = fakeCtor();
  const mixer = new Mixer(create);
  mixer.apply(prefsFromSettings(settings(patch)));
  mixer.unlock();
  await flush();
  return { mixer, ctx };
}

describe('mixer routing and levels', () => {
  it('builds nothing and plays nothing before the first gesture', () => {
    const { ctx, create } = fakeCtor();
    const mixer = new Mixer(create);
    const sfx = new Sfx(mixer);
    sfx.click();
    expect(mixer.ctx).toBeNull();
    expect(ctx.nodes.length).toBe(1); // only the destination stand-in
    expect(mixer.input('sfx')).toBeNull();
  });

  it('routes music → duck → master → limiter → speakers, sfx and voice → master', async () => {
    const { mixer, ctx } = await liveMixer();
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.outputs.some((o) => o instanceof FakeShaper)) as FakeGain;
    const limiter = master.outputs[0] as FakeShaper;
    expect(limiter.outputs).toContain(ctx.destination);
    const music = mixer.busNode('music') as unknown as FakeGain;
    const duck = music.outputs[0] as FakeGain;
    expect(duck.outputs).toEqual([master]);
    expect((mixer.busNode('sfx') as unknown as FakeGain).outputs).toEqual([master]);
    expect((mixer.busNode('voice') as unknown as FakeGain).outputs).toEqual([master]);
    expect(ctx.state).toBe('running');
    expect(mixer.input('sfx')).toBe(mixer.busNode('sfx'));
  });

  it('defaults are quiet: master 0.6, music 0.25, sfx 0.7, voice 0.5', async () => {
    expect(AUDIO_DEFAULTS).toEqual({ master: 0.6, music: 0.25, sfx: 0.7, voice: 0.5 });
    const { mixer } = await liveMixer();
    expect((mixer.busNode('music') as unknown as FakeGain).gain.value).toBe(0.25);
    expect((mixer.busNode('sfx') as unknown as FakeGain).gain.value).toBe(0.7);
    expect(mixer.level('music')).toBeCloseTo(0.15);
    expect(mixer.level('voice')).toBeCloseTo(0.3);
  });

  it('applies bus levels and switches; the master mute silences every bus', async () => {
    const { mixer } = await liveMixer();
    mixer.apply(prefsFromSettings(settings({ music: 0.5, sfxOn: false, voice: 1 })));
    expect((mixer.busNode('music') as unknown as FakeGain).gain.target).toBe(0.5);
    expect((mixer.busNode('sfx') as unknown as FakeGain).gain.target).toBe(0);
    expect(mixer.input('sfx')).toBeNull();
    expect(mixer.level('voice')).toBeCloseTo(0.6);
    mixer.apply(prefsFromSettings(settings({ sound: false })));
    expect(mixer.level('music')).toBe(0);
    expect(mixer.level('sfx')).toBe(0);
    expect(mixer.level('voice')).toBe(0);
    expect(mixer.input('music')).toBeNull();
  });

  it('clamps stored values and fills missing ones with the defaults', () => {
    const p = prefsFromSettings({ sound: true, volume: 3, music: -1 });
    expect(p.master).toBe(1);
    expect(p.music).toBe(0);
    expect(p.sfx).toBe(0.7);
    expect(p.voiceOn).toBe(true);
  });

  it('the limiter never passes −12 dBFS and leaves quiet signals alone', () => {
    const c = limiterCurve();
    expect(Math.max(...c)).toBeLessThanOrEqual(CEILING + 1e-6);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(-CEILING - 1e-6);
    // input 0.1 (−20 dBFS) passes unchanged
    const i = Math.round(((0.1 + 1) / 2) * (c.length - 1));
    expect(c[i]).toBeCloseTo(((i / (c.length - 1)) * 2 - 1), 3);
  });

  it('sleeps while the tab is hidden and wakes when it is back', async () => {
    const { mixer, ctx } = await liveMixer();
    mixer.setHidden(true);
    await flush();
    expect(ctx.state).toBe('suspended');
    expect(mixer.input('sfx')).toBeNull();
    mixer.setHidden(false);
    await flush();
    expect(ctx.state).toBe('running');
  });

  it('the dev tap connects the limiter output to a MediaStream destination', async () => {
    const { mixer, ctx } = await liveMixer();
    const stream = mixer.tap();
    expect(stream).toBeTruthy();
    const dest = ctx.nodes.find((n) => n.kind === 'stream')!;
    const limiter = ctx.nodes.find((n) => n instanceof FakeShaper && n.outputs.includes(ctx.destination))!;
    expect(limiter.outputs).toContain(dest);
    expect(mixer.tap()).toBe(stream);
  });
});

describe('ducking', () => {
  it('a stinger dips the music by 6 dB, then releases', async () => {
    const { mixer, ctx } = await liveMixer();
    const duck = (mixer.busNode('music') as unknown as FakeGain).outputs[0] as FakeGain;
    mixer.duck(1);
    expect(mixer.isDucked()).toBe(true);
    expect(DUCK_GAIN).toBeCloseTo(0.501, 3);
    const ramps = duck.gain.events.filter((e) => e[0] === 'linear');
    expect(ramps[0][1]).toBeCloseTo(DUCK_GAIN);
    expect(ramps[ramps.length - 1][1]).toBe(1);
    ctx.currentTime = 1.2;
    expect(mixer.isDucked()).toBe(false);
  });

  it('an announcer hold keeps it ducked until released', async () => {
    const { mixer, ctx } = await liveMixer();
    const duck = (mixer.busNode('music') as unknown as FakeGain).outputs[0] as FakeGain;
    mixer.holdDuck(true);
    ctx.currentTime = 30;
    expect(mixer.isDucked()).toBe(true);
    expect(duck.gain.target).toBeCloseTo(DUCK_GAIN);
    mixer.holdDuck(false);
    expect(duck.gain.target).toBe(1);
    ctx.currentTime = 31;
    expect(mixer.isDucked()).toBe(false);
  });

  it('big stingers duck the music by themselves', async () => {
    const { mixer } = await liveMixer();
    new Sfx(mixer).cashout();
    expect(mixer.isDucked()).toBe(true);
  });
});

describe('sfx', () => {
  it('rate-limits hover ticks to 8 per second', async () => {
    const { mixer, ctx } = await liveMixer();
    let now = 0;
    const sfx = new Sfx(mixer, () => now);
    const before = ctx.sources().length;
    let played = 0;
    for (let i = 0; i < 100; i++) {
      const n = ctx.sources().length;
      sfx.hover();
      if (ctx.sources().length > n) played++;
      now += 10; // 100 calls over one second
    }
    expect(HOVER_GAP_MS).toBe(125);
    expect(played).toBeLessThanOrEqual(8);
    expect(played).toBeGreaterThanOrEqual(7);
    expect(ctx.sources().length).toBeGreaterThan(before);
  });

  it('rateLimiter allows one call per gap', () => {
    let t = 0;
    const ok = rateLimiter(100, () => t);
    expect(ok()).toBe(true);
    t = 50;
    expect(ok()).toBe(false);
    t = 100;
    expect(ok()).toBe(true);
  });

  it('respects the master mute and the effects switch', async () => {
    const { mixer, ctx } = await liveMixer({ sound: false });
    const sfx = new Sfx(mixer);
    sfx.punch();
    sfx.stamp('paid');
    expect(ctx.sources().length).toBe(0);
    mixer.apply(prefsFromSettings(settings({ sfxOn: false })));
    sfx.click();
    expect(ctx.sources().length).toBe(0);
    mixer.apply(prefsFromSettings(settings()));
    sfx.click();
    expect(ctx.sources().length).toBeGreaterThan(0);
  });

  it('every voice stays far under the ceiling before the bus gains', async () => {
    const { mixer, ctx } = await liveMixer();
    const sfx = new Sfx(mixer);
    const all: (() => void)[] = [
      () => sfx.click(),
      () => sfx.select(),
      () => sfx.toggle(true),
      () => sfx.rustle(1),
      () => sfx.sheet(true),
      () => sfx.punch(),
      () => sfx.stamp('valid'),
      () => sfx.stamp('paid'),
      () => sfx.tear(),
      () => sfx.whoosh('in'),
      () => sfx.pin('error'),
      () => sfx.chomp(),
      () => sfx.cashout(),
      () => sfx.roundTick(3),
      () => sfx.bell(),
    ];
    for (const f of all) f();
    const peaks = ctx.nodes
      .filter((n): n is FakeGain => n instanceof FakeGain && n.gain.events.length > 0 && n !== (mixer.busNode('music') as unknown as FakeGain))
      .flatMap((g) => g.gain.events.map((e) => e[1]));
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
    // voice gains (not the bus / master / duck levels) top out at 0.2
    const voices = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.outputs.includes(mixer.busNode('sfx') as never));
    for (const v of voices) for (const e of v.gain.events) expect(e[1]).toBeLessThanOrEqual(0.2);
  });
});

describe('round sounds', () => {
  it('the last-seconds tick is quiet and at most one a second; the bell ducks the music', async () => {
    const { mixer, ctx } = await liveMixer();
    let t = 0;
    const sfx = new Sfx(mixer, () => t);
    const before = ctx.sources().length;
    sfx.roundTick(5);
    sfx.roundTick(4); // a late frame in the same second
    expect(ctx.sources().length - before).toBe(2); // one tick: a noise grain and a tone
    t += TICK_GAP_MS;
    sfx.roundTick(4);
    expect(ctx.sources().length - before).toBe(4);
    const tickGains = ctx.nodes
      .filter((n): n is FakeGain => n instanceof FakeGain && n.outputs.includes(mixer.busNode('sfx') as never))
      .flatMap((g) => g.gain.events.map((e) => e[1]));
    expect(Math.max(...tickGains)).toBeLessThanOrEqual(0.04);
    expect(mixer.isDucked()).toBe(false);
    sfx.bell();
    expect(mixer.isDucked()).toBe(true);
  });
});

describe('music', () => {
  it('waits for the gesture, then writes notes ahead on the context clock', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, create } = fakeCtor();
      const mixer = new Mixer(create);
      const music = new Music(mixer);
      mixer.apply(prefsFromSettings(settings()));
      expect(music.playing).toBe(false);
      mixer.unlock();
      await ctx.resume();
      expect(music.playing).toBe(true);
      ctx.currentTime = 5;
      vi.advanceTimersByTime(30);
      const starts = ctx.sources().map((s) => s.startedAt).filter((t): t is number => t !== null && t > 0);
      expect(starts.length).toBeGreaterThan(10);
      // nothing is written further ahead than the lookahead (plus swing)
      expect(Math.max(...starts)).toBeLessThan(5 + LOOKAHEAD + EIGHTH);
      // the grid: eighths of 82 BPM
      expect(music.nextTime).toBeGreaterThanOrEqual(5 + LOOKAHEAD);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cross-fades lobby → game over 1.5 s', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, create } = fakeCtor();
      const mixer = new Mixer(create);
      const music = new Music(mixer);
      mixer.unlock();
      await ctx.resume();
      const layerGains = () => ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.gain.events.some((e) => e[0] === 'linear' && (e[1] === 1 || e[1] === 0)) && n.outputs.length > 0 && n !== (mixer.busNode('music') as unknown as FakeGain));
      const before = layerGains().length;
      ctx.currentTime = 2;
      music.setMood('game');
      const gains = layerGains();
      expect(gains.length).toBe(before + 1);
      const fadeOut = gains[0].gain.events.at(-1)!;
      const fadeIn = gains.at(-1)!.gain.events.at(-1)!;
      expect(fadeOut).toEqual(['linear', 0, 2 + CROSSFADE]);
      expect(fadeIn).toEqual(['linear', 1, 2 + CROSSFADE]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when the music is switched off or the tab is hidden', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, create } = fakeCtor();
      const mixer = new Mixer(create);
      const music = new Music(mixer);
      mixer.unlock();
      await ctx.resume();
      expect(music.playing).toBe(true);
      mixer.apply(prefsFromSettings(settings({ musicOn: false })));
      expect(music.playing).toBe(false);
      mixer.apply(prefsFromSettings(settings()));
      expect(music.playing).toBe(true);
      mixer.setHidden(true);
      expect(music.playing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('melodies stay in F major pentatonic and repeat for the same seed', () => {
    const chord = { bass: 41, pad: [53, 57, 60, 67], tones: [60, 65, 67, 69, 72] };
    const a = phrase(42, chord);
    expect(phrase(42, chord)).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    for (const [, note] of a) expect([0, 2, 5, 7, 9].includes(note % 12)).toBe(true);
  });
});

describe('announcer', () => {
  type Spoken = { text: string; volume: number; voice: SpeechSynthesisVoice | null; rate: number; onstart?: () => void; onend?: () => void };
  let spoken: Spoken[];
  let now: number;
  let voices: SpeechSynthesisVoice[];

  const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

  class FakeUtterance {
    volume = 1;
    rate = 1;
    pitch = 1;
    lang = '';
    voice: SpeechSynthesisVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }

  const synth = () =>
    ({
      speaking: false,
      pending: false,
      getVoices: () => voices,
      speak: (u: Spoken) => spoken.push(u),
      cancel: vi.fn(),
    }) as unknown as SpeechSynthesis;

  async function make(patch: Record<string, unknown> = {}) {
    const { mixer } = await liveMixer(patch);
    const a = new Announcer(mixer, { synth: synth(), Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance, now: () => now });
    return { a, mixer };
  }

  beforeEach(() => {
    spoken = [];
    now = 100_000;
    voices = [voice('Zarvox', 'en-US'), voice('Anna', 'de-DE'), voice('Samantha', 'en-US'), voice('Google UK English Male', 'en-GB', false)];
  });
  afterEach(() => vi.restoreAllMocks());

  it('speaks the spec lines in English with a calm voice at the voice bus level', async () => {
    const { a } = await make();
    expect(a.say('whale')).toBe(true);
    expect(spoken[0].text).toBe('Whale alert.');
    expect(spoken[0].voice?.name).toBe('Samantha');
    expect(spoken[0].rate).toBe(1);
    // voice 0.5 × master 0.6
    expect(spoken[0].volume).toBeCloseTo(0.3);
  });

  it('keeps a 4 s global cooldown and per-line cooldowns', async () => {
    const { a } = await make();
    expect(a.say('firstBite')).toBe(true);
    now += 1000;
    expect(a.say('double')).toBe(false);
    now += GLOBAL_COOLDOWN_MS;
    expect(a.say('double')).toBe(true);
    now += GLOBAL_COOLDOWN_MS + 1;
    // first bite again inside its own 30 s cooldown
    expect(a.say('firstBite')).toBe(false);
    now += LINES.firstBite.cooldown;
    expect(a.say('firstBite')).toBe(true);
    expect(spoken.map((s) => s.text)).toEqual(['First bite!', 'Double!', 'First bite!']);
  });

  it('is silent with no voices, no English voice, the master mute or the announcer off', async () => {
    voices = [];
    expect((await make()).a.say('paid')).toBe(false);
    voices = [voice('Anna', 'de-DE')];
    expect((await make()).a.say('paid')).toBe(false);
    voices = [voice('Samantha', 'en-US')];
    expect((await make({ sound: false })).a.say('paid')).toBe(false);
    expect((await make({ announcer: false })).a.say('paid')).toBe(false);
    expect(spoken).toEqual([]);
    expect((await make()).a.say('paid')).toBe(true);
  });

  it('does nothing before the first gesture or without speech synthesis', async () => {
    const { create } = fakeCtor();
    const mixer = new Mixer(create);
    mixer.apply(prefsFromSettings(settings()));
    const a = new Announcer(mixer, { synth: synth(), Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance, now: () => now });
    expect(a.say('paid')).toBe(false);
    const { mixer: m2 } = await liveMixer();
    expect(new Announcer(m2, { synth: null, Utterance: null }).say('paid')).toBe(false);
  });

  it('ducks the music while a line speaks', async () => {
    const { a, mixer } = await make();
    a.say('whale');
    expect(mixer.isDucked()).toBe(false);
    spoken[0].onstart?.();
    expect(mixer.isDucked()).toBe(true);
    spoken[0].onend?.();
    mixer.ctx && ((mixer.ctx as unknown as FakeAudioContext).currentTime = 10);
    expect(mixer.isDucked()).toBe(false);
  });

  it('reads the round lines under the same cooldown rules', async () => {
    const { a } = await make();
    expect(a.say('oneMinute')).toBe(true);
    now += 50_000;
    expect(a.say('tenSeconds')).toBe(true);
    now += 2_000;
    // the global cooldown holds back a line that comes too soon
    expect(a.say('roundOver')).toBe(false);
    now += 8_000;
    expect(a.say('roundOver')).toBe(true);
    expect(spoken.map((x) => x.text)).toEqual(['One minute left.', 'Ten seconds.', 'Round over.']);
    // once a round at most
    now += GLOBAL_COOLDOWN_MS;
    expect(a.say('roundOver')).toBe(false);
  });

  it('pickVoice prefers calm English voices and skips novelty and other languages', () => {
    expect(pickVoice(voices)?.name).toBe('Samantha');
    expect(pickVoice([voice('Bad News', 'en-US'), voice('Some Voice', 'en-AU')])?.name).toBe('Some Voice');
    expect(pickVoice([voice('Thomas', 'fr-FR')])).toBeNull();
  });
});

describe('audio settings persist', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('defaults and saved per-bus levels round-trip through localStorage', async () => {
    const first = await import('../src/store');
    const s = first.useUi.getState().settings;
    expect([s.volume, s.music, s.sfx, s.voice]).toEqual([0.6, 0.25, 0.7, 0.5]);
    expect([s.sound, s.musicOn, s.sfxOn, s.announcer]).toEqual([true, true, true, true]);
    first.updateSettings({ music: 0.4, announcer: false, sfxOn: false });
    vi.resetModules();
    const second = await import('../src/store');
    const t = second.useUi.getState().settings;
    expect([t.music, t.announcer, t.sfxOn, t.voice]).toEqual([0.4, false, false, 0.5]);
  });

  it('an older save (master only) gains the bus defaults', async () => {
    localStorage.setItem('elymum.settings.v1', JSON.stringify({ sound: false, volume: 0.3 }));
    const { useUi } = await import('../src/store');
    const p = prefsFromSettings(useUi.getState().settings);
    expect(p).toMatchObject({ muted: true, master: 0.3, music: 0.25, sfx: 0.7, voice: 0.5, voiceOn: true });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_DEFAULTS, CEILING, DUCK_GAIN, Mixer, limiterCurve, prefsFromSettings } from '../src/audio/mixer';
import { GAPS, HOVER_GAP_MS, Sfx, TICK_GAP_MS, VOICE_CAP, rateLimiter } from '../src/audio/sfx';
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
      () => sfx.chomp(1),
      () => sfx.cashout(),
      () => sfx.eat(true),
      () => sfx.split(),
      () => sfx.eject(),
      () => sfx.virus(),
      () => sfx.danger(),
      () => sfx.rankUp(true),
      () => sfx.powerup(),
      () => sfx.coinRain(),
      () => sfx.ouch(),
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

describe('game sfx', () => {
  it('food eats are very soft, rate-limited and climb a little scale while they keep coming', async () => {
    const { mixer, ctx } = await liveMixer();
    let t = 0;
    const sfx = new Sfx(mixer, () => t, () => 0.5);
    const freqs: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = ctx.sources().length;
      sfx.eat();
      const made = ctx.sources().slice(before);
      if (made.length) freqs.push(made[0].frequency.events.find((e) => e[0] === 'exp')![1]);
      t += i === 0 ? 10 : GAPS.eat + 5; // the second call comes too soon
      ctx.currentTime += 1; // the voices of the last one have rung out
    }
    expect(freqs.length).toBe(5);
    for (let i = 1; i < freqs.length; i++) expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    const peaks = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.outputs.includes(mixer.busNode('sfx') as never)).flatMap((g) => g.gain.events.map((e) => e[1]));
    expect(Math.max(...peaks)).toBeLessThanOrEqual(0.025);
  });

  it('a busy moment: small sounds give way first, the bell and chomps always play', async () => {
    const { mixer, ctx } = await liveMixer();
    let t = 0;
    const sfx = new Sfx(mixer, () => t);
    // fill the voices (nothing rings out: the fake clock stands still)
    while (sfx.busy() < VOICE_CAP.mid) {
      sfx.chomp(0.5);
      t += GAPS.chomp;
    }
    const n = ctx.sources().length;
    t += 1000;
    sfx.eat();
    sfx.split();
    sfx.danger();
    expect(ctx.sources().length).toBe(n);
    sfx.chomp(1);
    expect(ctx.sources().length).toBeGreaterThan(n);
    const m = ctx.sources().length;
    sfx.bell();
    expect(ctx.sources().length).toBeGreaterThan(m);
    // they ring out: room again
    ctx.currentTime = 10;
    expect(sfx.busy()).toBe(0);
    sfx.eat();
    expect(ctx.sources().length).toBeGreaterThan(m);
  });

  it('per-sound rate limits: one danger whoosh every 4 s', async () => {
    const { mixer, ctx } = await liveMixer();
    let t = 0;
    const sfx = new Sfx(mixer, () => t);
    sfx.danger();
    const n = ctx.sources().length;
    t += 1000;
    sfx.danger();
    expect(ctx.sources().length).toBe(n);
    t += GAPS.danger;
    sfx.danger();
    expect(ctx.sources().length).toBeGreaterThan(n);
  });

  it('game sounds respect the effects switch and the master mute', async () => {
    const { mixer, ctx } = await liveMixer({ sfxOn: false });
    const sfx = new Sfx(mixer);
    sfx.chomp(1);
    sfx.eat();
    sfx.coinRain();
    mixer.apply(prefsFromSettings(settings({ sound: false })));
    sfx.virus();
    sfx.powerup();
    expect(ctx.sources().length).toBe(0);
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

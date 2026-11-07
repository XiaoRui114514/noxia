import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebAudio } from './web';
import type { AudioPlan } from './types';

const plan = (loop = false): AudioPlan => ({
  id: 'test', title: '队列验证', loop,
  steps: [
    { id: 'a', segmentId: 'one', kind: 'speech', text: '你好', rate: 1, volume: 1 },
    { id: 'gap', segmentId: 'one', kind: 'silence', durationMs: 1000, rate: 1, volume: 0 },
    { id: 'b', segmentId: 'two', kind: 'speech', text: 'Good evening', rate: 1, volume: 1 },
  ],
});

class FakeUtterance {
  constructor(public text: string) {}
  voice: unknown = null;
  lang = '';
  rate = 1;
  volume = 1;
  onend?: () => void;
  onerror?: (event: { error: string }) => void;
}

describe('foreground browser speech preview', () => {
  let spoken: FakeUtterance[];
  beforeEach(() => {
    vi.useFakeTimers();
    spoken = [];
    const synth = {
      paused: false, speaking: false,
      getVoices: () => [{ voiceURI: 'zh-test', name: '测试声音', lang: 'zh-CN', localService: true }],
      speak(utterance: FakeUtterance) { this.speaking = true; spoken.push(utterance); },
      cancel() { this.speaking = false; this.paused = false; },
      pause() { this.paused = true; },
      resume() { this.paused = false; },
    };
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('advances using speech completion and actual foreground silence duration', async () => {
    const audio = createWebAudio();
    await audio.prepare(plan());
    audio.play();
    expect(spoken.map(u => u.text)).toEqual(['你好']);
    spoken[0].onend?.();
    expect(audio.getStatus().stepIndex).toBe(1);
    vi.advanceTimersByTime(800);
    expect(spoken).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(spoken.map(u => u.text)).toEqual(['你好', 'Good evening']);
    spoken[1].onend?.();
    expect(audio.getStatus().playing).toBe(false);
    audio.stop();
  });

  it('ignores cancelled utterance callbacks after seeking', async () => {
    const audio = createWebAudio();
    await audio.prepare(plan());
    audio.play();
    const old = spoken[0];
    audio.seek(2.5);
    const current = audio.getStatus().stepIndex;
    old.onend?.();
    expect(audio.getStatus().stepIndex).toBe(current);
    audio.stop();
  });

  it('seeks to an exact prepared step and clamps out-of-range indices', async () => {
    const audio = createWebAudio();
    await audio.prepare(plan());
    audio.play();
    audio.skipStep(2);
    expect(spoken.at(-1)?.text).toBe('Good evening');
    expect(audio.getStatus().stepIndex).toBe(2);
    audio.skipStep(-10);
    expect(spoken.at(-1)?.text).toBe('你好');
    expect(audio.getStatus().stepIndex).toBe(0);
    audio.stop();
  });

  it('stops at the sleep deadline and never treats preview as a persistent audio cache', async () => {
    const audio = createWebAudio();
    await audio.prepare(plan(true));
    audio.setSleepTimer(1, 0);
    audio.play();
    vi.advanceTimersByTime(1200);
    expect(audio.getStatus().playing).toBe(false);
    expect(await audio.getCacheInfo()).toEqual({ count: 0, bytes: 0 });
    audio.stop();
  });

  it('preserves original script while applying pronunciation substitutions to speech', async () => {
    const audio = createWebAudio();
    const value = plan();
    value.pronunciations = { '你好': '您好' };
    await audio.prepare(value);
    audio.play();
    expect(spoken[0].text).toBe('您好');
    expect(value.steps[0].text).toBe('你好');
    audio.stop();
  });

  it('reports the current resource while a multi-resource timeline advances without JavaScript queue rebuilding', async () => {
    const audio = createWebAudio();
    const value = plan();
    value.steps = value.steps.map((step, index) => ({
      ...step,
      resourceId: index < 2 ? 'poetry-one' : 'grammar-two',
      title: index < 2 ? '第一篇' : '第二篇',
      author: index < 2 ? '甲' : '乙',
    }));
    const resources: (string | undefined)[] = [];
    const subscription = audio.addListener('onStatus', status => resources.push(status.resourceId));
    await audio.prepare(value);
    audio.play();
    expect(audio.getStatus().resourceId).toBe('poetry-one');
    spoken[0].onend?.();
    expect(audio.getStatus().resourceId).toBe('poetry-one');
    vi.advanceTimersByTime(1000);
    expect(audio.getStatus().resourceId).toBe('grammar-two');
    expect(resources).toContain('grammar-two');
    audio.skipStep(0);
    expect(audio.getStatus().resourceId).toBe('poetry-one');
    subscription.remove();
    audio.stop();
  });

  it('reports relative progress for the current contiguous resource block, including non-adjacent repeated resources', async () => {
    const audio = createWebAudio();
    const value = plan();
    value.steps = value.steps.map((step, index) => ({ ...step, resourceId: index < 2 ? 'a' : 'b' }));
    value.steps.push({ id: 'a-again', segmentId: 'again', resourceId: 'a', kind: 'speech', text: '再见', rate: 1, volume: 1 });
    await audio.prepare(value);
    expect(audio.getStatus().resourceDuration).toBe(2);
    audio.play();
    spoken[0].onend?.();
    vi.advanceTimersByTime(600);
    expect(audio.getStatus().resourcePosition).toBeCloseTo(1.6);
    vi.advanceTimersByTime(400);
    expect(audio.getStatus().resourceId).toBe('b');
    expect(audio.getStatus().resourcePosition).toBe(0);
    expect(audio.getStatus().resourceDuration).toBe(3);
    audio.skipStep(3);
    expect(audio.getStatus().resourceId).toBe('a');
    expect(audio.getStatus().resourcePosition).toBe(0);
    expect(audio.getStatus().resourceDuration).toBe(1);
    audio.stop();
  });

  it('uses global progress as relative progress for a plan without resource metadata', async () => {
    const audio = createWebAudio();
    await audio.prepare(plan());
    audio.skipStep(2);
    const status = audio.getStatus();
    expect(status.resourcePosition).toBe(status.position);
    expect(status.resourceDuration).toBe(status.duration);
    audio.stop();
  });

  it('does not fabricate browser playback or persistent cache for external file steps', async () => {
    const audio = createWebAudio();
    const key = 'a'.repeat(64);
    const cached = await audio.cacheExternalAudio('SUQzBAAAAAAA', key);
    expect(cached.uri).toMatch(/^data:audio\/mpeg;base64,/);
    expect(await audio.getExternalAudio(key)).toBeNull();
    const value = plan();
    value.steps = [{ id: 'cloud', segmentId: 'one', kind: 'file', uri: cached.uri, text: '你好', rate: 1, volume: 1 }];
    await expect(audio.prepare(value)).rejects.toThrow('不支持云语音音频播放');
    expect(audio.getStatus().playing).toBe(false);
    expect(spoken).toHaveLength(0);
  });

  it('rejects an unavailable browser engine instead of simulating playback', async () => {
    vi.stubGlobal('window', {});
    const audio = createWebAudio();
    await expect(audio.prepare(plan())).rejects.toThrow('不能朗读');
  });
});

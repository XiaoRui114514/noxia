import type { AudioBackend, AudioPlan, AudioStatus, Subscription } from './types';
import { externalAudioDataURI } from './externalAudio';

/** Development preview: browser-owned foreground speech; durations are estimates. */
export function createWebAudio(): AudioBackend {
  let plan: AudioPlan | undefined;
  let status: AudioStatus = { playing: false, position: 0, duration: 0, stepIndex: 0 };
  let durations: number[] = [];
  let starts: number[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let elapsed = 0;
  let lastTick = 0;
  let rate = 1;
  let sleepDeadline = 0;
  const listeners = new Set<(s: AudioStatus) => void>();
  const synth = () => typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const snapshot = (): AudioStatus => {
    const resourceId = plan?.steps[status.stepIndex]?.resourceId;
    let start = 0;
    let end = status.duration;
    if (resourceId && plan) {
      let first = status.stepIndex;
      let last = status.stepIndex;
      while (first > 0 && plan.steps[first - 1].resourceId === resourceId) first--;
      while (last < plan.steps.length - 1 && plan.steps[last + 1].resourceId === resourceId) last++;
      start = starts[first] ?? 0;
      end = (starts[last] ?? start) + (durations[last] ?? 0);
    }
    const resourceDuration = Math.max(0, end - start);
    return {
      ...status, resourceId, resourceDuration,
      resourcePosition: Math.max(0, Math.min(resourceDuration, status.position - start)),
    };
  };
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  const cancel = () => {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    synth()?.cancel();
  };
  const pause = () => {
    status.playing = false;
    synth()?.pause();
    if (timer) clearInterval(timer);
    timer = undefined;
    emit();
  };
  const tick = () => {
    const now = Date.now();
    if (sleepDeadline && now >= sleepDeadline) {
      sleepDeadline = 0;
      pause();
      return;
    }
    elapsed += (now - lastTick) / 1000 * rate;
    lastTick = now;
    const step = plan?.steps[status.stepIndex];
    status.position = (starts[status.stepIndex] ?? 0) + Math.min(elapsed, durations[status.stepIndex] ?? 0);
    emit();
    if (step?.kind === 'silence' && elapsed >= durations[status.stepIndex]) advance();
  };
  const startTimer = () => {
    lastTick = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 200);
  };
  const advance = () => {
    cancel();
    if (!plan) return;
    status.position=(starts[status.stepIndex]??0)+(durations[status.stepIndex]??0);
    emit();
    status.stepIndex++;
    elapsed = 0;
    if (status.stepIndex >= plan.steps.length) {
      if (!plan.loop) {
        status.playing = false;
        status.stepIndex = Math.max(0, plan.steps.length - 1);
        status.position = status.duration;
        emit();
        return;
      }
      status.stepIndex = 0;
    }
    speak();
  };
  const speak = () => {
    const speech = synth();
    if (!speech || !plan) throw new Error('请使用 iOS Development Build；当前环境没有可用的系统语音。');
    const step = plan.steps[status.stepIndex];
    if (!step) return;
    status.playing = true;
    status.position=(starts[status.stepIndex]??0)+elapsed;
    const token = generation;
    startTimer();
    if (step.kind === 'speech') {
      const replacements = Object.entries(plan.pronunciations ?? {}).sort((a, b) => b[0].length - a[0].length);
      let text = step.text ?? '';
      for (const [word, replacement] of replacements) if (word) text = text.split(word).join(replacement);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = speech.getVoices().find(v => v.voiceURI === step.voiceId) ?? null;
      utterance.lang = /[\u3400-\u9fff]/u.test(text) ? 'zh-CN' : 'en-US';
      utterance.rate = Math.max(0.25, Math.min(2, step.rate * rate));
      utterance.volume = Math.max(0, Math.min(1, step.volume));
      utterance.onend = () => { if (token === generation) advance(); };
      utterance.onerror = event => {
        if (token !== generation || event.error === 'canceled' || event.error === 'interrupted') return;
        pause();
        status.error = `浏览器语音失败：${event.error}`;
        emit();
      };
      speech.speak(utterance);
    }
    emit();
  };
  return {
    async listVoices() {
      const speech = synth();
      if (speech && !speech.getVoices().length) {
        await new Promise<void>(resolve => {
          const ready = () => { clearTimeout(timeout); speech.removeEventListener('voiceschanged', ready); resolve(); };
          const timeout = setTimeout(ready, 1500);
          speech.addEventListener('voiceschanged', ready);
        });
      }
      return speech?.getVoices().map(v => ({ id: v.voiceURI, name: v.name, language: v.lang, quality: v.localService ? 'system-local' : 'browser-network', gender: 'unspecified' as const })) ?? [];
    },
    async prepare(nextPlan) {
      if (nextPlan.steps.some(step => step.kind === 'file')) throw new Error('当前网页预览不支持云语音音频播放，请使用 iOS 原生开发构建；系统语音预览仍可使用。');
      cancel();
      if (!synth()) throw new Error('此预览环境不能朗读。请构建 iOS Development Build。');
      if (!nextPlan.steps.length) throw new Error('没有可播放的内容。');
      plan = nextPlan;
      let start = 0;
      starts = [];
      durations = plan.steps.map(step => {
        starts.push(start);
        const duration = step.kind === 'silence' ? (step.durationMs ?? 0) / 1000 : Math.max(1, (step.text?.length ?? 0) / (4 * step.rate));
        start += duration;
        return duration;
      });
      elapsed = 0;
      sleepDeadline = 0;
      status = { playing: false, position: 0, duration: start, stepIndex: 0 };
      emit();
      return { duration: start };
    },
    play() {
      if (status.playing) return;
      if (!plan) return;
      if (status.position >= status.duration) {
        status.stepIndex = 0;
        status.position = 0;
        elapsed = 0;
      }
      if (synth()?.paused && synth()?.speaking) {
        synth()?.resume();
        status.playing = true;
        startTimer();
        emit();
      } else speak();
    },
    pause,
    stop() {
      cancel();
      elapsed = 0;
      sleepDeadline = 0;
      status = { ...status, playing: false, position: 0, stepIndex: 0 };
      emit();
    },
    seek(seconds) {
      if (!plan) return;
      const playing = status.playing;
      cancel();
      let index = 0;
      for (let candidate = 0; candidate < starts.length; candidate++) {
        if (starts[candidate] <= seconds) index = candidate;
      }
      status.stepIndex = index;
      elapsed = 0;
      status.position = starts[status.stepIndex] ?? 0;
      status.playing = false;
      if (playing) speak(); else emit();
    },
    skipStep(index) {
      if (!plan || !Number.isFinite(index)) return;
      const playing = status.playing;
      cancel();
      status.stepIndex = Math.max(0, Math.min(plan.steps.length - 1, Math.trunc(index)));
      elapsed = 0;
      status.position = starts[status.stepIndex] ?? 0;
      status.playing = false;
      if (playing) speak(); else emit();
    },
    setRate(value) { rate = Math.max(0.25, Math.min(2, value)); },
    setSleepTimer(seconds) { sleepDeadline = seconds > 0 ? Date.now() + seconds * 1000 : 0; },
    getStatus() { return snapshot(); },
    async getCacheInfo() { return { count: 0, bytes: 0 }; },
    async clearCache() {},
    async cacheExternalAudio(base64, key) { return { uri: externalAudioDataURI(base64, key) }; },
    async getExternalAudio() { return null; },
    addListener(_event, listener): Subscription {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

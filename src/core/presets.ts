import { Step, StepKind, Template } from './types';

let nextStepId = 0;
export function makeStep(kind: StepKind, overrides: Partial<Step> = {}): Step {
  return {
    id: `step-${Date.now().toString(36)}-${++nextStepId}`,
    kind, repeat: 1, rate: 1, volume: 1,
    durationMs: kind === 'recall' ? 10000 : kind === 'pause' ? 1500 : 0,
    enabled: true, ...overrides,
  };
}

export const presets: Record<'simple' | 'focus' | 'recall' | 'sleep', Template> = {
  simple: {
    id: 'preset-simple', name: '原文译文循环', scope: 'sentence',
    steps: [makeStep('original', { id: 'simple-original' }), makeStep('translation', { id: 'simple-translation' }), makeStep('pause', { id: 'simple-pause', durationMs: 2000 })],
  },
  focus: {
    id: 'preset-focus', name: '逐句精背', scope: 'sentence',
    steps: [makeStep('original', { id: 'focus-original', repeat: 2 }), makeStep('translation', { id: 'focus-translation' }), makeStep('original', { id: 'focus-repeat', repeat: 3 }), makeStep('pause', { id: 'focus-pause', durationMs: 5000 })],
  },
  recall: {
    id: 'preset-recall', name: '留白自背', scope: 'sentence',
    steps: [makeStep('original', { id: 'recall-original' }), makeStep('recall', { id: 'recall-silence', durationMs: 10000 }), makeStep('original', { id: 'recall-answer' })],
  },
  sleep: {
    id: 'preset-sleep', name: '睡前舒缓听读', scope: 'paragraph',
    steps: [makeStep('original', { id: 'sleep-original', rate: 0.8 }), makeStep('pause', { id: 'sleep-pause', durationMs: 3000 })],
  },
};

import { AudioStep, CompileOptions, Plan, Resource, Segment, Template } from './types';
import { validateResource, validateTemplate, ValidationError } from './validation';
import { AUDIO_LIMITS } from './limits';

/** Compile independently cacheable utterances and native silent audio, never one giant TTS string. */
export function compile(input: Resource, inputTemplate: Template, options: CompileOptions = {}): Plan {
  const resource = validateResource(input);
  const template = validateTemplate(inputTemplate);
  if (options.loop !== undefined && typeof options.loop !== 'boolean') throw new ValidationError('循环设置无效');
  if (options.selectedIds && (!Array.isArray(options.selectedIds) || options.selectedIds.some(id => typeof id !== 'string'))) {
    throw new ValidationError('所选句段无效');
  }
  const available = new Set(resource.segments.map(s => s.id));
  if (options.selectedIds?.some(id => !available.has(id))) throw new ValidationError('所选句段已不存在，请重新选择');
  const selected = options.selectedIds ? new Set(options.selectedIds) : undefined;
  const segments = resource.segments.filter(s => !selected || selected.has(s.id));
  if (!segments.length) throw new ValidationError('请至少选择一个句段');
  const steps: AudioStep[] = [];
  const warnings = new Set<string>();
  let characters = 0;
  let silenceMs = 0;
  let cursor = 0;
  while (cursor < segments.length) {
    const start = cursor;
    let end = start + 1;
    if (template.scope === 'document') end = segments.length;
    if (template.scope === 'paragraph') {
      // Missing paragraph metadata never merges unrelated sentences into a fabricated paragraph.
      const paragraph = segments[start].paragraph;
      if (paragraph === undefined) warnings.add('部分句段没有段落对应信息，按独立句段应用模板。');
      else while (end < segments.length && segments[end].paragraph === paragraph) end++;
    }
    const group = segments.slice(start, end);
    let next = end;
    for (const step of template.steps) {
      if (!step.enabled) continue;
      if (step.kind === 'nextSentence') break;
      if (step.kind === 'nextParagraph') {
        const paragraph = segments[start].paragraph;
        if (paragraph === undefined) warnings.add('“下一段”缺少段落对应信息，按下一句处理。');
        else while (next < segments.length && segments[next].paragraph === paragraph) next++;
        break;
      }
      const segmentId = group[0].id;
      if (step.kind === 'pause' || step.kind === 'recall') {
        for (let n = 0; n < step.repeat; n++) {
          silenceMs += step.durationMs;
          append({ id: `${resource.id}:${start}:${step.id}:${n}`, segmentId, kind: 'silence', durationMs: step.durationMs, rate: 1, volume: 0 });
        }
        continue;
      }
      const texts = step.kind === 'custom' ? [step.text ?? ''] : group.map(segment => getText(segment, step.kind));
      if (texts.some(text => !text.trim())) {
        warnings.add(`“${label(step.kind)}”存在缺失内容，已跳过缺失项；未生成或猜测对应文字。`);
      }
      const text = texts.filter(t => t.trim()).join('\n');
      if (!text.trim()) continue;
      if (text.length > AUDIO_LIMITS.maxUtteranceCharacters) throw new ValidationError('单次朗读超过 10000 字符，请改用逐句或按段模板');
      const voiceId = step.voiceId ?? (step.kind === 'translation' ? options.translationVoiceId : undefined) ?? options.voiceId;
      for (let n = 0; n < step.repeat; n++) {
        characters += text.length;
        append({ id: `${resource.id}:${start}:${step.id}:${n}`, segmentId, kind: 'speech', text, voiceId, rate: step.rate, volume: step.volume });
      }
    }
    cursor = next;
  }
  if (!steps.length) throw new ValidationError('没有可播放内容；请补充对应文字或启用其他步骤');
  return {
    id: `${resource.id}:${template.id}`, title: resource.title, author: resource.author,
    steps, loop: options.loop ?? false, warnings: [...warnings],
  };

  function append(step: AudioStep) {
    if (steps.length >= AUDIO_LIMITS.maxSteps || characters > AUDIO_LIMITS.maxSpeechCharacters || silenceMs > AUDIO_LIMITS.maxTimelineMs) {
      throw new ValidationError('编排过长（最多 1000 步、15 万朗读字符或 8 小时留白），请减少重复或拆分列表');
    }
    steps.push(step);
  }
}

function getText(segment: Segment, kind: string): string {
  switch (kind) {
    case 'original': return segment.original;
    case 'translation': return segment.translation ?? '';
    case 'explanation': return segment.explanation ?? '';
    case 'keywords': return Array.isArray(segment.keywords) ? segment.keywords.join('，') : segment.keywords ?? '';
    default: return '';
  }
}

function label(kind: string): string {
  return ({ original: '原文', translation: '译文', explanation: '解释', keywords: '关键词', custom: '自定义文字' } as Record<string, string>)[kind] ?? kind;
}

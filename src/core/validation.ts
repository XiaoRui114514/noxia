import { Resource, Step, StepKind, Template, stepKinds } from './types';
import { AUDIO_LIMITS } from './limits';

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function boundedString(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new ValidationError(`${name}须为${allowEmpty ? '有效' : '非空'}文字，最多 ${max} 字符`);
  }
  return value;
}

function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
    (integer && !Number.isInteger(value))) {
    throw new ValidationError(`${name}须在 ${min}–${max} 之间${integer ? '且为整数' : ''}`);
  }
  return value;
}

export function validateTemplate(value: unknown): Template {
  if (!record(value)) throw new ValidationError('模板须为对象');
  const id = boundedString(value.id, '模板 ID', 200);
  const name = boundedString(value.name, '模板名称', 120);
  if (!['sentence', 'paragraph', 'document'].includes(String(value.scope))) {
    throw new ValidationError('模板应用范围无效');
  }
  const scope = value.scope as Template['scope'];
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 64) {
    throw new ValidationError('模板须包含 1–64 个步骤');
  }
  const seen = new Set<string>();
  let navigationSeen = false;
  const steps: Step[] = value.steps.map((raw, i) => {
    if (!record(raw)) throw new ValidationError(`步骤 ${i + 1} 无效`);
    const id = boundedString(raw.id, '步骤 ID', 200);
    if (seen.has(id)) throw new ValidationError('步骤 ID 不可重复');
    seen.add(id);
    if (!stepKinds.includes(raw.kind as StepKind)) throw new ValidationError('步骤类型无效');
    if (typeof raw.enabled !== 'boolean') throw new ValidationError('步骤启用状态无效');
    const kind = raw.kind as StepKind;
    if (raw.enabled && navigationSeen) throw new ValidationError('“下一句 / 下一段”须放在最后一个启用步骤');
    const navigation = kind === 'nextSentence' || kind === 'nextParagraph';
    if (raw.enabled && navigation) {
      if (scope === 'document') throw new ValidationError('全文模板不能包含“下一句 / 下一段”，请使用逐句或按段范围');
      navigationSeen = true;
    }
    const repeat = number(raw.repeat, '重复次数', 1, 20, true);
    if (navigation && repeat !== 1) throw new ValidationError('导航步骤重复次数须为 1');
    const text = raw.text === undefined ? undefined : boundedString(raw.text, '自定义文字', AUDIO_LIMITS.maxUtteranceCharacters, true);
    if (raw.enabled && kind === 'custom' && !text?.trim()) throw new ValidationError('自定义朗读文字不能为空');
    const voiceId = raw.voiceId === undefined ? undefined : boundedString(raw.voiceId, '声音 ID', 300);
    const durationMs = number(raw.durationMs, '留白 / 停顿时长', 0, AUDIO_LIMITS.maxSilenceMs, true);
    if (raw.enabled && (kind === 'pause' || kind === 'recall') && durationMs < AUDIO_LIMITS.minSilenceMs) {
      throw new ValidationError('启用的留白 / 停顿时长须为 50–600000 毫秒；无需停顿请关闭该步骤');
    }
    return {
      id, kind, enabled: raw.enabled, repeat, text, voiceId,
      rate: number(raw.rate, '语速', 0.25, 2),
      volume: number(raw.volume, '音量', 0, 1),
      durationMs,
    };
  });
  if (!steps.some(s => s.enabled && !s.kind.startsWith('next'))) throw new ValidationError('至少启用一个朗读或停顿步骤');
  return { id, name, scope, steps };
}

/** Return a fresh whitelisted object, never retain imported prototypes or unknown fields. */
export function validateResource(value: unknown): Resource {
  if (!record(value)) throw new ValidationError('学习材料须为对象');
  const id = boundedString(value.id, '材料 ID', 300);
  const title = boundedString(value.title, '材料标题', 500);
  if (!['poetry', 'grammar', 'custom'].includes(String(value.kind))) throw new ValidationError('材料类型无效');
  if (!Array.isArray(value.segments) || !value.segments.length || value.segments.length > 2000) {
    throw new ValidationError('材料须包含 1–2000 个已对应的句段');
  }
  const ids = new Set<string>();
  let characters = 0;
  const segments = value.segments.map(raw => {
    if (!record(raw)) throw new ValidationError('句段无效');
    const id = boundedString(raw.id, '句段 ID', 300);
    if (ids.has(id)) throw new ValidationError('句段 ID 不可重复');
    ids.add(id);
    const original = boundedString(raw.original, '原文', AUDIO_LIMITS.maxUtteranceCharacters, true);
    const translation = raw.translation === undefined ? undefined : boundedString(raw.translation, '译文', AUDIO_LIMITS.maxUtteranceCharacters, true);
    const explanation = raw.explanation === undefined ? undefined : boundedString(raw.explanation, '解释', AUDIO_LIMITS.maxUtteranceCharacters, true);
    let keywords: string | string[] | undefined;
    if (Array.isArray(raw.keywords)) {
      if (raw.keywords.length > 100) throw new ValidationError('关键词过多');
      keywords = raw.keywords.map(k => boundedString(k, '关键词', 1000));
    } else if (raw.keywords !== undefined) keywords = boundedString(raw.keywords, '关键词', 4000, true);
    characters += original.length + (translation?.length ?? 0) + (explanation?.length ?? 0) + (keywords?.length ?? 0);
    if (characters > 1000000) throw new ValidationError('材料超过 100 万字符，请分批导入');
    if (raw.important !== undefined && typeof raw.important !== 'boolean') throw new ValidationError('重点标记无效');
    const paragraph = raw.paragraph === undefined ? undefined : number(raw.paragraph, '段落序号', 0, 100000, true);
    return { id, original, translation, explanation, keywords, important: raw.important as boolean | undefined, paragraph };
  });
  const author = value.author === undefined ? undefined : boundedString(value.author, '作者', 500, true);
  if (value.generated !== undefined && typeof value.generated !== 'boolean') throw new ValidationError('生成标记无效');
  let source: Resource['source'];
  if (value.source !== undefined) {
    if (!record(value.source)) throw new ValidationError('来源无效');
    source = {
      repo: boundedString(value.source.repo, '来源仓库', 300),
      path: boundedString(value.source.path, '来源路径', 1000),
      version: boundedString(value.source.version, '资源版本', 200),
      url: boundedString(value.source.url, '来源链接', 2000),
    };
  }
  return { id, title, author, kind: value.kind as Resource['kind'], segments, source, generated: value.generated as boolean | undefined };
}

export function parseTemplate(json: string): Template {
  if (json.length > 200000) throw new ValidationError('模板文件过大');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new ValidationError('模板不是有效 JSON'); }
  return validateTemplate(value);
}

export function exportTemplate(template: Template): string {
  return JSON.stringify(validateTemplate(template), null, 2);
}

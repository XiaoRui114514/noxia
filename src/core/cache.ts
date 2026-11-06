import { ValidationError } from './validation';

export interface SpeechCacheIdentity {
  text: string;
  provider: string;
  model: string;
  modelVersion: string;
  voiceId: string;
  language?: string;
  rate: number;
  volume: number;
  pitch?: number;
  pronunciation?: Record<string, string>;
  format?: string;
}

/** Hash this canonical string with SHA-256 before using it as a filename. Repeats are intentionally excluded. */
export function canonicalSpeechCacheKey(identity: SpeechCacheIdentity): string {
  const { text, provider, model, modelVersion, voiceId, language, rate, volume, pitch, pronunciation, format } = identity;
  if ([text, provider, model, modelVersion, voiceId].some(s => typeof s !== 'string' || !s.length)) {
    throw new ValidationError('音频缓存身份缺少文字、来源、模型版本或声音');
  }
  if (![rate, volume, pitch ?? 1].every(Number.isFinite)) throw new ValidationError('音频缓存参数无效');
  const dictionary = Object.entries(pronunciation ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (dictionary.some(([key, value]) => !key || typeof value !== 'string')) throw new ValidationError('发音词典无效');
  return JSON.stringify({ schema: 1, text, provider, model, modelVersion, voiceId, language: language ?? '', rate, volume, pitch: pitch ?? 1, dictionary, format: format ?? 'wav' });
}

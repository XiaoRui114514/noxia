import { describe, expect, it } from 'vitest';
import {
  canonicalSpeechCacheKey, compile, exportTemplate, makeStep,
  parseTemplate, presets, Resource, Template, validateResource, validateTemplate,
} from './index';

const resource: Resource = {
  id: 'r', title: '独立编写的测试材料', kind: 'custom',
  segments: [
    { id: 'a', original: '第一句。', translation: 'First.', paragraph: 0, keywords: ['一', '句'] },
    { id: 'b', original: '第二句。', translation: 'Second.', paragraph: 0 },
    { id: 'c', original: '第三句。', paragraph: 1 },
  ],
};
const template = (steps: Template['steps'], scope: Template['scope'] = 'sentence'): Template => ({ id: 't', name: '测试', scope, steps });
const original = () => makeStep('original');

describe('structured playback compiler', () => {
  it('preserves exact source/translation ordering, repeat count, and native silence', () => {
    const plan = compile(resource, template([
      original(), makeStep('translation'), makeStep('original', { repeat: 3 }), makeStep('pause', { durationMs: 5000 }),
    ]));
    expect(plan.steps.slice(0, 6).map(s => s.text ?? s.durationMs)).toEqual(['第一句。', 'First.', '第一句。', '第一句。', '第一句。', 5000]);
    expect(plan.steps[5]).toMatchObject({ kind: 'silence', segmentId: 'a', volume: 0 });
    expect(plan.steps[6].text).toBe('第二句。');
    expect(plan.warnings).toHaveLength(1);
    expect(plan.steps.every(s => s.id)).toBe(true);
    expect(new Set(plan.steps.map(s => s.id)).size).toBe(plan.steps.length);
  });

  it('applies separate original/translation voices and per-step overrides', () => {
    const plan = compile(resource, template([original(), makeStep('translation'), makeStep('custom', { text: '提示', voiceId: 'special', rate: 0.8, volume: 0.5 })]), { selectedIds: ['a'], voiceId: 'zh', translationVoiceId: 'en' });
    expect(plan.steps.map(s => s.voiceId)).toEqual(['zh', 'en', 'special']);
    expect(plan.steps[2]).toMatchObject({ rate: 0.8, volume: 0.5 });
  });

  it('uses exact selected IDs in source order and never invents missing translations', () => {
    const plan = compile(resource, template([makeStep('translation')]), { selectedIds: ['c', 'a'] });
    expect(plan.steps.map(s => s.text)).toEqual(['First.']);
    expect(plan.warnings[0]).toContain('缺失');
    expect(() => compile(resource, template([makeStep('translation')]), { selectedIds: ['c'] })).toThrow('没有可播放内容');
    expect(() => compile(resource, template([original()]), { selectedIds: [] })).toThrow('至少选择');
    expect(() => compile(resource, template([original()]), { selectedIds: ['removed'] })).toThrow('已不存在');
  });

  it('groups only explicit adjacent paragraph IDs', () => {
    const plan = compile(resource, template([original()], 'paragraph'));
    expect(plan.steps.map(s => s.text)).toEqual(['第一句。\n第二句。', '第三句。']);
    const missing: Resource = { ...resource, segments: [{ id: 'x', original: '甲' }, { id: 'y', original: '乙' }] };
    const fallback = compile(missing, template([original()], 'paragraph'));
    expect(fallback.steps.map(s => s.text)).toEqual(['甲', '乙']);
    expect(fallback.warnings).toHaveLength(1);
  });

  it('supports explicit next-paragraph navigation without repeating skipped sentences', () => {
    const plan = compile(resource, template([original(), makeStep('nextParagraph')]));
    expect(plan.steps.map(s => s.text)).toEqual(['第一句。', '第三句。']);
  });

  it('provides a working next-sentence terminal and document scope', () => {
    expect(compile(resource, template([original(), makeStep('nextSentence')])).steps.map(s => s.segmentId)).toEqual(['a', 'b', 'c']);
    expect(compile(resource, template([original()], 'document')).steps[0].text).toBe('第一句。\n第二句。\n第三句。');
    expect(() => compile(resource, template([original(), makeStep('nextSentence')], 'document'))).toThrow('全文模板');
    expect(() => compile(resource, template([makeStep('nextSentence'), original()]))).toThrow('最后');
  });

  it('keeps active recall as native silence and never requests microphone input', () => {
    const plan = compile(resource, presets.recall, { selectedIds: ['a'], loop: true });
    expect(plan.steps.map(s => s.kind)).toEqual(['speech', 'silence', 'speech']);
    expect(plan.steps[1].durationMs).toBe(10000);
    expect(plan.loop).toBe(true);
    expect(plan.steps[0].text).toBe(plan.steps[2].text);
  });

  it('ignores disabled steps and preserves keyword hints', () => {
    const plan = compile(resource, template([makeStep('translation', { enabled: false }), makeStep('pause', { durationMs: 0, enabled: false }), makeStep('keywords')]), { selectedIds: ['a'] });
    expect(plan.steps.map(s => s.text)).toEqual(['一，句']);
  });

  it('bounds expansion before excessive repeat plans reach native audio', () => {
    const big: Resource = { ...resource, segments: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), original: '测试' })) };
    expect(() => compile(big, template([makeStep('original', { repeat: 20 })]))).toThrow('编排过长');
    expect(() => compile(resource, template([makeStep('original', { repeat: Infinity })]))).toThrow('重复次数');
    expect(() => compile(resource, template([makeStep('original', { rate: NaN })]))).toThrow('语速');
    expect(() => compile(resource, template([makeStep('pause', { durationMs: 600001 })]))).toThrow('时长');
  });

  it('rejects oversized utterances and keeps source input immutable', () => {
    const long = { ...resource, segments: [{ id: 'x', original: '甲'.repeat(10000) }, { id: 'y', original: '乙'.repeat(10000) }] };
    expect(() => compile(long, template([original()], 'document'))).toThrow('10000');
    const input = structuredClone(resource);
    compile(input, presets.recall);
    expect(input).toEqual(resource);
  });

  it('matches native step boundary: 1000 accepted, 1001 rejected', () => {
    const big: Resource = { ...resource, segments: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), original: '甲' })) };
    expect(compile(big, template([original()])).steps).toHaveLength(1000);
    expect(() => compile({ ...big, segments: [...big.segments, { id: '1001', original: '乙' }] }, template([original()]))).toThrow('1000 步');
  });

  it('matches native speech boundaries: single 10000 and total 150000 accepted', () => {
    const long: Resource = { ...resource, segments: [{ id: 'a', original: '甲'.repeat(10000) }] };
    expect(compile(long, template([makeStep('original', { repeat: 15 })])).steps).toHaveLength(15);
    expect(() => compile(long, template([makeStep('original', { repeat: 16 })]))).toThrow('15 万');
    expect(() => compile({ ...long, segments: [{ id: 'a', original: '甲'.repeat(10001) }] }, template([original()]))).toThrow('10000');
    const exact = { ...resource, segments: [{ id: 'a', original: '甲'.repeat(10000) }, { id: 'b', original: '乙'.repeat(5000) }] };
    expect(compile(exact, template([makeStep('original', { repeat: 10 })])).steps).toHaveLength(20);
    expect(() => compile({ ...exact, segments: [...exact.segments, { id: 'c', original: '丙' }] }, template([makeStep('original', { repeat: 10 })]))).toThrow('15 万');
  });

  it('matches native silence bounds and leaves zero duration valid for speech fields', () => {
    expect(compile(resource, template([makeStep('pause', { durationMs: 50 })]), { selectedIds: ['a'] }).steps[0].durationMs).toBe(50);
    expect(compile(resource, template([makeStep('recall', { durationMs: 600000 })]), { selectedIds: ['a'] }).steps[0].durationMs).toBe(600000);
    for (const durationMs of [0, 1, 49, 600001]) {
      expect(() => compile(resource, template([makeStep('pause', { durationMs })]))).toThrow('时长');
    }
    expect(compile(resource, template([makeStep('original', { durationMs: 0 })])).steps).toHaveLength(3);
  });

  it('caps total silence at native eight-hour timeline ceiling', () => {
    const steps = [makeStep('pause', { durationMs: 600000, repeat: 20 }), makeStep('pause', { durationMs: 600000, repeat: 20 }), makeStep('pause', { durationMs: 600000, repeat: 8 })];
    expect(compile(resource, template(steps), { selectedIds: ['a'] }).steps).toHaveLength(48);
    expect(() => compile(resource, template([...steps, makeStep('pause', { durationMs: 50 })]), { selectedIds: ['a'] })).toThrow('8 小时');
  });
});

describe('template and resource trust boundary', () => {
  it('round trips whitelisted JSON and removes unknown fields', () => {
    const imported = parseTemplate(JSON.stringify({ ...presets.recall, secret: 'not retained' }));
    expect(imported).not.toHaveProperty('secret');
    expect(parseTemplate(exportTemplate(imported))).toEqual(imported);
    expect(() => parseTemplate('{invalid')).toThrow('有效 JSON');
    expect(() => parseTemplate(' '.repeat(200001))).toThrow('过大');
  });

  it('rejects negative, fractional, nonfinite and ambiguous settings', () => {
    for (const repeat of [-1, 0, 1.2, 21, NaN]) {
      expect(() => validateTemplate(template([makeStep('original', { repeat })]))).toThrow();
    }
    expect(() => validateTemplate(template([makeStep('original', { volume: 1.1 })]))).toThrow('音量');
    expect(() => validateTemplate(template([makeStep('custom')]))).toThrow('不能为空');
    expect(() => validateTemplate(template([makeStep('original', { enabled: false })]))).toThrow('至少启用');
    expect(() => validateTemplate(template([makeStep('original', { id: 'same' }), makeStep('pause', { id: 'same' })]))).toThrow('不可重复');
  });

  it('does not accept duplicate source IDs or wrong-shaped metadata', () => {
    expect(() => validateResource({ ...resource, segments: [resource.segments[0], resource.segments[0]] })).toThrow('不可重复');
    expect(() => validateResource({ ...resource, segments: [{ id: 's', original: 1 }] })).toThrow('原文');
    expect(() => validateResource({ ...resource, generated: 'true' })).toThrow('生成标记');
  });
});

describe('speech cache identity', () => {
  const base = { text: '重读', provider: 'apple', model: 'AVSpeech', modelVersion: 'iPadOS-18', voiceId: 'zh', rate: 1, volume: 1 };
  it('is independent of dictionary insertion order and repeat count', () => {
    expect(canonicalSpeechCacheKey({ ...base, pronunciation: { 重: 'chong', 行: 'xing' } })).toBe(canonicalSpeechCacheKey({ ...base, pronunciation: { 行: 'xing', 重: 'chong' } }));
    expect(canonicalSpeechCacheKey(base)).toBe(canonicalSpeechCacheKey({ ...base }));
  });
  it('invalidates when synthesis-affecting parameters change', () => {
    const before = canonicalSpeechCacheKey(base);
    for (const changed of [{ text: '重读。' }, { voiceId: 'en' }, { modelVersion: '19' }, { provider: 'other' }, { rate: 0.8 }, { volume: 0.5 }, { pitch: 0.7 }, { pronunciation: { 重: 'zhong' } }]) {
      expect(canonicalSpeechCacheKey({ ...base, ...changed })).not.toBe(before);
    }
    expect(() => canonicalSpeechCacheKey({ ...base, rate: Infinity })).toThrow();
  });
});

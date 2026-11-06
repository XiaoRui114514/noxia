import { describe, expect, it } from 'vitest';
import {
  adaptGrammar, adaptPoetry, listRemoteResources, loadRemoteResource, parseGrammarSource, resourceSources,
  type ResourceEntry,
} from './index';

const poetry: ResourceEntry = {
  id: 'poetry:fictional', title: '虚构示例', kind: 'poetry', repo: resourceSources.poetry.repo,
  version: resourceSources.poetry.version, path: 'meta/poems.json', licenseUrl: 'https://example.invalid/LICENSE',
};
const grammar: ResourceEntry = {
  id: 'grammar:tense01', title: '虚构知识卡', kind: 'grammar', repo: resourceSources.grammar.repo,
  version: resourceSources.grammar.version, path: 'data/bank-tense-01.js', licenseUrl: 'https://example.invalid/LICENSE',
};
const meta = { id: 'fictional', title: '虚构示例', author: '测试作者', sentences: ['山中有一盏灯。', '灯下有一本书。'], examFocus: [{ index: 1, reason: '自定义重点' }] };

describe('resource provenance and alignment', () => {
  it('keeps explicit sentence IDs and exam focus without splitting source text', () => {
    const result = adaptPoetry(meta, { id: 'fictional', translations: ['译文甲', '译文乙'] }, poetry);
    expect(result.segments[1]).toMatchObject({ id: 'fictional:1', original: meta.sentences[1], translation: '译文乙', important: true });
    expect(result.attribution).toContain('Hison');
    expect(result.source?.version).toBe(resourceSources.poetry.version);
  });
  it('never attaches truncated or foreign translations to source sentences', () => {
    const truncated = adaptPoetry(meta, { id: 'fictional', translations: ['一条'] }, poetry);
    const foreign = adaptPoetry(meta, { id: 'another', translations: ['甲', '乙'] }, poetry);
    for (const result of [truncated, foreign]) {
      expect(result.segments.every(segment => segment.translation === undefined)).toBe(true);
      expect(result.warnings?.join()).toContain('停止逐句配对');
    }
  });
  it('refuses poetry without explicit sentence arrays', () => {
    expect(() => adaptPoetry({ id: 'fictional', title: '测试', text: '句子。句子。' }, undefined, poetry)).toThrow('显式原文句子');
  });
  it('requires personal licence acknowledgement before any network request', async () => {
    await expect(listRemoteResources('poetry', { acceptPersonalUseLicense: false, fetcher: (() => { throw new Error('network should not run'); }) as typeof fetch })).rejects.toThrow('许可');
  });
  it('rejects arbitrary download hosts, commits and paths', async () => {
    await expect(loadRemoteResource({ ...poetry, repo: 'attacker/project' }, { acceptPersonalUseLicense: true })).rejects.toThrow('未被审查');
    await expect(loadRemoteResource({ ...grammar, path: '../../secret' }, { acceptPersonalUseLicense: true })).rejects.toThrow('路径');
  });
});

describe('untrusted grammar scripts', () => {
  it('reads only the registered JSON5 data object, respecting quoted braces and comments', () => {
    const script = `window.__GRAMMAR_LAB__.tense01 = {id:'tense01', title:'测试 }', /* } */ knowledgeCard:{oneLine:'例子', examples:['A { B']}}; throw new Error('never run');`;
    const result = adaptGrammar(parseGrammarSource(script, 'tense01'), grammar);
    expect(result.title).toBe('测试 }');
    expect(result.segments.map(item => item.original)).toEqual(['例子', 'A { B']);
  });
  it('rejects executable expressions and mismatched IDs instead of evaluating JavaScript', () => {
    expect(() => parseGrammarSource(`window.__GRAMMAR_LAB__.tense01={id:'tense01', title:(()=>{throw 1})()}`, 'tense01')).toThrow();
    expect(() => parseGrammarSource(`window.__GRAMMAR_LAB__.tense01=fetch('secret')`, 'tense01')).toThrow('数据对象');
    expect(() => adaptGrammar({ id: 'tense02', title: '错误专题', knowledgeCard: {} }, grammar)).toThrow('ID');
  });
});

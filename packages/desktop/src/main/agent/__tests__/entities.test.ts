// ================================
// 实体抽取纯函数测试：实体名规范化、模型输出校验、多段结果合并、长文本分段
// ================================

import { describe, it, expect } from 'vitest';
import {
  ENTITY_SYSTEM_PROMPT,
  cleanEntityName,
  mergeEntityChunks,
  mergeRelations,
  normalizeEntityName,
  parseEntityResponse,
  parseRelationResponse,
  relationKey,
  type ExtractedEntity,
  type ExtractedRelation,
} from '../entities';
import { parseConfidence } from '../json-output';
import { RELATION_TYPES } from '../relation-types';
import { chunkText } from '../text-chunks';

describe('实体名规范化', () => {
  it('去掉包裹符号、统一全半角与空白，大小写不敏感', () => {
    expect(cleanEntityName('  《三体》 ')).toBe('三体');
    expect(cleanEntityName('“Open  AI”')).toBe('Open AI');
    expect(normalizeEntityName('ＯｐｅｎＡＩ')).toBe(normalizeEntityName('openai'));
  });
});

describe('parseEntityResponse', () => {
  it('未知类型归为 other，无效条目丢弃，mentions 取正整数', () => {
    const entities = parseEntityResponse({
      entities: [
        { name: '张三', type: 'Person', mentions: 2.6 },
        { name: 'Rust', type: 'language' },
        { name: '', type: 'concept' },
        { name: 'x'.repeat(200), type: 'concept' },
        { name: '北京', type: 'place', mentions: -3 },
        { type: 'person' },
        'garbage',
      ],
    });
    expect(entities).toEqual([
      { name: '张三', type: 'person', mentions: 3 },
      { name: 'Rust', type: 'other', mentions: 1 },
      { name: '北京', type: 'place', mentions: 1 },
    ]);
  });

  it('缺少 entities 数组时抛错', () => {
    expect(() => parseEntityResponse({ result: [] })).toThrow('entities');
  });
});

describe('mergeEntityChunks', () => {
  it('按规范化名称去重并累加次数，显示名与类型取加权多数，具体类型优先于 other', () => {
    const merged = mergeEntityChunks([
      [
        { name: 'OpenAI', type: 'other', mentions: 5 },
        { name: '张三', type: 'person', mentions: 1 },
      ],
      [
        { name: 'openai', type: 'organization', mentions: 1 },
        { name: 'OpenAI', type: 'other', mentions: 1 },
      ],
      [{ name: '张三', type: 'work', mentions: 3 }],
    ]);
    expect(merged).toEqual([
      { name: 'OpenAI', type: 'organization', mentions: 7 },
      { name: '张三', type: 'work', mentions: 4 },
    ]);
  });

  it('全部为 other 时保留 other；空输入返回空数组', () => {
    expect(mergeEntityChunks([[{ name: 'X', type: 'other', mentions: 1 }]])).toEqual([
      { name: 'X', type: 'other', mentions: 1 },
    ]);
    expect(mergeEntityChunks([])).toEqual([]);
  });
});

describe('parseConfidence', () => {
  it('数字或数字字符串截取到 [0, 1]，其余返回 null', () => {
    expect(parseConfidence(0.7)).toBe(0.7);
    expect(parseConfidence('0.9')).toBe(0.9);
    expect(parseConfidence(3)).toBe(1);
    expect(parseConfidence(-1)).toBe(0);
    expect(parseConfidence('高')).toBeNull();
    expect(parseConfidence('')).toBeNull();
    expect(parseConfidence(undefined)).toBeNull();
    expect(parseConfidence(Number.NaN)).toBeNull();
  });
});

describe('parseRelationResponse', () => {
  const entities: ExtractedEntity[] = [
    { name: 'OpenAI', type: 'organization', mentions: 2 },
    { name: '张三', type: 'person', mentions: 1 },
    { name: 'GPT-4', type: 'work', mentions: 1 },
  ];
  const chunk = '张三在  OpenAI 工作。\nOpenAI 发布了 GPT-4。';

  it('提示词要求输出 relations 并列出全部关系类型', () => {
    expect(ENTITY_SYSTEM_PROMPT).toContain('"relations"');
    for (const type of RELATION_TYPES) expect(ENTITY_SYSTEM_PROMPT).toContain(type);
  });

  it('端点必须在本次实体集合内（按规范化名称），丢弃自环与无效条目', () => {
    const relations = parseRelationResponse(
      {
        relations: [
          { source: '《张三》', target: 'openai', type: 'member-of', label: '任职于', evidence: '张三在 OpenAI 工作。', confidence: 0.9 },
          { source: 'OpenAI', target: '微软', type: 'related-to' },
          { source: 'OpenAI', target: 'OPENAI', type: 'uses' },
          { source: 'OpenAI' },
          'garbage',
        ],
      },
      entities,
      chunk
    );
    expect(relations).toEqual([
      {
        source: '张三',
        target: 'OpenAI',
        type: 'member-of',
        label: '任职于',
        // 证据按规范化后的空白匹配正文
        evidence: '张三在 OpenAI 工作。',
        confidence: 0.9,
      },
    ]);
  });

  it('未知类型归为 related-to 并按名称排序端点；编造的证据与过长标签丢弃，置信度默认 0.5', () => {
    const [relation] = parseRelationResponse(
      {
        relations: [
          { source: 'OpenAI', target: 'GPT-4', type: 'Founded', label: '很长'.repeat(20), evidence: 'OpenAI 收购了 GPT-4' },
        ],
      },
      entities,
      chunk
    );
    expect(relation).toEqual({
      source: 'GPT-4',
      target: 'OpenAI',
      type: 'related-to',
      label: null,
      evidence: null,
      confidence: 0.5,
    });
  });

  it('过长的证据截断', () => {
    const sentence = `OpenAI 发布了 GPT-4${'，并做了很多事'.repeat(40)}`;
    const [relation] = parseRelationResponse(
      { relations: [{ source: 'OpenAI', target: 'GPT-4', type: 'created', evidence: sentence }] },
      entities,
      sentence
    );
    expect(relation.evidence).toHaveLength(200);
    expect(relation.evidence!.endsWith('…')).toBe(true);
  });

  it('缺少 relations 视为没有关系，不是数组时抛错', () => {
    expect(parseRelationResponse({ entities: [] }, entities, chunk)).toEqual([]);
    expect(() => parseRelationResponse({ relations: {} }, entities, chunk)).toThrow('relations');
  });
});

describe('mergeRelations', () => {
  const relation = (overrides: Partial<ExtractedRelation>): ExtractedRelation => ({
    source: 'OpenAI',
    target: 'GPT-4',
    type: 'created',
    label: null,
    evidence: null,
    confidence: 0.5,
    ...overrides,
  });

  it('按 (source, target, type) 去重（名称大小写不敏感），保留置信度最高者并保持首次出现顺序', () => {
    const merged = mergeRelations([
      [relation({ confidence: 0.6, label: '发布' }), relation({ type: 'uses' })],
      [relation({ source: 'openai', confidence: 0.9, evidence: 'OpenAI 发布了 GPT-4' })],
      [relation({ confidence: 0.9, label: '同分不替换' }), relation({ source: 'GPT-4', target: 'OpenAI' })],
    ]);
    expect(merged).toEqual([
      relation({ source: 'openai', confidence: 0.9, evidence: 'OpenAI 发布了 GPT-4' }),
      relation({ type: 'uses' }),
      // 有方向的关系：反向是另一条关系
      relation({ source: 'GPT-4', target: 'OpenAI' }),
    ]);
    expect(relationKey(relation({ source: '《OpenAI》' }))).toBe(relationKey(relation({})));
  });
});

describe('chunkText', () => {
  it('短文本整体返回，空白文本返回空数组', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
    expect(chunkText('   ', 100)).toEqual([]);
  });

  it('按段落切分，片段不超过上限且拼接后等于原文（不截断）', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `段落${i}：${'内容'.repeat(10 + i)}`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('超长段落按上限硬切', () => {
    const text = 'a'.repeat(250);
    const chunks = chunkText(text, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

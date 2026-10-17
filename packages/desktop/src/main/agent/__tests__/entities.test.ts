// ================================
// 实体抽取纯函数测试：实体名规范化、模型输出校验、多段结果合并、长文本分段
// ================================

import { describe, it, expect } from 'vitest';
import {
  cleanEntityName,
  mergeEntityChunks,
  normalizeEntityName,
  parseEntityResponse,
} from '../entities';
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

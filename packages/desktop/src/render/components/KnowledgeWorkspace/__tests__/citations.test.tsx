// ================================
// 问答引用解析测试：[n] 标记 → 引用片段，段落拆分
// ================================

import { describe, expect, it } from 'vitest';
import type { AnswerSource } from '../../../lib/agent/askService';
import { parseAnswer, type AnswerParagraph } from '../citations';

const SOURCES: AnswerSource[] = [
  { index: 1, itemId: 'item-1', title: '笔记一', type: 'note' },
  { index: 2, itemId: 'item-2', title: '网页二', type: 'webpage' },
];

/** 简写：文本原样输出，引用输出为 @itemId */
function flatten(paragraph: AnswerParagraph): string[] {
  return paragraph.map((segment) => (segment.kind === 'text' ? segment.text : `@${segment.source.itemId}`));
}

describe('parseAnswer', () => {
  it('把 [n] 标记替换为对应来源', () => {
    const [paragraph] = parseAnswer('React 18 引入了并发渲染[1]，详见文档[2]。', SOURCES);
    expect(flatten(paragraph)).toEqual(['React 18 引入了并发渲染', '@item-1', '，详见文档', '@item-2', '。']);
  });

  it('支持一个标记内引用多个来源（半角、全角逗号与顿号）', () => {
    expect(flatten(parseAnswer('结论[1,2]', SOURCES)[0])).toEqual(['结论', '@item-1', '@item-2']);
    expect(flatten(parseAnswer('结论[1， 2]', SOURCES)[0])).toEqual(['结论', '@item-1', '@item-2']);
    expect(flatten(parseAnswer('结论[2、1]', SOURCES)[0])).toEqual(['结论', '@item-2', '@item-1']);
  });

  it('来源中不存在的编号与非引用的方括号保留为原文', () => {
    expect(flatten(parseAnswer('数组 a[0] 与引用[3]，以及[1]', SOURCES)[0])).toEqual([
      '数组 a[0] 与引用[3]，以及',
      '@item-1',
    ]);
    expect(flatten(parseAnswer('混合[1,3]', SOURCES)[0])).toEqual(['混合[1,3]']);
  });

  it('按空行拆分段落，段内换行保留，首尾空行忽略', () => {
    const paragraphs = parseAnswer('\n第一段第一行\n第一段第二行[1]\n\n  \n第二段\n', SOURCES);
    expect(paragraphs.map(flatten)).toEqual([['第一段第一行\n第一段第二行', '@item-1'], ['第二段']]);
  });

  it('模型输出中的 HTML 作为纯文本保留', () => {
    expect(flatten(parseAnswer('<img src=x onerror=alert(1)>[2]', SOURCES)[0])).toEqual([
      '<img src=x onerror=alert(1)>',
      '@item-2',
    ]);
  });

  it('空回答没有段落', () => {
    expect(parseAnswer('  \n\n ', SOURCES)).toEqual([]);
  });
});

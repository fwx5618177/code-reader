// ================================
// 自动归类纯函数测试：模型输出校验与规范化、多段合并、标签合并规划、待审阅提议计划
// ================================

import { describe, it, expect } from 'vitest';
import {
  batchBySize,
  buildCategorizePlan,
  buildFolderPaths,
  buildSegments,
  mergeItemProposals,
  normalizeTagList,
  normalizeTagName,
  parseCategorizeResponse,
  parseTagMergeResponse,
  planTagMerges,
  planToResult,
  tagKey,
  MAX_TAGS_PER_ITEM,
  SAME_KEY_MERGE_REASON,
  type ItemProposal,
  type TagMergeProposal,
  type TagRef,
} from '../categorize';
import { parseJsonObject, parseJsonStringArray } from '../json-output';

const tag = (id: string, name: string, usageCount = 1, aliases: string[] = []): TagRef => ({
  id,
  name,
  usageCount,
  aliases,
});

const segment = (overrides: Partial<ItemProposal> & Pick<ItemProposal, 'itemId'>): ItemProposal => ({
  folder: null,
  tags: [],
  reason: null,
  confidence: null,
  ...overrides,
});

const mergeProposal = (into: string, from: string[], reason: string | null = null, confidence: number | null = null): TagMergeProposal => ({
  into,
  from,
  reason,
  confidence,
});

describe('标签名规范化', () => {
  it('统一全半角、空白并去掉 #', () => {
    expect(normalizeTagName('  #Ｒｅａｃｔ   Hooks ')).toBe('React Hooks');
    expect(tagKey('Machine-Learning')).toBe(tagKey('machine learning'));
    expect(tagKey('#React')).toBe(tagKey('react'));
  });

  it('标签列表去重、去空并限制数量', () => {
    expect(normalizeTagList(['React', 'react', ' ', '#', 42, 'Vue'])).toEqual(['React', 'Vue']);
    expect(normalizeTagList('not-array')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(normalizeTagList(many)).toHaveLength(MAX_TAGS_PER_ITEM);
  });
});

describe('JSON 解析', () => {
  it('从代码块与说明文字中取出 JSON 对象', () => {
    expect(parseJsonObject('好的：\n```json\n{"items": []}\n```')).toEqual({ items: [] });
  });

  it('没有对象或无法解析时抛错', () => {
    expect(() => parseJsonObject('no json')).toThrow('没有 JSON');
    expect(() => parseJsonObject('{bad json}')).toThrow('无法解析');
  });

  it('JSON 字符串数组列：非法内容视为空，非字符串元素丢弃', () => {
    expect(parseJsonStringArray('["a", 1]')).toEqual(['a']);
    expect(parseJsonStringArray('{bad')).toEqual([]);
    expect(parseJsonStringArray('{"a": 1}')).toEqual([]);
    expect(parseJsonStringArray(null)).toEqual([]);
  });
});

describe('parseCategorizeResponse', () => {
  const refs = new Map([
    ['1', 'item-a'],
    ['2', 'item-b'],
  ]);

  it('只接受本批次编号，规范化文件夹、标签、理由与置信度', () => {
    const proposals = parseCategorizeResponse(
      {
        items: [
          { id: 1, folder: ' 工作 ', tags: ['#React', 'react', 'Hooks'], reason: '  前端 框架笔记 ', confidence: '0.8' },
          { id: '2', folder: 'null', tags: 'oops', reason: 42, confidence: 7 },
          { id: '9', folder: '不存在的编号', tags: ['x'] },
          'garbage',
        ],
      },
      refs
    );
    expect(proposals).toEqual([
      { itemId: 'item-a', folder: '工作', tags: ['React', 'Hooks'], reason: '前端 框架笔记', confidence: 0.8 },
      { itemId: 'item-b', folder: null, tags: [], reason: null, confidence: 1 },
    ]);
  });

  it('缺少 items 或没有任何有效建议时抛错（触发重试）', () => {
    expect(() => parseCategorizeResponse({}, refs)).toThrow('items');
    expect(() => parseCategorizeResponse({ items: [{ id: '42' }] }, refs)).toThrow('有效');
  });
});

describe('分段与分批', () => {
  it('长文本切分为多段，每段独立编号并保留条目归属', () => {
    const long = Array.from({ length: 6 }, (_, i) => `第${i}段`.padEnd(40, '字')).join('\n\n');
    const segments = buildSegments(
      [
        { id: 'a', title: 'A', text: long },
        { id: 'b', title: 'B', text: '' },
      ],
      100
    );
    const ofA = segments.filter((s) => s.itemId === 'a');
    expect(ofA.length).toBeGreaterThan(1);
    expect(ofA.every((s) => s.parts === ofA.length && s.text.length <= 100)).toBe(true);
    expect(ofA.map((s) => s.text).join('')).toBe(long);
    // 没有正文的条目仍按标题参与归类
    expect(segments.filter((s) => s.itemId === 'b')).toHaveLength(1);
    expect(new Set(segments.map((s) => s.ref)).size).toBe(segments.length);
  });

  it('按预算分批，单个超预算元素独占一批', () => {
    expect(batchBySize([3, 3, 3, 10, 1], (n) => n, 6)).toEqual([[3, 3], [3], [10], [1]]);
  });
});

describe('mergeItemProposals', () => {
  it('多段结果：文件夹取多数票，标签按频次排序，置信度取平均，理由取置信度最高的片段', () => {
    const merged = mergeItemProposals([
      segment({ itemId: 'a', folder: '学习', tags: ['AI', 'Python'], reason: '讲机器学习', confidence: 0.6 }),
      segment({ itemId: 'a', folder: '工作', tags: ['python', 'Data'], reason: '工作相关', confidence: 0.9 }),
      segment({ itemId: 'a', folder: '工作', tags: ['ai'] }),
      segment({ itemId: 'b' }),
    ]);
    expect(merged.get('a')).toEqual({
      folder: '工作',
      tags: ['AI', 'Python', 'Data'],
      reason: '工作相关',
      confidence: 0.75,
    });
    expect(merged.get('b')).toEqual({ folder: null, tags: [], reason: null, confidence: null });
  });
});

describe('planTagMerges', () => {
  it('比较键相同的标签确定性合并到使用最多的一个，置信度为 1', () => {
    const steps = planTagMerges([tag('1', 'react', 1), tag('2', 'React', 5), tag('3', '#REACT', 2)], []);
    const same = { reason: SAME_KEY_MERGE_REASON, confidence: 1 };
    expect(steps).toEqual([
      { sourceId: '1', sourceName: 'react', targetId: '2', targetName: 'React', ...same },
      { sourceId: '3', sourceName: '#REACT', targetId: '2', targetName: 'React', ...same },
    ]);
  });

  it('链式建议压平为最终目标，成环与未知名称被忽略；理由来自源标签被并入的那条建议', () => {
    const tags = [tag('js', 'JS'), tag('javascript', 'JavaScript'), tag('ecma', 'ECMAScript'), tag('go', 'Go')];
    const steps = planTagMerges(tags, [
      mergeProposal('JavaScript', ['JS'], '简称', 0.9),
      mergeProposal('ECMAScript', ['JavaScript'], '标准名', 0.7),
      // 成环：ECMAScript 已是 JS / JavaScript 的最终目标
      mergeProposal('JS', ['ECMAScript'], '成环', 0.1),
      mergeProposal('不存在', ['Go']),
      mergeProposal('Go', ['不存在']),
    ]);
    expect(steps).toEqual([
      { sourceId: 'js', sourceName: 'JS', targetId: 'ecma', targetName: 'ECMAScript', reason: '简称', confidence: 0.9 },
      {
        sourceId: 'javascript',
        sourceName: 'JavaScript',
        targetId: 'ecma',
        targetName: 'ECMAScript',
        reason: '标准名',
        confidence: 0.7,
      },
    ]);
  });

  it('解析模型返回的合并建议', () => {
    expect(
      parseTagMergeResponse({
        merges: [{ into: '#AI', from: ['ai ', 'A.I.'], reason: '缩写', confidence: 0.95 }, { into: '', from: ['x'] }, null],
      })
    ).toEqual([mergeProposal('AI', ['ai', 'A.I.'], '缩写', 0.95)]);
    expect(() => parseTagMergeResponse({})).toThrow('merges');
  });
});

describe('buildCategorizePlan', () => {
  const folders = buildFolderPaths([
    { id: 'work', name: '工作', parentId: null },
    { id: 'proj', name: '项目A', parentId: 'work' },
  ]);

  it('构建文件夹路径', () => {
    expect(folders.map((f) => f.path)).toEqual(['工作', '工作/项目A']);
  });

  it('按条目生成提议：匹配已有文件夹 / 新建文件夹，复用已有标签（含别名与合并目标），跳过无需改动的条目', () => {
    const tags = [tag('t-react', 'React', 3, ['reactjs']), tag('t-old', 'react.js', 1), tag('t-ai', 'AI')];
    const merges = planTagMerges(tags, [mergeProposal('React', ['react.js'], '同一框架', 0.9)]);
    const proposal = (folder: string | null, proposedTags: string[]) => ({
      folder,
      tags: proposedTags,
      reason: `理由-${folder}`,
      confidence: 0.8,
    });
    const plan = buildCategorizePlan({
      items: [
        { id: 'a', title: 'A.md', folderId: null, tagIds: ['t-old'] },
        { id: 'b', title: 'B', folderId: 'proj', tagIds: ['t-ai'] },
        { id: 'c', title: 'C', folderId: null, tagIds: [] },
      ],
      folders,
      tags,
      merges,
      proposals: new Map([
        ['a', proposal('工作/项目a', ['ReactJS', 'ai', 'Rust'])],
        // 已在目标文件夹且已有标签：不产生提议
        ['b', proposal('项目A', ['AI'])],
        ['c', proposal('读书', ['Rust'])],
      ]),
    });

    expect(plan.merges).toEqual([
      {
        sourceId: 't-old',
        sourceName: 'react.js',
        targetId: 't-react',
        targetName: 'React',
        reason: '同一框架',
        confidence: 0.9,
      },
    ]);
    // a 原有 react.js 将合并到 React，因此 ReactJS（React 的别名）视为已拥有
    expect(plan.items).toEqual([
      {
        itemId: 'a',
        title: 'A.md',
        folderId: 'proj',
        folderName: '工作/项目A',
        tags: ['AI', 'Rust'],
        reason: '理由-工作/项目a',
        confidence: 0.8,
      },
      { itemId: 'c', title: 'C', folderId: null, folderName: '读书', tags: ['Rust'], reason: '理由-读书', confidence: 0.8 },
    ]);

    expect(planToResult('library', 3, plan)).toEqual({
      scope: 'library',
      analyzedCount: 3,
      itemProposals: 2,
      tagMergeProposals: 1,
    });
  });
});

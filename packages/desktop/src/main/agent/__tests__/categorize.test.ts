// ================================
// 自动归类纯函数测试：模型输出校验与规范化、多段合并、标签合并规划、写回计划
// ================================

import { describe, it, expect } from 'vitest';
import {
  batchBySize,
  buildCategorizePlan,
  buildFolderPaths,
  buildSegments,
  mergeAliases,
  mergeItemProposals,
  normalizeTagList,
  normalizeTagName,
  parseAliases,
  parseCategorizeResponse,
  parseTagMergeResponse,
  planTagMerges,
  planToResult,
  tagKey,
  MAX_TAGS_PER_ITEM,
  type TagRef,
} from '../categorize';
import { parseJsonObject } from '../json-output';

const tag = (id: string, name: string, usageCount = 1, aliases: string[] = []): TagRef => ({
  id,
  name,
  usageCount,
  aliases,
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

describe('parseJsonObject', () => {
  it('从代码块与说明文字中取出 JSON 对象', () => {
    expect(parseJsonObject('好的：\n```json\n{"items": []}\n```')).toEqual({ items: [] });
  });

  it('没有对象或无法解析时抛错', () => {
    expect(() => parseJsonObject('no json')).toThrow('没有 JSON');
    expect(() => parseJsonObject('{bad json}')).toThrow('无法解析');
  });
});

describe('parseCategorizeResponse', () => {
  const refs = new Map([
    ['1', 'item-a'],
    ['2', 'item-b'],
  ]);

  it('只接受本批次编号，规范化文件夹与标签', () => {
    const proposals = parseCategorizeResponse(
      {
        items: [
          { id: 1, folder: ' 工作 ', tags: ['#React', 'react', 'Hooks'] },
          { id: '2', folder: 'null', tags: 'oops' },
          { id: '9', folder: '不存在的编号', tags: ['x'] },
          'garbage',
        ],
      },
      refs
    );
    expect(proposals).toEqual([
      { itemId: 'item-a', folder: '工作', tags: ['React', 'Hooks'] },
      { itemId: 'item-b', folder: null, tags: [] },
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
  it('多段结果：文件夹取多数票，标签按频次排序', () => {
    const merged = mergeItemProposals([
      { itemId: 'a', folder: '学习', tags: ['AI', 'Python'] },
      { itemId: 'a', folder: '工作', tags: ['python', 'Data'] },
      { itemId: 'a', folder: '工作', tags: ['ai'] },
      { itemId: 'b', folder: null, tags: [] },
    ]);
    expect(merged.get('a')).toEqual({ folder: '工作', tags: ['AI', 'Python', 'Data'] });
    expect(merged.get('b')).toEqual({ folder: null, tags: [] });
  });
});

describe('planTagMerges', () => {
  it('比较键相同的标签确定性合并到使用最多的一个', () => {
    const steps = planTagMerges([tag('1', 'react', 1), tag('2', 'React', 5), tag('3', '#REACT', 2)], []);
    expect(steps).toEqual([
      { sourceId: '1', sourceName: 'react', targetId: '2', targetName: 'React' },
      { sourceId: '3', sourceName: '#REACT', targetId: '2', targetName: 'React' },
    ]);
  });

  it('链式建议压平为最终目标，成环与未知名称被忽略', () => {
    const tags = [tag('js', 'JS'), tag('javascript', 'JavaScript'), tag('ecma', 'ECMAScript'), tag('go', 'Go')];
    const steps = planTagMerges(tags, [
      { into: 'JavaScript', from: ['JS'] },
      { into: 'ECMAScript', from: ['JavaScript'] },
      // 成环：ECMAScript 已是 JS / JavaScript 的最终目标
      { into: 'JS', from: ['ECMAScript'] },
      { into: '不存在', from: ['Go'] },
      { into: 'Go', from: ['不存在'] },
    ]);
    expect(steps).toEqual([
      { sourceId: 'js', sourceName: 'JS', targetId: 'ecma', targetName: 'ECMAScript' },
      { sourceId: 'javascript', sourceName: 'JavaScript', targetId: 'ecma', targetName: 'ECMAScript' },
    ]);
  });

  it('解析模型返回的合并建议', () => {
    expect(
      parseTagMergeResponse({ merges: [{ into: '#AI', from: ['ai ', 'A.I.'] }, { into: '', from: ['x'] }, null] })
    ).toEqual([{ into: 'AI', from: ['ai', 'A.I.'] }]);
    expect(() => parseTagMergeResponse({})).toThrow('merges');
  });

  it('合并后的别名：去重且不含目标自身', () => {
    expect(mergeAliases('JavaScript', ['js'], { name: 'JS', aliases: ['javascript', 'ES'] })).toEqual(['js', 'ES']);
    expect(parseAliases('["a", 1]')).toEqual(['a']);
    expect(parseAliases('{bad')).toEqual([]);
    expect(parseAliases(null)).toEqual([]);
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

  it('匹配已有文件夹 / 新建文件夹，复用已有标签（含别名与合并目标），跳过已拥有的标签', () => {
    const tags = [tag('t-react', 'React', 3, ['reactjs']), tag('t-old', 'react.js', 1), tag('t-ai', 'AI')];
    const merges = planTagMerges(tags, [{ into: 'React', from: ['react.js'] }]);
    const plan = buildCategorizePlan({
      items: [
        { id: 'a', title: 'A.md', folderId: null, tagIds: ['t-old'] },
        { id: 'b', title: 'B', folderId: 'proj', tagIds: [] },
        { id: 'c', title: 'C', folderId: null, tagIds: [] },
      ],
      folders,
      tags,
      merges,
      proposals: new Map([
        ['a', { folder: '工作/项目a', tags: ['ReactJS', 'ai', 'Rust'] }],
        ['b', { folder: '项目A', tags: [] }],
        ['c', { folder: '读书', tags: ['Rust'] }],
      ]),
    });

    expect(plan.merges).toHaveLength(1);
    expect(plan.newFolders).toEqual(['读书']);
    expect(plan.moves).toEqual([
      { itemId: 'a', title: 'A.md', folderId: 'proj', folderName: '工作/项目A' },
      { itemId: 'c', title: 'C', folderId: null, folderName: '读书' },
    ]);
    // a 原有 react.js 已合并到 React，因此 ReactJS（React 的别名）视为已拥有
    expect(plan.tagAdditions).toEqual([
      {
        itemId: 'a',
        title: 'A.md',
        tags: [
          { id: 't-ai', name: 'AI' },
          { id: null, name: 'Rust' },
        ],
      },
      { itemId: 'c', title: 'C', tags: [{ id: null, name: 'Rust' }] },
    ]);

    expect(planToResult('library', 3, plan)).toEqual({
      scope: 'library',
      analyzedCount: 3,
      createdFolders: ['读书'],
      moves: [
        { itemId: 'a', title: 'A.md', folder: '工作/项目A' },
        { itemId: 'c', title: 'C', folder: '读书' },
      ],
      tagAdditions: [
        { itemId: 'a', title: 'A.md', tags: ['AI', 'Rust'] },
        { itemId: 'c', title: 'C', tags: ['Rust'] },
      ],
      tagMerges: [{ from: 'react.js', into: 'React' }],
    });
  });
});

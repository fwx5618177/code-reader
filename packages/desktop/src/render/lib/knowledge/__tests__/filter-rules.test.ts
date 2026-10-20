// ================================
// 智能文件夹规则测试
// ================================

import { describe, expect, it } from 'vitest';
import { SMART_FOLDER_PRESETS, matchesAllRules, matchesRule } from '../filter-rules';
import type { KnowledgeItem } from '../../../types/knowledge';

function item(overrides: Partial<KnowledgeItem>): KnowledgeItem {
  return {
    id: 'x',
    title: '标题',
    type: 'note',
    status: 'ready',
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const preset = (id: string) => SMART_FOLDER_PRESETS.find((p) => p.id === id)!.rules;

describe('智能文件夹规则', () => {
  it('内置预设', () => {
    expect(matchesAllRules(item({}), preset('all'))).toBe(true);
    expect(matchesAllRules(item({ isFavorite: true }), preset('favorites'))).toBe(true);
    expect(matchesAllRules(item({ isFavorite: false }), preset('favorites'))).toBe(false);
    expect(matchesAllRules(item({ tagIds: [] }), preset('untagged'))).toBe(true);
    expect(matchesAllRules(item({ tagIds: ['t'] }), preset('untagged'))).toBe(false);
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    expect(matchesAllRules(item({ updatedAt: old }), preset('recent'))).toBe(false);
  });

  it('字符串与集合操作符', () => {
    const it1 = item({ title: 'React 笔记', type: 'webpage', tagIds: ['a', 'b'] });
    expect(matchesRule(it1, { field: 'title', operator: 'contains', value: 'react' })).toBe(true);
    expect(matchesRule(it1, { field: 'title', operator: 'startsWith', value: 'react' })).toBe(true);
    expect(matchesRule(it1, { field: 'tagIds', operator: 'contains', value: 'b' })).toBe(true);
    expect(matchesRule(it1, { field: 'type', operator: 'in', value: ['webpage', 'note'] })).toBe(true);
    expect(matchesRule(it1, { field: 'type', operator: 'notIn', value: ['webpage'] })).toBe(false);
  });

  it('多条规则为 AND', () => {
    const rules = [
      { field: 'type', operator: 'equals' as const, value: 'note' },
      { field: 'isFavorite', operator: 'equals' as const, value: true },
    ];
    expect(matchesAllRules(item({ isFavorite: true }), rules)).toBe(true);
    expect(matchesAllRules(item({ type: 'audio', isFavorite: true }), rules)).toBe(false);
  });
});

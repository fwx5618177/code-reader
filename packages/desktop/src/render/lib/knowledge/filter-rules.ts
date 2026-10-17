// ================================
// 智能文件夹筛选规则
// 侧边栏计数与知识库条目流共用同一套规则引擎
// ================================

import type { KnowledgeItem } from '../../types/knowledge';

export interface FilterRule {
  field: string;
  operator:
    | 'equals'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'in'
    | 'notIn'
    | 'isEmpty'
    | 'isNotEmpty'
    | 'before'
    | 'after';
  value: unknown;
}

/** 内置智能文件夹 */
export interface SmartFolderPreset {
  id: string;
  name: string;
  icon: 'folder' | 'clock' | 'star' | 'tag' | 'sparkles';
  rules: FilterRule[];
}

export const SMART_FOLDER_PRESETS: SmartFolderPreset[] = [
  { id: 'all', name: '全部', icon: 'folder', rules: [] },
  {
    id: 'recent',
    name: '最近',
    icon: 'clock',
    rules: [{ field: 'updatedAt', operator: 'after', value: 'last7days' }],
  },
  {
    id: 'favorites',
    name: '收藏',
    icon: 'star',
    rules: [{ field: 'isFavorite', operator: 'equals', value: true }],
  },
  {
    id: 'untagged',
    name: '未标签',
    icon: 'tag',
    rules: [{ field: 'tagIds', operator: 'isEmpty', value: null }],
  },
];

/**
 * 将日期预设值转换为实际日期
 */
export function getDateFromPreset(preset: string): Date {
  const now = new Date();
  switch (preset) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'yesterday':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    case 'last7days':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'last30days':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'thisMonth':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'lastMonth':
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    default:
      return new Date(preset);
  }
}

/**
 * 检查单个条目是否匹配单条规则
 */
export function matchesRule(item: KnowledgeItem, rule: FilterRule): boolean {
  const { field, operator, value } = rule;
  const fieldValue = (item as unknown as Record<string, unknown>)[field];

  switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'contains':
      if (Array.isArray(fieldValue)) return fieldValue.includes(value);
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.toLowerCase().includes(value.toLowerCase());
      }
      return false;
    case 'startsWith':
      return (
        typeof fieldValue === 'string' &&
        typeof value === 'string' &&
        fieldValue.toLowerCase().startsWith(value.toLowerCase())
      );
    case 'endsWith':
      return (
        typeof fieldValue === 'string' &&
        typeof value === 'string' &&
        fieldValue.toLowerCase().endsWith(value.toLowerCase())
      );
    case 'in':
      return Array.isArray(value) && value.includes(fieldValue);
    case 'notIn':
      return !Array.isArray(value) || !value.includes(fieldValue);
    case 'isEmpty':
      return Array.isArray(fieldValue) ? fieldValue.length === 0 : !fieldValue;
    case 'isNotEmpty':
      return Array.isArray(fieldValue) ? fieldValue.length > 0 : !!fieldValue;
    case 'before':
      return new Date(fieldValue as string | Date) < getDateFromPreset(value as string);
    case 'after':
      return new Date(fieldValue as string | Date) > getDateFromPreset(value as string);
    default:
      return false;
  }
}

/**
 * 检查条目是否匹配所有规则（AND 逻辑；无规则时全部匹配）
 */
export function matchesAllRules(item: KnowledgeItem, rules: FilterRule[] | undefined): boolean {
  return !rules || rules.every((rule) => matchesRule(item, rule));
}

// ================================
// 标签云：按使用次数映射字号 / 字重等级
// ================================

import type { Tag } from '../../types/knowledge';

/** 等级数：0（最小）到 TAG_CLOUD_LEVELS - 1（最大） */
export const TAG_CLOUD_LEVELS = 5;

export interface TagCloudEntry {
  tag: Tag;
  level: number;
}

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/**
 * 使用次数取对数后线性映射到等级，避免少数高频标签把其余标签都压到最小；
 * 所有标签次数相同时取中间等级。结果按名称排序，便于查找
 */
export function buildTagCloud(tags: readonly Tag[], levels: number = TAG_CLOUD_LEVELS): TagCloudEntry[] {
  if (tags.length === 0) return [];
  const weights = tags.map((tag) => Math.log1p(Math.max(0, tag.usageCount)));
  let min = Infinity;
  let max = -Infinity;
  for (const weight of weights) {
    min = Math.min(min, weight);
    max = Math.max(max, weight);
  }
  const span = max - min;
  const top = levels - 1;
  return tags
    .map((tag, index) => ({
      tag,
      level: span === 0 ? Math.floor(top / 2) : Math.round(((weights[index] - min) / span) * top),
    }))
    .sort((a, b) => nameCollator.compare(a.tag.name, b.tag.name));
}

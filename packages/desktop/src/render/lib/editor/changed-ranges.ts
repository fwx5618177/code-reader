// ================================
// 事务改动过的范围：装饰插件据此只重新计算受影响的部分（缩写、拼写检查、脚注编号）
// ================================

import type { Transaction } from 'prosemirror-state';

/** 事务在新文档中改动过的区间 [起点, 终点]（每一步的改动按其后的步骤映射到最终文档） */
export function changedRanges(tr: Transaction): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  return ranges;
}

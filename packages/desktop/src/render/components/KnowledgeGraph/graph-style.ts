// ================================
// 图谱节点配色
// 节点类型 → 颜色角色 → CSS 变量。Canvas 在运行时读取变量值，
// 图例色块在 KnowledgeGraph.module.scss 中按 data-role 使用同一组变量。
// ================================

import type { GraphNode } from '../../lib/links';

export type NodeColorRole =
  | 'accent'
  | 'info'
  | 'success'
  | 'warning'
  | 'secondary'
  | 'muted'
  | 'faint'
  | 'entity';

/** 颜色角色及其 CSS 变量（顺序即图例顺序） */
export const COLOR_ROLES: readonly { role: NodeColorRole; cssVar: string }[] = [
  { role: 'accent', cssVar: '--accent-primary' },
  { role: 'info', cssVar: '--color-info' },
  { role: 'success', cssVar: '--color-success' },
  { role: 'warning', cssVar: '--color-warning' },
  { role: 'secondary', cssVar: '--accent-secondary' },
  { role: 'muted', cssVar: '--text-muted' },
  { role: 'faint', cssVar: '--text-faint' },
  // 实体节点需要与所有条目类型都不同的颜色，取主题中的语法高亮关键字色（亮 / 暗主题均有定义）
  { role: 'entity', cssVar: '--code-keyword' },
];

export const NODE_COLOR_ROLE: Record<GraphNode['type'], NodeColorRole> = {
  note: 'accent',
  document: 'info',
  webpage: 'info',
  image: 'success',
  video: 'success',
  audio: 'warning',
  code: 'secondary',
  bookmark: 'muted',
  file: 'muted',
  unresolved: 'faint',
  entity: 'entity',
};

const NODE_TYPE_LABELS: Record<GraphNode['type'], string> = {
  note: '笔记',
  document: '文档',
  webpage: '网页',
  image: '图片',
  video: '视频',
  audio: '音频',
  code: '代码',
  bookmark: '书签',
  file: '文件',
  unresolved: '未创建',
  entity: '实体',
};

/** 图例：每个颜色角色对应的类型名称 */
export const LEGEND: readonly { role: NodeColorRole; label: string }[] = COLOR_ROLES.map(
  ({ role }) => ({
    role,
    label: (Object.keys(NODE_COLOR_ROLE) as GraphNode['type'][])
      .filter((type) => NODE_COLOR_ROLE[type] === role)
      .map((type) => NODE_TYPE_LABELS[type])
      .join(' / '),
  })
);

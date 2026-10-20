// ================================
// 托盘“最近打开”子菜单
// 列表由渲染进程经 IPC 提供，进入主进程前先校验形状与长度
// ================================

import type { MenuItemConstructorOptions } from 'electron';

export interface RecentDocument {
  id: string;
  title: string;
}

/** 子菜单最多显示的文档数 */
export const RECENT_DOCUMENTS_LIMIT = 10;

/** 菜单项标题的最大长度，过长截断 */
const TITLE_MAX_LENGTH = 40;

/** 校验并规范化 IPC 传入的列表：丢弃非法项与重复 id，限制条数 */
export function normalizeRecentDocuments(payload: unknown): RecentDocument[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const documents: RecentDocument[] = [];
  for (const entry of payload) {
    if (documents.length >= RECENT_DOCUMENTS_LIMIT) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, title } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    const text = typeof title === 'string' ? title.trim() : '';
    documents.push({
      id,
      title: text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text || '无标题',
    });
  }
  return documents;
}

/**
 * 菜单项文字转义：Windows / Linux 把 & 当作助记键前缀（不显示并给后一个字符加下划线），
 * 需写成 && 才能显示字面的 &；macOS 不处理 &，转义反而会显示两个
 */
export function escapeMenuLabel(label: string, platform: NodeJS.Platform): string {
  return platform === 'darwin' ? label : label.replace(/&/g, '&&');
}

/** 生成“最近打开”的子菜单项；没有文档时显示不可点的提示 */
export function buildRecentSubmenu(
  documents: readonly RecentDocument[],
  onOpen: (id: string) => void,
  platform: NodeJS.Platform
): MenuItemConstructorOptions[] {
  if (documents.length === 0) return [{ label: '暂无文档', enabled: false }];
  return documents.map((document) => ({
    label: escapeMenuLabel(document.title, platform),
    click: () => onOpen(document.id),
  }));
}

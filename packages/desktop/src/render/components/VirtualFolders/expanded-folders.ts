// ================================
// 知识库侧边栏文件夹的展开状态：保存在 localStorage，重启后保持
// ================================

export const EXPANDED_FOLDERS_STORAGE_KEY = 'knowledge-sidebar:expanded-folders';

/** 首次使用时默认只展开「智能文件夹」 */
const DEFAULT_EXPANDED = ['smart'];

/** 读取展开的文件夹 ID；缺失或损坏时回退到默认值 */
export function loadExpandedFolders(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(EXPANDED_FOLDERS_STORAGE_KEY) ?? 'null');
    if (Array.isArray(raw)) {
      return new Set(raw.filter((id): id is string => typeof id === 'string'));
    }
  } catch {
    // 数据损坏：使用默认值
  }
  return new Set(DEFAULT_EXPANDED);
}

export function saveExpandedFolders(expanded: ReadonlySet<string>): void {
  localStorage.setItem(EXPANDED_FOLDERS_STORAGE_KEY, JSON.stringify([...expanded]));
}

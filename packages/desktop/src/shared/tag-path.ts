// ================================
// 层级标签路径（主进程与渲染进程共用的纯函数）
// 与 Obsidian 一致，用“父/子”命名表达层级，不改变数据表结构：
// - 标签“技术/前端”是“技术”的子标签；父标签不必真实存在（树中显示为分组）
// - 按父标签筛选时包含全部子孙标签；重命名父标签时子孙标签随之改名
// ================================

/** 层级分隔符 */
export const TAG_PATH_SEPARATOR = '/';

/**
 * 规范化标签名：统一全半角（NFKC）与空白，去掉开头的 #，
 * 各级名称去除首尾空白并丢弃空级（“ 技术 / /前端 ” → “技术/前端”）
 */
export function normalizeTagPath(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^#+\s*/, '')
    .split(TAG_PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(TAG_PATH_SEPARATOR);
}

/** 末级名称 */
export function tagLeafName(path: string): string {
  return path.slice(path.lastIndexOf(TAG_PATH_SEPARATOR) + 1);
}

/** 父路径；顶层标签为 null */
export function parentTagPath(path: string): string | null {
  const index = path.lastIndexOf(TAG_PATH_SEPARATOR);
  return index > 0 ? path.slice(0, index) : null;
}

/** 全部祖先路径（由近及远，不含自身） */
export function ancestorTagPaths(path: string): string[] {
  const result: string[] = [];
  for (let parent = parentTagPath(path); parent; parent = parentTagPath(parent)) result.push(parent);
  return result;
}

/** path 是否为 ancestor 本身或其子孙 */
export function isTagPathWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + TAG_PATH_SEPARATOR);
}

/**
 * 把 ancestor 改名为 renamed 后 path 的新路径；path 不在 ancestor 之下时为 null
 */
export function rebaseTagPath(path: string, ancestor: string, renamed: string): string | null {
  if (!isTagPathWithin(path, ancestor)) return null;
  return renamed + path.slice(ancestor.length);
}

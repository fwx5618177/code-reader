// ================================
// Markdown 头部 YAML（frontmatter）的最小解析：只支持导入时用到的子集——
// `key: value`、`key: [a, b]` 行内数组、`key:` 后接 `- item` 块列表；其余写法忽略
// ================================

export type FrontmatterValue = string | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.endsWith(trimmed[0])) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineArray(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map(unquote)
    .filter(Boolean);
}

/** 拆出文本开头的 frontmatter；没有（或未闭合）时 data 为空、body 为原文 */
export function splitFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end === -1) return { data: {}, body: text };

  const data: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const current = data[listKey];
      const values = Array.isArray(current) ? current : [];
      const value = unquote(item[1]);
      if (value) values.push(value);
      data[listKey] = values;
      continue;
    }
    const pair = /^([A-Za-z0-9_\-\u4e00-\u9fff ]+?)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      listKey = null;
      continue;
    }
    const [, key, raw] = pair;
    const value = raw.trim();
    if (!value) {
      // 空值：可能是随后的块列表
      listKey = key;
      data[key] = [];
      continue;
    }
    listKey = null;
    data[key] = value.startsWith('[') && value.endsWith(']') ? parseInlineArray(value) : unquote(value);
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

/** 取 frontmatter 字段为字符串列表（字符串按逗号或空白拆分） */
export function frontmatterList(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return value.split(/[,\s]+/).filter(Boolean);
}

/** 取 frontmatter 字段为单个字符串 */
export function frontmatterString(value: FrontmatterValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

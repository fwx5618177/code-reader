// ================================
// Markdown 头部 YAML（frontmatter）的最小解析：只支持导入与文档属性用到的子集——
// `key: value`、`key: [a, b]` 行内数组（可跨多行）、`key:` 后接 `- item` 块列表；其余写法忽略
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

/** 值中未闭合的 [ { 层数（引号内的不计；负数表示多出的右括号） */
export function flowDepth(value: string): number {
  let depth = 0;
  let inQuote: string | null = null;
  for (const char of value) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
    }
  }
  return depth;
}

/** 去掉行内数组 / 映射右括号之后的行尾注释（数组里的 #标签 按宽松写法保留，不当作注释） */
export const withoutFlowComment = (text: string) => text.replace(/([\]}])\s+#.*$/, '$1');

/**
 * 从 start 行起的行内数组在第几行闭合（跨行的 [a,⏎ b] 写法），value 为 start 行冒号之后的值；
 * 到 limit（不含）仍未闭合时为 -1
 */
export function flowSequenceEnd(lines: readonly string[], start: number, value: string, limit: number): number {
  let depth = flowDepth(withoutFlowComment(value));
  let line = start;
  while (depth > 0) {
    if (++line >= limit) return -1;
    depth += flowDepth(withoutFlowComment(lines[line]!));
  }
  return line;
}

/** 行内数组的元素：按引号外的逗号拆分（"a, b" 是一个元素），去掉引号与空元素 */
export function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  for (const char of inner) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map(unquote).filter(Boolean);
}


/** 拆出文本开头的 frontmatter；没有（或未闭合）时 data 为空、body 为原文 */
export function splitFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end === -1) return { data: {}, body: text };

  const data: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;
  for (let index = 1; index < end; index++) {
    const line = lines[index]!;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const current = data[listKey];
      const values = Array.isArray(current) ? current : [];
      const value = unquote(item[1]!);
      if (value) values.push(value);
      data[listKey] = values;
      continue;
    }
    const pair = /^([A-Za-z0-9_\-\u4e00-\u9fff ]+?)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      listKey = null;
      continue;
    }
    const key = pair[1]!;
    let value = pair[2]!.trim();
    if (!value) {
      // 空值：可能是随后的块列表
      listKey = key;
      data[key] = [];
      continue;
    }
    listKey = null;
    if (value.startsWith('[')) {
      // 跨行的行内数组：拼上到右括号为止的行（未闭合时只取本行）
      const close = flowSequenceEnd(lines, index, value, end);
      if (close > index) {
        value = [value, ...lines.slice(index + 1, close + 1).map((text) => text.trim())].join(' ');
        index = close;
      }
      // 行内数组后的行尾注释去掉；普通值里的 #标签 按宽松写法保留
      value = withoutFlowComment(value);
    }
    data[key] = value.startsWith('[') && value.endsWith(']') ? splitFlowItems(value.slice(1, -1)) : unquote(value);
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

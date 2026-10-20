// ================================
// 文档属性（文档开头的 YAML 头部）
// - 读取 tags / aliases（也接受单数 tag / alias；值可以是 [a, b]、块列表或逗号分隔），供条目标签与链接别名同步
// - 检查常见的 YAML 写错：制表符缩进、缺少冒号、重复的键、引号或括号未闭合、不属于任何键的列表项
// 编辑器中的着色与错误标注见 front-matter-plugin.ts（这里不依赖 Prism，链接索引等非编辑器模块也能使用）
// ================================

import { normalizeTagPath } from '../../../shared/tag-path';
import { frontmatterList, splitFrontmatter } from '../transfer/frontmatter';

/** 文档属性中与知识库同步的字段 */
export interface DocumentProperties {
  tags: string[];
  aliases: string[];
}

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

/** 读取文档开头 YAML 头部中的标签与别名（标签可以写成 #标签，按知识库的层级标签规则规范化） */
export function documentProperties(markdown: string): DocumentProperties {
  if (!markdown.startsWith('---')) return { tags: [], aliases: [] };
  const { data } = splitFrontmatter(markdown);
  return {
    tags: unique(frontmatterList(data.tags ?? data.tag).map((tag) => normalizeTagPath(tag.replace(/^#/, '')))),
    aliases: unique(frontmatterList(data.aliases ?? data.alias)),
  };
}

/**
 * 保存后条目的标签：加入 YAML 中的标签，去掉上次同步后从 YAML 中删掉的标签；
 * 在界面上添加的其他标签保持不变
 */
export function mergeDocumentTags(current: readonly string[], previousYaml: readonly string[], yaml: readonly string[]): string[] {
  const removed = new Set(previousYaml.filter((tag) => !yaml.includes(tag)));
  return unique([...current.filter((tag) => !removed.has(tag)), ...yaml]);
}

/** 两组标签是否相同（不计顺序） */
export function sameTagSet(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((tag) => set.has(tag));
}

/** YAML 头部中顶层 tags（或 tag）键所在的行与头部结束行；没有头部或没有该键时为 null */
function locateTagsKey(lines: readonly string[]): { keyLine: number; end: number } | null {
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end === -1) return null;
  for (let line = 1; line < end; line++) {
    if (/^tags?\s*:/.test(lines[line]!)) return { keyLine: line, end };
  }
  return null;
}

/** 文档属性里是否写了 tags（或 tag）键：有时条目标签的修改会写回 YAML */
export function hasFrontMatterTags(markdown: string): boolean {
  return markdown.startsWith('---') && locateTagsKey(markdown.split(/\r?\n/)) !== null;
}

/** 行内数组与块列表里需要加引号的值 */
const needsQuotes = (value: string) => /[,[\]{}"]|: |^['&*!|>%@`]|^\s|\s$/.test(value);

/**
 * 把 YAML 头部的 tags（或 tag）改写为给定标签，保留原来的写法：行内数组 [a, b]（含行尾注释）、
 * 块列表（保留缩进与 - 前缀）、逗号或空格分隔的字符串；原来都写成 #标签 的保留 #。
 * 保留下来的标签顺序不变，新标签追加在后面。标签集合没变或没有 tags 键时原样返回
 */
export function setFrontMatterTags(markdown: string, tags: readonly string[]): string {
  if (!markdown.startsWith('---')) return markdown;
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const located = locateTagsKey(lines);
  if (!located) return markdown;

  const current = documentProperties(markdown).tags;
  const wanted = unique(tags.map(normalizeTagPath));
  if (sameTagSet(current, wanted)) return markdown;
  const ordered = [...current.filter((tag) => wanted.includes(tag)), ...wanted.filter((tag) => !current.includes(tag))];

  const { keyLine, end } = located;
  const [, key, separator, rawValue] = /^(tags?)(\s*:\s*)(.*)$/.exec(lines[keyLine]!)!;
  const value = rawValue!.trim();
  let blockEnd = keyLine + 1;
  while (blockEnd < end && /^\s*-(\s|$)/.test(lines[blockEnd]!)) blockEnd++;
  const blockItems = lines.slice(keyLine + 1, blockEnd);

  const rawItems = value.startsWith('[')
    ? value.slice(1, value.indexOf(']') === -1 ? undefined : value.indexOf(']')).split(',')
    : value
      ? value.split(/[,\s]+/)
      : blockItems.map((line) => line.replace(/^\s*-\s*/, ''));
  const items = rawItems.map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const hashed = items.length > 0 && items.every((item) => item.startsWith('#'));
  const written = ordered.map((tag) => (hashed ? `#${tag}` : tag));
  const quoted = written.map((tag) => (needsQuotes(tag) ? JSON.stringify(tag) : tag));
  const inlineArray = `[${quoted.join(', ')}]`;

  if (!value) {
    // 块列表（或只有键）：沿用第一项的缩进与前缀
    const prefix = /^(\s*-\s*)/.exec(blockItems[0] ?? '')?.[1] ?? '  - ';
    lines.splice(keyLine + 1, blockItems.length, ...quoted.map((tag) => prefix + tag));
  } else if (value.startsWith('[')) {
    const close = rawValue!.indexOf(']');
    lines[keyLine] = `${key}${separator}${inlineArray}${close === -1 ? '' : rawValue!.slice(close + 1)}`;
  } else if (written.some((tag) => /[\s,]/.test(tag)) || written.length === 0) {
    // 分隔符写法放不下含空格的标签，也表示不了空列表：改用行内数组
    lines[keyLine] = `${key}${separator}${inlineArray}`;
  } else {
    lines[keyLine] = `${key}${separator}${written.join(value.includes(',') ? ', ' : ' ')}`;
  }
  return lines.join(eol);
}

/** YAML 头部中的一处问题（行号从 0 计，相对头部内容） */
export interface FrontMatterProblem {
  line: number;
  message: string;
}

/** 值中引号与括号是否闭合（引号内的括号不计） */
function unbalanced(value: string): string | null {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && !new RegExp(`^${quote}(?:[^${quote}\\\\]|\\\\.)*${quote}`).test(value)) return '引号未闭合';
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
  return depth !== 0 ? '括号未闭合' : null;
}

/** 检查 YAML 头部的常见写错 */
export function lintFrontMatter(yaml: string): FrontMatterProblem[] {
  const problems: FrontMatterProblem[] = [];
  const keys = new Set<string>();
  /** 上一个顶层键是否没有写值（之后可以是块列表或缩进的子项） */
  let openKey = false;
  /** 多行的块文本（| 或 >）之中 */
  let blockScalar = false;
  yaml.split('\n').forEach((text, line) => {
    if (/^\s*$/.test(text) || /^\s*#/.test(text)) return;
    if (/^ *\t/.test(text)) {
      problems.push({ line, message: 'YAML 不能用制表符缩进，请改用空格' });
      return;
    }
    const indented = /^\s/.test(text);
    if (indented) {
      if (!openKey && !blockScalar && /^\s+-\s/.test(text)) problems.push({ line, message: '列表项不属于任何键：上一行应为“键:”且不写值' });
      return;
    }
    blockScalar = false;
    if (/^-(\s|$)/.test(text)) {
      if (!openKey) problems.push({ line, message: '列表项不属于任何键：上一行应为“键:”且不写值' });
      return;
    }
    const pair = /^("[^"]*"|'[^']*'|[^:#]+?)\s*:(?:\s+(.*)|$)/.exec(text);
    if (!pair) {
      openKey = false;
      problems.push({ line, message: '缺少冒号：每一行应为“键: 值”' });
      return;
    }
    const key = pair[1]!.replace(/^["']|["']$/g, '');
    if (keys.has(key)) problems.push({ line, message: `重复的键「${key}」` });
    keys.add(key);
    const value = (pair[2] ?? '').replace(/\s+#.*$/, '').trim();
    openKey = value === '';
    blockScalar = /^[|>][+-]?$/.test(value);
    const issue = value && !blockScalar ? unbalanced(value) : null;
    if (issue) problems.push({ line, message: issue });
  });
  return problems;
}

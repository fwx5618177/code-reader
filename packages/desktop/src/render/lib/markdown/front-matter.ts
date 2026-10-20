// ================================
// 文档属性（文档开头的 YAML 头部）
// - 读取 tags / aliases（也接受单数 tag / alias；值可以是 [a, b]、块列表或逗号分隔），供条目标签与链接别名同步
// - 检查常见的 YAML 写错：制表符缩进、缺少冒号、重复的键、引号或括号未闭合、不属于任何键的列表项
// 编辑器中的着色与错误标注见 front-matter-plugin.ts（这里不依赖 Prism，链接索引等非编辑器模块也能使用）
// ================================

import { normalizeTagPath } from '../../../shared/tag-path';
import {
  flowDepth,
  flowSequenceEnd,
  frontmatterList,
  splitFlowItems,
  splitFrontmatter,
  withoutFlowComment,
} from '../transfer/frontmatter';

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
  const inline = value.startsWith('[');
  // 行内数组可以跨多行：到右括号所在的行为止（未闭合时只算本行）
  const closeLine = inline ? Math.max(keyLine, flowSequenceEnd(lines, keyLine, rawValue!, end)) : keyLine;
  const flowText = lines.slice(keyLine, closeLine + 1).join('\n');
  const flowOpen = flowText.indexOf('[');
  const flowClose = inline ? closingBracket(flowText, flowOpen) : -1;
  let blockEnd = keyLine + 1;
  while (blockEnd < end && /^\s*-(\s|$)/.test(lines[blockEnd]!)) blockEnd++;
  const blockItems = lines.slice(keyLine + 1, blockEnd);

  const items = inline
    ? splitFlowItems(flowText.slice(flowOpen + 1, flowClose === -1 ? undefined : flowClose))
    : (value ? value.split(/[,\s]+/) : blockItems.map((line) => line.replace(/^\s*-\s*/, '')))
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
  const hashed = items.length > 0 && items.every((item) => item.startsWith('#'));
  const written = ordered.map((tag) => (hashed ? `#${tag}` : tag));
  const quoted = written.map((tag) => (needsQuotes(tag) ? JSON.stringify(tag) : tag));
  const inlineArray = `[${quoted.join(', ')}]`;

  if (!value) {
    // 块列表（或只有键）：沿用第一项的缩进与前缀
    const prefix = /^(\s*-\s*)/.exec(blockItems[0] ?? '')?.[1] ?? '  - ';
    lines.splice(keyLine + 1, blockItems.length, ...quoted.map((tag) => prefix + tag));
  } else if (inline) {
    // 右括号之后的内容（行尾注释）保留
    const after = flowClose === -1 ? '' : flowText.slice(flowClose + 1);
    lines.splice(keyLine, closeLine - keyLine + 1, ...rewriteFlowSequence(lines.slice(keyLine, closeLine + 1), `${key}${separator}`, quoted, after));
  } else if (written.some((tag) => /[\s,]/.test(tag)) || written.length === 0) {
    // 分隔符写法放不下含空格的标签，也表示不了空列表：改用行内数组
    lines[keyLine] = `${key}${separator}${inlineArray}`;
  } else {
    lines[keyLine] = `${key}${separator}${written.join(value.includes(',') ? ', ' : ' ')}`;
  }
  return lines.join(eol);
}

/** text 中 open 位置的 [ 对应的 ] 的位置（引号内的不计）；未闭合时为 -1 */
function closingBracket(text: string, open: number): number {
  for (let index = open + 1, depth = 1, inQuote: string | null = null; index < text.length; index++) {
    const char = text[index]!;
    if (inQuote) {
      if (char === inQuote) inQuote = null;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === '[' || char === '{') {
      depth++;
    } else if ((char === ']' || char === '}') && --depth === 0) {
      return index;
    }
  }
  return -1;
}

/**
 * 改写行内数组：原来是展开写法（[ 在键所在行末尾，每行一项）时保留展开写法、项的缩进、末尾逗号与 ] 所在行；
 * 其他写法（单行，或 [a,⏎ b] 折行）写成一行
 */
function rewriteFlowSequence(original: readonly string[], head: string, quoted: readonly string[], after: string): string[] {
  const expanded = original.length > 1 && /\[\s*$/.test(original[0]!);
  if (!expanded || quoted.length === 0) return [`${head}[${quoted.join(', ')}]${after}`];
  const itemLines = original.slice(1).filter((line) => line.trim() && !line.trim().startsWith(']'));
  const indent = /^\s*/.exec(itemLines[0] ?? '')?.[0] || '  ';
  const trailingComma = /,\s*$/.test(itemLines[itemLines.length - 1] ?? '');
  const closeLine = original[original.length - 1]!;
  const closeOwnLine = closeLine.trim().startsWith(']');
  const body = quoted.map((tag, index) => `${indent}${tag}${index < quoted.length - 1 || (trailingComma && closeOwnLine) ? ',' : ''}`);
  if (closeOwnLine) return [`${head}[`, ...body, closeLine];
  body[body.length - 1] += `]${after}`;
  return [`${head}[`, ...body];
}

/** YAML 头部中的一处问题（行号从 0 计，相对头部内容） */
export interface FrontMatterProblem {
  line: number;
  message: string;
}

/** 值以引号开头却没有闭合 */
function unclosedQuote(value: string): boolean {
  const quote = value[0];
  return (quote === '"' || quote === "'") && !new RegExp(`^${quote}(?:[^${quote}\\\\]|\\\\.)*${quote}`).test(value);
}

/** 检查 YAML 头部的常见写错 */
export function lintFrontMatter(yaml: string): FrontMatterProblem[] {
  const problems: FrontMatterProblem[] = [];
  const keys = new Set<string>();
  /** 上一个顶层键是否没有写值（之后可以是块列表或缩进的子项） */
  let openKey = false;
  /** 多行的块文本（| 或 >）之中 */
  let blockScalar = false;
  /** 跨行的行内数组 / 映射之中：开始的行与尚未闭合的括号层数 */
  let flow: { line: number; depth: number } | null = null;
  yaml.split('\n').forEach((text, line) => {
    if (/^\s*$/.test(text) || /^\s*#/.test(text)) return;
    if (flow) {
      // 顶格的“键:”或列表项：括号没有闭合就开始了下一项，在开始的行报错，这一行照常检查
      if (/^(-(\s|$)|[^\s#][^:#]*:(\s|$))/.test(text)) {
        problems.push({ line: flow.line, message: '括号未闭合' });
        flow = null;
      } else {
        flow.depth += flowDepth(withoutFlowComment(text));
        if (flow.depth < 0) problems.push({ line, message: '括号未闭合' });
        if (flow.depth <= 0) flow = null;
        return;
      }
    }
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
    const raw = (pair[2] ?? '').trim();
    // 行内数组 / 映射只去掉右括号之后的注释（[#a, #b] 这种 #标签 写法按宽松规则接受）
    const value = /^[[{]/.test(raw) ? withoutFlowComment(raw) : raw.replace(/\s+#.*$/, '').trim();
    openKey = value === '';
    blockScalar = /^[|>][+-]?$/.test(value);
    if (!value || blockScalar) return;
    if (unclosedQuote(value)) {
      problems.push({ line, message: '引号未闭合' });
      return;
    }
    const depth = flowDepth(value);
    // [ 或 { 开头、到行尾还没闭合：跨行写法，继续看后面的行
    if (depth > 0 && /^[[{]/.test(value)) flow = { line, depth };
    else if (depth !== 0) problems.push({ line, message: '括号未闭合' });
  });
  if (flow) problems.push({ line: (flow as { line: number }).line, message: '括号未闭合' });
  return problems;
}

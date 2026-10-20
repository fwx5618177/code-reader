// ================================
// LaTeX 块分割器
//
// 把正文切成可独立解析的顶层块，是增量引擎“只重新处理变化内容”的基础：
// - 空行分段（段落）
// - \begin{env}…\end{env} 与 $$…$$、\[…\] 各自成块，内部的空行不切分
// - \section 等章节命令独占一块
//
// 只在完整解析器本身也会切分顶层节点的位置切块（段落分隔、章节、环境、块级公式），
// 因此按块独立解析与整篇解析得到的顶层节点序列一致。
// 找不到闭合的环境/公式（正在输入中）按普通行处理并标记 unmatched，
// 避免一个未闭合的 \begin 把其后整篇文档并成一个块。
// ================================

/** 文档的前言/正文/尾部划分 */
export interface BodyRange {
  /** 正文起点（\begin{document} 之后；没有 document 环境时为 0） */
  readonly bodyStart: number;
  /** 正文终点（\end{document} 起点；没有时为文档末尾） */
  readonly bodyEnd: number;
}

/** 单个块的扫描结果 */
interface ScannedBlock {
  /** 块结束位置（不含），总是位于行首或正文终点 */
  readonly end: number;
  /** 块内是否存在找不到闭合的环境/公式开头（其分块结果依赖块后的文本） */
  readonly unmatched: boolean;
}

const BEGIN_DOCUMENT = '\\begin{document}';
const END_DOCUMENT = '\\end{document}';

const SECTION_LINE = /^\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const BEGIN_AT_LINE_START = /^\\begin\{([^}]+)\}/;
const BEGIN_ANYWHERE = /\\begin\{([^}]+)\}/g;

/**
 * 计算前言/正文范围
 */
export function findBodyRange(text: string): BodyRange {
  const begin = text.indexOf(BEGIN_DOCUMENT);
  if (begin === -1) {
    return { bodyStart: 0, bodyEnd: text.length };
  }
  const bodyStart = begin + BEGIN_DOCUMENT.length;
  const end = text.indexOf(END_DOCUMENT, bodyStart);
  return { bodyStart, bodyEnd: end === -1 ? text.length : end };
}

/**
 * 统计 [from, to) 内的换行数
 */
export function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  let i = text.indexOf('\n', from);
  while (i !== -1 && i < to) {
    count++;
    i = text.indexOf('\n', i + 1);
  }
  return count;
}

/** 行尾（换行符之后）位置，不超过 limit */
function nextLineStart(text: string, pos: number, limit: number): number {
  const i = text.indexOf('\n', pos);
  return i === -1 || i >= limit ? limit : i + 1;
}

function isBlankLine(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    // 空格、\t、\r、\n
    if (c !== 32 && c !== 9 && c !== 13 && c !== 10) return false;
  }
  return true;
}

function skipBlankLines(text: string, pos: number, limit: number): number {
  let p = pos;
  while (p < limit) {
    const next = nextLineStart(text, p, limit);
    if (!isBlankLine(text, p, next)) break;
    p = next;
  }
  return p;
}

/** 去掉行首空白后的起点 */
function firstNonSpace(text: string, start: number, end: number): number {
  let i = start;
  while (i < end && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

/** 行内第一个未转义 % 的位置（注释起点），没有则返回 end */
function commentStart(text: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    if (text[i] !== '%') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= start && text[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return end;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 查找与 from 之前的 \begin{name} 匹配的 \end{name} 的起点（同名嵌套计数）
 */
function findEnvEnd(text: string, from: number, name: string, limit: number): number {
  const pattern = new RegExp(`\\\\(begin|end)\\{${escapeRegExp(name)}\\}`, 'g');
  pattern.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null && match.index < limit) {
    depth += match[1] === 'begin' ? 1 : -1;
    if (depth === 0) return match.index;
  }
  return -1;
}

/** 查找闭合分隔符起点，限定在 limit 之前 */
function findCloser(text: string, closer: string, from: number, limit: number): number {
  const i = text.indexOf(closer, from);
  return i === -1 || i >= limit ? -1 : i;
}

/** 行首是否开启一个需要独立成块的结构 */
function startsStructure(text: string, lineStart: number, lineEnd: number): boolean {
  const s = firstNonSpace(text, lineStart, lineEnd);
  const head = text.slice(s, Math.min(lineEnd, s + 32));
  return (
    head.startsWith('\\begin{') ||
    head.startsWith('$$') ||
    head.startsWith('\\[') ||
    SECTION_LINE.test(head)
  );
}

/**
 * 在一行内寻找跨行的结构（环境、$$、\[），返回跳过这些结构后所在行的结束位置
 */
function skipOpenConstructs(
  text: string,
  lineStart: number,
  lineEnd: number,
  limit: number
): ScannedBlock {
  let unmatched = false;
  let cursor = lineStart;
  let currentEnd = lineEnd;

  while (cursor < currentEnd) {
    const codeEnd = commentStart(text, cursor, currentEnd);
    const line = text.slice(cursor, codeEnd);
    let jumpTo = -1;

    // 依次检查行内各类开头，取第一个跨到后续行的结构
    let earliest = Infinity;
    BEGIN_ANYWHERE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BEGIN_ANYWHERE.exec(line)) !== null) {
      const name = m[1];
      const afterBegin = cursor + m.index + m[0].length;
      const endIdx = findEnvEnd(text, afterBegin, name, limit);
      if (endIdx === -1) {
        unmatched = true;
        continue;
      }
      if (endIdx >= currentEnd) {
        earliest = m.index;
        jumpTo = endIdx + `\\end{${name}}`.length;
        break;
      }
      // 同行闭合的环境直接跳过，继续检查其后的开头
      BEGIN_ANYWHERE.lastIndex = endIdx - cursor;
    }

    const delimiters: Array<[string, string]> = [
      ['$$', '$$'],
      ['\\[', '\\]'],
    ];
    for (const [open, close] of delimiters) {
      let search = 0;
      while (search < line.length) {
        const openIdx = line.indexOf(open, search);
        if (openIdx === -1 || openIdx >= earliest) break;
        const closeIdx = findCloser(text, close, cursor + openIdx + open.length, limit);
        if (closeIdx === -1) {
          unmatched = true;
          break;
        }
        if (closeIdx >= currentEnd) {
          earliest = openIdx;
          jumpTo = closeIdx + close.length;
          break;
        }
        search = closeIdx - cursor + close.length;
      }
    }

    if (jumpTo === -1) break;
    // 从结构闭合处继续检查该行剩余部分
    cursor = jumpTo;
    currentEnd = nextLineStart(text, jumpTo, limit);
  }

  return { end: currentEnd, unmatched };
}

/**
 * 从 pos（行首或正文起点）开始扫描一个块
 */
export function scanBlock(text: string, pos: number, limit: number): ScannedBlock {
  // 区域开头的空行并入当前块
  const start = skipBlankLines(text, pos, limit);
  if (start >= limit) {
    return { end: limit, unmatched: false };
  }

  const firstLineEnd = nextLineStart(text, start, limit);
  const head = firstNonSpace(text, start, firstLineEnd);
  const headText = text.slice(head, Math.min(firstLineEnd, head + 64));
  let unmatched = false;

  // 1. 环境块
  const envMatch = BEGIN_AT_LINE_START.exec(headText);
  if (envMatch) {
    const endIdx = findEnvEnd(text, head + envMatch[0].length, envMatch[1], limit);
    if (endIdx !== -1) {
      const after = endIdx + `\\end{${envMatch[1]}}`.length;
      const tail = skipOpenConstructs(text, after, nextLineStart(text, after, limit), limit);
      return {
        end: skipBlankLines(text, tail.end, limit),
        unmatched: tail.unmatched,
      };
    }
    unmatched = true;
  }

  // 2. 块级公式
  if (!envMatch && (headText.startsWith('$$') || headText.startsWith('\\['))) {
    const close = headText.startsWith('$$') ? '$$' : '\\]';
    const closeIdx = findCloser(text, close, head + 2, limit);
    if (closeIdx !== -1) {
      const after = closeIdx + close.length;
      const tail = skipOpenConstructs(text, after, nextLineStart(text, after, limit), limit);
      return {
        end: skipBlankLines(text, tail.end, limit),
        unmatched: tail.unmatched,
      };
    }
    unmatched = true;
  }

  // 3. 章节命令独占一块
  if (SECTION_LINE.test(headText)) {
    const line = skipOpenConstructs(text, start, firstLineEnd, limit);
    return {
      end: skipBlankLines(text, line.end, limit),
      unmatched: line.unmatched,
    };
  }

  // 4. 段落：直到空行或下一个结构开头
  let p = start;
  while (p < limit) {
    const lineEnd = nextLineStart(text, p, limit);
    const line = skipOpenConstructs(text, p, lineEnd, limit);
    unmatched = unmatched || line.unmatched;
    p = line.end;
    if (p >= limit) break;

    const nextEnd = nextLineStart(text, p, limit);
    if (isBlankLine(text, p, nextEnd)) {
      p = skipBlankLines(text, p, limit);
      break;
    }
    if (startsStructure(text, p, nextEnd)) break;
  }

  return { end: p, unmatched };
}

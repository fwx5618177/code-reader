// ================================
// 增量编辑解析器 (Incremental Edit Parser)
// 支持局部重解析和编辑区域检测
// 优化大型文档的实时编辑性能
// ================================

import { Token, TokenType, ParseResult, ParseError, ParserConfig } from './incremental-parser';

// ================================
// 类型定义
// ================================

/**
 * 文档编辑操作类型
 */
export const enum EditOperationType {
  /** 插入文本 */
  Insert = 'insert',
  /** 删除文本 */
  Delete = 'delete',
  /** 替换文本 */
  Replace = 'replace',
}

/**
 * 编辑操作描述
 */
export interface EditOperation {
  /** 操作类型 */
  type: EditOperationType;
  /** 编辑起始位置（字符偏移） */
  offset: number;
  /** 删除的字符数（仅 Delete/Replace） */
  deleteCount?: number;
  /** 插入的文本（仅 Insert/Replace） */
  insertText?: string;
  /** 编辑起始行号 */
  startLine: number;
  /** 编辑起始列号 */
  startColumn: number;
}

/**
 * 受影响区域
 */
export interface AffectedRange {
  /** 起始位置（字符偏移） */
  start: number;
  /** 结束位置（字符偏移） */
  end: number;
  /** 起始行号 */
  startLine: number;
  /** 结束行号 */
  endLine: number;
  /** 受影响的 Token 索引范围 */
  tokenStartIndex: number;
  tokenEndIndex: number;
}

/**
 * 增量解析结果
 */
export interface IncrementalParseResult extends ParseResult {
  /** 受影响的区域 */
  affectedRange: AffectedRange;
  /** 新解析的 Token */
  newTokens: Token[];
  /** 被替换的 Token 数量 */
  replacedTokenCount: number;
  /** 是否进行了全量重解析 */
  fullReparse: boolean;
}

/**
 * 行信息缓存
 */
interface LineInfo {
  /** 行号（1-based） */
  line: number;
  /** 行起始位置（字符偏移） */
  start: number;
  /** 行结束位置（字符偏移，不含换行符） */
  end: number;
  /** 行长度（不含换行符） */
  length: number;
  /** 所属 Token 索引列表 */
  tokenIndices: number[];
}

/**
 * 解析缓存
 */
interface ParseCache {
  /** 完整文档内容 */
  content: string;
  /** 已解析的 Token 列表 */
  tokens: Token[];
  /** 行信息索引 */
  lines: LineInfo[];
  /** Token 位置索引（按起始位置排序） */
  tokenPositionIndex: Map<number, number>;
  /** 最后解析时间戳 */
  lastParsedAt: number;
}

/**
 * 增量解析器配置
 */
export interface IncrementalEditParserConfig extends ParserConfig {
  /** 强制全量重解析的阈值（编辑影响行数超过此值时） */
  fullReparseThreshold?: number;
  /** 是否启用缓存 */
  cacheEnabled?: boolean;
  /** 缓存过期时间（毫秒） */
  cacheTTL?: number;
  /** 上下文扩展行数（确保解析完整性） */
  contextLines?: number;
}

const DEFAULT_CONFIG: Required<IncrementalEditParserConfig> = {
  gfm: true,
  html: true,
  math: false,
  smartPunctuation: false,
  chunkSize: 65536,
  maxNestingDepth: 100,
  fullReparseThreshold: 50,
  cacheEnabled: true,
  cacheTTL: 300000, // 5 分钟
  contextLines: 3,
};

// ================================
// 字符常量
// ================================

const CHAR_NEWLINE = 10; // \n
const CHAR_CARRIAGE_RETURN = 13; // \r
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_HASH = 35; // #
const CHAR_BACKTICK = 96; // `
const CHAR_ASTERISK = 42; // *
const CHAR_UNDERSCORE = 95; // _
const CHAR_GREATER_THAN = 62; // >
const CHAR_HYPHEN = 45; // -
const CHAR_PLUS = 43; // +

// ================================
// 工具函数
// ================================

/**
 * 判断字符码是否可能开启块级结构（标题、引用、列表、分隔线等）
 * 用于 parseLine 快速路径：不满足时直接判定为段落，避免逐个规则尝试
 */
function isBlockMarkerStart(code: number): boolean {
  return (
    code === CHAR_HASH ||
    code === CHAR_GREATER_THAN ||
    code === CHAR_HYPHEN ||
    code === CHAR_PLUS ||
    code === CHAR_ASTERISK ||
    code === CHAR_UNDERSCORE ||
    (code >= 48 && code <= 57) // 数字 0-9（有序列表）
  );
}

/**
 * 判断是否为空白行
 */
function isBlankLine(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code !== CHAR_SPACE && code !== CHAR_TAB) {
      return false;
    }
  }
  return true;
}

/**
 * 判断是否为代码围栏行
 */
function isCodeFenceLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.length < 3) return false;

  const char = trimmed.charCodeAt(0);
  if (char !== CHAR_BACKTICK && char !== 126) return false; // ` 或 ~

  let count = 1;
  for (let i = 1; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) === char) {
      count++;
    } else {
      break;
    }
  }
  return count >= 3;
}

/**
 * 代码围栏信息
 */
interface FenceInfo {
  /** 围栏字符（` 或 ~） */
  char: string;
  /** 围栏字符连续个数 */
  count: number;
  /** 围栏行首缩进（空格数） */
  indent: number;
}

/**
 * 统计字符串开头连续出现指定字符的次数
 */
function countLeadingRun(text: string, char: string): number {
  let count = 0;
  while (count < text.length && text.charAt(count) === char) {
    count++;
  }
  return count;
}

/**
 * 解析开启围栏行，非围栏行返回 null
 */
function readOpeningFence(line: string): FenceInfo | null {
  if (!isCodeFenceLine(line)) return null;
  const trimmed = line.trimStart();
  const char = trimmed.charAt(0);
  return {
    char,
    count: countLeadingRun(trimmed, char),
    indent: line.length - trimmed.length,
  };
}

/**
 * 判断是否为与开启围栏匹配的闭合围栏行
 * 规则：同字符、个数不少于开启围栏、其后仅允许空白
 */
function isClosingFence(line: string, fence: FenceInfo): boolean {
  const trimmed = line.trimStart();
  const count = countLeadingRun(trimmed, fence.char);
  return count >= fence.count && trimmed.slice(count).trim() === '';
}

/**
 * 去除代码块内容行的围栏缩进（CommonMark：最多去除与开启围栏相同数量的前导空格）
 */
function stripFenceIndent(line: string, indent: number): string {
  let removed = 0;
  while (removed < indent && line.charCodeAt(removed) === CHAR_SPACE) {
    removed++;
  }
  return line.slice(removed);
}

/**
 * 行切片：行文本及其在原文中的起止偏移
 */
interface LineSpan {
  /** 行文本（不含换行符） */
  text: string;
  /** 行起始偏移 */
  start: number;
  /** 行结束偏移（不含换行符） */
  end: number;
}

/**
 * 按行切分文本并记录真实偏移，同时正确处理 \n 与 \r\n 换行
 * （与 split(/\r?\n/) 的切分结果一致，但不会因 \r\n 导致偏移漂移）
 */
function splitLineSpans(content: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let lineStart = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== CHAR_NEWLINE) continue;
    const lineEnd =
      i > lineStart && content.charCodeAt(i - 1) === CHAR_CARRIAGE_RETURN ? i - 1 : i;
    spans.push({ text: content.slice(lineStart, lineEnd), start: lineStart, end: lineEnd });
    lineStart = i + 1;
  }
  spans.push({ text: content.slice(lineStart), start: lineStart, end: content.length });
  return spans;
}

// ================================
// IncrementalEditParser 类
// ================================

export class IncrementalEditParser {
  private config: Required<IncrementalEditParserConfig>;
  private cache: ParseCache | null = null;
  private errors: ParseError[] = [];

  constructor(config?: Partial<IncrementalEditParserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取当前配置
   */
  get currentConfig(): Required<IncrementalEditParserConfig> {
    return { ...this.config };
  }

  /**
   * 初始化解析（全量解析）
   */
  parse(content: string): ParseResult {
    const startTime = performance.now();
    this.errors = [];

    const tokens = this.parseContent(content);
    const lines = this.buildLineIndex(content);

    // 构建 Token 位置索引
    const tokenPositionIndex = new Map<number, number>();
    tokens.forEach((token, index) => {
      tokenPositionIndex.set(token.start, index);
    });

    // 更新缓存
    if (this.config.cacheEnabled) {
      this.cache = {
        content,
        tokens,
        lines,
        tokenPositionIndex,
        lastParsedAt: Date.now(),
      };
    }

    const duration = performance.now() - startTime;

    return {
      tokens,
      complete: true,
      processed: content.length,
      duration,
      errors: this.errors,
    };
  }

  /**
   * 增量解析（仅解析受影响区域）
   */
  parseIncremental(
    content: string,
    edit: EditOperation
  ): IncrementalParseResult {
    const startTime = performance.now();
    this.errors = [];

    // 检查是否有有效缓存
    if (
      !this.cache ||
      !this.config.cacheEnabled ||
      this.isCacheExpired()
    ) {
      // 没有缓存，进行全量解析
      const result = this.parse(content);
      return {
        ...result,
        affectedRange: {
          start: 0,
          end: content.length,
          startLine: 1,
          endLine: this.countLines(content),
          tokenStartIndex: 0,
          tokenEndIndex: result.tokens.length - 1,
        },
        newTokens: result.tokens,
        replacedTokenCount: 0,
        fullReparse: true,
      };
    }

    // 计算受影响的区域
    const affectedRange = this.calculateAffectedRange(content, edit);

    // 检查是否需要全量重解析
    const affectedLineCount = affectedRange.endLine - affectedRange.startLine + 1;
    if (affectedLineCount > this.config.fullReparseThreshold) {
      const result = this.parse(content);
      return {
        ...result,
        affectedRange,
        newTokens: result.tokens,
        replacedTokenCount: this.cache.tokens.length,
        fullReparse: true,
      };
    }

    // 执行局部重解析
    const { newTokens, startIndex, endIndex } = this.reparseRange(
      content,
      affectedRange
    );

    // 合并结果：后续 Token 需按字符偏移差与行数差整体平移
    const offsetDelta = (edit.insertText?.length ?? 0) - (edit.deleteCount ?? 0);
    const lineDelta = this.countLines(content) - this.cache.lines.length;
    const tokens = this.mergeTokens(
      this.cache.tokens,
      newTokens,
      startIndex,
      endIndex,
      offsetDelta,
      lineDelta
    );

    // 更新缓存
    this.updateCache(content, tokens);

    const duration = performance.now() - startTime;

    return {
      tokens,
      complete: true,
      processed: content.length,
      duration,
      errors: this.errors,
      affectedRange,
      newTokens,
      replacedTokenCount: endIndex - startIndex + 1,
      fullReparse: false,
    };
  }

  /**
   * 应用编辑并返回新内容
   */
  applyEdit(content: string, edit: EditOperation): string {
    switch (edit.type) {
      case EditOperationType.Insert:
        return (
          content.slice(0, edit.offset) +
          (edit.insertText || '') +
          content.slice(edit.offset)
        );

      case EditOperationType.Delete:
        return (
          content.slice(0, edit.offset) +
          content.slice(edit.offset + (edit.deleteCount || 0))
        );

      case EditOperationType.Replace:
        return (
          content.slice(0, edit.offset) +
          (edit.insertText || '') +
          content.slice(edit.offset + (edit.deleteCount || 0))
        );

      default:
        return content;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): {
    hasCache: boolean;
    tokenCount: number;
    lineCount: number;
    age: number;
  } {
    if (!this.cache) {
      return {
        hasCache: false,
        tokenCount: 0,
        lineCount: 0,
        age: 0,
      };
    }

    return {
      hasCache: true,
      tokenCount: this.cache.tokens.length,
      lineCount: this.cache.lines.length,
      age: Date.now() - this.cache.lastParsedAt,
    };
  }

  /**
   * 获取解析错误
   */
  getErrors(): ParseError[] {
    return [...this.errors];
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 解析内容为 Token 列表
   */
  private parseContent(content: string): Token[] {
    const tokens: Token[] = [];
    const spans = splitLineSpans(content);

    let fence: FenceInfo | null = null;
    let codeBlockStart = 0;
    let codeBlockStartLine = 0;
    let codeBlockLanguage = '';
    let codeBlockContent: string[] = [];

    for (let lineIndex = 0; lineIndex < spans.length; lineIndex++) {
      const span = spans[lineIndex];
      if (!span) continue;
      const { text: line, start: lineStart, end: lineEnd } = span;
      const lineNumber = lineIndex + 1;

      if (fence === null) {
        const opening = readOpeningFence(line);
        if (opening) {
          // 代码块开始
          fence = opening;
          codeBlockLanguage = line.trimStart().slice(opening.count).trim();
          codeBlockStart = lineStart;
          codeBlockStartLine = lineNumber;
          codeBlockContent = [];
          continue;
        }

        // 解析其他块级元素
        const token = this.parseLine(line, lineStart, lineNumber);
        if (token) {
          tokens.push(token);
        }
        continue;
      }

      if (isClosingFence(line, fence)) {
        // 代码块结束
        tokens.push({
          type: TokenType.CodeBlock,
          raw: content.slice(codeBlockStart, lineEnd),
          content: codeBlockContent.join('\n'),
          start: codeBlockStart,
          end: lineEnd,
          startLine: codeBlockStartLine,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: line.length + 1,
          attributes: {
            language: codeBlockLanguage,
            fenceChar: fence.char,
            fenceCount: fence.count,
          },
        });
        fence = null;
      } else {
        codeBlockContent.push(stripFenceIndent(line, fence.indent));
      }
    }

    // 处理未闭合的代码块
    if (fence !== null) {
      const lastSpan = spans[spans.length - 1];
      tokens.push({
        type: TokenType.CodeBlock,
        raw: content.slice(codeBlockStart),
        content: codeBlockContent.join('\n'),
        start: codeBlockStart,
        end: content.length,
        startLine: codeBlockStartLine,
        startColumn: 1,
        endLine: spans.length,
        endColumn: (lastSpan?.text.length ?? 0) + 1,
        attributes: {
          language: codeBlockLanguage,
          fenceChar: fence.char,
          fenceCount: fence.count,
          unclosed: true,
        },
      });
    }

    return tokens;
  }

  /**
   * 解析单行
   */
  private parseLine(
    line: string,
    offset: number,
    lineNumber: number
  ): Token | null {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // 空行（仅由空格 / 制表符组成，含零长度行）
    if (isBlankLine(line)) {
      return {
        type: TokenType.Newline,
        raw: line,
        content: '',
        start: offset,
        end: offset + line.length,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: line.length + 1,
        attributes: { indent },
      };
    }

    const firstChar = trimmed.charCodeAt(0);

    // 快速路径：首字符不可能开启块级结构时直接作为段落
    if (!isBlockMarkerStart(firstChar)) {
      return this.createParagraphToken(line, offset, lineNumber);
    }

    // 标题
    if (firstChar === CHAR_HASH) {
      let level = 0;
      for (let i = 0; i < trimmed.length && i < 6; i++) {
        if (trimmed.charCodeAt(i) === CHAR_HASH) {
          level++;
        } else {
          break;
        }
      }

      if (level > 0 && level <= 6 && trimmed.charCodeAt(level) === CHAR_SPACE) {
        const content = trimmed.slice(level + 1).trim();
        return {
          type: TokenType.Heading,
          raw: line,
          content,
          start: offset,
          end: offset + line.length,
          startLine: lineNumber,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: line.length + 1,
          attributes: { level },
        };
      }
    }

    // 引用块
    if (firstChar === CHAR_GREATER_THAN) {
      const content = trimmed.slice(1).trimStart();
      return {
        type: TokenType.Blockquote,
        raw: line,
        content,
        start: offset,
        end: offset + line.length,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: line.length + 1,
        attributes: {},
      };
    }

    // 无序列表
    if (
      (firstChar === CHAR_HYPHEN ||
        firstChar === CHAR_PLUS ||
        firstChar === CHAR_ASTERISK) &&
      trimmed.charCodeAt(1) === CHAR_SPACE
    ) {
      const content = trimmed.slice(2);
      return {
        type: TokenType.ListItem,
        raw: line,
        content,
        start: offset,
        end: offset + line.length,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: line.length + 1,
        attributes: {
          ordered: false,
          marker: trimmed[0],
          indent,
        },
      };
    }

    // 有序列表
    if (firstChar >= 48 && firstChar <= 57) {
      let i = 0;
      while (i < trimmed.length && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
        i++;
      }

      if (
        i > 0 &&
        i < trimmed.length &&
        (trimmed[i] === '.' || trimmed[i] === ')') &&
        trimmed.charCodeAt(i + 1) === CHAR_SPACE
      ) {
        const number = parseInt(trimmed.slice(0, i), 10);
        const content = trimmed.slice(i + 2);
        return {
          type: TokenType.ListItem,
          raw: line,
          content,
          start: offset,
          end: offset + line.length,
          startLine: lineNumber,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: line.length + 1,
          attributes: {
            ordered: true,
            number,
            marker: trimmed[i],
            indent,
          },
        };
      }
    }

    // 水平分隔线
    if (
      firstChar === CHAR_HYPHEN ||
      firstChar === CHAR_ASTERISK ||
      firstChar === CHAR_UNDERSCORE
    ) {
      const ruleChar = trimmed[0];
      let count = 0;
      let valid = true;

      for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (c === ruleChar) {
          count++;
        } else if (c !== ' ' && c !== '\t') {
          valid = false;
          break;
        }
      }

      if (valid && count >= 3) {
        return {
          type: TokenType.HorizontalRule,
          raw: line,
          content: '',
          start: offset,
          end: offset + line.length,
          startLine: lineNumber,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: line.length + 1,
          attributes: { char: ruleChar },
        };
      }
    }

    // 普通段落
    return this.createParagraphToken(line, offset, lineNumber);
  }

  /**
   * 创建段落 Token
   */
  private createParagraphToken(line: string, offset: number, lineNumber: number): Token {
    return {
      type: TokenType.Paragraph,
      raw: line,
      content: line,
      start: offset,
      end: offset + line.length,
      startLine: lineNumber,
      startColumn: 1,
      endLine: lineNumber,
      endColumn: line.length + 1,
      attributes: {},
    };
  }

  /**
   * 构建行索引
   */
  private buildLineIndex(content: string): LineInfo[] {
    return splitLineSpans(content).map((span, index) => ({
      line: index + 1,
      start: span.start,
      end: span.end,
      length: span.text.length,
      tokenIndices: [],
    }));
  }

  /**
   * 计算受影响区域
   */
  private calculateAffectedRange(
    newContent: string,
    edit: EditOperation
  ): AffectedRange {
    if (!this.cache) {
      return {
        start: 0,
        end: newContent.length,
        startLine: 1,
        endLine: this.countLines(newContent),
        tokenStartIndex: 0,
        tokenEndIndex: -1,
      };
    }

    const spans = splitLineSpans(newContent);
    const editEndOffset = edit.offset + (edit.insertText?.length ?? 0);

    // 起始行向前扩展上下文
    let startLine = Math.max(1, edit.startLine - this.config.contextLines);

    // 找到编辑结束位置所在行（行结束偏移不小于编辑结束偏移的第一行）
    let endLine = edit.startLine;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (span && span.end >= editEndOffset) {
        endLine = i + 1;
        break;
      }
    }

    // 结束行向后扩展上下文
    endLine = Math.min(spans.length, endLine + this.config.contextLines);

    // 检查是否在代码块内
    const { inCodeBlock, codeBlockStartLine, codeBlockEndLine } =
      this.findCodeBlockContext(spans, startLine, endLine);

    if (inCodeBlock) {
      startLine = Math.min(startLine, codeBlockStartLine);
      endLine = Math.max(endLine, codeBlockEndLine ?? spans.length);
    }

    // 计算字符偏移（结束偏移不含换行符）
    const start = spans[startLine - 1]?.start ?? 0;
    const end = spans[endLine - 1]?.end ?? newContent.length;

    // 查找受影响的 Token 索引
    const tokenStartIndex = this.findTokenIndexByLine(startLine);
    const tokenEndIndex = this.findTokenIndexByLine(endLine);

    return {
      start,
      end,
      startLine,
      endLine,
      tokenStartIndex,
      tokenEndIndex,
    };
  }

  /**
   * 查找代码块上下文
   */
  private findCodeBlockContext(
    spans: LineSpan[],
    startLine: number,
    endLine: number
  ): {
    inCodeBlock: boolean;
    codeBlockStartLine: number;
    codeBlockEndLine: number | null;
  } {
    let fence: FenceInfo | null = null;
    let codeBlockStartLine = 0;

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (!span) continue;
      const lineNum = i + 1;
      const inRange = lineNum >= startLine && lineNum <= endLine;

      if (fence === null) {
        fence = readOpeningFence(span.text);
        if (fence) {
          codeBlockStartLine = lineNum;
        }
      } else if (isClosingFence(span.text, fence)) {
        if (inRange) {
          return { inCodeBlock: true, codeBlockStartLine, codeBlockEndLine: lineNum };
        }
        fence = null;
      }

      if (inRange && fence !== null) {
        return { inCodeBlock: true, codeBlockStartLine, codeBlockEndLine: null };
      }
    }

    return { inCodeBlock: false, codeBlockStartLine: 0, codeBlockEndLine: null };
  }

  /**
   * 根据行号查找 Token 索引
   */
  private findTokenIndexByLine(lineNumber: number): number {
    if (!this.cache) return 0;

    for (let i = 0; i < this.cache.tokens.length; i++) {
      const token = this.cache.tokens[i];
      if (!token) continue;
      if (token.startLine <= lineNumber && token.endLine >= lineNumber) {
        return i;
      }
      if (token.startLine > lineNumber) {
        return Math.max(0, i - 1);
      }
    }

    return this.cache.tokens.length - 1;
  }

  /**
   * 重新解析指定区域
   */
  private reparseRange(
    content: string,
    range: AffectedRange
  ): {
    newTokens: Token[];
    startIndex: number;
    endIndex: number;
  } {
    // 提取受影响区域的原文（保留原始换行符，保证偏移一致）
    const startOffset = range.start;
    const affectedContent = content.slice(range.start, range.end);

    // 解析受影响区域
    const tempParser = new IncrementalEditParser({
      ...this.config,
      cacheEnabled: false,
    });

    const result = tempParser.parse(affectedContent);

    // 调整 Token 位置
    const newTokens = result.tokens.map((token) => ({
      ...token,
      start: token.start + startOffset,
      end: token.end + startOffset,
      startLine: token.startLine + range.startLine - 1,
      endLine: token.endLine + range.startLine - 1,
    }));

    return {
      newTokens,
      startIndex: range.tokenStartIndex,
      endIndex: range.tokenEndIndex,
    };
  }

  /**
   * 合并 Token
   */
  private mergeTokens(
    oldTokens: Token[],
    newTokens: Token[],
    startIndex: number,
    endIndex: number,
    offsetDelta: number,
    lineDelta: number
  ): Token[] {
    // 调整后续 Token 的字符偏移与行号
    const adjustedLaterTokens = oldTokens.slice(endIndex + 1).map((token) => ({
      ...token,
      start: token.start + offsetDelta,
      end: token.end + offsetDelta,
      startLine: token.startLine + lineDelta,
      endLine: token.endLine + lineDelta,
    }));

    return [
      ...oldTokens.slice(0, startIndex),
      ...newTokens,
      ...adjustedLaterTokens,
    ];
  }

  /**
   * 更新缓存
   */
  private updateCache(content: string, tokens: Token[]): void {
    if (!this.config.cacheEnabled) return;

    const lines = this.buildLineIndex(content);
    const tokenPositionIndex = new Map<number, number>();
    tokens.forEach((token, index) => {
      tokenPositionIndex.set(token.start, index);
    });

    this.cache = {
      content,
      tokens,
      lines,
      tokenPositionIndex,
      lastParsedAt: Date.now(),
    };
  }

  /**
   * 检查缓存是否过期
   */
  private isCacheExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.lastParsedAt > this.config.cacheTTL;
  }

  /**
   * 统计行数
   */
  private countLines(content: string): number {
    let count = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === CHAR_NEWLINE) {
        count++;
      }
    }
    return count;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建增量编辑解析器实例
 */
export function createIncrementalEditParser(
  config?: Partial<IncrementalEditParserConfig>
): IncrementalEditParser {
  return new IncrementalEditParser(config);
}

/**
 * 应用编辑并进行增量解析
 */
export function parseWithEdit(
  parser: IncrementalEditParser,
  oldContent: string,
  edit: EditOperation
): {
  newContent: string;
  result: IncrementalParseResult;
} {
  const newContent = parser.applyEdit(oldContent, edit);
  const result = parser.parseIncremental(newContent, edit);
  return { newContent, result };
}

/**
 * 创建编辑操作
 */
export function createEditOperation(
  type: EditOperationType,
  offset: number,
  startLine: number,
  startColumn: number,
  options?: {
    deleteCount?: number;
    insertText?: string;
  }
): EditOperation {
  return {
    type,
    offset,
    startLine,
    startColumn,
    deleteCount: options?.deleteCount,
    insertText: options?.insertText,
  };
}

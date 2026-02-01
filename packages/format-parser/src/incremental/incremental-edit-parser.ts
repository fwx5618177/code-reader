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
 * 判断是否为块级标记开始
 */
function isBlockMarkerStart(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code === CHAR_HASH ||
    code === CHAR_BACKTICK ||
    code === CHAR_GREATER_THAN ||
    code === CHAR_HYPHEN ||
    code === CHAR_PLUS ||
    code === CHAR_ASTERISK ||
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

    // 合并结果
    const tokens = this.mergeTokens(
      this.cache.tokens,
      newTokens,
      startIndex,
      endIndex,
      edit
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
    const lines = content.split(/\r?\n/);

    let offset = 0;
    let inCodeBlock = false;
    let codeBlockStart = 0;
    let codeBlockStartLine = 0;
    let codeBlockFenceCount = 0;
    let codeBlockFenceChar = '';
    let codeBlockLanguage = '';
    let codeBlockContent: string[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineNumber = lineIndex + 1;
      const lineStart = offset;
      const lineEnd = offset + line.length;

      // 处理代码围栏
      if (!inCodeBlock && isCodeFenceLine(line)) {
        const trimmed = line.trimStart();
        const indent = line.length - trimmed.length;
        codeBlockFenceChar = trimmed[0];
        codeBlockFenceCount = 0;

        for (let i = 0; i < trimmed.length; i++) {
          if (trimmed[i] === codeBlockFenceChar) {
            codeBlockFenceCount++;
          } else {
            break;
          }
        }

        codeBlockLanguage = trimmed.slice(codeBlockFenceCount).trim();
        codeBlockStart = lineStart;
        codeBlockStartLine = lineNumber;
        codeBlockContent = [];
        inCodeBlock = true;
      } else if (inCodeBlock) {
        const trimmed = line.trimStart();
        let closingFence = false;

        if (trimmed.length >= codeBlockFenceCount) {
          if (trimmed[0] === codeBlockFenceChar) {
            let count = 0;
            for (let i = 0; i < trimmed.length; i++) {
              if (trimmed[i] === codeBlockFenceChar) {
                count++;
              } else {
                break;
              }
            }

            if (count >= codeBlockFenceCount && trimmed.slice(count).trim() === '') {
              closingFence = true;
            }
          }
        }

        if (closingFence) {
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
              fenceChar: codeBlockFenceChar,
              fenceCount: codeBlockFenceCount,
            },
          });
          inCodeBlock = false;
        } else {
          codeBlockContent.push(line);
        }
      } else {
        // 解析其他块级元素
        const token = this.parseLine(line, lineStart, lineNumber);
        if (token) {
          tokens.push(token);
        }
      }

      // 更新偏移（包含换行符）
      offset = lineEnd + 1; // +1 for newline
    }

    // 处理未闭合的代码块
    if (inCodeBlock) {
      tokens.push({
        type: TokenType.CodeBlock,
        raw: content.slice(codeBlockStart),
        content: codeBlockContent.join('\n'),
        start: codeBlockStart,
        end: content.length,
        startLine: codeBlockStartLine,
        startColumn: 1,
        endLine: lines.length,
        endColumn: lines[lines.length - 1].length + 1,
        attributes: {
          language: codeBlockLanguage,
          fenceChar: codeBlockFenceChar,
          fenceCount: codeBlockFenceCount,
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
    if (line.length === 0) {
      return {
        type: TokenType.Newline,
        raw: '',
        content: '',
        start: offset,
        end: offset,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: 1,
        attributes: {},
      };
    }

    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (trimmed.length === 0) {
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
    const lines: LineInfo[] = [];
    let offset = 0;
    let lineNumber = 1;

    const contentLines = content.split(/\r?\n/);

    for (const line of contentLines) {
      lines.push({
        line: lineNumber,
        start: offset,
        end: offset + line.length,
        length: line.length,
        tokenIndices: [],
      });

      offset += line.length + 1; // +1 for newline
      lineNumber++;
    }

    return lines;
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

    const { offset, deleteCount = 0 } = edit;
    const insertLength = edit.insertText?.length || 0;
    const delta = insertLength - deleteCount;

    // 查找受影响的起始行
    let startLine = edit.startLine;
    let endLine = startLine;

    // 扩展上下文
    startLine = Math.max(1, startLine - this.config.contextLines);

    // 计算受影响的结束行
    const newLines = newContent.split(/\r?\n/);
    const editEndOffset = offset + insertLength;

    // 找到编辑结束位置对应的行
    let currentOffset = 0;
    for (let i = 0; i < newLines.length; i++) {
      currentOffset += newLines[i].length + 1;
      if (currentOffset > editEndOffset) {
        endLine = i + 1;
        break;
      }
    }

    // 扩展上下文
    endLine = Math.min(newLines.length, endLine + this.config.contextLines);

    // 检查是否在代码块内
    const { inCodeBlock, codeBlockStartLine, codeBlockEndLine } =
      this.findCodeBlockContext(newContent, startLine, endLine);

    if (inCodeBlock) {
      startLine = Math.min(startLine, codeBlockStartLine);
      endLine = Math.max(endLine, codeBlockEndLine || newLines.length);
    }

    // 计算字符偏移
    let start = 0;
    let end = 0;
    currentOffset = 0;

    for (let i = 0; i < newLines.length; i++) {
      const lineNum = i + 1;

      if (lineNum === startLine) {
        start = currentOffset;
      }

      currentOffset += newLines[i].length + 1;

      if (lineNum === endLine) {
        end = currentOffset - 1; // 不含换行符
        break;
      }
    }

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
    content: string,
    startLine: number,
    endLine: number
  ): {
    inCodeBlock: boolean;
    codeBlockStartLine: number;
    codeBlockEndLine: number | null;
  } {
    const lines = content.split(/\r?\n/);
    let inCodeBlock = false;
    let codeBlockStartLine = 0;
    let codeBlockFenceCount = 0;
    let codeBlockFenceChar = '';

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];

      if (!inCodeBlock && isCodeFenceLine(line)) {
        const trimmed = line.trimStart();
        codeBlockFenceChar = trimmed[0];
        codeBlockFenceCount = 0;

        for (let j = 0; j < trimmed.length; j++) {
          if (trimmed[j] === codeBlockFenceChar) {
            codeBlockFenceCount++;
          } else {
            break;
          }
        }

        inCodeBlock = true;
        codeBlockStartLine = lineNum;
      } else if (inCodeBlock) {
        const trimmed = line.trimStart();

        if (trimmed.length >= codeBlockFenceCount) {
          if (trimmed[0] === codeBlockFenceChar) {
            let count = 0;
            for (let j = 0; j < trimmed.length; j++) {
              if (trimmed[j] === codeBlockFenceChar) {
                count++;
              } else {
                break;
              }
            }

            if (count >= codeBlockFenceCount && trimmed.slice(count).trim() === '') {
              if (lineNum >= startLine && lineNum <= endLine) {
                return {
                  inCodeBlock: true,
                  codeBlockStartLine,
                  codeBlockEndLine: lineNum,
                };
              }
              inCodeBlock = false;
            }
          }
        }
      }

      if (lineNum >= startLine && lineNum <= endLine && inCodeBlock) {
        return {
          inCodeBlock: true,
          codeBlockStartLine,
          codeBlockEndLine: null,
        };
      }
    }

    return {
      inCodeBlock: false,
      codeBlockStartLine: 0,
      codeBlockEndLine: null,
    };
  }

  /**
   * 根据行号查找 Token 索引
   */
  private findTokenIndexByLine(lineNumber: number): number {
    if (!this.cache) return 0;

    for (let i = 0; i < this.cache.tokens.length; i++) {
      const token = this.cache.tokens[i];
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
    // 提取受影响区域的文本
    const lines = content.split(/\r?\n/);
    const affectedLines = lines.slice(range.startLine - 1, range.endLine);
    const affectedContent = affectedLines.join('\n');

    // 计算起始偏移
    let startOffset = 0;
    for (let i = 0; i < range.startLine - 1; i++) {
      startOffset += lines[i].length + 1;
    }

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
    edit: EditOperation
  ): Token[] {
    const delta =
      (edit.insertText?.length || 0) - (edit.deleteCount || 0);

    // 调整后续 Token 的位置
    const adjustedLaterTokens = oldTokens.slice(endIndex + 1).map((token) => ({
      ...token,
      start: token.start + delta,
      end: token.end + delta,
      // 行号需要根据实际变化调整
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

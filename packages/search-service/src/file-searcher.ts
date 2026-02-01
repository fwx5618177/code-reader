// ================================
// File Searcher - 批量文件内容搜索
//
// 提供大量文件的内容搜索功能：
// - 并行文件读取
// - 流式搜索
// - 正则表达式匹配
// - 模糊匹配
// - 上下文提取
// ================================

// ================================
// 类型定义
// ================================

/**
 * 文件匹配结果
 */
export interface FileMatch {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  filename: string;
  /** 匹配项列表 */
  matches: LineMatch[];
  /** 匹配总数 */
  matchCount: number;
  /** 文件大小 */
  fileSize: number;
  /** 搜索耗时 */
  searchTimeMs: number;
}

/**
 * 行匹配结果
 */
export interface LineMatch {
  /** 行号（1-based） */
  lineNumber: number;
  /** 行内容 */
  lineContent: string;
  /** 匹配位置列表 */
  positions: MatchPosition[];
  /** 上下文行（之前） */
  contextBefore?: string[];
  /** 上下文行（之后） */
  contextAfter?: string[];
}

/**
 * 匹配位置
 */
export interface MatchPosition {
  /** 起始位置（在行内） */
  start: number;
  /** 结束位置（在行内） */
  end: number;
  /** 匹配的文本 */
  matchedText: string;
}

/**
 * 文件搜索选项
 */
export interface FileSearchOptions {
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 是否全词匹配 */
  wholeWord?: boolean;
  /** 是否使用正则表达式 */
  useRegex?: boolean;
  /** 是否模糊匹配 */
  fuzzy?: boolean;
  /** 模糊匹配阈值 */
  fuzzyThreshold?: number;
  /** 最大匹配数（每文件） */
  maxMatchesPerFile?: number;
  /** 最大匹配文件数 */
  maxFiles?: number;
  /** 上下文行数 */
  contextLines?: number;
  /** 包含的文件模式（glob） */
  includePatterns?: string[];
  /** 排除的文件模式（glob） */
  excludePatterns?: string[];
  /** 最大文件大小（字节） */
  maxFileSize?: number;
  /** 并行度 */
  concurrency?: number;
  /** 进度回调 */
  onProgress?: (processed: number, total: number, currentFile: string) => void;
  /** 文件匹配回调（流式） */
  onFileMatch?: (match: FileMatch) => void;
  /** 是否可取消 */
  abortSignal?: AbortSignal;
}

/**
 * 搜索统计
 */
export interface SearchStats {
  /** 搜索的文件数 */
  filesSearched: number;
  /** 匹配的文件数 */
  filesMatched: number;
  /** 总匹配数 */
  totalMatches: number;
  /** 总耗时 */
  totalTimeMs: number;
  /** 跳过的文件数 */
  filesSkipped: number;
  /** 错误文件数 */
  filesErrored: number;
}

/**
 * 批量搜索结果
 */
export interface BatchSearchResult {
  /** 查询字符串 */
  query: string;
  /** 匹配结果 */
  results: FileMatch[];
  /** 统计信息 */
  stats: SearchStats;
}

/**
 * 文件提供者接口
 */
export interface IFileProvider {
  /** 列出文件路径 */
  listFiles(patterns?: string[], excludePatterns?: string[]): Promise<string[]>;
  /** 读取文件内容 */
  readFile(path: string): Promise<string>;
  /** 获取文件大小 */
  getFileSize(path: string): Promise<number>;
  /** 获取文件名 */
  getFileName(path: string): string;
}

/**
 * 默认搜索选项
 */
const DEFAULT_OPTIONS: Required<
  Omit<FileSearchOptions, 'onProgress' | 'onFileMatch' | 'abortSignal'>
> = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  fuzzy: false,
  fuzzyThreshold: 0.7,
  maxMatchesPerFile: 1000,
  maxFiles: 1000,
  contextLines: 2,
  includePatterns: [],
  excludePatterns: ['node_modules/**', '.git/**', '*.min.js', '*.map'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  concurrency: 4,
};

// ================================
// FileSearcher 类
// ================================

/**
 * 文件搜索器
 *
 * 支持大量文件的并行内容搜索。
 *
 * @example
 * ```typescript
 * const searcher = new FileSearcher(fileProvider);
 *
 * // 简单搜索
 * const result = await searcher.search('TODO', {
 *   includePatterns: ['**\/*.ts'],
 *   contextLines: 2,
 * });
 *
 * // 正则搜索
 * const regexResult = await searcher.search('function\\s+\\w+', {
 *   useRegex: true,
 * });
 *
 * // 流式搜索
 * await searcher.search('error', {
 *   onFileMatch: (match) => {
 *     console.log(`Found ${match.matchCount} matches in ${match.path}`);
 *   },
 * });
 * ```
 */
export class FileSearcher {
  private readonly fileProvider: IFileProvider;

  constructor(fileProvider: IFileProvider) {
    this.fileProvider = fileProvider;
  }

  // ================================
  // 搜索方法
  // ================================

  /**
   * 在文件中搜索
   */
  async search(query: string, options: FileSearchOptions = {}): Promise<BatchSearchResult> {
    const startTime = performance.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const stats: SearchStats = {
      filesSearched: 0,
      filesMatched: 0,
      totalMatches: 0,
      totalTimeMs: 0,
      filesSkipped: 0,
      filesErrored: 0,
    };

    const results: FileMatch[] = [];

    // 检查空查询
    if (!query.trim()) {
      return { query, results, stats };
    }

    // 创建匹配器
    const matcher = this.createMatcher(query, opts);

    // 获取文件列表
    const files = await this.fileProvider.listFiles(
      opts.includePatterns.length > 0 ? opts.includePatterns : undefined,
      opts.excludePatterns
    );

    // 限制文件数量
    const filesToSearch = files.slice(0, opts.maxFiles);
    const totalFiles = filesToSearch.length;

    // 并行搜索文件
    const concurrency = Math.min(opts.concurrency, filesToSearch.length);
    const chunks = this.chunkArray(filesToSearch, concurrency);

    for (const chunk of chunks) {
      // 检查取消
      if (opts.abortSignal?.aborted) {
        break;
      }

      const chunkResults = await Promise.all(
        chunk.map(async (filePath) => {
          try {
            // 检查文件大小
            const fileSize = await this.fileProvider.getFileSize(filePath);
            if (fileSize > opts.maxFileSize) {
              stats.filesSkipped++;
              return null;
            }

            // 搜索文件
            const fileMatch = await this.searchFile(filePath, fileSize, matcher, opts);

            stats.filesSearched++;

            // 报告进度
            opts.onProgress?.(stats.filesSearched, totalFiles, filePath);

            if (fileMatch && fileMatch.matchCount > 0) {
              stats.filesMatched++;
              stats.totalMatches += fileMatch.matchCount;
              opts.onFileMatch?.(fileMatch);
              return fileMatch;
            }

            return null;
          } catch (error) {
            stats.filesErrored++;
            return null;
          }
        })
      );

      // 收集结果
      for (const result of chunkResults) {
        if (result) {
          results.push(result);
        }
      }
    }

    const endTime = performance.now();
    stats.totalTimeMs = endTime - startTime;

    return { query, results, stats };
  }

  /**
   * 搜索单个文件
   */
  async searchFile(
    filePath: string,
    fileSize: number,
    matcher: IMatcher,
    opts: Required<Omit<FileSearchOptions, 'onProgress' | 'onFileMatch' | 'abortSignal'>>
  ): Promise<FileMatch | null> {
    const startTime = performance.now();

    try {
      const content = await this.fileProvider.readFile(filePath);
      const lines = content.split('\n');
      const matches: LineMatch[] = [];

      for (let i = 0; i < lines.length && matches.length < opts.maxMatchesPerFile; i++) {
        const line = lines[i];
        const positions = matcher.match(line);

        if (positions.length > 0) {
          const lineMatch: LineMatch = {
            lineNumber: i + 1,
            lineContent: line,
            positions,
          };

          // 添加上下文
          if (opts.contextLines > 0) {
            const beforeStart = Math.max(0, i - opts.contextLines);
            const afterEnd = Math.min(lines.length, i + opts.contextLines + 1);

            lineMatch.contextBefore = lines.slice(beforeStart, i);
            lineMatch.contextAfter = lines.slice(i + 1, afterEnd);
          }

          matches.push(lineMatch);
        }
      }

      if (matches.length === 0) {
        return null;
      }

      const endTime = performance.now();

      return {
        path: filePath,
        filename: this.fileProvider.getFileName(filePath),
        matches,
        matchCount: matches.reduce((sum, m) => sum + m.positions.length, 0),
        fileSize,
        searchTimeMs: endTime - startTime,
      };
    } catch {
      return null;
    }
  }

  /**
   * 在内容中搜索（不读取文件）
   */
  searchContent(content: string, query: string, options: FileSearchOptions = {}): LineMatch[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const matcher = this.createMatcher(query, opts);
    const lines = content.split('\n');
    const matches: LineMatch[] = [];

    for (let i = 0; i < lines.length && matches.length < opts.maxMatchesPerFile; i++) {
      const line = lines[i];
      const positions = matcher.match(line);

      if (positions.length > 0) {
        const lineMatch: LineMatch = {
          lineNumber: i + 1,
          lineContent: line,
          positions,
        };

        if (opts.contextLines > 0) {
          const beforeStart = Math.max(0, i - opts.contextLines);
          const afterEnd = Math.min(lines.length, i + opts.contextLines + 1);

          lineMatch.contextBefore = lines.slice(beforeStart, i);
          lineMatch.contextAfter = lines.slice(i + 1, afterEnd);
        }

        matches.push(lineMatch);
      }
    }

    return matches;
  }

  /**
   * 替换文件内容
   */
  async replace(
    query: string,
    replacement: string,
    files: string[],
    options: FileSearchOptions = {}
  ): Promise<Array<{ path: string; replacements: number; newContent: string }>> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const matcher = this.createMatcher(query, opts);
    const results: Array<{ path: string; replacements: number; newContent: string }> = [];

    for (const filePath of files) {
      try {
        const content = await this.fileProvider.readFile(filePath);
        const { newContent, count } = this.replaceInContent(content, matcher, replacement, opts);

        if (count > 0) {
          results.push({
            path: filePath,
            replacements: count,
            newContent,
          });
        }
      } catch {
        // 跳过读取失败的文件
      }
    }

    return results;
  }

  /**
   * 在内容中替换
   */
  replaceInContent(
    content: string,
    matcher: IMatcher,
    replacement: string,
    _opts: Required<Omit<FileSearchOptions, 'onProgress' | 'onFileMatch' | 'abortSignal'>>
  ): { newContent: string; count: number } {
    const lines = content.split('\n');
    let count = 0;

    const newLines = lines.map((line) => {
      const positions = matcher.match(line);

      if (positions.length === 0) {
        return line;
      }

      // 从后向前替换以避免位置偏移
      let newLine = line;
      const sortedPositions = [...positions].sort((a, b) => b.start - a.start);

      for (const pos of sortedPositions) {
        newLine = newLine.substring(0, pos.start) + replacement + newLine.substring(pos.end);
        count++;
      }

      return newLine;
    });

    return {
      newContent: newLines.join('\n'),
      count,
    };
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 创建匹配器
   */
  private createMatcher(
    query: string,
    opts: Required<Omit<FileSearchOptions, 'onProgress' | 'onFileMatch' | 'abortSignal'>>
  ): IMatcher {
    if (opts.useRegex) {
      return new RegexMatcher(query, opts.caseSensitive);
    }

    if (opts.fuzzy) {
      return new FuzzyMatcher(query, opts.fuzzyThreshold, opts.caseSensitive);
    }

    return new LiteralMatcher(query, opts.caseSensitive, opts.wholeWord);
  }

  /**
   * 分割数组为多个块
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// ================================
// 匹配器接口和实现
// ================================

/**
 * 匹配器接口
 */
interface IMatcher {
  match(text: string): MatchPosition[];
}

/**
 * 字面量匹配器
 */
class LiteralMatcher implements IMatcher {
  private readonly query: string;
  private readonly caseSensitive: boolean;
  private readonly wholeWord: boolean;

  constructor(query: string, caseSensitive: boolean, wholeWord: boolean) {
    this.query = caseSensitive ? query : query.toLowerCase();
    this.caseSensitive = caseSensitive;
    this.wholeWord = wholeWord;
  }

  match(text: string): MatchPosition[] {
    const positions: MatchPosition[] = [];
    const searchText = this.caseSensitive ? text : text.toLowerCase();

    let pos = 0;
    while ((pos = searchText.indexOf(this.query, pos)) !== -1) {
      // 检查全词匹配
      if (this.wholeWord) {
        const before = pos > 0 ? searchText[pos - 1] : ' ';
        const after =
          pos + this.query.length < searchText.length ? searchText[pos + this.query.length] : ' ';

        if (this.isWordChar(before) || this.isWordChar(after)) {
          pos++;
          continue;
        }
      }

      positions.push({
        start: pos,
        end: pos + this.query.length,
        matchedText: text.substring(pos, pos + this.query.length),
      });

      pos++;
    }

    return positions;
  }

  private isWordChar(char: string): boolean {
    return /\w/.test(char);
  }
}

/**
 * 正则表达式匹配器
 */
class RegexMatcher implements IMatcher {
  private readonly regex: RegExp;

  constructor(pattern: string, caseSensitive: boolean) {
    this.regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  }

  match(text: string): MatchPosition[] {
    const positions: MatchPosition[] = [];
    this.regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this.regex.exec(text)) !== null) {
      positions.push({
        start: match.index,
        end: match.index + match[0].length,
        matchedText: match[0],
      });

      // 防止空匹配导致无限循环
      if (match[0].length === 0) {
        this.regex.lastIndex++;
      }
    }

    return positions;
  }
}

/**
 * 模糊匹配器
 */
class FuzzyMatcher implements IMatcher {
  private readonly query: string;
  private readonly threshold: number;
  private readonly caseSensitive: boolean;

  constructor(query: string, threshold: number, caseSensitive: boolean) {
    this.query = caseSensitive ? query : query.toLowerCase();
    this.threshold = threshold;
    this.caseSensitive = caseSensitive;
  }

  match(text: string): MatchPosition[] {
    const positions: MatchPosition[] = [];
    const searchText = this.caseSensitive ? text : text.toLowerCase();

    // 使用滑动窗口进行模糊匹配
    const windowSize = Math.ceil(this.query.length * 1.5);

    for (let i = 0; i <= searchText.length - this.query.length; i++) {
      const window = searchText.substring(i, i + windowSize);
      const similarity = this.calculateSimilarity(
        this.query,
        window.substring(0, this.query.length)
      );

      if (similarity >= this.threshold) {
        // 找到更精确的匹配边界
        const matchEnd = this.findMatchEnd(searchText, i, this.query);

        positions.push({
          start: i,
          end: matchEnd,
          matchedText: text.substring(i, matchEnd),
        });

        // 跳过已匹配的部分
        i = matchEnd - 1;
      }
    }

    return positions;
  }

  private calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const len1 = s1.length;
    const len2 = s2.length;

    // 使用编辑距离计算相似度
    const matrix: number[][] = Array.from({ length: len1 + 1 }, (_, i) =>
      Array.from({ length: len2 + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    return 1 - distance / Math.max(len1, len2);
  }

  private findMatchEnd(text: string, start: number, query: string): number {
    // 简单实现：返回查询长度
    return Math.min(start + query.length, text.length);
  }
}

// ================================
// 内存文件提供者（用于测试）
// ================================

/**
 * 内存文件提供者
 */
export class MemoryFileProvider implements IFileProvider {
  private files: Map<string, string> = new Map();

  constructor(files?: Record<string, string>) {
    if (files) {
      for (const [path, content] of Object.entries(files)) {
        this.files.set(path, content);
      }
    }
  }

  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  removeFile(path: string): void {
    this.files.delete(path);
  }

  async listFiles(patterns?: string[], excludePatterns?: string[]): Promise<string[]> {
    let paths = Array.from(this.files.keys());

    // 简单的模式匹配
    if (patterns && patterns.length > 0) {
      paths = paths.filter((path) => patterns.some((pattern) => this.matchPattern(path, pattern)));
    }

    if (excludePatterns && excludePatterns.length > 0) {
      paths = paths.filter(
        (path) => !excludePatterns.some((pattern) => this.matchPattern(path, pattern))
      );
    }

    return paths;
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async getFileSize(path: string): Promise<number> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content.length;
  }

  getFileName(path: string): string {
    return path.split('/').pop() || path;
  }

  private matchPattern(path: string, pattern: string): boolean {
    // 简化的 glob 匹配
    const regexPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.');

    return new RegExp(`^${regexPattern}$`).test(path);
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建文件搜索器
 */
export function createFileSearcher(fileProvider: IFileProvider): FileSearcher {
  return new FileSearcher(fileProvider);
}

/**
 * 创建内存文件搜索器（用于测试）
 */
export function createMemoryFileSearcher(files?: Record<string, string>): FileSearcher {
  return new FileSearcher(new MemoryFileProvider(files));
}

// ================================
// 便捷函数
// ================================

/**
 * 在内容中快速搜索
 */
export function quickContentSearch(
  content: string,
  query: string,
  options?: FileSearchOptions
): LineMatch[] {
  const searcher = new FileSearcher(new MemoryFileProvider());
  return searcher.searchContent(content, query, options);
}

/**
 * 在内容中快速正则搜索
 */
export function quickRegexSearch(
  content: string,
  pattern: string,
  caseSensitive: boolean = false
): LineMatch[] {
  return quickContentSearch(content, pattern, {
    useRegex: true,
    caseSensitive,
  });
}

/**
 * 高亮搜索结果
 */
export function highlightMatches(
  text: string,
  positions: MatchPosition[],
  prefix: string = '<mark>',
  suffix: string = '</mark>'
): string {
  if (positions.length === 0) return text;

  // 从后向前替换
  const sorted = [...positions].sort((a, b) => b.start - a.start);
  let result = text;

  for (const pos of sorted) {
    result =
      result.substring(0, pos.start) +
      prefix +
      result.substring(pos.start, pos.end) +
      suffix +
      result.substring(pos.end);
  }

  return result;
}
